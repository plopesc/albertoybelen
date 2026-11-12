import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync}from'node:child_process';import{readFileSync}from'node:fs';
import {pilotFixture}from'./helpers/pilot-fixture.js';
import {createPilot,PILOT_ORIGIN}from'../backend/pilot.js';
import entry from'../backend/pilot-entry.js';

test('piloto apagado e incompleto: no authorize, canje, refresh, sync ni fallback de fixtures',async t=>{
 const f=await pilotFixture(t,{env:{PILOT_ENABLED:'disabled'}});
 await assert.rejects(f.runtime.issue(),/not_authorized/);await assert.rejects(f.runtime.sync(),/not_authorized/);assert.equal(f.calls.length,0);
 const response=await entry.fetch(new Request(`${PILOT_ORIGIN}/api/progress`),f.env);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'local_pilot_unavailable'});
 for(const field of ['STRAVA_CLIENT_ID','STRAVA_CLIENT_SECRET','PILOT_OWNER_ATHLETE_ID','TOKEN_ENCRYPTION_KEY']){
  const env={...f.env,PILOT_ENABLED:'owner-authorized-local-pilot',[field]:''};const p=createPilot(env,{fetchProvider:()=>{throw Error('Forbidden');}});await assert.rejects(p.issue());await assert.rejects(p.sync());
 }
 assert.equal(f.calls.length,0);assert.equal(entry.scheduled,undefined);
});

test('OAuth real en forma, callback DDEV limpio, una cuenta y público sin PII; sin navegación Strava',async t=>{
 const f=await pilotFixture(t);const {authorize,cookie}=await f.begin();
 assert.equal(authorize.origin,'https://www.strava.com');assert.equal(authorize.pathname,'/oauth/authorize');assert.equal(authorize.searchParams.get('scope'),'activity:read_all');assert.equal(authorize.searchParams.get('redirect_uri'),`${PILOT_ORIGIN}/oauth/callback`);assert.equal(authorize.href.includes('synthetic-client-secret'),false);
 const response=await f.request(`/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:'synthetic-code',scope:'activity:read_all'})}`,{headers:{Cookie:cookie}});
 assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/oauth/result');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal((await f.runtime.sync()).status,'synced');
 const publicResponse=await f.request('/api/progress');const dto=await publicResponse.json();assert.equal(dto.source,'strava-pilot');assert.equal(dto.distanceKm,2.2345);assert.equal(dto.partial,true);assert.equal(dto.stale,false);
 assert.deepEqual(Object.keys(dto).sort(),['schemaVersion','source','distanceKm','partial','stale','updatedAt','unlockedMilestoneIds'].sort());
 assert.doesNotMatch(JSON.stringify(dto),/athlete|slot-|token|scopes|synthetic/);
 const state=(await f.runtime.repository.read()).state;assert.equal(state.auth.slots[1].status,'disconnected');assert.equal(state.policy.participants[1].activities.length,0);assert.equal(Object.keys(state.sealedTokens).length,1);
 assert.doesNotMatch(JSON.stringify(state),/synthetic-client-secret|synthetic-access|synthetic-refresh|synthetic-private-title|synthetic-GPS/);
 assert.deepEqual(f.calls.filter(c=>c.page).map(c=>c.page),['1','2','1','2']);
});

test('identidad incorrecta y segunda cuenta se rechazan antes de consultar actividades',async t=>{
 const f=await pilotFixture(t);f.source.athleteId=202;const callback=await f.connect();assert.match(callback.headers.get('Set-Cookie'),/=error;/);assert.equal(Object.keys((await f.runtime.repository.read()).state.sealedTokens).length,0);
 await f.runtime.repository.updatePrivate(state=>{state.auth.slots[1].status='connected';});
 const count=f.calls.length;await assert.rejects(f.runtime.sync(),/owner_only/);await assert.rejects(f.runtime.issue(),/owner_only/);assert.equal(f.calls.length,count);
});

test('refresh backend y revocación local sin petición externa posterior; limpieza total del ensayo',async t=>{
 const f=await pilotFixture(t);await f.connect();await f.runtime.sync();f.time.now+=120000;f.reopen();await f.runtime.sync();assert.equal(f.source.refreshes,1);
 const before=(await f.runtime.status()).requests;await f.runtime.revoke();f.reopen();await f.runtime.sync();assert.equal((await f.runtime.status()).requests,before);assert.equal((await f.runtime.status()).progress.stale,true);
 await f.runtime.erase();const s=await f.runtime.status();assert.equal(s.activities,0);assert.equal(s.progress.distanceKm,0);assert.deepEqual(s.progress.unlockedMilestoneIds,[]);assert.equal(s.requests,before);
 const state=(await f.runtime.repository.read()).state;assert.deepEqual(state.sealedTokens,{});assert.deepEqual(state.oauthSessions,{});assert.deepEqual(state.auth.invitations,{});assert.deepEqual(state.auth.attempts,{});
});

for(const status of [401,403,429,500,503])test(`piloto HTTP ${status}: último dato y backoff durable entre procesos`,async t=>{
 const f=await pilotFixture(t);await f.connect();await f.runtime.sync();const old=(await f.runtime.status()).progress;f.source.status=status;f.reopen();await f.runtime.sync();
 const current=await f.runtime.status();assert.equal(current.progress.distanceKm,old.distanceKm);assert.equal(current.progress.updatedAt,old.updatedAt);assert.equal(current.progress.stale,true);assert.equal(current.progress.partial,true);
 const count=f.calls.length;f.reopen();await f.runtime.sync();assert.equal(f.calls.length,count);assert.ok(current.blockedUntil>f.time.now);
});

for(const action of ['revoke','erase'])test(`piloto ${action} durante listado: descarta trabajo sin resurrección`,async t=>{
 let enter,release;const entered=new Promise(r=>{enter=r;}),blocked=new Promise(r=>{release=r;});let waiting=false;
 const f=await pilotFixture(t,{httpTransport:async(url,options)=>{
  if(new URL(url).pathname==='/oauth/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:2000000000,athlete:{id:101}});
  if(!waiting){waiting=true;enter();await blocked;}return Response.json([]);
 }});await f.connect();const work=f.runtime.sync();await entered;await f.runtime[action]();release();await work;
 assert.equal((await f.runtime.status()).activities,0);assert.deepEqual((await f.runtime.repository.read()).state.sealedTokens,{});
});

test('origen HTTPS estricto, mocks no disponibles y sin administración HTTP',async t=>{
 const f=await pilotFixture(t);await assert.rejects(f.runtime.fetch(new Request('http://albertoybelen.ddev.site/invite')),/origin_rejected/);
 for(const path of ['/oauth/mock/authorize','/admin','/sync'])assert.equal((await f.request(path)).status,404);
 const denied=await f.request('/invite/start',{method:'POST',headers:{Origin:'https://evil.invalid'},body:'{}'});assert.equal(denied.status,403);assert.equal(f.calls.length,0);
});

test('CLI solo local, flag explícito obligatorio, template vacío y base aislada sin Cron',()=>{
 for(const args of [['deploy'],['sync'],['dev'],['issue'],['refresh'],['migrate','--remote'],['status','--authorize-owner-pilot']])assert.notEqual(spawnSync(process.execPath,['scripts/pilot-local.mjs',...args]).status,0);
 const config=JSON.parse(readFileSync('wrangler.pilot.local.jsonc','utf8'));assert.equal(config.vars.PILOT_ENABLED,'disabled');assert.equal(config.d1_databases[0].remote,false);assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000029');assert.equal(config.triggers,undefined);
 const template=readFileSync('.dev.vars.pilot.example','utf8');assert.match(template,/^STRAVA_CLIENT_SECRET=$/m);assert.match(template,/^TOKEN_ENCRYPTION_KEY=$/m);
});

test('scope incompleto del callback no intercambia códigos ni vincula cuenta',async t=>{
 const f=await pilotFixture(t);const {authorize,cookie}=await f.begin();const response=await f.request(`/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:'synthetic-code',scope:'read'})}`,{headers:{Cookie:cookie}});
 assert.match(response.headers.get('Set-Cookie'),/=error;/);assert.equal(f.calls.length,0);assert.equal((await f.runtime.status()).activities,0);
});

test('presupuesto durante paginación no confirma snapshot parcial y no reintenta red',async t=>{
 let calls=0;const f=await pilotFixture(t,{httpTransport:async(url)=>{
  if(new URL(url).pathname==='/oauth/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:2000000000,athlete:{id:101}});
  calls++;return Response.json([{id:1,distance:5000,start_date:'2026-11-01T10:00:00Z',manual:false,private:true,sport_type:'Run'}],{headers:{'X-ReadRateLimit-Limit':'100,1000','X-ReadRateLimit-Usage':'95,10'}});
 }});await f.connect();assert.equal((await f.runtime.sync()).status,'stale');assert.equal((await f.runtime.status()).progress.distanceKm,0);assert.equal(calls,1);f.reopen();await f.runtime.sync();assert.equal(calls,1);
});
