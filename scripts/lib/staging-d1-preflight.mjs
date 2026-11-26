import {atStage} from './staging-diagnostics.mjs';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync,constants as c} from 'node:sqlite';
import {loadInfrastructureConfig} from './infrastructure-config.mjs';
import {validateStagingRelease} from './staging-release-config.mjs';
import {MIGRATION_PINS,FIXTURE_TABLES,STAGE_TABLES,HISTORY_SQL,MAX_BACKUP_BYTES} from './staging-d1-policy.mjs';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function migrationPreflight(root,config) {
  validateStagingRelease(JSON.parse(readFileSync(join(root,'wrangler.staging-oauth.jsonc'),'utf8')),JSON.parse(readFileSync(join(root,'wrangler.staging-operator.jsonc'),'utf8')),config,loadInfrastructureConfig(join(root,'config.json')));const directory=join(root,'backend/d1/migrations');
  if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()||JSON.stringify(readdirSync(directory).sort())!==JSON.stringify(MIGRATION_PINS.map(m=>m.name)))throw Error('Migration inventory mismatch');
  const migrations=MIGRATION_PINS.map(pin=>{const path=join(directory,pin.name);if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('Migration file required');const sql=readFileSync(path);if(sha256(sql)!==pin.sha256)throw Error('Migration fingerprint mismatch');return{...pin,sql:sql.toString('utf8')};});
  // SQLite authorizer verifies actual operations, not keyword matching inside comments/strings.
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(migrations[0].sql+migrations[1].sql);
    db.setAuthorizer((action,first,second)=>{
      if(action===c.SQLITE_CREATE_TABLE)return STAGE_TABLES.includes(first)?c.SQLITE_OK:c.SQLITE_DENY;
      if(action===c.SQLITE_CREATE_INDEX)return STAGE_TABLES.includes(second)?c.SQLITE_OK:c.SQLITE_DENY;
      if([c.SQLITE_INSERT,c.SQLITE_UPDATE,c.SQLITE_READ].includes(action))return ['sqlite_master','sqlite_schema',...STAGE_TABLES].includes(first)?c.SQLITE_OK:c.SQLITE_DENY;
      if(action===c.SQLITE_FUNCTION)return ['json_valid','length','like','glob','julianday'].includes(second)?c.SQLITE_OK:c.SQLITE_DENY;
      return c.SQLITE_DENY;
    });
    db.exec(migrations[2].sql);db.setAuthorizer(null);
    if(db.prepare('SELECT count(*) n FROM participants').get().n!==2)throw Error('Fixture changed');
  }catch{throw Error('Additive migration check failed');}finally{db.close();}
  return migrations;
}
export function assertApplied(applied,{after=false}={}) {
  const expected=MIGRATION_PINS.slice(0,after?3:2).map(m=>m.name);
  if(JSON.stringify(applied)!==JSON.stringify(expected))throw Error('Unexpected migration history; only 0003 may be pending');
}
export function parseRemoteState(output,{after=false}={}) {
  return atStage('INVENTORY_RESPONSE',()=>{
    const data=JSON.parse(output);if(!Array.isArray(data)||data.length!==1||data[0].success!==true||!Array.isArray(data[0].results))throw Error();
    const migrations=[],counts={},tables=[],expectedTables=[...FIXTURE_TABLES,'d1_migrations',...(after?STAGE_TABLES:[])];
    for(const row of data[0].results) {
      if(row.kind==='migration'&&typeof row.name==='string'&&Number.isSafeInteger(row.value)&&row.value>0)migrations.push(row);
      else if(row.kind==='rows'&&FIXTURE_TABLES.includes(row.name)&&Number.isSafeInteger(row.value)&&row.value>=0&&!Object.hasOwn(counts,row.name))counts[row.name]=row.value;
      else if(row.kind==='schema-table'&&row.value===0&&expectedTables.includes(row.name)&&!tables.includes(row.name))tables.push(row.name);
      else throw Error();
    }
    migrations.sort((a,b)=>a.value-b.value);if(new Set(migrations.map(m=>m.value)).size!==migrations.length)throw Error();
    const applied=migrations.map(m=>m.name);assertApplied(applied,{after});
    if(Object.keys(counts).length!==FIXTURE_TABLES.length||tables.length!==expectedTables.length)throw Error();
    return{applied,counts};
  });
}
// Compare schema tokens, preserving string literals; harmless quote/whitespace changes are allowed.
const normalized=sql=>{const tokens=(sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|\[[^\]]*\]|`[^`]*`|[a-zA-Z_][a-zA-Z_0-9]*|\d+|[^\s]/g)??[]).map(token=>token.startsWith("'")?token:token.replace(/^["`\[]|["`\]]$/g,'').toLowerCase());if(tokens.slice(0,5).join(' ')==='create table if not exists')tokens.splice(2,3);return tokens.join(' ');};
export function inspectSql(bytes,migrations) {
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,allowExtension:false});
  const expected=new DatabaseSync(':memory:');
  try {
    if(bytes.byteLength<1||bytes.byteLength>MAX_BACKUP_BYTES||migrations.length!==3||migrations.some((m,i)=>m.name!==MIGRATION_PINS[i].name||sha256(m.sql)!==MIGRATION_PINS[i].sha256))throw Error();
    const sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!sql.trimEnd().endsWith(';')||sql.includes('\0'))throw Error();
    expected.exec(migrations[0].sql+migrations[1].sql+HISTORY_SQL);
    const tables=[...FIXTURE_TABLES,'d1_migrations','sqlite_sequence'];
    db.setAuthorizer((action,first,second)=>{
      if(action===c.SQLITE_CREATE_TABLE)return tables.includes(first)?c.SQLITE_OK:c.SQLITE_DENY;
      if(action===c.SQLITE_CREATE_INDEX)return tables.includes(second)?c.SQLITE_OK:c.SQLITE_DENY;
      if(action===c.SQLITE_UPDATE)return ['sqlite_master','sqlite_schema','sqlite_sequence'].includes(first)?c.SQLITE_OK:c.SQLITE_DENY;
      if([c.SQLITE_INSERT,c.SQLITE_READ].includes(action))return ['sqlite_master','sqlite_schema',...tables].includes(first)?c.SQLITE_OK:c.SQLITE_DENY;
      if(action===c.SQLITE_DELETE)return first==='sqlite_sequence'?c.SQLITE_OK:c.SQLITE_DENY;
      if(action===c.SQLITE_TRANSACTION)return c.SQLITE_OK;
      if(action===c.SQLITE_PRAGMA)return ['foreign_keys','defer_foreign_keys'].includes(first)?c.SQLITE_OK:c.SQLITE_DENY;
      if(action===c.SQLITE_FUNCTION)return ['char','json_valid','current_timestamp','length','like','glob','julianday'].includes(second?.toLowerCase())?c.SQLITE_OK:c.SQLITE_DENY;
      return c.SQLITE_DENY;
    });
    db.exec(sql);db.setAuthorizer(null);if(db.isTransaction)throw Error();
    const schema=d=>d.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all().map(row=>({...row,sql:normalized(row.sql)}));
    if(JSON.stringify(schema(db))!==JSON.stringify(schema(expected)))throw Error();
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error();
    const applied=db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row=>row.name);assertApplied(applied);
    const counts=Object.fromEntries(FIXTURE_TABLES.map(name=>[name,db.prepare(`SELECT count(*) n FROM ${name}`).get().n]));
    const fingerprint=()=>sha256(JSON.stringify(FIXTURE_TABLES.map(name=>db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())));
    const before=fingerprint();db.exec(migrations[2].sql);db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(MIGRATION_PINS[2].name);if(fingerprint()!==before)throw Error();
    return{applied,counts};
  }catch{throw Error('Backup SQL rejected or local restore failed');}finally{db.close();expected.close();}
}
