import {randomBytes} from 'node:crypto';
import {sqliteD1} from './sqlite-d1.js';
import {createStagingAuth} from '../../backend/staging-auth.js';
import {STAGING_AUTH_ENABLE,STAGING_AUTH_ORIGIN} from '../../backend/staging-auth-settings.js';
export const stagingActor=Object.freeze({authenticated:true,role:'owner'});
export const stagingEnvironment=()=>({APP_ENV:'staging-strava-test',STAGING_AUTH_ENABLED:STAGING_AUTH_ENABLE,STAGING_NETWORK_ENABLED:'disabled',STRAVA_CLIENT_ID:'12345',STRAVA_CLIENT_SECRET:'synthetic-staging-secret',TOKEN_ENCRYPTION_KEY_VERSION:'v1',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
export const stagingRows=(id=1,distance=1000)=>[{id,distance,start_date:'2026-11-01T10:00:00Z',sport_type:'Run',manual:false,private:true,name:'synthetic-private-title',map:{summary_polyline:'synthetic-GPS'}}];
export function stagingMock(time={now:Date.parse('2026-11-01T12:00:00Z')}) {
  const source={rows:{101:stagingRows(),202:stagingRows()},status:200,tokenStatus:200,refreshes:0,expiresIn:3600,headers:{},beforeResponse:null};
  const calls=[];
  const fetch=async(address,options)=>{
    const url=new URL(address);if(url.origin!=='https://www.strava.com')throw Error('unexpected mock target');
    calls.push({path:url.pathname,page:url.searchParams.get('page')});
    if(url.pathname==='/oauth/token') {
      await source.beforeTokenResponse?.();
      const body=new URLSearchParams(options.body);const refresh=body.get('grant_type')==='refresh_token';if(refresh)source.refreshes++;
      if(source.tokenStatus!==200)return Response.json({error:source.tokenStatus===400?'invalid_grant':'synthetic-private-error'},{status:source.tokenStatus});
      const id=Number((refresh?body.get('refresh_token'):body.get('code'))?.split('-').at(-1));
      if(!Number.isSafeInteger(id))throw Error('invalid mock identity');
      return Response.json({access_token:`synthetic-access-${id}`,refresh_token:`synthetic-refresh-${id}`,expires_at:Math.floor(time.now/1000)+source.expiresIn,athlete:{id},scope:'activity:read_all'});
    }
    if(url.pathname!=='/api/v3/athlete/activities')throw Error('unexpected mock path');
    await source.beforeResponse?.();
    if(source.status!==200)return Response.json({private:'synthetic-provider-error'},{status:source.status,headers:source.headers});
    const id=Number(new Headers(options.headers).get('Authorization')?.split('-').at(-1));
    const page=Number(url.searchParams.get('page'));return Response.json(source.rows[id].slice((page-1)*100,page*100),{headers:source.headers});
  };
  return{source,calls,fetch,time};
}
export function stagingAuthFixture(t,{env:overrides={}}={}) {
  const db=sqliteD1();t.after(()=>db.close());const mock=stagingMock();
  const env={...stagingEnvironment(),...overrides,DB:db};
  const open=()=>createStagingAuth(env,{fetchProvider:mock.fetch,clock:()=>mock.time.now});
  let runtime=open();
  const request=(path,options={})=>runtime.fetch(new Request(new URL(path,STAGING_AUTH_ORIGIN),options));
  async function begin(slot='slot-a',id=101,link) {
    link??=await runtime.admin.issue({actor:stagingActor,slot,expectedAthleteId:id});
    const response=await request('/invite');const cookie=response.headers.get('Set-Cookie').split(';')[0];
    const start=await request('/invite/start',{method:'POST',headers:{Origin:STAGING_AUTH_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).hash.slice(1)})});
    if(start.status!==200)throw Error('synthetic start failed');
    return{link,cookie,authorize:new URL((await start.json()).authorizeUrl)};
  }
  function callback({cookie,authorize},id=101,scope='activity:read_all') {
    return request(`/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:`synthetic-code-${id}`,scope})}`,{headers:{Cookie:cookie}});
  }
  const connect=async(slot='slot-a',id=101)=>callback(await begin(slot,id),id);
  return{db,env,...mock,open,request,begin,callback,connect,get runtime(){return runtime;},reopen(){runtime=open();},sync(){runtime=open();return runtime.admin.sync({actor:stagingActor});},async progress(){return(await request('/api/progress')).json();}};
}
