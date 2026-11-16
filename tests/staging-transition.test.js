import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {stagingCallback,validateStagingCallback,stagingTransitionPreflight} from '../scripts/lib/staging-transition.mjs';
import {stagingReleasePlan} from '../scripts/lib/staging-release-config.mjs';
import {stagingAuthPlan} from '../scripts/staging-auth-plan.mjs';
import {stagingCommand} from '../scripts/lib/staging-config.mjs';
import {OPERATOR_READINESS} from '../backend/staging-operator-policy.js';
import {stagingAuthFixture} from './helpers/staging-auth-fixture.js';
import {pilotFixture} from './helpers/pilot-fixture.js';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const configs=()=>['wrangler.staging-oauth.jsonc','wrangler.staging-operator.jsonc','wrangler.staging.jsonc'].map(read);
const host='albertoybelen-api-staging.autumn-dream-2a39.workers.dev',uri=`https://${host}/oauth/callback`;

test('preflight une metadata, allowlist, tres Wrangler y callback runtime sin confundir ensayo con autorización',()=>{
  const [oauth,operator,fixture]=configs();const p=stagingTransitionPreflight(oauth,operator,fixture);
  assert.deepEqual(stagingCallback(),{panelDomain:host,redirectUri:uri});validateStagingCallback(host,uri);
  assert.equal(p.callback.redirectUri,OPERATOR_READINESS.STAGING_CALLBACK_CONFIRMED);
  assert.equal(p.remoteChecked,false);assert.equal(p.activationAllowed,false);assert.equal(p.transitionExecuted,false);
  assert.equal(p.architecture.application,'existing-single-Strava-app');assert.equal(p.architecture.relay,false);assert.equal(p.architecture.additionalApplication,false);assert.equal(p.architecture.simultaneousOAuth,false);
  assert.equal(p.ddev.policy,'parked');assert.equal(p.ddev.processState,'not-inspected');assert.equal(p.provider.athleteCapacity,'unverified');assert.equal(p.callback.providerAcceptance,'unverified');assert.equal(p.provider.countExistingAuthorizations,true);
  assert.equal(p.reportedRemote.migration0003,'pending');assert.equal(p.operatorIngress,'blocked-not-implemented');assert.equal(p.release.state,'closed');assert.equal(p.release.cronEnabled,false);
  assert.equal(stagingAuthPlan(fixture).callback,uri);assert.equal(stagingReleasePlan(oauth,operator,fixture).callback,uri);
  assert.equal(p.rollback.callbackPanelDomain,'albertoybelen.ddev.site');assert.equal(p.rollback.tokensAndD1,'do-not-copy-delete-revoke-or-restore');
});

test('panel solo hostname exacto, URI fija: rechaza DDEV, sufijo compartido, relay y cualquier override',()=>{
  for(const domain of ['workers.dev','autumn-dream-2a39.workers.dev','albertoybelen.ddev.site',`https://${host}`,`${host}/oauth/callback`,`${host}:443`,`${host}.evil.invalid`,`${host}.`,uri])assert.throws(()=>validateStagingCallback(domain,uri));
  for(const address of ['https://albertoybelen.ddev.site/oauth/callback',`http://${host}/oauth/callback`,`https://${host}:443/oauth/callback`,`https://user@${host}/oauth/callback`,`${uri}?`,`${uri}#x`,`${uri}?redirect=https://albertoybelen.ddev.site`,uri.replace('/oauth/callback','/relay'),uri+'/'])assert.throws(()=>validateStagingCallback(host,address));
});

test('preflight falla cerrado ante metadata/Wrangler alterados; fixture deploy no acepta OAuth',()=>{
  for(const change of [([c])=>c.vars.STAGING_AUTH_ENABLED='owner-authorized-staging-test',([c])=>c.vars.STAGING_CALLBACK_CONFIRMED='https://albertoybelen.ddev.site/oauth/callback',([c])=>c.d1_databases[0].database_id='00000000-0000-0000-0000-000000000029',([,c])=>c.workers_dev=true,([,,c])=>c.name='albertoybelen-api',([c])=>c.triggers.crons=['0 * * * *']]) {
    const c=configs();change(c);assert.throws(()=>stagingTransitionPreflight(...c));
  }
  const metadata=read('config.json');metadata.cloudflare.staging.apiOrigin='https://albertoybelen.ddev.site';assert.throws(()=>stagingTransitionPreflight(...configs(),metadata));
  assert.throws(()=>stagingCommand(configs()[0],['deploy','--confirm-staging'],{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}));
});

test('staging usa su callback, sin importar tokens/D1/cofres del piloto sintético de la misma app',async t=>{
  const parked=await pilotFixture(t);await parked.connect();await parked.runtime.sync();
  const before=JSON.stringify((await parked.runtime.repository.read()).state);
  const stage=stagingAuthFixture(t);assert.equal(stage.env.STRAVA_CLIENT_ID,parked.env.STRAVA_CLIENT_ID);
  const initial=(await stage.runtime.repository.read()).state;assert.deepEqual(initial.sealedTokens,{});assert.deepEqual(initial.policy.unlockedMilestoneIds,[]);assert.ok(initial.auth.slots.every(s=>s.status==='disconnected'));
  const attempt=await stage.begin();assert.equal(attempt.authorize.searchParams.get('redirect_uri'),uri);assert.equal(stage.calls.length,0);
  assert.equal((await stage.runtime.fetch(new Request('https://albertoybelen.ddev.site/oauth/callback'))).status,400);
  await stage.callback(attempt);await stage.sync();assert.equal((await stage.progress()).distanceKm,1);
  assert.equal(JSON.stringify((await parked.runtime.repository.read()).state),before);
});

test('CLI aislada es solo lectura: no red, procesos, datos privados, escrituras ni argumentos',()=>{
  const root=mkdtempSync(join(tmpdir(),'staging-preflight-'));
  try {
    for(const dir of ['scripts/lib','backend','.local/pilot-config','.local/pilot-d1','frontend/config'])mkdirSync(join(root,dir),{recursive:true});
    for(const file of ['scripts/lib/staging-diagnostics.mjs','scripts/lib/staging-d1-policy.mjs','config.json','wrangler.staging.jsonc','wrangler.staging-oauth.jsonc','wrangler.staging-operator.jsonc','scripts/staging-preflight.mjs','scripts/lib/staging-transition.mjs','scripts/lib/staging-release-config.mjs','scripts/lib/staging-config.mjs','scripts/lib/infrastructure-config.mjs','scripts/lib/infrastructure-policy.mjs','backend/staging-operator-policy.js','backend/staging-auth-settings.js'])writeFileSync(join(root,file),readFileSync(file));
    writeFileSync(join(root,'package.json'),'{"type":"module"}');
    const privateFiles=['.local/pilot-config/.dev.vars','.local/pilot-d1/sentinel','.dev.vars','frontend/config/local.json'];
    for(const path of privateFiles)writeFileSync(join(root,path),'synthetic-private-never-read');
    writeFileSync(join(root,'deny-io.mjs'),`import fs from 'node:fs';import net from 'node:net';import http from 'node:http';import https from 'node:https';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const read=fs.readFileSync;fs.readFileSync=(path,...args)=>{const value=String(path);if(/\\.local|\\.dev\\.vars|frontend\\/config/.test(value))throw Error('Private read forbidden');return read(path,...args)};for(const key of ['writeFileSync','mkdirSync','unlinkSync','rmSync'])fs[key]=()=>{throw Error('Write forbidden')};globalThis.fetch=()=>{throw Error('Network forbidden')};net.connect=net.createConnection=()=>{throw Error('Network forbidden')};http.request=http.get=https.request=https.get=()=>{throw Error('Network forbidden')};child.spawn=child.spawnSync=child.exec=child.execSync=child.execFile=child.execFileSync=child.fork=()=>{throw Error('Process forbidden')};syncBuiltinESMExports();`);
    const run=args=>spawnSync(process.execPath,['--import',join(root,'deny-io.mjs'),join(root,'scripts/staging-preflight.mjs'),...args],{cwd:root,env:{...process.env,STRAVA_CLIENT_SECRET:'synthetic-env-never-read'}});
    const first=run([]);assert.equal(first.status,0,first.stderr.toString());assert.doesNotMatch(first.stdout.toString(),/synthetic-private-never-read|synthetic-env-never-read/);const p=JSON.parse(first.stdout);assert.equal(p.callback.panelDomain,host);assert.equal(p.remoteChecked,false);assert.equal(run([]).stdout.toString(),first.stdout.toString());
    for(const args of [['--remote'],['--callback',uri],['--confirm'],['deploy'],['--client-secret','synthetic-private-never-read']]){const r=run(args);assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout.toString()+r.stderr.toString(),/synthetic-private-never-read|synthetic-env-never-read/);}
    for(const path of privateFiles)assert.equal(readFileSync(join(root,path),'utf8'),'synthetic-private-never-read');
  }finally{rmSync(root,{recursive:true,force:true});}
});
