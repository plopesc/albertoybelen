import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stagingAuthFixture,stagingActor as actor,stagingRows} from './helpers/staging-auth-fixture.js';
import {createStagingAuth} from '../backend/staging-auth.js';
import entry from '../backend/staging-auth-entry.js';
import fixtureEntry from '../backend/staging-entry.js';
import {createD1Repository} from '../backend/d1/repository.js';
import {createTokenVault} from '../auth/token-vault.js';
import {STAGING_AUTH_ORIGIN as origin,STAGING_AUTH_LIMITS} from '../backend/staging-auth-settings.js';
import {validateLocalTarget} from '../scripts/lib/infrastructure-config.mjs';
import {validateStagingConfig,stagingCommand} from '../scripts/lib/staging-config.mjs';

test('staging OAuth cerrado por defecto, entry sin Cron, sin cambio del destino fixture operativo',async()=>{
  const config=JSON.parse(readFileSync('wrangler.staging-auth.local.jsonc'));validateLocalTarget(config,'stagingAuth');
  const response=await entry.fetch(new Request(`${origin}/api/progress`),{...config.vars,DB:{prepare(){throw Error('must not access DB');}}});
  assert.equal(response.status,503);assert.equal(entry.scheduled,undefined);assert.equal(fixtureEntry.scheduled,undefined);
  assert.throws(()=>validateStagingConfig(config));assert.throws(()=>stagingCommand(config,['deploy','--confirm-staging'],{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}));
  assert.throws(()=>createD1Repository({}, {dataset:'production'}));
});

test('dos cuentas, suma anónima, cifrado, tablas separadas y rollback fixture intacto',async t=>{
  const f=stagingAuthFixture(t);
  const old=createD1Repository(f.db);await old.applyEvents([{participantId:'slot-a',generation:0,status:'connected',scopes:['activity:read_all']}]);
  const snapshot=JSON.stringify((await old.read()).state);
  assert.match((await f.connect()).headers.get('Set-Cookie'),/=success;/);
  await f.sync();assert.equal((await f.progress()).partial,true);
  assert.match((await f.connect('slot-b',202)).headers.get('Set-Cookie'),/=success;/);
  await f.sync();const dto=await f.progress();assert.equal(dto.distanceKm,2);assert.equal(dto.partial,false);assert.equal(dto.source,'strava');
  assert.deepEqual(Object.keys(dto).sort(),['schemaVersion','source','distanceKm','partial','stale','updatedAt','unlockedMilestoneIds'].sort());
  assert.doesNotMatch(JSON.stringify(dto),/athlete|token|slot-|scope|activities|"101"|"202"/);
  const privateDoc=JSON.stringify((await f.runtime.repository.read()).state);
  for(const secret of ['synthetic-access','synthetic-refresh','synthetic-private-title','synthetic-GPS',f.env.TOKEN_ENCRYPTION_KEY,f.env.STRAVA_CLIENT_SECRET])assert.equal(privateDoc.includes(secret),false);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM staging_auth_oauth_credentials').bind().first()).n,2);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM oauth_credentials').bind().first()).n,0);
  assert.equal(JSON.stringify((await old.read()).state),snapshot);
  assert.equal((await(await fixtureEntry.fetch(new Request('https://fixture.invalid/api/progress'),{APP_ENV:'staging-fixtures',DB:f.db})).json()).source,'fixture');
});

test('scope, identidad vinculada y atleta duplicado fallan; la invitación permite recuperación segura',async t=>{
  const f=stagingAuthFixture(t);const attempt=await f.begin();
  assert.match((await f.callback(attempt,101,'read')).headers.get('Set-Cookie'),/=error;/);assert.equal(f.calls.length,0);
  const retry=await f.begin('slot-a',101,attempt.link);
  assert.match((await f.callback(retry,202)).headers.get('Set-Cookie'),/=error;/);
  const again=await f.begin('slot-a',101,attempt.link);assert.match((await f.callback(again,101)).headers.get('Set-Cookie'),/=success;/);
  await assert.rejects(f.runtime.admin.issue({actor,slot:'slot-b',expectedAthleteId:101}));
  const b=await f.begin('slot-b',202);assert.match((await f.callback(b,101)).headers.get('Set-Cookie'),/=error;/);
  assert.equal((await f.runtime.repository.read()).state.auth.slots[1].status,'disconnected');
});

test('expiración, sesión equivocada y callbacks concurrentes/replay no intercambian códigos de nuevo',async t=>{
  const f=stagingAuthFixture(t);const attempt=await f.begin();
  assert.match((await f.callback({...attempt,cookie:'__Host-strava-attempt='+'X'.repeat(43)})).headers.get('Set-Cookie'),/=error;/);assert.equal(f.calls.length,0);
  const results=await Promise.all([f.callback(attempt),f.callback(attempt)]);assert.equal(results.filter(r=>/=success;/.test(r.headers.get('Set-Cookie'))).length,1);assert.equal(f.calls.length,1);
  assert.match((await f.callback(attempt)).headers.get('Set-Cookie'),/=error;/);assert.equal(f.calls.length,1);
  const b=await f.begin('slot-b',202);f.time.now+=600001;
  assert.match((await f.callback(b,202)).headers.get('Set-Cookie'),/=error;/);assert.equal(f.calls.length,1);
  f.time.now+=3600000;await assert.rejects(f.begin('slot-b',202,b.link));
});

test('superficie HTTP: origen HTTPS exacto, CSRF, cookies, no-store, CSP, CORS y ausencia de administración',async t=>{
  const f=stagingAuthFixture(t);const invite=await f.request('/invite');
  assert.match(invite.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);assert.match(invite.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.equal(invite.headers.get('Referrer-Policy'),'no-referrer');assert.match(await invite.text(),/Staging · conexión de prueba/);
  for(const address of ['http://'+new URL(origin).host+'/invite',origin+':444/invite','https://evil.invalid/invite'])assert.equal((await f.runtime.fetch(new Request(address,{headers:{'X-Forwarded-Proto':'https'}}))).status,400);
  assert.equal((await f.request('/invite/start',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
  for(const path of ['/admin','/api/sync','/api/invitations','/oauth/mock/authorize','/__scheduled'])assert.equal((await f.request(path)).status,404);
  assert.equal((await f.request('/invite?token=synthetic')).status,400);assert.equal((await f.request('/api/progress?slot=slot-a')).status,400);
  assert.equal((await f.request('/api/progress',{headers:{Origin:'https://plopesc.github.io'}})).status,403);
  const dto=await f.request('/api/progress',{headers:{Origin:origin}});assert.equal(dto.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(dto.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(dto.headers.get('Cache-Control'),'no-store');
  const attempt=await f.begin();const duplicate=`/oauth/callback?state=${attempt.authorize.searchParams.get('state')}&state=bad&code=synthetic-code-101&scope=activity:read_all`;
  const rejected=await f.request(duplicate,{headers:{Cookie:attempt.cookie}});assert.equal(rejected.headers.get('Location'),'/oauth/result');assert.match(rejected.headers.get('Set-Cookie'),/=error;/);assert.equal(f.calls.length,0);
  for(const method of ['issue','sync','revoke','erase','rotate'])await assert.rejects(f.runtime.admin[method]({actor:{role:'owner'},slot:'slot-a',expectedAthleteId:101}));
});

test('network tiene opt-in adicional; claves ausentes/incorrectas y mezcla de dataset fallan cerradas',async t=>{
  const f=stagingAuthFixture(t);const runtime=createStagingAuth(f.env);
  await assert.rejects(runtime.admin.sync({actor}),/network_disabled/);
  const invalid=createStagingAuth({...f.env,TOKEN_ENCRYPTION_KEY:'invalid'},{fetchProvider:f.fetch});await assert.rejects(invalid.fetch(new Request(`${origin}/invite`)),/vault_unavailable/);
  await f.runtime.repository.setGoal(100);await assert.rejects(f.request('/api/progress'),/dataset_mismatch/);
});

test('refresh y rotación con namespace AES-GCM específico; invalid_grant conserva datos y revoca',async t=>{
  const f=stagingAuthFixture(t);f.source.expiresIn=120;await f.connect();await f.sync();f.time.now+=61000;
  await f.sync();assert.equal(f.source.refreshes,1);
  const before=(await f.runtime.repository.read()).state.sealedTokens['slot-a'];
  const newKey=Buffer.alloc(32,9).toString('base64');const env={...f.env,TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION:'v1',TOKEN_PREVIOUS_ENCRYPTION_KEY:f.env.TOKEN_ENCRYPTION_KEY,TOKEN_ENCRYPTION_KEY_VERSION:'v2',TOKEN_ENCRYPTION_KEY:newKey};
  const rotated=createStagingAuth(env,{fetchProvider:f.fetch,clock:()=>f.time.now});await rotated.admin.rotate({actor,slot:'slot-a'});
  assert.equal((await rotated.repository.read()).state.sealedTokens['slot-a'].keyVersion,'v2');
  const wrongDomain=createTokenVault({keys:{v1:f.env.TOKEN_ENCRYPTION_KEY}});await assert.rejects(wrongDomain.open(before,{slot:'slot-a',generation:before.generation,version:before.version}));
  // Keep the rotated key set for the remaining operations.
  Object.assign(f.env,env);f.reopen();f.time.now+=61000;f.source.tokenStatus=400;await f.sync();
  assert.equal((await f.progress()).distanceKm,1);assert.equal((await f.progress()).partial,true);assert.deepEqual((await f.runtime.repository.read()).state.sealedTokens,{});
});

test('dos snapshots por cuenta: filtros, deduplicación compuesta, correcciones y borrados mantienen cofres',async t=>{
  const f=stagingAuthFixture(t);await f.connect();await f.connect('slot-b',202);
  f.source.rows[101]=[{...stagingRows()[0],distance:600000},...stagingRows(2,5000).map(a=>({...a,manual:true})),...stagingRows(3,5000).map(a=>({...a,sport_type:'Ride'}))];
  f.source.rows[202]=[{...stagingRows()[0],sport_type:'Hike',start_date:'2026-10-31T23:00:00Z'}];
  await f.sync();const unlocked=(await f.progress()).unlockedMilestoneIds;assert.equal((await f.progress()).distanceKm,601);assert.ok(unlocked.includes('finish'));
  f.time.now+=900001;f.source.rows[101]=stagingRows(1,20000);f.source.rows[202]=[];await f.sync();assert.equal((await f.progress()).distanceKm,20);assert.deepEqual((await f.progress()).unlockedMilestoneIds,unlocked);
  f.time.now+=900001;f.source.rows[101]=[];await f.sync();assert.equal((await f.progress()).distanceKm,0);assert.deepEqual((await f.progress()).unlockedMilestoneIds,unlocked);
});

test('429/backoff durable, datos parciales y obsoletos coexisten; respuesta fallida no sustituye snapshot',async t=>{
  const f=stagingAuthFixture(t);await f.connect();await f.sync();f.source.status=429;f.source.headers={'Retry-After':'3600'};
  await f.sync();let dto=await f.progress();assert.equal(dto.distanceKm,1);assert.equal(dto.partial,true);assert.equal(dto.stale,true);
  const count=f.calls.length;await f.sync();assert.equal(f.calls.length,count);
  f.time.now+=3600001;f.source.status=200;f.source.headers={};await f.sync();dto=await f.progress();assert.equal(dto.stale,false);
  assert.ok(STAGING_AUTH_LIMITS.perQuarter<100);assert.ok(STAGING_AUTH_LIMITS.perDay<1000);
});

test('supresión verificada y revocación durante lectura invalidan trabajos; otra cuenta puede seguir',async t=>{
  const f=stagingAuthFixture(t);await f.connect();await f.connect('slot-b',202);await f.sync();
  await assert.rejects(f.runtime.admin.erase({actor,slot:'slot-a'}),/verified_deletion/);
  let release,started;const blocked=new Promise(r=>release=r);const entered=new Promise(r=>started=r);let once=true;
  f.source.beforeResponse=async()=>{if(once){once=false;started();await blocked;}};
  const work=f.sync();await entered;
  const busy=await f.open().admin.sync({actor});assert.equal(busy.status,'busy');
  await f.runtime.admin.erase({actor,slot:'slot-a',verified:true,purgeMilestones:true});release();await work;
  const state=(await f.runtime.repository.read()).state;assert.equal(state.policy.participants[0].activities.length,0);assert.equal(state.sealedTokens['slot-a'],undefined);assert.equal((await f.progress()).distanceKm,1);
  await f.runtime.admin.revoke({actor,slot:'slot-b'});assert.equal((await f.progress()).distanceKm,1);assert.deepEqual((await f.runtime.repository.read()).state.sealedTokens,{});
});

test('presupuesto staging compartido entre instancias: 40/15min, 120/día sin afectar piloto',async t=>{
  const f=stagingAuthFixture(t);const {createPilotTransport}=await import('../backend/pilot-budget.js');let count=0;
  const request=()=>createPilotTransport({repository:f.runtime.repository,ready:async()=>{},fetchProvider:async()=>{count++;return Response.json([]);},clock:()=>f.time.now,limits:STAGING_AUTH_LIMITS,budgetKey:'stagingBudget'})('https://www.strava.com/api/v3/athlete/activities?after=1&before=2&page=1&per_page=100',{redirect:'error'});
  for(let quarter=0;quarter<3;quarter++) {
    for(let i=0;i<40;i++)await request();
    await assert.rejects(request());f.time.now+=900001;
  }
  await assert.rejects(request());assert.equal(count,120);
  const state=(await f.runtime.repository.read()).state;assert.equal(state.stagingBudget.dayCount,120);assert.equal(state.pilotBudget,undefined);
  f.time.now=Date.parse('2026-11-02T00:00:01Z');await request();assert.equal(count,121);
});

test('backfill incompleto/limitado y error temporal de refresh conservan el snapshot y el consentimiento',async t=>{
  const f=stagingAuthFixture(t);f.source.expiresIn=120;await f.connect();await f.sync();
  f.source.rows[101]=Array.from({length:401},(_,i)=>stagingRows(i+1)[0]);await f.sync();
  let dto=await f.progress();assert.equal(dto.distanceKm,1);assert.equal(dto.stale,true);
  f.time.now+=900001;f.source.tokenStatus=500;await f.sync();
  const state=(await f.runtime.repository.read()).state;assert.equal(state.auth.slots[0].status,'connected');assert.ok(state.sealedTokens['slot-a']);
  dto=await f.progress();assert.equal(dto.distanceKm,1);assert.equal(dto.stale,true);
});

test('plan remoto es solo diseño, deriva el destino permitido y conserva ambos interruptores apagados',async()=>{
  const {stagingAuthPlan}=await import('../scripts/staging-auth-plan.mjs');const fixture=JSON.parse(readFileSync('wrangler.staging.jsonc'));
  const plan=stagingAuthPlan(fixture);assert.equal(plan.deploymentAllowed,false);assert.equal(plan.target.workerName,fixture.name);assert.equal(plan.callback,`${origin}/oauth/callback`);
  assert.equal(plan.proposedConfig.vars.STAGING_AUTH_ENABLED,'disabled');assert.equal(plan.proposedConfig.vars.STAGING_NETWORK_ENABLED,'disabled');assert.deepEqual(plan.proposedConfig.triggers.crons,[]);
  assert.throws(()=>stagingCommand(plan.proposedConfig,['deploy','--confirm-staging'],{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}));
  fixture.d1_databases[0].database_name='albertoybelen-db';assert.throws(()=>stagingAuthPlan(fixture));
});

test('metadatos y Wrangler locales no pueden habilitar red/OAuth ni seleccionar producción',async()=>{
  const {validateInfrastructureConfig}=await import('../scripts/lib/infrastructure-config.mjs');
  for(const change of [c=>c.local.stagingAuth.authEnabled=true,c=>c.local.stagingAuth.networkEnabled=true,c=>c.local.stagingAuth.datasetId='production',c=>c.local.stagingAuth.startDate='2026-11-28',c=>c.local.ddev.stagingAuth.port=8790,c=>c.local.ddev.stagingAuth.databaseId=c.cloudflare.staging.databaseId]) {
    const metadata=JSON.parse(readFileSync('config.json'));change(metadata);assert.throws(()=>validateInfrastructureConfig(metadata));
  }
  for(const change of [c=>c.vars.STAGING_AUTH_ENABLED='owner-authorized-staging-test',c=>c.vars.STAGING_NETWORK_ENABLED='owner-authorized-staging-network',c=>c.name='albertoybelen-api',c=>c.d1_databases[0].database_name='albertoybelen-db',c=>c.triggers={crons:['0 * * * *']}]) {
    const config=JSON.parse(readFileSync('wrangler.staging-auth.local.jsonc'));change(config);assert.throws(()=>validateLocalTarget(config,'stagingAuth'));
  }
});

test('supresión durante intercambio de código no permite que callback tardío guarde credenciales',async t=>{
  const f=stagingAuthFixture(t);const attempt=await f.begin();let release,started;
  const block=new Promise(r=>release=r),entered=new Promise(r=>started=r);
  f.source.beforeTokenResponse=async()=>{started();await block;};
  const callback=f.callback(attempt);await entered;
  await f.runtime.admin.erase({actor,slot:'slot-a',verified:true});release();
  assert.match((await callback).headers.get('Set-Cookie'),/=error;/);
  const state=(await f.runtime.repository.read()).state;assert.equal(state.auth.slots[0].status,'deleted');assert.deepEqual(state.sealedTokens,{});assert.equal((await f.progress()).distanceKm,0);
});
