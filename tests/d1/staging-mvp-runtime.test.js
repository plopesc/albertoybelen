import test from 'node:test';import assert from 'node:assert/strict';
import {mvpRuntime} from '../helpers/staging-mvp-runtime.js';
import {mvpCommand} from '../../scripts/lib/staging-mvp-client.mjs';
import {MVP_AUTO_SYNC_CRON,MVP_ORIGIN} from '../../backend/staging-mvp-policy.js';
import fixture from '../../backend/staging-entry.js';
import {createD1Repository} from '../../backend/d1/repository.js';

test('MVP único workerd/D1 temporal: invitación, OAuth cifrado, sync manual, replay/reinicio y rollback fixture',async()=>{
 const f=await mvpRuntime();try {
  const old=await createD1Repository(f.db).read();
  const inviteCommand=mvpCommand({type:'issue',slot:'slot-a',expectedAthleteId:101});
  const issue=await(await f.send(inviteCommand)).json();assert.equal(issue.status,'issued');assert.equal((await(await f.send(inviteCommand)).json()).status,'replay');
  const invite=await f.request('/invite'),cookie=invite.headers.get('Set-Cookie').split(';')[0];
  const start=await f.request('/invite/start',{method:'POST',headers:{Origin:MVP_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(issue.invitation).hash.slice(1)})});assert.equal(start.status,200);
  const url=new URL((await start.json()).authorizeUrl);
  const callback=await f.request(`/oauth/callback?${new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code-101',scope:'activity:read_all'})}`,{headers:{Cookie:cookie}});assert.match(callback.headers.get('Set-Cookie'),/=success;/);
  assert.equal((await f.execute({type:'sync'})).status,'disabled');
  assert.equal((await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'})).status,'enabled');
  const command=mvpCommand({type:'sync'});assert.equal((await(await f.send(command)).json()).status,'synced');const requests=await f.requestCount();
  assert.equal((await(await f.send(command)).json()).status,'replay');assert.equal(await f.requestCount(),requests);
  let dto=await(await f.request('/api/progress')).json();assert.equal(dto.source,'strava');assert.equal(dto.distanceKm,1);assert.equal(dto.partial,true);
  assert.doesNotMatch(JSON.stringify(dto),/athlete|token|slot-|activities|invitation|101/);
  const credentials=(await f.db.prepare('SELECT ciphertext FROM staging_auth_oauth_credentials').all()).results;assert.equal(credentials.length,1);assert.doesNotMatch(JSON.stringify(credentials),/synthetic-access|synthetic-refresh/);
  await f.restart();assert.equal((await(await f.send(command)).json()).status,'replay');assert.equal((await f.execute({type:'status'})).progress.distanceKm,1);
  assert.equal((await f.execute({type:'disable-sync'})).status,'disabled');assert.equal((await f.execute({type:'sync'})).status,'disabled');
  assert.deepEqual(await createD1Repository(f.db).read(),old);
  dto=await(await fixture.fetch(new Request('https://fixture.invalid/api/progress'),{APP_ENV:'staging-fixtures',DB:f.db})).json();assert.equal(dto.source,'fixture');
 }finally{await f.close();}
});

test('scheduled UTC usa D1 existente, se mantiene OFF, respeta lease y budget con una o dos cuentas',async()=>{
 const f=await mvpRuntime();try {
  async function connect(slot,id){
   const issued=await f.execute({type:'issue',slot,expectedAthleteId:id});assert.equal(issued.status,'issued');
   const invite=await f.request('/invite'),cookie=invite.headers.get('Set-Cookie').split(';')[0];
   const start=await f.request('/invite/start',{method:'POST',headers:{Origin:MVP_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(issued.invitation).hash.slice(1)})});const authorize=new URL((await start.json()).authorizeUrl);
   const callback=await f.request(`/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:`synthetic-code-${id}`,scope:'activity:read_all'})}`,{headers:{Cookie:cookie}});assert.equal(callback.status,303);
  }
  let status=await f.execute({type:'status'});assert.equal(status.autoSyncEnabled,false);assert.equal(status.syncDisabled,true);assert.equal(status.lastAutomaticSync,null);
  assert.equal((await f.execute({type:'enable-auto-sync',confirmation:'enable-staging-auto-sync'})).status,'enabled');
  const beforeSyncEnabled=await f.requestCount();assert.equal((await f.scheduled()).outcome,'ok');assert.equal(await f.requestCount(),beforeSyncEnabled);status=await f.execute({type:'status'});assert.equal(status.syncDisabled,true);assert.equal(status.autoSyncEnabled,true);assert.equal(status.lastAutomaticSync,null);
  assert.equal((await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'})).status,'enabled');
  const beforeNoAccounts=await f.requestCount();assert.equal((await f.scheduled()).outcome,'ok');assert.equal(await f.requestCount(),beforeNoAccounts);status=await f.execute({type:'status'});assert.equal(status.lastAutomaticSync.status,'idle');
  assert.equal((await f.execute({type:'disable-auto-sync'})).status,'disabled');await connect('slot-a',101);
  const beforeOff=await f.requestCount();assert.equal((await f.scheduled('0 0 * * *')).outcome,'ok');assert.equal((await f.scheduled()).outcome,'ok');assert.equal(await f.requestCount(),beforeOff);
  const offStatus=await f.execute({type:'status'});assert.equal(offStatus.autoSyncEnabled,false);assert.equal(offStatus.syncDisabled,false);assert.equal(offStatus.lastAutomaticSync.status,'idle');
  assert.equal((await f.execute({type:'enable-auto-sync',confirmation:'enable-staging-auto-sync'})).status,'enabled');
  assert.equal((await f.scheduled()).outcome,'ok');status=await f.execute({type:'status'});assert.equal(status.progress.distanceKm,1);assert.equal(status.progress.partial,true);assert.equal(status.autoSyncEnabled,true);assert.equal(status.lastAutomaticSync.status,'synced');assert.match(status.lastAutomaticSync.at,/Z$/);

  await connect('slot-b',202);assert.equal((await f.scheduled()).outcome,'ok');status=await f.execute({type:'status'});assert.equal(status.progress.distanceKm,2);assert.equal(status.progress.partial,false);assert.equal(status.lastAutomaticSync.status,'synced');
  const beforeDisabled=await f.requestCount();assert.equal((await f.execute({type:'disable-auto-sync'})).status,'disabled');assert.equal((await f.scheduled()).outcome,'ok');assert.equal(await f.requestCount(),beforeDisabled);
  status=await f.execute({type:'status'});assert.equal(status.autoSyncEnabled,false);assert.equal(status.syncDisabled,false);assert.equal(status.progress.distanceKm,2);assert.equal((await f.execute({type:'sync'})).status,'synced');

  assert.equal((await f.execute({type:'enable-auto-sync',confirmation:'enable-staging-auto-sync'})).status,'enabled');
  const row=await f.db.prepare('SELECT document FROM staging_auth_game_state WHERE id=?').bind('staging-strava-test-v1').first(),state=JSON.parse(row.document),now=Date.now();
  state.stagingBudget={quarterStart:now,quarterCount:40,day:new Date(now).toISOString().slice(0,10),dayCount:0,requests:40,responses:{},networkErrors:0,blockedUntil:0};
  await f.db.prepare('UPDATE staging_auth_game_state SET document=?,revision=revision+1 WHERE id=?').bind(JSON.stringify(state),'staging-strava-test-v1').run();
  const beforeQuota=await f.requestCount();assert.equal((await f.scheduled()).outcome,'ok');assert.equal(await f.requestCount(),beforeQuota);
  status=await f.execute({type:'status'});assert.equal(status.progress.distanceKm,2);assert.equal(status.progress.stale,true);assert.equal(status.lastAutomaticSync.status,'stale');
 }finally{await f.close();}
});

test('release MVP cerrada o sin 0003 no inicializa dataset ni usa proveedor',async()=>{
 for(const options of [{closed:true},{migration:false}]){
  const f=await mvpRuntime(options);try{assert.equal((await f.request('/api/progress')).status,503);assert.equal((await f.execute({type:'status'})).status,'unavailable');assert.equal(await f.requestCount(),0);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM game_state').first()).n,0);if(options.closed)assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM staging_auth_game_state').first()).n,0);}finally{await f.close();}
 }
});

test('CORS Pages solo permite GET agregado desde el origen exacto, sin credenciales ni rutas privadas',async()=>{
 const f=await mvpRuntime();try {
  const pages='https://plopesc.github.io',url='/api/progress',noCors=response=>{for(const name of ['Access-Control-Allow-Origin','Access-Control-Allow-Methods','Access-Control-Allow-Headers','Access-Control-Allow-Credentials','Access-Control-Expose-Headers'])assert.equal(response.headers.get(name),null);};
  const allowed=await f.request(url,{headers:{Origin:pages,Accept:'application/json'}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),pages);for(const name of ['Access-Control-Allow-Credentials','Access-Control-Allow-Methods','Access-Control-Allow-Headers','Access-Control-Expose-Headers'])assert.equal(allowed.headers.get(name),null);assert.match(allowed.headers.get('Vary'),/Origin/i);assert.equal(allowed.headers.get('Cache-Control'),'no-store');assert.deepEqual(Object.keys(await allowed.json()).sort(),['distanceKm','partial','schemaVersion','source','stale','unlockedMilestoneIds','updatedAt'].sort());
  for(const [headers,status]of [[{Origin:'https://evil.example'},403],[{Origin:pages,Authorization:'Bearer synthetic'},200],[{Origin:pages,Cookie:'session=synthetic'},200],[{Accept:'application/json'},200]]){const r=await f.request(url,{headers});assert.equal(r.status,status);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.match(r.headers.get('Vary'),/Origin/i);assert.equal(r.headers.get('Cache-Control'),'no-store');}
  for(const path of ['/admin/staging','/oauth/start','/oauth/callback']){const r=await f.request(path,{headers:{Origin:pages}});noCors(r);}
  const preflight=await f.request(url,{method:'OPTIONS',headers:{Origin:pages,'Access-Control-Request-Method':'GET'}});noCors(preflight);
  const otherMethod=await f.request(url,{method:'POST',headers:{Origin:pages}});noCors(otherMethod);
  const query=await f.request(`${url}?ignored=1`,{headers:{Origin:pages}});noCors(query);
 }finally{await f.close();}
});
