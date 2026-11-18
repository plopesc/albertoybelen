import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateStagingRelease,stagingReleasePlan} from '../scripts/lib/staging-release-config.mjs';
import {validateInfrastructureConfig} from '../scripts/lib/infrastructure-config.mjs';
import {stagingCommand} from '../scripts/lib/staging-config.mjs';
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const configs=()=>['wrangler.staging-oauth.jsonc','wrangler.staging-operator.jsonc','wrangler.staging.jsonc'].map(json);

test('release cerrada y operador no público contrastados con metadata/allowlist y rollback fixture',()=>{
  const [oauth,operator,fixture]=configs();validateStagingRelease(oauth,operator,fixture);
  const plan=stagingReleasePlan(oauth,operator,fixture);assert.equal(plan.deploymentAllowed,false);assert.equal(plan.operatorPublic,false);assert.deepEqual(plan.remoteOperations,[]);assert.equal(plan.rollback.entry,fixture.main);
  assert.throws(()=>stagingCommand(oauth,['deploy','--confirm-staging'],{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}));assert.throws(()=>stagingCommand(operator,['deploy','--confirm-staging'],{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}));
});

test('editar solo metadata/Wrangler no habilita red/producción/rutas/secrets/bindings/flags',()=>{
  const changes=[
    ([c])=>c.name='albertoybelen-api',([c])=>c.d1_databases[0].database_name='albertoybelen-db',([c])=>c.d1_databases[0].database_id='00000000-0000-0000-0000-000000000001',
    ([c])=>c.vars.STAGING_AUTH_ENABLED='owner-authorized-staging-test',([c])=>c.vars.STAGING_NETWORK_ENABLED='owner-authorized-staging-network',([c])=>c.vars.STAGING_OPERATOR_ENABLED='owner-authorized-private-staging-operator',
    ([c])=>c.vars.STRAVA_CLIENT_SECRET='synthetic-must-not-print',([c])=>c.account_id='a'.repeat(32),([c])=>c.env={production:{}},([c])=>c.triggers.crons=['0 * * * *'],([c])=>c.main='backend/pilot-entry.js',
    ([,c])=>c.workers_dev=true,([,c])=>c.preview_urls=true,([,c])=>c.routes=['*'],([,c])=>c.services[0].service='albertoybelen-api',([,c])=>c.services[0].entrypoint='default',([,c])=>c.d1_databases=[],([,c])=>c.vars.STAGING_OPERATOR_ENABLED='owner-authorized-private-staging-operator',
  ];
  for(const change of changes){const c=configs();change(c);assert.throws(()=>validateStagingRelease(...c));}
  for(const change of [c=>c.cloudflare.stagingOperator.workerName='albertoybelen-api',c=>c.cloudflare.stagingOperator.configured=true,c=>c.cloudflare.stagingOperator.deployEnabled=true,c=>c.cloudflare.stagingOperator.apiOrigin='https://unsafe.invalid',c=>c.cloudflare.stagingOperator.STAGING_OPERATOR_KEYS='synthetic']){const c=json('config.json');change(c);assert.throws(()=>validateInfrastructureConfig(c));}
});

test('CLI OAuth no ofrece remoto ni flags de override, incluso con credenciales/cuenta sintéticas',()=>{
  for(const args of [[],['deploy'],['migrate'],['list'],['secrets'],['check','--env','production'],['plan','--name','albertoybelen-api'],['dry-run','--config','other'],['dry-run','--remote']]) {
    const r=spawnSync(process.execPath,['scripts/staging-oauth.mjs',...args],{env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-must-not-print',STRAVA_CLIENT_SECRET:'synthetic-must-not-print'}});
    assert.notEqual(r.status,0);assert.equal((r.stdout.toString()+r.stderr.toString()).includes('synthetic-must-not-print'),false);
  }
  const check=spawnSync(process.execPath,['scripts/staging-oauth.mjs','check'],{encoding:'utf8'});assert.equal(check.status,0,`staging-oauth check failed:\n${check.stderr||check.stdout||'no diagnostic output'}`);
  const plan=spawnSync(process.execPath,['scripts/staging-oauth.mjs','plan'],{encoding:'utf8'});assert.equal(plan.status,0,`staging-oauth plan failed:\n${plan.stderr||plan.stdout||'no diagnostic output'}`);assert.equal(JSON.parse(plan.stdout).deploymentAllowed,false);
});

test('check/plan funcionan en checkout limpio sin esbuild; solo dry-run intenta importarlo',t=>{
  const directory=mkdtempSync(join(tmpdir(),'staging-oauth-no-esbuild-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const loader=join(directory,'block-esbuild.mjs');writeFileSync(loader,`import {registerHooks} from 'node:module';\nregisterHooks({resolve(specifier,context,nextResolve){if(specifier==='esbuild')throw new Error('synthetic clean checkout has no esbuild');return nextResolve(specifier,context);}});\n`);
  const run=operation=>spawnSync(process.execPath,['--import',loader,'scripts/staging-oauth.mjs',operation],{encoding:'utf8'});
  for(const operation of ['check','plan']){const result=run(operation);assert.equal(result.status,0,`${operation} unexpectedly required esbuild:\n${result.stderr||result.stdout||'no diagnostic output'}`);assert.doesNotMatch(result.stdout+result.stderr,/synthetic clean checkout has no esbuild/);}
  const dryRun=run('dry-run');assert.notEqual(dryRun.status,0);assert.match(dryRun.stderr,/Staging OAuth preparation blocked/);assert.doesNotMatch(dryRun.stderr,/synthetic clean checkout has no esbuild/);
  const denied=run('check --remote');assert.notEqual(denied.status,0);assert.match(denied.stderr,/Staging OAuth preparation blocked/);
});
