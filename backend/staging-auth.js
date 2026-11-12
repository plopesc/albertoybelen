import {createD1Repository} from './d1/repository.js';
import {createTokenVault} from '../auth/token-vault.js';
import {createOAuthService} from '../auth/oauth-service.js';
import {createStravaAdapter} from '../auth/strava-adapter.js';
import {hashSecret,newSecret,transitionInvitation} from '../auth/invitation-machine.js';
import {createOAuthRouter} from './oauth-http.js';
import {createWorker} from './worker.js';
import {createActivitySync} from './activity-sync.js';
import {createActivityClient} from './strava-activities.js';
import {createPilotTransport} from './pilot-budget.js';
import {STAGING_AUTH_ORIGIN as origin,STAGING_AUTH_DATASET as dataset,STAGING_AUTH_SETTINGS as settings,STAGING_AUTH_ENABLE,STAGING_NETWORK_ENABLE,STAGING_AUTH_LIMITS as limits} from './staging-auth-settings.js';

/** Private capabilities are returned to trusted code, NEVER dispatched from HTTP. */
export function createStagingAuth(env,{fetchProvider,clock=Date.now}={}) {
  if (env.APP_ENV !== 'staging-strava-test' || !env.DB || env.STAGING_AUTH_ENABLED !== STAGING_AUTH_ENABLE) throw Error('staging_auth_disabled');
  const repository=createD1Repository(env.DB,{settings,dataset});
  const version=env.TOKEN_ENCRYPTION_KEY_VERSION;
  if (!/^[a-zA-Z0-9-]{1,32}$/.test(version??'') || env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION === version) throw Error('vault_unavailable');
  const keys={[version]:env.TOKEN_ENCRYPTION_KEY};
  if(env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION) keys[env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION]=env.TOKEN_PREVIOUS_ENCRYPTION_KEY;
  const vault=createTokenVault({keys,activeVersion:version,domain:dataset});
  async function ready() {
    if(env.APP_ENV!=='staging-strava-test'||env.STAGING_AUTH_ENABLED!==STAGING_AUTH_ENABLE)throw Error('staging_auth_disabled');
    await vault.ready();
    const {state}=await repository.read();
    if (Object.keys(settings).some(k=>state.policy.config[k]!==settings[k]) || state.auth.slots.length!==2 || new Set(state.auth.slots.map(s=>s.id)).size!==2 || state.auth.slots.some(s=>!['slot-a','slot-b'].includes(s.id))) throw Error('staging_dataset_mismatch');
  }
  async function networkReady() {
    await ready();
    // Injection is for local mocks. Deployed code requires an additional explicit switch.
    if (!fetchProvider && env.STAGING_NETWORK_ENABLED !== STAGING_NETWORK_ENABLE) throw Error('staging_network_disabled');
    if (!/^[1-9]\d*$/.test(env.STRAVA_CLIENT_ID??'') || typeof env.STRAVA_CLIENT_SECRET!=='string' || !env.STRAVA_CLIENT_SECRET.trim()) throw Error('staging_configuration_incomplete');
  }
  const transport=createPilotTransport({repository,ready:networkReady,fetchProvider,clock,limits,budgetKey:'stagingBudget'});
  const adapter=createStravaAdapter({enabled:true,clientId:env.STRAVA_CLIENT_ID,clientSecret:env.STRAVA_CLIENT_SECRET,fetchProvider:transport});
  const provider={...adapter,async authorizeUrl(options){await networkReady();return adapter.authorizeUrl(options);}};
  const service=createOAuthService({repository,provider,vault,origin,clock});
  const router=createOAuthRouter({service,provider,origin,label:'Staging · conexión de prueba',publicWorker:createWorker({repository,source:'strava',allowedOrigins:[origin],loadFixture:async()=>[]})});
  const syncClient=createActivityClient({enabled:true,fetchProvider:transport});
  const owner=actor=>{if(actor?.authenticated!==true||actor.role!=='owner')throw Error('private_operator_required');};
  return {
    repository,service,vault,
    async fetch(request) {
      const url=new URL(request.url);
      // Do not trust forwarded headers, wildcard hostnames or alternative ports remotely.
      if(url.origin!==origin || url.username || url.password) return new Response('Request rejected',{status:400,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      if(url.pathname!=='/oauth/callback' && url.search) return new Response('Request rejected',{status:400,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      await ready();
      return router.fetch(request);
    },
    admin:{
      async issue({actor,slot,expectedAthleteId,fence=()=>true}) {
        owner(actor);await ready();
        if(!['slot-a','slot-b'].includes(slot)||!Number.isSafeInteger(expectedAthleteId)||expectedAthleteId<=0)throw Error('invalid_invitation');
        const token=newSecret(),now=clock(),expectedAccountHash=hashSecret(String(expectedAthleteId));
        const ok=await repository.updatePrivate(state=>{
          if(!fence(state))throw Error('operator_lease_expired');
          if(state.auth.slots.some(s=>s.id!==slot&&(s.accountHash===expectedAccountHash||s.expectedAccountHash===expectedAccountHash)))return false;
          const next=transitionInvitation(state.auth,{type:'issue',actor,now,slot,expectedAccountHash,tokenHash:hashSecret(token),expiresAt:now+3600000});
          state.auth=next.state;return next.result.ok;
        });
        if(!ok)throw Error('invalid_invitation');
        return `${origin}/invite#${token}`;
      },
      async sync({actor,fence=()=>true}) {
        owner(actor);await networkReady();
        const initial=(await repository.read()).state,epoch=initial.stagingOperator?.epoch??0;
        return createActivitySync({repository,oauth:service,clock,client:syncClient,snapshotOptions:{maxPages:limits.maxPages,maxRecords:limits.maxRecords},allowed:state=>state.stagingOperator?.syncDisabled!==true&&(state.stagingOperator?.epoch??0)===epoch&&fence(state)}).run();
      },
      async revoke({actor,slot}) {owner(actor);await ready();return repository.transitionAuth({type:'revoke',actor,slot,now:clock()});},
      async erase({actor,slot,verified=false,purgeMilestones=false}) {
        owner(actor);await ready();if(verified!==true)throw Error('verified_deletion_required');
        return repository.transitionAuth({type:'delete',actor,slot,now:clock(),requestVerified:true,purgeMilestones:purgeMilestones===true});
      },
      async rotate({actor,slot,fence=()=>true}) {owner(actor);await ready();return service.rotate(slot,{fence});},
    },
  };
}
