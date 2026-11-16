import test from 'node:test';
import assert from 'node:assert/strict';
import {constants as sqlite} from 'node:sqlite';
import {chmodSync,existsSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {backupFixture} from './helpers/staging-backup-fixture.js';
import {STAGING_D1_READ_QUERY,MIGRATION_PINS} from '../scripts/lib/staging-d1-policy.mjs';
import {parseRemoteState} from '../scripts/lib/staging-d1-preflight.mjs';
import {createStagingRunner} from '../scripts/lib/staging-runner.mjs';
import {atStage,diagnosticCode,wranglerFailure} from '../scripts/lib/staging-diagnostics.mjs';
const args=['d1','execute','DB','--remote','--json','--command',STAGING_D1_READ_QUERY];
// Synthetic values only; envelope matches Wrangler 4.160.1 remote --json.
const envelope=rows=>[{results:rows,success:true,meta:{served_by:'synthetic',duration:0.1,changes:0,last_row_id:0,changed_db:false,size_after:4096,rows_read:123,rows_written:0}}];
const compoundFailure=()=>({status:1,stdout:JSON.stringify({error:{text:'Synthetic API failure',notes:[{text:'too many terms in compound SELECT: SQLITE_ERROR'}]}}),stderr:'synthetic-private-token https://signed.invalid/'});

test('inventario remoto: tres términos, SELECT autorizado y formato Wrangler sintético antes/después de 0003',async t=>{
  const f=await backupFixture(t);
  f.db.sqlite.setAuthorizer((action)=>[sqlite.SQLITE_SELECT,sqlite.SQLITE_READ,sqlite.SQLITE_FUNCTION,sqlite.SQLITE_RECURSIVE].includes(action)?sqlite.SQLITE_OK:sqlite.SQLITE_DENY);
  const rows=f.db.sqlite.prepare(STAGING_D1_READ_QUERY).all();f.db.sqlite.setAuthorizer(null);
  assert.equal(STAGING_D1_READ_QUERY.split('UNION ALL').length,3);
  assert.deepEqual(parseRemoteState(JSON.stringify(envelope(rows))).applied,MIGRATION_PINS.slice(0,2).map(m=>m.name));
  f.db.sqlite.exec(readFileSync(join(f.root,'backend/d1/migrations',MIGRATION_PINS[2].name),'utf8'));
  f.db.sqlite.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(MIGRATION_PINS[2].name);
  const after=JSON.stringify(envelope(f.db.sqlite.prepare(STAGING_D1_READ_QUERY).all()));
  assert.equal(parseRemoteState(after,{after:true}).applied.length,3);
  assert.throws(()=>parseRemoteState(after),e=>diagnosticCode(e)==='INVENTORY_RESPONSE');
});

test('inventario falla cerrado con salida parcial, historia/tipos/tablas/conteos inesperados',async t=>{
  const f=await backupFixture(t),valid=envelope(f.db.sqlite.prepare(STAGING_D1_READ_QUERY).all());
  const mutations=[
    d=>d[0].success=false,
    d=>d.push(structuredClone(d[0])),
    d=>d[0].results.pop(),
    d=>d[0].results.find(r=>r.kind==='migration').value='1',
    d=>d[0].results.find(r=>r.kind==='migration').name='0004_unexpected.sql',
    d=>d[0].results.push({...d[0].results.find(r=>r.kind==='migration')}),
    d=>d[0].results.find(r=>r.kind==='rows').value='0',
    d=>d[0].results.find(r=>r.kind==='rows').value=-1,
    d=>d[0].results.find(r=>r.kind==='rows').value=1.1,
    d=>d[0].results.find(r=>r.kind==='rows').value=Number.MAX_SAFE_INTEGER+1,
    d=>d[0].results.push({...d[0].results.find(r=>r.kind==='rows')}),
    d=>d[0].results.find(r=>r.kind==='schema-table').name='unexpected_table',
    d=>d[0].results.find(r=>r.kind==='schema-table').value='0',
    d=>d[0].results.push({kind:'schema-table',name:'staging_auth_participants',value:0}),
  ];
  for(const mutate of mutations){const d=structuredClone(valid);mutate(d);assert.throws(()=>parseRemoteState(JSON.stringify(d)),e=>diagnosticCode(e)==='INVENTORY_RESPONSE');}
  for(const invalid of ['{','{}','[]',JSON.stringify(valid).slice(0,-10)])assert.throws(()=>parseRemoteState(invalid));
});

test('list en checkout DDEV 0775 usa temporal 0700 sin aflojar export/write ni tocar perfiles',async t=>{
  const f=await backupFixture(t);chmodSync(f.root,0o775);let cwd;
  const output=JSON.stringify(envelope(f.db.sqlite.prepare(STAGING_D1_READ_QUERY).all()));
  const runner=createStagingRunner(f.root,f.config,f.env,{spawn:(_binary,childArgs,options)=>{
    cwd=options.cwd;assert.equal(cwd.startsWith(f.root),false);assert.equal(lstatSync(cwd).mode&0o777,0o700);
    for(const name of ['wrangler.json','.dev.vars','command.log'])assert.equal(lstatSync(join(cwd,name)).mode&0o777,0o600);
    assert.equal(readFileSync(join(cwd,'.dev.vars'),'utf8'),'');assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
    assert.deepEqual(childArgs.slice(1,-2),args);return {status:0,stdout:output};
  }});
  assert.equal(runner(args),output);assert.equal(existsSync(cwd),false);assert.equal(lstatSync(f.root).mode&0o777,0o775);
  assert.equal(existsSync(join(f.root,'.local')),false);
  assert.throws(()=>f.run(['backup','--confirm-staging']));assert.equal(f.calls.length,0);
  assert.throws(()=>runner(['deploy']),e=>diagnosticCode(e)==='PRIVATE_WORKSPACE');
});

test('códigos cerrados: límite real de compound SELECT, errores confidenciales y limpieza incluso al fallar',async t=>{
  const f=await backupFixture(t);let cwd;
  const runner=createStagingRunner(f.root,f.config,f.env,{spawn:(_binary,_args,options)=>{cwd=options.cwd;return compoundFailure();}});
  assert.throws(()=>runner(args),e=>diagnosticCode(e)==='WRANGLER_COMPOUND_SELECT_LIMIT'&&!/synthetic|signed\.invalid/.test(String(e)));
  assert.equal(existsSync(cwd),false);
  for(const [result,code]of [[{error:{code:'ETIMEDOUT'}},'WRANGLER_TIMEOUT'],[{error:{code:'ENOBUFS'}},'WRANGLER_OUTPUT_LIMIT'],[{stdout:'private incomplete output'},'WRANGLER_EXECUTION']])assert.equal(diagnosticCode(wranglerFailure(result)),code);
  assert.equal(diagnosticCode({code:'ACCOUNT_SELECTION',message:'synthetic-private-token'}),'STAGING_OPERATION_FAILED');
  assert.throws(()=>atStage('LOCAL_PREFLIGHT',()=>{throw Error('synthetic-private-token');}),e=>diagnosticCode(e)==='LOCAL_PREFLIGHT'&&!String(e).includes('synthetic-private'));
  assert.throws(()=>createStagingRunner(f.root,f.config,{}) (args),e=>diagnosticCode(e)==='ACCOUNT_SELECTION');
  assert.throws(()=>createStagingRunner(f.root,{...f.config,name:'albertoybelen-api'},f.env)(args),e=>diagnosticCode(e)==='TARGET_CONFIG');
});
