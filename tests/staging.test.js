import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';
import{validateStagingConfig,stagingCommand,stagingEnvironment}from'../scripts/lib/staging-config.mjs';import staging from'../backend/staging-entry.js';
const config=()=>JSON.parse(readFileSync('wrangler.staging.jsonc','utf8'));
const account={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};

test('staging fija worker, D1 e ID autorizados, esquema existente y ningún Cron',()=>{
 const c=config();validateStagingConfig(c);assert.equal(c.name,'albertoybelen-api-staging');assert.equal(c.d1_databases[0].database_name,'albertoybelen-db-staging');assert.equal(c.d1_databases[0].database_id,'c6bde806-cf94-4ff3-8c4f-c08b8de477f6');assert.equal(c.d1_databases[0].binding,'DB');assert.equal(c.d1_databases[0].migrations_dir,'backend/d1/migrations');assert.deepEqual(c.triggers.crons,[]);assert.equal(staging.scheduled,undefined);
});

test('cambiar cualquier destino a producción, añadir env/rutas/secretos o Cron aborta antes de invocar Wrangler',()=>{
 const changes=[c=>c.name='albertoybelen-api',c=>c.d1_databases[0].database_name='albertoybelen-db',c=>c.d1_databases[0].database_id='00000000-0000-0000-0000-000000000001',c=>c.d1_databases[0].binding='PROD',c=>c.d1_databases.push({...c.d1_databases[0]}),c=>c.main='backend/oauth-entry.js',c=>c.vars.APP_ENV='production',c=>c.vars.STRAVA_CLIENT_SECRET='must-not-be-accepted',c=>c.triggers.crons.push('0 * * * *'),c=>c.routes=['production.invalid/*'],c=>c.route='production.invalid/*',c=>c.env={production:{}},c=>c.account_id='a'.repeat(32),c=>c.d1_databases[0].remote=true,c=>c.build={command:'false'}];
 for(const change of changes){const c=config();change(c);assert.throws(()=>stagingCommand(c,['deploy','--confirm-staging'],account),/mismatch/);}
});

test('operaciones remotas solo manuales, confirmadas y con cuenta seleccionada; sin overrides',()=>{
 assert.equal(stagingCommand(config(),['check']),null);assert.deepEqual(stagingCommand(config(),['dry-run']),['deploy','--dry-run','--outdir','dist']);
 assert.deepEqual(stagingCommand(config(),['migrate','--confirm-staging'],account),['d1','migrations','apply','DB','--remote']);assert.deepEqual(stagingCommand(config(),['list','--confirm-staging'],account),['d1','migrations','list','DB','--remote']);assert.deepEqual(stagingCommand(config(),['deploy','--confirm-staging'],account),['deploy']);
 for(const args of [['migrate'],['deploy'],['list'],['delete','--confirm-staging'],['deploy','--confirm-staging','--env','production'],['migrate','--confirm-staging','albertoybelen-db'],['dry-run','--config','other'],['check','--remote']])assert.throws(()=>stagingCommand(config(),args,account));
 for(const operation of ['list','migrate','deploy'])assert.throws(()=>stagingCommand(config(),[operation,'--confirm-staging'],{}),/ACCOUNT_ID/);
});

test('dry-run elimina credenciales Cloudflare/Strava y variables de selección de entorno',()=>{
 const original={PATH:'/bin',HOME:'/tmp/test',CLOUDFLARE_ACCOUNT_ID:account.CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_API_TOKEN:'fake-cloudflare-token',CLOUDFLARE_ENV:'production',WRANGLER_ENV:'production',STRAVA_CLIENT_SECRET:'fake-strava',TOKEN_ENCRYPTION_KEY:'fake-vault',PILOT_ENABLED:'enabled'};
 const local=stagingEnvironment(original,false);assert.equal(local.PATH,'/bin');assert.equal(local.HOME,original.HOME);assert.equal(local.CLOUDFLARE_API_TOKEN,undefined);assert.equal(local.CLOUDFLARE_ACCOUNT_ID,undefined);assert.equal(local.STRAVA_CLIENT_SECRET,undefined);assert.equal(local.TOKEN_ENCRYPTION_KEY,undefined);assert.equal(local.PILOT_ENABLED,undefined);assert.equal(local.WRANGLER_ENV,undefined);assert.equal(local.CLOUDFLARE_ENV,undefined);assert.equal(local.CLOUDFLARE_SEND_METRICS,'false');assert.equal(local.WRANGLER_LOG_PATH,'staging.log');
 const remote=stagingEnvironment(original,true);assert.equal(remote.CLOUDFLARE_API_TOKEN,'fake-cloudflare-token');assert.equal(remote.CLOUDFLARE_ACCOUNT_ID,account.CLOUDFLARE_ACCOUNT_ID);assert.equal(remote.CLOUDFLARE_ENV,undefined);assert.equal(remote.STRAVA_CLIENT_SECRET,undefined);assert.equal(original.STRAVA_CLIENT_SECRET,'fake-strava');
});

test('CLI sin confirmación ni argumentos arbitrarios falla sin llamadas remotas',()=>{
 for(const args of [['migrate'],['deploy'],['list'],['deploy','--remote'],['check','--name','albertoybelen-api']])assert.notEqual(spawnSync(process.execPath,['scripts/staging.mjs',...args]).status,0);
 assert.equal(spawnSync(process.execPath,['scripts/staging.mjs','check']).status,0);
});

test('entry de staging falla cerrado fuera de entorno y no expone OAuth',async()=>{
 const response=await staging.fetch(new Request('https://staging.invalid/api/progress'),{APP_ENV:'production',DB:{}});assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'staging_unavailable'});
 const unknown=await staging.fetch(new Request('https://staging.invalid/oauth/authorize'),{APP_ENV:'staging-fixtures',DB:{}});assert.equal(unknown.status,404);
});
