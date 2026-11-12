import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
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
  assert.equal(spawnSync(process.execPath,['scripts/staging-oauth.mjs','check']).status,0);
  const plan=spawnSync(process.execPath,['scripts/staging-oauth.mjs','plan']);assert.equal(plan.status,0);assert.equal(JSON.parse(plan.stdout).deploymentAllowed,false);
});
