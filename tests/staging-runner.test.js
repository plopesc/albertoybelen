import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {backupFixture,dumpSql} from './helpers/staging-backup-fixture.js';
import {createStagingRunner} from '../scripts/lib/staging-runner.mjs';
import {MIGRATION_PINS,STAGING_D1_READ_QUERY} from '../scripts/lib/staging-d1-policy.mjs';
import {migrationPreflight} from '../scripts/lib/staging-d1-preflight.mjs';

test('único runner no admite SQL/target/flags arbitrarios ni apply sin backup, y congela solo 0003',async t=>{
  const f=await backupFixture(t),backup=f.run(['backup','--confirm-staging']),migration=migrationPreflight(f.root,f.config)[2];let calls=0;
  const runner=createStagingRunner(f.root,f.config,{...f.env,STRAVA_CLIENT_SECRET:'synthetic-must-not-propagate',WRANGLER_ENV:'production'}, {spawn:(binary,args,options)=>{
    calls++;assert.equal(binary,process.execPath);assert.ok(args.includes('--config'));assert.equal(options.env.STRAVA_CLIENT_SECRET,undefined);assert.equal(options.env.WRANGLER_ENV,undefined);assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID,f.env.CLOUDFLARE_ACCOUNT_ID);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
    const config=JSON.parse(readFileSync(args.at(-1)));assert.equal(config.name,'albertoybelen-api-staging');assert.equal(config.d1_databases[0].database_id,f.config.d1_databases[0].database_id);
    assert.deepEqual(readdirSync(config.d1_databases[0].migrations_dir),[MIGRATION_PINS[2].name]);assert.equal(readFileSync(join(config.d1_databases[0].migrations_dir,migration.name),'utf8'),migration.sql);
    assert.equal(readFileSync(join(options.cwd,'.dev.vars'),'utf8'),'');return{status:0,stdout:'captured-only',stderr:'synthetic-private-url'};
  }});
  for(const args of [['d1','execute','DB','--remote','--command','DROP TABLE participants'],['deploy','--name','albertoybelen-api'],['d1','export','DB','--remote','--output','frontend/leak.sql']])assert.throws(()=>runner(args,{capture:true}));
  const apply=['d1','migrations','apply','DB','--remote'];assert.throws(()=>runner(apply,{capture:true,migration}));assert.equal(calls,0);
  assert.throws(()=>runner(apply,{capture:true,migration:{...migration,sql:migration.sql+'DROP TABLE participants;'},backupId:backup.backupId}));assert.equal(calls,0);
  assert.equal(runner(apply,{capture:true,migration,backupId:backup.backupId}),'captured-only');assert.equal(calls,1);
});

test('CLI backup con Wrangler simulado nunca imprime SQL, signed URL, stdout/stderr privado ni credenciales',async t=>{
  const f=await backupFixture(t);
  for(const dir of ['scripts/lib','node_modules/wrangler/bin','.local/pilot-config'])mkdirSync(join(f.root,dir),{recursive:true,mode:0o700});
  for(const file of ['scripts/lib/staging-release-config.mjs','scripts/staging.mjs','scripts/lib/staging-config.mjs','scripts/lib/staging-runner.mjs','scripts/lib/staging-d1.mjs','scripts/lib/staging-d1-policy.mjs','scripts/lib/staging-d1-preflight.mjs','scripts/lib/staging-private-files.mjs','scripts/lib/infrastructure-config.mjs','scripts/lib/infrastructure-policy.mjs'])writeFileSync(join(f.root,file),readFileSync(file));
  writeFileSync(join(f.root,'package.json'),'{"type":"module"}');writeFileSync(join(f.root,'fixture.sql'),dumpSql(f.db.sqlite),{mode:0o600});writeFileSync(join(f.root,'inventory.json'),JSON.stringify([{success:true,results:f.db.sqlite.prepare(STAGING_D1_READ_QUERY).all()}]),{mode:0o600});
  const marker='synthetic-private-never-output';writeFileSync(join(f.root,'.local/pilot-config/.dev.vars'),marker,{mode:0o600});writeFileSync(join(f.root,'.dev.vars'),marker,{mode:0o600});
  writeFileSync(join(f.root,'node_modules/wrangler/bin/wrangler.js'),`import{readFileSync,writeFileSync}from'node:fs';const args=process.argv.slice(2);if(args[1]==='execute'){console.log(readFileSync(${JSON.stringify(join(f.root,'inventory.json'))},'utf8'));}else if(args[1]==='export'){const output=args[args.indexOf('--output')+1];writeFileSync(output,readFileSync(${JSON.stringify(join(f.root,'fixture.sql'))}));console.log('Executing on remote database DB (c6bde806-cf94-4ff3-8c4f-c08b8de477f6):');console.log('${marker} https://signed.invalid/?token=${marker}');console.error('${marker} stderr');console.log('Downloaded to '+output+' successfully!');}else{throw Error('Forbidden fake command');}`);
  const syntheticEnv={...process.env};for(const key of Object.keys(syntheticEnv))if(/^(CLOUDFLARE_|WRANGLER_|STRAVA_|TOKEN_|PILOT_|OAUTH_)/.test(key))delete syntheticEnv[key];
  const result=spawnSync(process.execPath,[join(f.root,'scripts/staging.mjs'),'backup','--confirm-staging'],{cwd:f.root,env:{...syntheticEnv,...f.env,CLOUDFLARE_API_TOKEN:'synthetic-cloudflare-token',STRAVA_CLIENT_SECRET:marker},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'backup-verified');assert.doesNotMatch(result.stdout+result.stderr,/signed\.invalid|synthetic-private|INSERT INTO|CREATE TABLE/);
  assert.equal(readFileSync(join(f.root,'.local/pilot-config/.dev.vars'),'utf8'),marker);
});
