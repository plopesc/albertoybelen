import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,chmodSync,symlinkSync,linkSync,statSync,readdirSync,existsSync,mkdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {backupFixture,dumpSql} from './helpers/staging-backup-fixture.js';
import {migrationPreflight,inspectSql,parseRemoteState} from '../scripts/lib/staging-d1-preflight.mjs';
import {MIGRATION_PINS,FIXTURE_TABLES,STAGING_D1_READ_QUERY} from '../scripts/lib/staging-d1-policy.mjs';
import {inspectBackup} from '../scripts/lib/staging-d1.mjs';

test('backup mock privado validado/restaurado, ligado a cuenta/target; solo 0003 y fixture exacto tras aplicar',async t=>{
  const f=await backupFixture(t);assert.equal(f.run(['d1-check']).remoteState,'not-checked');assert.equal(f.calls.length,0);
  const list=f.run(['list','--confirm-staging']);assert.deepEqual(list.pending,[MIGRATION_PINS[2].name]);
  const backup=f.run(['backup','--confirm-staging']),dir=join(f.root,'.local/staging-backups',backup.backupId);
  assert.equal(backup.status,'backup-verified');assert.equal(statSync(dir).mode&0o777,0o700);for(const name of ['backup.sql','manifest.json'])assert.equal(statSync(join(dir,name)).mode&0o777,0o600);
  assert.equal(f.run(['inspect-backup',backup.backupId]).status,'verified-locally');
  const result=f.run(['migrate',backup.backupId,'--confirm-staging']);assert.equal(result.status,'migration-0003-applied');
  for(const name of FIXTURE_TABLES)assert.deepEqual(f.db.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),f.original[name]);
  const migration=f.calls.find(call=>call.args[1]==='migrations');assert.equal(migration.options.migration.name,MIGRATION_PINS[2].name);assert.equal(migration.options.capture,true);
  assert.deepEqual(f.run(['list','--confirm-staging']).pending,[]);
  assert.throws(()=>f.run(['migrate',backup.backupId,'--confirm-staging']),/INVENTORY_RESPONSE/);
  assert.doesNotMatch(JSON.stringify(backup),/signed|synthetic-private|activities|document/);
});

test('sin backup, confirmación, cuenta o con IDs/rutas arbitrarios no se inicia ningún remoto',async t=>{
  const f=await backupFixture(t);
  for(const args of [['backup'],['backup','--confirm-staging','--output','frontend/leak.sql'],['migrate','--confirm-staging'],['migrate','../pilot','--confirm-staging'],['inspect-backup','../../pilot'],['restore'],['execute','DROP'],['d1-plan','--remote']])assert.throws(()=>f.run(args));
  for(const account of ['', 'wrong'])assert.throws(()=>f.run(['backup','--confirm-staging'],{env:{CLOUDFLARE_ACCOUNT_ID:account}}));
  assert.throws(()=>f.run(['migrate','1'.repeat(24),'--confirm-staging']));assert.equal(f.calls.length,0);
});

test('permisos, symlinks, hardlinks, checksum, manifest, cuenta y edad rechazan evidencia inválida',async t=>{
  const f=await backupFixture(t),backup=f.run(['backup','--confirm-staging']),dir=join(f.root,'.local/staging-backups',backup.backupId),sql=join(dir,'backup.sql'),manifest=join(dir,'manifest.json');
  const originalSql=readFileSync(sql),originalManifest=readFileSync(manifest);const reject=()=>assert.throws(()=>f.run(['inspect-backup',backup.backupId]));
  chmodSync(sql,0o644);reject();chmodSync(sql,0o600);chmodSync(dir,0o755);reject();chmodSync(dir,0o700);
  writeFileSync(sql,Buffer.concat([originalSql,Buffer.from('\n-- damaged\n')]));reject();writeFileSync(sql,originalSql);
  writeFileSync(manifest,JSON.stringify({...JSON.parse(originalManifest),target:{databaseName:'albertoybelen-db'}}));reject();writeFileSync(manifest,originalManifest);
  const calls=f.calls.length;assert.throws(()=>f.run(['migrate',backup.backupId,'--confirm-staging'],{env:{CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32)}}));assert.equal(f.calls.length,calls);
  assert.throws(()=>f.run(['migrate',backup.backupId,'--confirm-staging'],{clock:()=>f.now+86400001}));assert.equal(f.calls.length,calls);
  linkSync(sql,join(dir,'hardlink'));reject();
});

test('symlink de directorio privado y colisiones fallan sin sobrescribir ni seguir el enlace',async t=>{
  const f=await backupFixture(t),first=f.run(['backup','--confirm-staging']);
  const dir=join(f.root,'.local/staging-backups',first.backupId),before=readFileSync(join(dir,'backup.sql'));
  assert.throws(()=>f.run(['backup','--confirm-staging'],{createId:()=>first.backupId}));assert.deepEqual(readFileSync(join(dir,'backup.sql')),before);
  const id='f'.repeat(24);symlinkSync(dir,join(f.root,'.local/staging-backups',id));assert.throws(()=>f.run(['inspect-backup',id]));
});

test('errores, salida truncada/target errado y export parcial no publican evidencia usable ni SQL en errores',async t=>{
  const f=await backupFixture(t);
  for(const mode of ['export','partial','missingRows','wrongTarget','missingCompletion']) {
    f.fault[mode]=true;let id;
    assert.throws(()=>f.run(['backup','--confirm-staging']),error=>{id=error.backupId;return !/synthetic-private|signed\.invalid/.test(error.message);});
    assert.ok(id);assert.equal(existsSync(join(f.root,'.local/staging-backups',id,'manifest.json')),false);assert.throws(()=>f.run(['inspect-backup',id]));f.fault[mode]=false;
  }
});

test('inventario remoto desconocido, duplicado, parcial o distinto de solo 0003 bloquea escritura',async t=>{
  const f=await backupFixture(t),backup=f.run(['backup','--confirm-staging']);
  for(const sql of ["INSERT INTO d1_migrations(name) VALUES('0004_unexpected.sql')",'CREATE TABLE staging_auth_incomplete(id TEXT)']) {
    f.db.sqlite.exec('SAVEPOINT fixture');f.db.sqlite.exec(sql);const before=f.calls.filter(c=>c.args[1]==='migrations').length;
    assert.throws(()=>f.run(['migrate',backup.backupId,'--confirm-staging']));assert.equal(f.calls.filter(c=>c.args[1]==='migrations').length,before);f.db.sqlite.exec('ROLLBACK TO fixture; RELEASE fixture');
  }
  const output=JSON.stringify([{success:true,results:f.db.sqlite.prepare(STAGING_D1_READ_QUERY).all()}]);
  assert.throws(()=>parseRemoteState('truncated'));assert.throws(()=>parseRemoteState(output.replace('0002_oauth_vault.sql','unexpected.sql')));
  const json=JSON.parse(output);json[0].results.push(json[0].results[0]);assert.throws(()=>parseRemoteState(JSON.stringify(json)));
});

test('huellas, orden, SQL destructivo/symlinks y edición aislada del JSON/UUID fallan antes de remoto',async t=>{
  const f=await backupFixture(t),file=join(f.root,'backend/d1/migrations',MIGRATION_PINS[2].name),original=readFileSync(file);
  writeFileSync(file,Buffer.concat([original,Buffer.from('DROP TABLE participants;')]));assert.throws(()=>f.run(['backup','--confirm-staging']));writeFileSync(file,original);
  writeFileSync(join(f.root,'backend/d1/migrations/0004_unknown.sql'),'SELECT 1;');assert.throws(()=>migrationPreflight(f.root,f.config));
  unlinkSync(join(f.root,'backend/d1/migrations/0004_unknown.sql'));
  const meta=JSON.parse(readFileSync(join(f.root,'config.json')));meta.cloudflare.staging.databaseId='00000000-0000-0000-0000-000000000001';writeFileSync(join(f.root,'config.json'),JSON.stringify(meta));assert.throws(()=>f.run(['backup','--confirm-staging']));
  assert.equal(f.calls.length,0);
});

test('restauración SQL aislada rechaza ATTACH, extensión, escrituras destructivas y dump incompleto',async t=>{
  const f=await backupFixture(t),migrations=migrationPreflight(f.root,f.config),sql=dumpSql(f.db.sqlite);
  for(const suffix of ["ATTACH '/tmp/forbidden-staging.db' AS external;","SELECT load_extension('forbidden');",'DROP TABLE participants;','DELETE FROM participants;','PRAGMA writable_schema=ON;','CREATE INDEX sqliteXrogue ON participants(generation);'])assert.throws(()=>inspectSql(Buffer.from(sql+suffix),migrations),/rejected/);
  assert.throws(()=>inspectSql(Buffer.from(sql.slice(0,-3)),migrations));
  assert.equal(inspectSql(Buffer.from(sql),migrations).counts.participants,2);
});

test('ruta de export bajo symlink a carpeta publicada se rechaza antes de consultar remoto',async t=>{
  const f=await backupFixture(t);mkdirSync(join(f.root,'.local'),{mode:0o700});mkdirSync(join(f.root,'frontend'));symlinkSync(join(f.root,'frontend'),join(f.root,'.local/staging-backups'));
  assert.throws(()=>f.run(['backup','--confirm-staging']));assert.equal(f.calls.length,0);assert.deepEqual(readdirSync(join(f.root,'frontend')),[]);
});

test('fallo de migración no provoca retry/restore/despliegue, ni escribe sobre el backup',async t=>{
  const f=await backupFixture(t),backup=f.run(['backup','--confirm-staging']),path=join(f.root,'.local/staging-backups',backup.backupId,'backup.sql'),before=readFileSync(path);
  f.fault.migrate=true;assert.throws(()=>f.run(['migrate',backup.backupId,'--confirm-staging']));assert.equal(f.calls.filter(c=>c.args[1]==='migrations').length,1);
  assert.deepEqual(readFileSync(path),before);for(const name of FIXTURE_TABLES)assert.deepEqual(f.db.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),f.original[name]);
  assert.deepEqual(f.run(['list','--confirm-staging']).pending,[MIGRATION_PINS[2].name]);
});

test('lock de operación impide backups/migraciones simultáneos sin matar servicios ajenos',async t=>{
  const f=await backupFixture(t);let nested=false;
  const backup=f.run(['backup','--confirm-staging'],{runWrangler:(args,options)=>{
    if(!nested){nested=true;assert.throws(()=>f.run(['backup','--confirm-staging']));}
    if(args[1]==='execute')return JSON.stringify([{success:true,results:f.db.sqlite.prepare(STAGING_D1_READ_QUERY).all()}]);
    const file=args[args.indexOf('--output')+1];writeFileSync(file,dumpSql(f.db.sqlite));return `Executing on remote database DB (${f.config.d1_databases[0].database_id}):\nDownloaded to ${file} successfully!`;
  }});assert.equal(backup.status,'backup-verified');assert.equal(existsSync(join(f.root,'.local/staging-backups/.operation-lock')),false);
});

test('archivo backup SQL sustituido por symlink y migración enlazada nunca se siguen',async t=>{
  const f=await backupFixture(t),backup=f.run(['backup','--confirm-staging']),dir=join(f.root,'.local/staging-backups',backup.backupId),file=join(dir,'backup.sql');
  writeFileSync(join(dir,'retained.sql'),readFileSync(file),{mode:0o600});unlinkSync(file);symlinkSync(join(dir,'retained.sql'),file);assert.throws(()=>f.run(['inspect-backup',backup.backupId]));
  const migration=join(f.root,'backend/d1/migrations',MIGRATION_PINS[2].name),contents=readFileSync(migration);writeFileSync(join(f.root,'source.sql'),contents);unlinkSync(migration);symlinkSync(join(f.root,'source.sql'),migration);assert.throws(()=>f.run(['d1-check']));
});
