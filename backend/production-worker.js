import {timingSafeEqual} from 'node:crypto';
import {createD1Repository} from './d1/repository.js';
import {createWorker} from './worker.js';
import {createStagingCommandExecutor} from './staging-command-executor.js';
import {createMvpRateLimit} from './staging-mvp.js';
import {stagingOperatorState,automaticSyncStatus} from './staging-operator-state.js';
import {createOAuthRouter} from './oauth-http.js';
import {createOAuthService} from '../auth/oauth-service.js';
import {createStravaAdapter} from '../auth/strava-adapter.js';
import {createTokenVault} from '../auth/token-vault.js';
import {hashSecret,newSecret,transitionInvitation} from '../auth/invitation-machine.js';
import {createActivityClient} from './strava-activities.js';
import {createActivitySync} from './activity-sync.js';
import {createPilotTransport} from './pilot-budget.js';
import {startInstant} from '../policy/distance-policy.js';
import {PRODUCTION_TARGET,PRODUCTION_DATASET,PRODUCTION_MIGRATION,PRODUCTION_SETTINGS,PRODUCTION_ADMIN_PATH,PRODUCTION_CRON,requireProductionTarget} from './production-target.js';
import {validateProductionCommand} from './production-command.js';

const pagesOrigin = 'https://plopesc.github.io';
const start = startInstant(PRODUCTION_SETTINGS.startDate,PRODUCTION_SETTINGS.timeZone);
const owner = Object.freeze({authenticated:true,role:'owner'});
const limits = Object.freeze({perOperation:24,perQuarter:40,perDay:120,maxPages:5,maxRecords:400});
const headers = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply = (status,code,extra={}) => Response.json({status:code},{status,headers:{...headers,...extra}});
const validToken = token => typeof token === 'string' && /^[\w-]{43}$/.test(token) && Buffer.from(token,'base64url').toString('base64url') === token;

export function createProductionWorker({target=PRODUCTION_TARGET,clock=Date.now,fetchProvider,admit=createMvpRateLimit(clock)}={}) {
  async function repository(env) {
    if (env.APP_ENV !== PRODUCTION_DATASET || !env.DB) throw Error('production_disabled');
    const history = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all();
    if (!history.success || history.results?.length !== 1 || history.results[0].name !== PRODUCTION_MIGRATION) throw Error('production_schema_mismatch');
    const tables = await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'").all();
    const expected = ['d1_migrations',...['game_state','transaction_guard','participants','activities','rewards','invitations','oauth_attempts','oauth_credentials','oauth_sessions'].map(name=>'production_'+name)];
    if (!tables.success || tables.results?.length !== expected.length || tables.results.some(({name})=>!expected.includes(name))) throw Error('production_database_not_exclusive');
    const repo = createD1Repository(env.DB,{dataset:PRODUCTION_DATASET,settings:PRODUCTION_SETTINGS});
    const {state} = await repo.read();
    if (Object.entries(PRODUCTION_SETTINGS).some(([key,value])=>state.policy.config[key]!==value)) throw Error('production_challenge_mismatch');
    return repo;
  }

  function runtime(repo,env,origin) {
    const networkReady = () => {
      if (clock()<start || env.PRODUCTION_OAUTH !== 'owner-enabled' ||
          !/^[1-9]\d*$/.test(env.STRAVA_CLIENT_ID??'') || !env.STRAVA_CLIENT_SECRET) throw Error('production_oauth_disabled');
    };
    function oauth() {
      networkReady();
      const version = env.TOKEN_ENCRYPTION_KEY_VERSION;
      if (version !== 'v1') throw Error('production_vault_unavailable');
      const vault = createTokenVault({keys:{[version]:env.TOKEN_ENCRYPTION_KEY},activeVersion:version,domain:PRODUCTION_DATASET});
      const transport = createPilotTransport({repository:repo,ready:networkReady,fetchProvider,clock,limits,budgetKey:'productionBudget'});
      const provider = createStravaAdapter({enabled:true,clientId:env.STRAVA_CLIENT_ID,clientSecret:env.STRAVA_CLIENT_SECRET,fetchProvider:transport});
      return {vault,provider,transport,service:createOAuthService({repository:repo,provider,vault,origin,clock})};
    }
    return {
      repository:repo,oauth,
      admin:{
        async issue({slot,expectedAthleteId,fence}) {
          await oauth().vault.ready();
          const token=newSecret(), now=clock(), expectedAccountHash=hashSecret(String(expectedAthleteId));
          await repo.updatePrivate(state=>{
            const current=state.auth.slots.find(entry=>entry.id===slot);
            if (!fence(state) || (current?.accountHash && current.accountHash!==expectedAccountHash) ||
                state.auth.slots.some(entry=>entry.id!==slot && (entry.accountHash===expectedAccountHash || entry.expectedAccountHash===expectedAccountHash))) throw Error('invalid_invitation');
            const next=transitionInvitation(state.auth,{type:'issue',actor:owner,now,slot,expectedAccountHash,tokenHash:hashSecret(token),expiresAt:now+3600000});
            if (!next.result.ok) throw Error('invalid_invitation');
            state.auth=next.state;
          });
          return `${origin}/invite#${token}`;
        },
        async sync({automatic=false,fence=()=>true}={}) {
          const initial=stagingOperatorState((await repo.read()).state);
          if (initial.syncDisabled || (automatic && !initial.autoSyncEnabled)) return {status:'disabled'};
          const {service,transport}=oauth();
          const allowed = state => {
            const control=stagingOperatorState(state);
            return !control.syncDisabled && control.epoch===initial.epoch &&
              (!automatic || (control.autoSyncEnabled && control.autoSyncEpoch===initial.autoSyncEpoch)) && fence(state);
          };
          const client=createActivityClient({enabled:true,fetchProvider:transport});
          const result=await createActivitySync({repository:repo,oauth:service,clock,client,allowed,
            snapshotOptions:{maxPages:limits.maxPages,maxRecords:limits.maxRecords}}).run();
          if (automatic) await repo.updatePrivate(state=>{
            if (allowed(state)) stagingOperatorState(state).lastAutomaticSync={at:new Date(clock()).toISOString(),status:automaticSyncStatus(result.status)};
          });
          return result;
        },
      },
    };
  }

  async function admin(request,env,origin) {
    if (request.method!=='POST') return reply(405,'rejected');
    if (request.headers.has('Origin') || request.headers.has('Cookie') || ['Sec-Fetch-Site','Sec-Fetch-Dest','Sec-Fetch-User'].some(key=>request.headers.has(key))) return reply(403,'rejected');
    if (!admit()) return reply(429,'limited');
    const token=request.headers.get('Authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];
    if (!validToken(token) || !validToken(env.PRODUCTION_ADMIN_TOKEN) ||
        !timingSafeEqual(Buffer.from(token),Buffer.from(env.PRODUCTION_ADMIN_TOKEN))) return reply(401,'rejected');
    if (request.headers.get('Content-Type')!=='application/json' || !request.body) return reply(400,'rejected');
    let command;
    try {
      const chunks=[];
      let bytes=0;
      for await (const chunk of request.body) {
        bytes+=chunk.byteLength;
        if (bytes>2048) return reply(413,'rejected');
        chunks.push(chunk);
      }
      command=validateProductionCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')),clock());
    } catch { return reply(400,'rejected'); }
    const repo=await repository(env);
    const allowed=await repo.updatePrivate(state=>{
      const minute=Math.floor(clock()/60000),day=Math.floor(minute/1440);
      const quota=state.productionAdminQuota??={minute,day,minuteCount:0,dayCount:0};
      if(quota.minute!==minute){quota.minute=minute;quota.minuteCount=0;}
      if(quota.day!==day){quota.day=day;quota.dayCount=0;}
      if(quota.minuteCount>=20 || quota.dayCount>=200) return false;
      quota.minuteCount++;quota.dayCount++;
      return true;
    });
    if (!allowed) return reply(429,'limited');
    const result=await createStagingCommandExecutor({runtime:runtime(repo,env,origin),clock,budgetKey:'productionBudget'}).execute(command);
    return Response.json(result,{headers});
  }

  return {
    async scheduled(event,env) {
      if(event?.cron!==PRODUCTION_CRON) return {status:'ignored'};
      try {
        const {origin}=requireProductionTarget(target);
        if (env.PRODUCTION_OAUTH!=='owner-enabled' || clock()<start) return {status:'disabled'};
        return await runtime(await repository(env),env,origin).admin.sync({automatic:true});
      } catch { return {status:'unavailable'}; }
    },
    async fetch(request,env) {
      const url=new URL(request.url);
      const isProgress=url.pathname==='/api/progress' && request.method==='GET' && !url.search;
      const requestedOrigin=request.headers.get('Origin');
      const crossOrigin=isProgress && requestedOrigin===pagesOrigin && !request.headers.has('Cookie') && !request.headers.has('Authorization');
      const cors=crossOrigin?{'Access-Control-Allow-Origin':pagesOrigin,Vary:'Origin'}:{Vary:'Origin'};
      try {
        const {origin}=requireProductionTarget(target);
        if(url.origin!==origin || url.username || url.password || url.hash || (url.search && url.pathname!=='/oauth/callback')) return reply(400,'rejected',cors);
        if(url.pathname===PRODUCTION_ADMIN_PATH) return await admin(request,env,origin);
        if(url.pathname==='/api/progress') {
          if(!isProgress) return reply(405,'rejected',cors);
          if ((requestedOrigin && !crossOrigin) || request.headers.has('Cookie') || request.headers.has('Authorization')) return reply(403,'rejected',cors);
          const repo=await repository(env);
          const response=await createWorker({repository:repo,source:'strava',allowedOrigins:[pagesOrigin]}).fetch(request);
          const resultHeaders=new Headers(response.headers);
          if(response.ok) {
            resultHeaders.set('X-Challenge-Start',PRODUCTION_SETTINGS.startDate);
            resultHeaders.set('X-Challenge-Environment','production');
            if(crossOrigin) resultHeaders.set('Access-Control-Expose-Headers','X-Challenge-Start, X-Challenge-Environment');
          }
          return new Response(response.body,{status:response.status,headers:resultHeaders});
        }
        if (!['/invite','/invite/start','/oauth/callback','/oauth/result'].includes(url.pathname)) return reply(404,'rejected');
        if(env.PRODUCTION_OAUTH!=='owner-enabled' || clock()<start) return reply(404,'rejected');
        const {service,provider,vault}=runtime(await repository(env),env,origin).oauth();
        await vault.ready();
        return await createOAuthRouter({service,provider,origin,label:'Alberto y Belén · Conexión privada'}).fetch(request);
      } catch { return reply(503,'unavailable',isProgress?cors:{}); }
    },
  };
}
