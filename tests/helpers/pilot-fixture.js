import {randomBytes} from 'node:crypto';
import {sqliteD1} from './sqlite-d1.js';
import {createPilot,PILOT_ENABLE,PILOT_ORIGIN} from '../../backend/pilot.js';
export const pilotEnvironment=()=>({APP_ENV:'local-owner-pilot',PILOT_ENABLED:PILOT_ENABLE,STRAVA_CLIENT_ID:'12345',STRAVA_CLIENT_SECRET:'synthetic-client-secret',PILOT_OWNER_ATHLETE_ID:'101',TOKEN_ENCRYPTION_KEY_VERSION:'v1',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
export const pilotRows=()=>[
 {id:1,distance:1234.5,start_date:'2026-11-01T10:00:00Z',sport_type:'Run',manual:false,private:true,name:'synthetic-private-title',map:{summary_polyline:'synthetic-GPS'}},
 {id:2,distance:1000,start_date:'2026-10-31T23:00:00Z',sport_type:'Walk',manual:false,private:false},
];
export async function pilotFixture(t,{env:overrides={},httpTransport}={}){
 const db=sqliteD1();t.after(()=>db.close());const time={now:Date.parse('2026-11-01T12:00:00Z')};
 const env={...pilotEnvironment(),...overrides,DB:db};
 const source={rows:pilotRows(),status:200,athleteId:101,refreshes:0};const calls=[];
 const defaultTransport=async(address,options)=>{
  const url=new URL(address);calls.push({path:url.pathname,page:url.searchParams.get('page')});
  if(url.pathname==='/oauth/token'){
   const body=new URLSearchParams(options.body);if(body.get('grant_type')==='refresh_token')source.refreshes++;
   return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(time.now/1000)+120,athlete:{id:source.athleteId},scope:'activity:read_all'});
  }
  if(source.status!==200)return Response.json({private:'synthetic-private-error'},{status:source.status});
  return Response.json(Number(url.searchParams.get('page'))===1?source.rows:[]);
 };
 const open=()=>createPilot(env,{clock:()=>time.now,fetchProvider:httpTransport??defaultTransport});
 let runtime=open();
 const request=(path,options={})=>runtime.fetch(new Request(new URL(path,PILOT_ORIGIN),{redirect:'manual',...options}));
 async function begin(){
  const link=await runtime.issue();const response=await request('/invite');const cookie=response.headers.get('Set-Cookie').split(';')[0];
  const start=await request('/invite/start',{method:'POST',headers:{Origin:PILOT_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).hash.slice(1)})});
  if(start.status!==200)throw Error('Mock start failed');
  const authorize=new URL((await start.json()).authorizeUrl);
  return{authorize,cookie};
 }
 async function connect(){const {authorize,cookie}=await begin();return request(`/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:'synthetic-code',scope:'read,activity:read_all'})}`,{headers:{Cookie:cookie}});}
 return{db,env,time,source,calls,open,begin,connect,request,get runtime(){return runtime;},reopen(){runtime=open();}};
}
