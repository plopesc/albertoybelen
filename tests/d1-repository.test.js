import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteD1 } from './helpers/sqlite-d1.js';
import { createD1Repository, credentialVault } from '../backend/d1/repository.js';
import { defaultFixtureEvents } from '../backend/fixtures.js';
import { createWorker } from '../backend/worker.js';
import { hashSecret } from '../auth/invitation-machine.js';
const owner = { authenticated: true, role: 'owner' };
function setup(t) { const db = sqliteD1(); t.after(() => db.close()); return { db, repo: createD1Repository(db) }; }
const success = (distance = 40000) => ({ ...defaultFixtureEvents()[1], activities: [{ id: 'run', distance, sport_type: 'Run', manual: false, private: false, start_date: '2026-11-01T00:00:00+01:00', name: 'MUST NOT STORE', map: { polyline: 'MUST NOT STORE' } }] });
test('migraciones, claves, checks, composición y solo metadatos mínimos', async t => {
 const { db, repo } = setup(t); await repo.applyEvents(defaultFixtureEvents());
 assert.equal((await repo.getProgress()).distanceKm,4.00075);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM activities').get().n,2);
 assert.throws(()=>db.sqlite.exec("INSERT INTO rewards VALUES('')"));
 assert.throws(()=>db.sqlite.exec("INSERT INTO activities VALUES('absent','x','2026-11-01T00:00:00Z',1,1,'Run',0,0)"));
 assert.throws(()=>db.sqlite.exec("INSERT INTO participants VALUES('third',0,0,0,0,0,'[]',NULL)"));
 await repo.applyEvents([success()]);
 assert.equal(JSON.stringify(await repo.read()).includes('MUST NOT STORE'),false);
 assert.equal(db.sqlite.prepare('SELECT start_utc FROM activities WHERE activity_id=?').get('run').start_utc,'2026-10-31T23:00:00.000Z');
});
test('repeticiones, correcciones, borrados y logros históricos incluido finish', async t => {
 const { repo }=setup(t); await repo.applyEvents(defaultFixtureEvents());
 await repo.applyEvents([success(110000)]); const completed=await repo.getProgress();assert.ok(completed.unlockedMilestoneIds.includes('finish'));
 await repo.applyEvents([success(110000)]);assert.deepEqual(await repo.getProgress(),completed);
 await repo.applyEvents([success(1000)]);assert.equal((await repo.getProgress()).distanceKm,3.75025);assert.ok((await repo.getProgress()).unlockedMilestoneIds.includes('finish'));
 await repo.applyEvents([{...success(),activities:[{id:'run',deleted:true}],complete:false}]); assert.equal((await repo.getProgress()).distanceKm,2.75025);
 await repo.setGoal(700);assert.ok((await repo.getProgress()).unlockedMilestoneIds.includes('finish'));
});
test('snapshot compuesto y proyecciones se revierten ante conflicto CAS o integridad', async t => {
 const { db,repo }=setup(t);await repo.applyEvents(defaultFixtureEvents());const old=await repo.read();
 await repo.applyEvents([success()]); const latest=await repo.read();
 await assert.rejects(repo.commit(old.revision,old.state));assert.deepEqual(await repo.read(),latest);
 const broken=structuredClone(latest.state);broken.policy.unlockedMilestoneIds.push('');
 await assert.rejects(repo.commit(latest.revision,broken));assert.deepEqual(await repo.read(),latest);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM participants').get().n,2);
});
test('dos repositorios concurrentes no pierden actualizaciones de slots independientes', async t => {
 const { db,repo }=setup(t);await repo.applyEvents(defaultFixtureEvents()); const other=createD1Repository(db);
 await Promise.all([repo.applyEvents([success(10000)]),other.applyEvents([{...success(20000),participantId:'slot-b'}])]);
 assert.equal((await repo.getProgress()).distanceKm,30);
});
test('proceso nuevo recupera datos y premio; reset explícito aislado bloquea jobs viejos', async () => {
 const dir=mkdtempSync(join(tmpdir(),'alberto-d1-'));const file=join(dir,'fixture.sqlite');let db;
 try {
 db=sqliteD1(file);let repo=createD1Repository(db);await repo.applyEvents(defaultFixtureEvents());await repo.applyEvents([success(110000)]);const before=await repo.getProgress();db.close();
 db=sqliteD1(file,false);repo=createD1Repository(db);assert.deepEqual(await repo.getProgress(),before);
 assert.throws(()=>repo.resetForTests('production'));await repo.resetForTests('local-fixtures');await repo.applyEvents(defaultFixtureEvents());
 assert.equal((await repo.getProgress()).distanceKm,0);assert.deepEqual((await repo.getProgress()).unlockedMilestoneIds,[]);
 } finally { db?.close();rmSync(dir,{recursive:true,force:true}); }
});
test('error temporal y parcial inicial mantienen último dato válido sin filtrar cuentas',async t=>{
 const { repo }=setup(t);const events=defaultFixtureEvents();await repo.applyEvents(events.slice(0,3));
 assert.equal((await repo.getProgress()).partial,true);assert.equal((await repo.getProgress()).updatedAt,null);
 await repo.markFailures();assert.equal((await repo.getProgress()).stale,true);assert.equal((await repo.getProgress()).distanceKm,1.2505);
 const worker=createWorker({repository:repo});await worker.scheduled({});const dto=await(await worker.fetch(new Request('http://local/api/progress'))).json();
 assert.equal(dto.partial,false);assert.equal(dto.stale,false);assert.equal(JSON.stringify(dto).includes('slot-'),false);
 const broken=createWorker({repository:repo,loadFixture:async()=>[success(50000),{...success(),activities:[{id:'bad',distance:-1}]}]});
 await assert.rejects(broken.scheduled({}));assert.equal((await repo.getProgress()).distanceKm,4.00075);
});
test('invitaciones hash-only, intentos, supresión atómica y generaciones duraderas',async t=>{
 const { db,repo }=setup(t);const hash=value=>hashSecret(value);const now=Date.parse('2026-11-01T12:00:00Z');
 await repo.transitionAuth({type:'issue',now,actor:owner,slot:'slot-a',tokenHash:hash('synthetic-invite'),expectedAccountHash:hash('synthetic-account'),expiresAt:now+10000});
 await repo.transitionAuth({type:'begin',now,tokenHash:hash('synthetic-invite'),stateHash:hash('synthetic-state'),sessionHash:hash('synthetic-session')});
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM oauth_attempts').get().n,1);
 const callback={type:'callback',now,stateHash:hash('synthetic-state'),sessionHash:hash('synthetic-session'),accountHash:hash('synthetic-account'),providerStatus:'valid',scopes:['activity:read_all']};
 assert.equal((await repo.transitionAuth(callback)).ok,true);await repo.applyEvents([success()]);
 await repo.transitionAuth({type:'delete',now,actor:owner,requestVerified:true,slot:'slot-a'});
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM activities').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM invitations').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM oauth_attempts').get().n,0);
 assert.equal((await repo.transitionAuth(callback)).ok,false);await repo.applyEvents([success(100000)]);assert.equal((await repo.getProgress()).distanceKm,0);
 assert.equal(JSON.stringify((await repo.read()).state).includes(hash('synthetic-account')),false);
 await assert.rejects(credentialVault.store('never-store-a-token'));
});
test('canje concurrente persiste un solo consumo y revocación directa invalida intentos',async t=>{
 const {db,repo}=setup(t);const other=createD1Repository(db);const h=hashSecret;const now=Date.parse('2026-11-01T12:00:00Z');
 await repo.transitionAuth({type:'issue',now,actor:owner,slot:'slot-a',tokenHash:h('fixture-ticket'),expectedAccountHash:h('fixture-account'),expiresAt:now+10000});
 await repo.transitionAuth({type:'begin',now,tokenHash:h('fixture-ticket'),stateHash:h('fixture-state'),sessionHash:h('fixture-session')});
 const callback={type:'callback',now,stateHash:h('fixture-state'),sessionHash:h('fixture-session'),accountHash:h('fixture-account'),providerStatus:'valid',scopes:['activity:read_all']};
 const results=await Promise.all([repo.transitionAuth(callback),other.transitionAuth(callback)]);assert.equal(results.filter(r=>r.ok).length,1);
 await repo.applyEvents([{participantId:'slot-a',generation:0,status:'revoked'}]);
 const read=await repo.read();assert.equal(read.state.auth.slots[0].generation,1);assert.equal(read.state.auth.slots[0].status,'revoked');
 assert.equal((await repo.transitionAuth(callback)).ok,false);
});
test('fallo de repositorio no filtra información y mantiene CORS/no-store',async()=>{
 const worker=createWorker({repository:{async getState(){throw new Error('private-slot-data');}}});
 const response=await worker.fetch(new Request('http://local/api/progress',{headers:{Origin:'https://albertoybelen.ddev.site'}}));
 assert.equal(response.status,503);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://albertoybelen.ddev.site');assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(await response.json(),{error:'local_storage_unavailable'});
});
