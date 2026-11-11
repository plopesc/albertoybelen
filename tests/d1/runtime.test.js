import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Repository } from '../../backend/d1/repository.js';
import { defaultFixtureEvents } from '../../backend/fixtures.js';
const migration = await readFile(new URL('../../backend/d1/migrations/0001_local_game.sql', import.meta.url),'utf8');
test('D1 real local: migración, batch/CAS/rollback, HTTP, scheduled y reinicio workerd',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'alberto-workerd-'));let mf;
 try {
  const bundled=await build({entryPoints:['backend/d1/entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
  const options={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ENV:'local-fixtures'},d1Databases:{DB:'00000000-0000-0000-0000-000000000023'},d1Persist:join(dir,'d1'),outboundService:()=>new Response('Network forbidden',{status:502})};
  mf=new Miniflare({...convertV4MiniflareOptions(options),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false}});let db=(await mf.getBindings()).DB;
  const unavailable=await mf.dispatchFetch('http://local/api/progress');assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'local_storage_unavailable'});
  // D1 exec accepts one statement per line; the migration has multiline DDL.
  for(const sql of migration.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(sql).run();
  const repo=createD1Repository(db);await repo.applyEvents(defaultFixtureEvents());
  await (await mf.getWorker()).scheduled({scheduledTime:Date.parse('2026-11-02T12:00:00Z'),cron:'local-test'});
  const before=await repo.getProgress();assert.equal(before.distanceKm,4.00075);
  const stale=await repo.read();await repo.applyEvents([{participantId:'slot-a',generation:0,status:'error'}]);
  await assert.rejects(repo.commit(stale.revision,stale.state));assert.equal((await repo.getProgress()).stale,true);
  const current=await repo.read();current.state.policy.unlockedMilestoneIds.push('');
  await assert.rejects(repo.commit(current.revision,current.state));assert.equal((await repo.getProgress()).unlockedMilestoneIds.includes(''),false);
  const response=await mf.dispatchFetch('http://local/api/progress');assert.equal(response.headers.get('Cache-Control'),'no-store');const dto=await response.json();assert.equal(dto.distanceKm,before.distanceKm);assert.equal(JSON.stringify(dto).includes('slot-'),false);
  await mf.dispose();mf=new Miniflare({...convertV4MiniflareOptions(options),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false}});db=(await mf.getBindings()).DB;const recovered=createD1Repository(db);assert.equal((await recovered.getProgress()).distanceKm,before.distanceKm);
  await recovered.resetForTests('local-fixtures');assert.equal((await recovered.getProgress()).distanceKm,0);
 } finally {await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
