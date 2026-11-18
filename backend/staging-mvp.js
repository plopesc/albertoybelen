import {timingSafeEqual} from 'node:crypto';
import {createStagingAuth} from './staging-auth.js';
import {createStagingCommandExecutor} from './staging-command-executor.js';
import {MVP_ENABLE,MVP_READY,MVP_ADMIN_PATH,MVP_AUTO_SYNC_CRON,MVP_ORIGIN,validateMvpCommand} from './staging-mvp-policy.js';
import {STAGING_AUTH_ENABLE,STAGING_NETWORK_ENABLE} from './staging-auth-settings.js';
const headers={'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const PAGES_READ_ORIGIN='https://plopesc.github.io';
const response=(status,code)=>Response.json({status:code},{status,headers});
const migrations=['0001_local_game.sql','0002_oauth_vault.sql','0003_staging_auth_test.sql'];
const tokenValid=value=>typeof value==='string'&&/^[\w-]{43}$/.test(value)&&Buffer.from(value,'base64url').length===32&&Buffer.from(value,'base64url').toString('base64url')===value;
export function createMvpRateLimit(clock=Date.now) {
  let minute=-1,requests=0;
  // This limiter is deliberately per isolate. Authenticated quotas/replay are durable in D1.
  return ()=>{const m=Math.floor(clock()/60000);if(m!==minute){minute=m;requests=0;}return ++requests<=60;};
}
export function createStagingMvp(env,{clock=Date.now,fetchProvider,admit=createMvpRateLimit(clock)}={}) {
  const publicProgressResponse=(request,result)=>{
    const url=new URL(request.url);
    if(url.pathname!=='/api/progress'||url.search||request.method!=='GET'){
      if(!result.headers.has('Access-Control-Allow-Origin'))return result;
      const responseHeaders=new Headers(result.headers);for(const key of ['Access-Control-Allow-Origin','Access-Control-Allow-Methods','Access-Control-Allow-Headers','Access-Control-Allow-Credentials','Access-Control-Expose-Headers'])responseHeaders.delete(key);
      return new Response(result.body,{status:result.status,statusText:result.statusText,headers:responseHeaders});
    }
    const responseHeaders=new Headers(result.headers);responseHeaders.set('Cache-Control','no-store');responseHeaders.append('Vary','Origin');
    const origin=request.headers.get('Origin');
    if(origin===PAGES_READ_ORIGIN&&!request.headers.has('Cookie')&&!request.headers.has('Authorization'))responseHeaders.set('Access-Control-Allow-Origin',PAGES_READ_ORIGIN);
    else responseHeaders.delete('Access-Control-Allow-Origin');
    for(const key of ['Access-Control-Allow-Methods','Access-Control-Allow-Headers','Access-Control-Allow-Credentials','Access-Control-Expose-Headers'])responseHeaders.delete(key);
    return new Response(result.body,{status:result.status,statusText:result.statusText,headers:responseHeaders});
  };
  async function runtime() {
    if(env.APP_ENV!=='staging-strava-test'||env.STAGING_MVP_ENABLED!==MVP_ENABLE||env.STAGING_MVP_READY!==MVP_READY||env.STAGING_AUTH_ENABLED!==STAGING_AUTH_ENABLE||env.STAGING_NETWORK_ENABLED!==STAGING_NETWORK_ENABLE||!tokenValid(env.STAGING_ADMIN_TOKEN)||!env.DB||!/^[1-9]\d*$/.test(env.STRAVA_CLIENT_ID??'')||typeof env.STRAVA_CLIENT_SECRET!=='string'||!env.STRAVA_CLIENT_SECRET.trim())throw Error('closed');
    // No initialize/migration before this independent read-only schema/history check.
    const rows=await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').bind().all();
    if(rows.success===false||!Array.isArray(rows.results)||JSON.stringify(rows.results.map(r=>r.name))!==JSON.stringify(migrations))throw Error('closed');
    const api=createStagingAuth(env,{clock,fetchProvider,progressOrigins:[MVP_ORIGIN,PAGES_READ_ORIGIN]});await api.vault.ready();return api;
  }
  return {async scheduled(event,env,context) {
    if(event?.cron!==MVP_AUTO_SYNC_CRON)return{status:'ignored'};
    const work=(async()=>{try{return await(await runtime()).admin.sync({actor:{authenticated:true,role:'owner'},automatic:true});}catch{return{status:'unavailable'};}})();
    context?.waitUntil(work);return work;
  },async fetch(request) {
    const url=new URL(request.url);
    if(url.origin!==MVP_ORIGIN||url.username||url.password||url.hash||(url.pathname!=='/oauth/callback'&&url.search))return response(400,'rejected');
    if(url.pathname===MVP_ADMIN_PATH) {
      if(request.method!=='POST')return response(405,'rejected');
      if(request.headers.has('Origin')||request.headers.has('Cookie')||['Sec-Fetch-Site','Sec-Fetch-Dest','Sec-Fetch-User'].some(k=>request.headers.has(k)))return response(403,'rejected');
      if(!admit())return response(429,'limited');
      const authorization=request.headers.get('Authorization')??'';
      if(!tokenValid(env.STAGING_ADMIN_TOKEN)||!/^Bearer [\w-]{43}$/.test(authorization)||!timingSafeEqual(Buffer.from(authorization.slice(7)),Buffer.from(env.STAGING_ADMIN_TOKEN)))return response(401,'rejected');
      if(request.headers.get('Content-Type')!=='application/json')return response(400,'rejected');
      try {
        const reader=request.body?.getReader();if(!reader)return response(400,'rejected');
        const chunks=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return response(413,'rejected');}chunks.push(value);}}
        finally{reader.releaseLock();}
        let command;try{command=validateMvpCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')),clock());}catch{return response(400,'rejected');}
        const api=await runtime();
        const quota=await api.repository.updatePrivate(state=>{
          const now=clock(),minute=Math.floor(now/60000),day=Math.floor(now/86400000);
          const q=state.stagingAdminQuota??={minute,day,minuteCount:0,dayCount:0};
          if(q.minute!==minute){q.minute=minute;q.minuteCount=0;}if(q.day!==day){q.day=day;q.dayCount=0;}
          if(q.minuteCount>=20||q.dayCount>=200)return false;q.minuteCount++;q.dayCount++;return true;
        });
        if(!quota)return response(429,'limited');
        const result=await createStagingCommandExecutor({runtime:api,clock}).execute(command);
        return Response.json(result,{headers});
      }catch{return response(503,'unavailable');}
    }
    try{return publicProgressResponse(request,await(await runtime()).fetch(request));}catch{return publicProgressResponse(request,response(503,'unavailable'));}
  }};
}
