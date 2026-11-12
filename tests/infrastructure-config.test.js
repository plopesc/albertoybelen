import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadInfrastructureConfig, validateInfrastructureConfig, validateLocalTarget} from '../scripts/lib/infrastructure-config.mjs';
import {validateStagingConfig} from '../scripts/lib/staging-config.mjs';
import {checkInfrastructureFiles} from '../scripts/check-infrastructure-config.mjs';
import {stagingViewConfig, STAGING_READ_URL, STAGING_READ_PORT} from '../scripts/lib/staging-read.mjs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const metadata = () => read('config.json');

test('metadatos consistentes con todos los Wrangler, DDEV y guardas independientes de #36', () => {
  const config = checkInfrastructureFiles();
  assert.equal(STAGING_READ_URL, config.cloudflare.staging.apiOrigin + config.public.progressPath);
  assert.equal(STAGING_READ_PORT, config.local.ddev.stagingRead.port);
  assert.deepEqual(stagingViewConfig({game:{title:'A y B'}}), {game:{title:'A y B · Staging ficticio',id:'local-ddev-cloudflare-staging',mode:'real',goalKm:100,startDate:'2026-11-01',timeZone:'Europe/Madrid'},api:{url:'/api/staging/progress',allowFixtures:true}});
  assert.equal(config.cloudflare.production.databaseId, undefined);
  assert.equal(config.cloudflare.production.apiOrigin, undefined);
  assert.throws(() => {config.cloudflare.production.deployEnabled = true;}, TypeError);
  assert.equal(config.local.ddev.oauthMock.port, config.local.ddev.ownerPilot.port); // exclusive modes, existing contract
});

test('config.json falla cerrado: versiones, claves, secretos, destino, URL, puerto, IDs y separación', () => {
  const changes = [
    c=>c.schemaVersion=2, c=>c.extra=true, c=>c.cloudflare.staging.workerName=c.cloudflare.production.workerName,
    c=>c.cloudflare.staging.databaseName=c.cloudflare.production.databaseName, c=>c.cloudflare.staging.databaseId='not-a-uuid',
    c=>c.cloudflare.staging.databaseId=c.local.ddev.fixtures.databaseId, c=>c.cloudflare.staging.apiOrigin='http://staging.invalid',
    c=>c.cloudflare.staging.apiOrigin='https://user:password@staging.invalid', c=>c.cloudflare.staging.apiOrigin+='/?token=synthetic',
    c=>c.cloudflare.staging.binding='OTHER', c=>c.cloudflare.staging.cronEnabled=true,
    c=>c.cloudflare.production.configured=true, c=>c.cloudflare.production.deployEnabled=true,
    c=>c.cloudflare.production.databaseId='c6bde806-cf94-4ff3-8c4f-c08b8de477f6', c=>c.cloudflare.production.apiOrigin='https://prod.invalid',
    c=>c.local.ddev.origin='https://other.ddev.site', c=>c.local.ddev.origin='http://albertoybelen.ddev.site',
    c=>c.local.ddev.host='0.0.0.0', c=>c.local.ddev.ownerPilot.port=8792, c=>c.local.ddev.frontend.port=8790,
    c=>c.local.ddev.fixtures.databaseId=c.local.ddev.ownerPilot.databaseId, c=>c.local.ddev.ownerPilot.persistence='../private',
    c=>c.local.ddev.callbackPath='https://evil.invalid', c=>c.local.ddev.stagingRead.path='/api/progress',
    c=>c.local.profiles.ownerPilot.allowFixtures=true, c=>c.local.profiles.staging.apiPath='https://external.invalid',
    c=>c.local.profiles.fixtures.id=c.local.profiles.ownerPilot.id, c=>c.local.profiles.fixtures.goalKm=0,
    c=>c.local.profiles.fixtures.goalKm='100', c=>c.local.profiles.staging.startDate='2026-11-28',
    c=>c.local.profiles.staging.timeZone='UTC', c=>c.public.pagesPath='/',
  ];
  for (const change of changes) {const c=metadata(); change(c); assert.throws(()=>validateInfrastructureConfig(c), /execution blocked/);}
  const privateKeys=['STRAVA_CLIENT_SECRET','STRAVA_CLIENT_ID','PILOT_OWNER_ATHLETE_ID','access_token','refresh_token','TOKEN_ENCRYPTION_KEY','invitation','cookie','account_id','CLOUDFLARE_ACCOUNT_ID'];
  for (const key of privateKeys) for (const section of ['root','staging','ddev','profile']) {
    const c=metadata(); const target={root:c,staging:c.cloudflare.staging,ddev:c.local.ddev,profile:c.local.profiles.staging}[section];
    target[key]='synthetic-value-must-not-appear';
    assert.throws(()=>validateInfrastructureConfig(c), error=>/blocked/.test(error.message) && !error.message.includes(target[key]));
  }
});

test('Wrangler no puede divergir de config o añadir rutas, variables o D1 remota', () => {
  for(const [name,file] of Object.entries({fixtures:'wrangler.local.jsonc',oauthMock:'wrangler.oauth.local.jsonc',ownerPilot:'wrangler.pilot.local.jsonc'})) {
    for(const change of [c=>c.name='albertoybelen-api',c=>c.dev.port++,c=>c.dev.ip='0.0.0.0',c=>c.d1_databases[0].database_id='unknown',c=>c.d1_databases[0].remote=true,c=>c.vars.STRAVA_CLIENT_SECRET='synthetic',c=>c.routes=['*']]) {
      const c=read(file);change(c);assert.throws(()=>validateLocalTarget(c,name), /execution blocked/);
    }
  }
  const operational=metadata();operational.cloudflare.staging.workerName='albertoybelen-api';
  const wrangler=read('wrangler.staging.jsonc');wrangler.name='albertoybelen-api';
  assert.throws(()=>validateStagingConfig(wrangler,operational),/protected staging target/);
});

function replica(root) {
  for(const dir of ['scripts/lib','frontend/config','.ddev/nginx','.github/workflows']) mkdirSync(join(root,dir),{recursive:true});
  for(const file of ['package.json','config.json','wrangler.staging.jsonc','scripts/staging.mjs','scripts/lib/staging-config.mjs','scripts/lib/infrastructure-config.mjs','scripts/lib/infrastructure-policy.mjs']) writeFileSync(join(root,file),readFileSync(file));
}
test('CLI rechaza config alterada antes de crear salida/invocar Wrangler, incluso con confirmación y cuenta', () => {
  const root=mkdtempSync(join(tmpdir(),'infra-cli-'));
  try {
    replica(root);
    const cli=args=>spawnSync(process.execPath,[join(root,'scripts/staging.mjs'),...args],{cwd:root,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)}});
    assert.equal(cli(['check']).status,0);
    for(const change of [c=>c.cloudflare.staging.workerName='albertoybelen-api',c=>c.cloudflare.staging.databaseName='albertoybelen-db',c=>c.cloudflare.staging.databaseId='00000000-0000-0000-0000-000000000001',c=>c.local.ddev.host='0.0.0.0',c=>c.STRAVA_CLIENT_SECRET='synthetic']) {
      const c=metadata();change(c);writeFileSync(join(root,'config.json'),JSON.stringify(c));
      for(const args of [['check'],['dry-run'],['migrate','--confirm-staging'],['deploy','--confirm-staging']]) {
        const result=cli(args);assert.notEqual(result.status,0);assert.equal(existsSync(join(root,'.local')),false);
      }
    }
    writeFileSync(join(root,'config.json'),'broken JSON');assert.throws(()=>loadInfrastructureConfig(join(root,'config.json')),/strict JSON/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('config de tooling queda fuera del frontend y del artifact Pages; no hay imports Node en navegador', () => {
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
  assert.equal(existsSync('frontend/config.json'),false);
  for(const file of walk('frontend/js').filter(path=>path.endsWith('.js'))) assert.doesNotMatch(readFileSync(file,'utf8'), /infrastructure-config|infrastructure-policy|\.\.\/\.\.\/config\.json/);
  assert.match(readFileSync('.github/workflows/pages.yml','utf8'), /path: frontend\//);
});

test('consistencia detecta cambios estáticos en Wrangler, proxy Nginx y guardas del navegador', () => {
  const root=mkdtempSync(join(tmpdir(),'infra-consistency-'));
  try {
    replica(root);
    mkdirSync(join(root,'frontend/js'),{recursive:true});
    const files=['wrangler.staging-oauth.jsonc','wrangler.staging-operator.jsonc','wrangler.staging-auth.local.jsonc','wrangler.local.jsonc','wrangler.oauth.local.jsonc','wrangler.pilot.local.jsonc','.ddev/config.yaml','.ddev/nginx/oauth-local.conf','.ddev/nginx/frontend-local.conf.example','.ddev/nginx/staging-read-local.conf.example','frontend/js/runtime-config.js','.github/workflows/pages.yml'];
    for(const file of files)writeFileSync(join(root,file),readFileSync(file));
    const url=new URL(`file://${root}/`);checkInfrastructureFiles(url);
    for(const [file,from,to] of [
      ['wrangler.staging.jsonc','albertoybelen-db-staging','albertoybelen-db'],
      ['wrangler.local.jsonc','8788','8790'],
      ['.ddev/nginx/staging-read-local.conf.example','8792','8790'],
      ['.ddev/nginx/frontend-local.conf.example','127.0.0.1','0.0.0.0'],
      ['.ddev/nginx/oauth-local.conf','albertoybelen.ddev.site','other.ddev.site'],
      ['frontend/js/runtime-config.js','local-ddev-cloudflare-staging','local-ddev-owner-pilot'],
      ['.github/workflows/pages.yml','path: frontend/','path: ./'],
    ]) {
      const original=readFileSync(join(root,file),'utf8');assert.ok(original.includes(from));
      writeFileSync(join(root,file),original.replaceAll(from,to));assert.throws(()=>checkInfrastructureFiles(url));
      writeFileSync(join(root,file),original);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
