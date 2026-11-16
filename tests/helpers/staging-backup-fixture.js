import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sqliteD1} from './sqlite-d1.js';
import {createD1Repository} from '../../backend/d1/repository.js';
import {defaultFixtureEvents} from '../../backend/fixtures.js';
import {HISTORY_SQL,MIGRATION_PINS,FIXTURE_TABLES,STAGING_D1_READ_QUERY} from '../../scripts/lib/staging-d1-policy.mjs';
import {runStagingD1} from '../../scripts/lib/staging-d1.mjs';
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
export function dumpSql(db) {
  const tables=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  let sql='PRAGMA defer_foreign_keys=TRUE;\n';
  for(const table of tables)sql+=table.sql+';\n';
  for(const table of tables)for(const row of db.prepare(`SELECT * FROM "${table.name}"`).all())sql+=`INSERT INTO "${table.name}" VALUES(${Object.values(row).map(literal).join(',')});\n`;
  return sql;
}
export async function backupFixture(t) {
  const root=mkdtempSync(join(tmpdir(),'staging-backup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'backend/d1/migrations'),{recursive:true});
  for(const file of ['config.json','wrangler.staging.jsonc','wrangler.staging-oauth.jsonc','wrangler.staging-operator.jsonc'])writeFileSync(join(root,file),readFileSync(file));
  for(const migration of MIGRATION_PINS)writeFileSync(join(root,'backend/d1/migrations',migration.name),readFileSync(`backend/d1/migrations/${migration.name}`));
  const db=sqliteD1(':memory:',false);t.after(()=>db.close());
  for(const migration of MIGRATION_PINS.slice(0,2))db.sqlite.exec(readFileSync(`backend/d1/migrations/${migration.name}`,'utf8'));
  db.sqlite.exec(HISTORY_SQL);for(const migration of MIGRATION_PINS.slice(0,2))db.sqlite.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(migration.name);
  await createD1Repository(db).applyEvents(defaultFixtureEvents());
  db.sqlite.prepare('INSERT INTO oauth_credentials VALUES(?,?,?,?,?,?)').run('slot-a',0,1,'v1','abcdefghijklmnop','synthetic-private-ciphertext-opaque-envelope');
  const original=Object.fromEntries([...FIXTURE_TABLES,'d1_migrations'].map(name=>[name,db.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
  const calls=[],fault={export:false,partial:false,wrongTarget:false,missingCompletion:false};let number=0;
  const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)},config=JSON.parse(readFileSync(join(root,'wrangler.staging.jsonc'))),now=Date.now();
  const fake=(args,options)=>{
    calls.push({args,options});
    if(args[1]==='execute'){if(args.at(-1)!==STAGING_D1_READ_QUERY)throw Error('Unknown query');return JSON.stringify([{success:true,results:db.sqlite.prepare(STAGING_D1_READ_QUERY).all()}]);}
    if(args[1]==='export') {
      const file=args[args.indexOf('--output')+1];writeFileSync(file,fault.partial?'CREATE TABLE game_state (id TEXT);':fault.missingRows?dumpSql(db.sqlite).replace(/INSERT INTO "game_state"[^\n]+;\n/,''):dumpSql(db.sqlite));
      if(fault.export)throw Error('synthetic-private-error-signed-url');
      return `Executing on remote database DB (${fault.wrongTarget?'00000000-0000-0000-0000-000000000001':config.d1_databases[0].database_id}):\nhttps://synthetic-private-signed.invalid\n${fault.missingCompletion?'':`Downloaded to ${file} successfully!`}`;
    }
    if(args[1]==='migrations') {
      db.sqlite.exec('BEGIN');try{db.sqlite.exec(options.migration.sql);if(fault.migrate)throw Error('synthetic-private-migration-failure');db.sqlite.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(options.migration.name);db.sqlite.exec('COMMIT');}catch(error){db.sqlite.exec('ROLLBACK');throw error;}
      return 'synthetic-private-migration-output';
    }
    throw Error('Unknown mock command');
  };
  return{root,db,env,config,calls,fault,original,now,run(argv,overrides={}){return runStagingD1({root,config,env,argv,runWrangler:fake,clock:()=>now,createId:()=>String(++number).padStart(24,'0'),...overrides});}};
}
