import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {createD1Repository} from '../../backend/d1/repository.js';
import {defaultFixtureEvents} from '../../backend/fixtures.js';
import fixtureWorker from '../../backend/staging-entry.js';
import {HISTORY_SQL,MIGRATION_PINS,FIXTURE_TABLES} from '../../scripts/lib/staging-d1-policy.mjs';
import {inspectSql} from '../../scripts/lib/staging-d1-preflight.mjs';

test('D1 temporal: export SQL real de Miniflare, restauración local exacta, 0003 aditiva y fixture rollback',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'staging-d1-backup-'));
  const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:'export default {}',compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'00000000-0000-0000-0000-000000000046'},outboundService:()=>{throw Error('External network forbidden');}}),resourcePersistencePath:join(directory,'persist'),telemetry:{enabled:false},logRequests:false});let restored;
  try {
    const db=await mf.getD1Database('DB'),migrations=await Promise.all(MIGRATION_PINS.map(async pin=>({...pin,sql:await readFile(`backend/d1/migrations/${pin.name}`,'utf8')})));
    for(const migration of migrations.slice(0,2))for(const sql of migration.sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    await db.prepare(HISTORY_SQL).run();for(const pin of MIGRATION_PINS.slice(0,2))await db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(pin.name).run();
    await createD1Repository(db).applyEvents(defaultFixtureEvents());
    await db.prepare('INSERT INTO oauth_credentials VALUES(?,?,?,?,?,?)').bind('slot-a',0,1,'v1','abcdefghijklmnop','synthetic-private-ciphertext-opaque-envelope').run();
    const snapshot=async()=>Object.fromEntries(await Promise.all([...FIXTURE_TABLES,'d1_migrations'].map(async name=>[name,(await db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()).results])));
    const before=await snapshot(),dto=await(await fixtureWorker.fetch(new Request('https://fixture.invalid/api/progress'),{APP_ENV:'staging-fixtures',DB:db})).json();
    const dump=await db.prepare('PRAGMA miniflare_d1_export(?,?,?);').bind(false,false).raw();const sql=dump[0].join('\n');
    const verified=inspectSql(Buffer.from(sql),migrations);assert.equal(verified.counts.participants,2);
    restored=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});restored.exec(sql);
    for(const name of [...FIXTURE_TABLES,'d1_migrations'])assert.equal(JSON.stringify(restored.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()),JSON.stringify(before[name]));
    const statements=migrations[2].sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s));statements.push(db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(MIGRATION_PINS[2].name));await db.batch(statements);
    const after=await snapshot();for(const name of FIXTURE_TABLES)assert.deepEqual(after[name],before[name]);
    await assert.rejects(db.batch(statements));for(const name of FIXTURE_TABLES)assert.deepEqual((await snapshot())[name],before[name]);
    assert.deepEqual(await(await fixtureWorker.fetch(new Request('https://fixture.invalid/api/progress'),{APP_ENV:'staging-fixtures',DB:db})).json(),dto);
    assert.equal(dto.source,'fixture');assert.equal((await fixtureWorker.fetch(new Request('https://fixture.invalid/invite'),{APP_ENV:'staging-fixtures',DB:db})).status,404);
  }finally{restored?.close();await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
