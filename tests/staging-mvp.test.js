import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,chmodSync,statSync,symlinkSync,existsSync,unlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {stagingAuthFixture} from './helpers/staging-auth-fixture.js';
import {createStagingMvp} from '../backend/staging-mvp.js';
import {MVP_ENABLE,MVP_READY,MVP_ADMIN_PATH,MVP_AUTO_SYNC_CRON,MVP_ORIGIN,validateMvpCommand} from '../backend/staging-mvp-policy.js';
import {STAGING_NETWORK_ENABLE} from '../backend/staging-auth-settings.js';
import {mvpCommand,callMvp} from '../scripts/lib/staging-mvp-client.mjs';
import {prepareMvpPrivate,readMvpPrivate,rotateMvpAdmin} from '../scripts/lib/staging-mvp-private.mjs';
import {runMvpWrangler} from '../scripts/lib/staging-mvp-runner.mjs';
import {mvpConfiguration,validateMvpConfiguration} from '../scripts/lib/staging-mvp-config.mjs';
import {stagingOperatorState} from '../backend/staging-operator-state.js';
const history=db=>{db.sqlite.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT)');for(const [i,name]of ['0001_local_game.sql','0002_oauth_vault.sql','0003_staging_auth_test.sql'].entries())db.sqlite.prepare('INSERT INTO d1_migrations VALUES(?,?)').run(i+1,name);};
function unit(t) {
 const f=stagingAuthFixture(t);history(f.db);const env={...f.env,STAGING_MVP_ENABLED:MVP_ENABLE,STAGING_MVP_READY:MVP_READY,STAGING_NETWORK_ENABLED:STAGING_NETWORK_ENABLE,STAGING_ADMIN_TOKEN:randomBytes(32).toString('base64url')};
 const api=createStagingMvp(env,{clock:()=>f.time.now,fetchProvider:f.fetch});
 const request=(options={})=>api.fetch(new Request(MVP_ORIGIN+MVP_ADMIN_PATH,{method:'POST',headers:{Authorization:`Bearer ${env.STAGING_ADMIN_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(mvpCommand({type:'status'},f.time.now)),...options}));
 return{...f,env,api,request};
}
test('admin MVP autenticada: rechazos sin red/CORS y sin fugas, método/origen/query/tamaño',async t=>{
 const f=unit(t);for(const headers of [{},{Authorization:'Bearer '+'x'.repeat(43),'Content-Type':'application/json'},{Authorization:`Bearer ${f.env.STAGING_ADMIN_TOKEN}`,Origin:MVP_ORIGIN,'Content-Type':'application/json'},{Authorization:`Bearer ${f.env.STAGING_ADMIN_TOKEN}`,Origin:'https://untrusted.invalid','Content-Type':'application/json'},{Authorization:`Bearer ${f.env.STAGING_ADMIN_TOKEN}`,Cookie:'forged','Content-Type':'application/json'}]){
  const r=await f.request({headers});assert.ok([401,403].includes(r.status));assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.doesNotMatch(await r.text(),/token|synthetic|Bearer/);
 }
 for(const method of ['GET','PUT','OPTIONS','HEAD'])assert.equal((await f.request({method,body:undefined})).status,405);
 assert.equal((await f.request({body:'x'.repeat(2049)})).status,413);assert.equal(f.calls.length,0);
 assert.equal((await f.api.fetch(new Request(MVP_ORIGIN+MVP_ADMIN_PATH+'?token=bad'))).status,400);
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM staging_auth_game_state').get().n,0);
 assert.equal((await f.request({body:'{}'})).status,400);
 assert.equal((await f.request()).status,200);
});
test('replay y cuota autenticada durables; limitador sin autenticación no escribe D1',async t=>{
 const f=unit(t),command=mvpCommand({type:'status'},f.time.now),body=JSON.stringify(command);
 assert.equal((await(await f.request({body})).json()).status,'ok');assert.equal((await(await f.request({body})).json()).status,'replay');
 for(let n=0;n<18;n++)assert.equal((await f.request()).status,200);assert.equal((await f.request()).status,429);
 f.time.now+=60001;assert.equal((await f.request()).status,200);
 for(let n=0;n<60;n++)await f.request({headers:{}});assert.equal((await f.request({headers:{}})).status,429);
});
test('sync automático se conserva separado, OFF por defecto e idempotente',async t=>{
 const f=unit(t),send=async operation=>(await f.api.fetch(new Request(MVP_ORIGIN+MVP_ADMIN_PATH,{method:'POST',headers:{Authorization:`Bearer ${f.env.STAGING_ADMIN_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(mvpCommand(operation,f.time.now))}))).json();
 const initial=await(await f.request()).json();assert.equal(initial.autoSyncEnabled,false);assert.equal(initial.syncDisabled,true);assert.equal(initial.lastAutomaticSync,null);assert.doesNotMatch(JSON.stringify(initial),/slot-|101|token|activities/);
 const legacy=stagingOperatorState({stagingOperator:{syncDisabled:false,epoch:3,receipts:{},audit:[]}});assert.equal(legacy.autoSyncEnabled,false);assert.equal(legacy.autoSyncEpoch,0);assert.equal(legacy.lastAutomaticSync,null);
 assert.throws(()=>validateMvpCommand(mvpCommand({type:'enable-auto-sync',confirmation:'wrong'},f.time.now)));
 for(const operation of [{type:'enable-auto-sync',confirmation:'enable-staging-auto-sync'},{type:'enable-auto-sync',confirmation:'enable-staging-auto-sync'}])assert.deepEqual(await send(operation),{status:'enabled',autoSyncEnabled:true});
 let state=JSON.parse(f.db.sqlite.prepare('SELECT document FROM staging_auth_game_state').get().document);assert.equal(state.stagingOperator.autoSyncEpoch,1);assert.equal(state.stagingOperator.syncDisabled,true);
 for(const operation of [{type:'disable-auto-sync'},{type:'disable-auto-sync'}])assert.deepEqual(await send(operation),{status:'disabled',autoSyncEnabled:false});
 state=JSON.parse(f.db.sqlite.prepare('SELECT document FROM staging_auth_game_state').get().document);assert.equal(state.stagingOperator.autoSyncEpoch,2);assert.equal(state.stagingOperator.syncDisabled,true);assert.deepEqual(state.stagingOperator.lastAutomaticSync,null);
 for(const change of [c=>c.triggers.crons=['* * * * *'],c=>c.triggers.crons=['0 */2 * * *'],c=>c.triggers.crons=[]]){const config=mvpConfiguration();change(config);assert.throws(()=>validateMvpConfiguration(config,JSON.parse(readFileSync('wrangler.staging.jsonc'))));}
 assert.deepEqual(mvpConfiguration().triggers,{crons:[MVP_AUTO_SYNC_CRON]});
});
test('scheduled comparte lease y disable-auto fences una respuesta tardía sin afectar sync manual',async t=>{
 const f=unit(t),send=async operation=>(await f.api.fetch(new Request(MVP_ORIGIN+MVP_ADMIN_PATH,{method:'POST',headers:{Authorization:`Bearer ${f.env.STAGING_ADMIN_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(mvpCommand(operation,f.time.now))}))).json();
 await f.connect('slot-a',101);await send({type:'enable-sync',confirmation:'enable-staging-sync'});await send({type:'enable-auto-sync',confirmation:'enable-staging-auto-sync'});
 const before=await f.runtime.repository.getProgress(),outboundBefore=f.calls.length;let enteredResolve,release;const entered=new Promise(resolve=>{enteredResolve=resolve;}),gate=new Promise(resolve=>{release=resolve;});f.source.beforeResponse=async()=>{enteredResolve();await gate;};
 let firstWaitUntil;const event={cron:MVP_AUTO_SYNC_CRON,scheduledTime:f.time.now};const first=f.api.scheduled(event,f.env,{waitUntil(promise){firstWaitUntil=promise;}});await entered;
 let secondWaitUntil;const second=await f.api.scheduled(event,f.env,{waitUntil(promise){secondWaitUntil=promise;}});assert.equal(second.status,'busy');assert.ok(secondWaitUntil);assert.equal((await send({type:'disable-auto-sync'})).autoSyncEnabled,false);release();assert.equal((await first).status,'stale');await firstWaitUntil;
 f.source.beforeResponse=null;let status=await send({type:'status'});assert.equal(status.autoSyncEnabled,false);assert.equal(status.syncDisabled,false);assert.deepEqual(status.progress,before);assert.equal(f.calls.length,outboundBefore+1);
 assert.equal((await send({type:'sync'})).status,'synced');status=await send({type:'status'});assert.equal(status.autoSyncEnabled,false);assert.equal(status.progress.distanceKm,1);
});
test('comandos cerrados, vencidos, actor/target/operaciones arbitrarios y falta de secretos',async t=>{
 const f=unit(t);for(const change of [c=>c.actor={role:'owner'},c=>c.expiresAt=c.issuedAt-1,c=>c.operation.type='erase',c=>c.nonce='bad',c=>c.operation={type:'issue',slot:'slot-c',expectedAthleteId:101},c=>c.operation={type:'issue',slot:'slot-a',expectedAthleteId:'101'}]){const c=mvpCommand({type:'status'},f.time.now);change(c);assert.throws(()=>validateMvpCommand(c,f.time.now));}
 for(const key of ['STAGING_ADMIN_TOKEN','STRAVA_CLIENT_ID','STRAVA_CLIENT_SECRET','TOKEN_ENCRYPTION_KEY','STAGING_MVP_READY']){const api=createStagingMvp({...f.env,[key]:undefined},{fetchProvider:f.fetch,clock:()=>f.time.now});assert.equal((await api.fetch(new Request(MVP_ORIGIN+'/api/progress'))).status,503);}
});
test('CLI archivos privados sin overwrite/symlink, destinos y subproceso sin filtraciones',async t=>{
 const root=mkdtempSync(join(tmpdir(),'mvp-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));chmodSync(root,0o775);prepareMvpPrivate(root);
 const dir=join(root,'.local/staging-mvp');assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(join(dir,'admin-token')).mode&0o777,0o600);assert.throws(()=>prepareMvpPrivate(root));
 const originalToken=readMvpPrivate(root,'admin-token');rotateMvpAdmin(root);assert.notEqual(readMvpPrivate(root,'admin-token'),originalToken);
 const token=readMvpPrivate(root,'admin-token');assert.equal(token.length,43);chmodSync(join(dir,'admin-token'),0o644);assert.throws(()=>readMvpPrivate(root,'admin-token'));chmodSync(join(dir,'admin-token'),0o600);
 const config=mvpConfiguration(),fixture=JSON.parse(readFileSync('wrangler.staging.jsonc'));for(const edit of [c=>c.name='albertoybelen-api',c=>c.d1_databases[0].database_id='bad',c=>c.triggers.crons=['* * * * *'],c=>c.vars.STAGING_MVP_ENABLED=MVP_ENABLE]){const c=structuredClone(config);edit(c);assert.throws(()=>validateMvpConfiguration(c,fixture));}
 let calls=0,cwd;
 const invoke=argv=>runMvpWrangler({root,config,fixture,env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),STRAVA_CLIENT_SECRET:'never-forward'},argv,spawn:(bin,args,options)=>{calls++;cwd=options.cwd;assert.equal(options.env.STRAVA_CLIENT_SECRET,undefined);assert.equal(args.includes(token),false);assert.equal(options.input,token+'\n');assert.deepEqual(options.stdio,['pipe','pipe','pipe']);return{status:0,stdout:'private',stderr:'private'};}});
 assert.throws(()=>invoke(['secret-delete','TOKEN_ENCRYPTION_KEY','--confirm-staging-secret']));
 assert.throws(()=>invoke(['deploy']));assert.throws(()=>invoke(['secret','STRAVA_BAD','--confirm-staging-secret']));assert.equal(calls,0);assert.equal(invoke(['secret','STAGING_ADMIN_TOKEN','--confirm-staging-secret']).status,'completed');assert.equal(existsSync(cwd),false);
 const deploy=runMvpWrangler({root,config,fixture,env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)},argv:['deploy','--confirm-staging-oauth'],spawn:(_bin,args,options)=>{
  assert.match(args[0],/wrangler\.js$/);assert.equal(args[1],'deploy');assert.equal(args.includes('secret'),false);assert.equal(args.includes('secret-delete'),false);
  const live=JSON.parse(readFileSync(args.at(-1),'utf8'));assert.equal(live.name,'albertoybelen-api-staging');assert.equal(live.vars.STAGING_MVP_ENABLED,MVP_ENABLE);assert.equal(live.vars.STAGING_MVP_READY,MVP_READY);assert.equal(live.d1_databases.length,1);assert.equal(live.d1_databases[0].binding,'DB');assert.equal(live.d1_databases[0].database_name,'albertoybelen-db-staging');assert.equal(live.d1_databases[0].database_id,'c6bde806-cf94-4ff3-8c4f-c08b8de477f6');assert.deepEqual(live.triggers,{crons:[MVP_AUTO_SYNC_CRON]});assert.equal(live.services,undefined);assert.equal(options.input,undefined);assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID,'a'.repeat(32));return{status:0};
 }});assert.equal(deploy.status,'completed');assert.equal(config.vars.STAGING_MVP_ENABLED,'disabled');
 assert.throws(()=>runMvpWrangler({root,config,fixture,env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)},argv:['deploy','--confirm-staging-oauth'],spawn:()=>({status:1,stdout:token,stderr:token})}),error=>!String(error).includes(token));

 const fetchAdmin=async(url,options)=>{assert.equal(url,MVP_ORIGIN+MVP_ADMIN_PATH);assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.redirect,'error');return Response.json({status:'issued',invitation:MVP_ORIGIN+'/invite#'+'x'.repeat(43)},{headers:{'Cache-Control':'no-store'}});};
 const result=await callMvp({root,operation:{type:'issue',slot:'slot-a',expectedAthleteId:101},fetchAdmin});assert.equal(result.status,'issued');assert.doesNotMatch(JSON.stringify(result),/invite#|Bearer/);assert.equal(statSync(join(root,result.file)).mode&0o777,0o600);
 const privateStatus=await callMvp({root,operation:{type:'status'},fetchAdmin:async()=>Response.json({status:'ok',syncDisabled:false,autoSyncEnabled:false,lastAutomaticSync:{at:'2026-11-18T10:00:00.000Z',status:'busy'},progress:{distanceKm:1,partial:true,stale:false,updatedAt:null,unlockedMilestoneIds:[]}},{headers:{'Cache-Control':'no-store'}})});assert.equal(privateStatus.syncDisabled,false);assert.equal(privateStatus.autoSyncEnabled,false);assert.deepEqual(privateStatus.lastAutomaticSync,{at:'2026-11-18T10:00:00.000Z',status:'busy'});assert.equal(privateStatus.progress.distanceKm,1);
 linkSync(join(dir,'admin-token'),join(dir,'hardlink'));assert.throws(()=>readMvpPrivate(root,'admin-token'));unlinkSync(join(dir,'hardlink'));
 unlinkSync(join(dir,'strava-client-secret'));symlinkSync(join(dir,'admin-token'),join(dir,'strava-client-secret'));assert.throws(()=>readMvpPrivate(root,'strava-client-secret'));
 chmodSync(dir,0o755);assert.throws(()=>readMvpPrivate(root,'admin-token'));chmodSync(dir,0o700);
});


test('dos slots y reemisión por admin: invitación anterior invalidada y atleta duplicado rechazado',async t=>{
 const f=unit(t),issue=async(slot,id)=> (await f.request({body:JSON.stringify(mvpCommand({type:'issue',slot,expectedAthleteId:id},f.time.now))})).json();
 const a=await issue('slot-a',101),replacement=await issue('slot-a',101);assert.equal(a.status,'issued');assert.equal(replacement.status,'issued');assert.notEqual(a.invitation,replacement.invitation);
 const invite=await f.api.fetch(new Request(MVP_ORIGIN+'/invite')),cookie=invite.headers.get('Set-Cookie').split(';')[0];
 const start=link=>f.api.fetch(new Request(MVP_ORIGIN+'/invite/start',{method:'POST',headers:{Origin:MVP_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).hash.slice(1)})}));
 assert.equal((await start(a.invitation)).status,400);assert.equal((await start(replacement.invitation)).status,200);
 assert.equal((await issue('slot-b',101)).status,'failed');assert.equal((await issue('slot-b',202)).status,'issued');
});
