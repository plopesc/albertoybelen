import test from 'node:test';
import assert from 'node:assert/strict';
import { oauthFixture, actor } from './helpers/oauth-fixture.js';
import { createActivitySync } from '../backend/activity-sync.js';
import { createActivityClient } from '../backend/strava-activities.js';
import { activityFixtures, createFixtureActivityTransport } from '../backend/activity-fixtures.js';
import { createWorker } from '../backend/worker.js';

async function fixture(t, { both = true, options = {} } = {}) {
  const f = await oauthFixture(t);
  async function connect(slot, id) {
    f.provider.exchange = async () => f.response(id);
    assert.equal(await f.service.callback(await f.begin(slot, id)), true);
  }
  await connect('slot-a', 101); if (both) await connect('slot-b', 202);
  const transport = { fetch: createFixtureActivityTransport() };
  const sync = createActivitySync({ repository: f.repository, oauth: f.service, client: createActivityClient({ enabled: true, fetchProvider: (...args) => transport.fetch(...args) }), clock: () => f.time.now, snapshotOptions: options });
  return { ...f, connect, transport, sync, progress: () => f.repository.getProgress(), advance: () => { f.time.now += 900001; } };
}

test('dos cuentas: cientos de actividades, privadas, manuales, deportes, IDs compuestos y mínimo UTC', async t => {
  const f = await fixture(t); assert.equal((await f.sync.run()).status, 'synced');
  const p = await f.progress(); assert.equal(p.distanceKm, 102.50525); assert.equal(p.partial, false); assert.equal(p.stale, false); assert.ok(p.unlockedMilestoneIds.includes('finish'));
  assert.equal((await f.db.prepare('SELECT count(*) n FROM activities').bind().first()).n, 234);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM activities WHERE activity_id=?').bind('1').first()).n, 2);
  const doc = JSON.stringify((await f.repository.read()).state);
  assert.equal(doc.includes('fixture-access-sensitive'), false);
  assert.equal((await f.sync.run()).status, 'synced'); assert.deepEqual(await f.progress(), p);
  const worker = createWorker({ repository: f.repository }); const response = await worker.fetch(new Request('https://local/api/progress'));
  const dto = await response.json(); assert.equal(dto.distanceKm, p.distanceKm);
  assert.deepEqual(Object.keys(dto).sort(), ['schemaVersion','source','distanceKm','partial','stale','updatedAt','unlockedMilestoneIds'].sort());
  assert.doesNotMatch(JSON.stringify(dto), /slot-|athlete|access|refresh|scopes|"101"|"202"/);
});

test('correcciones de distancia/tipo/fecha y borrados antiguos bajan km, nunca borran cofres', async t => {
  const f = await fixture(t); await f.sync.run(); const rewards = (await f.progress()).unlockedMilestoneIds;
  f.transport.fetch = createFixtureActivityTransport({ scenario: 'corrected' }); await f.sync.run(); assert.equal((await f.progress()).distanceKm, 32.35525);
  const records = activityFixtures('corrected'); records[101][0].start_date = '2026-10-30T10:00:00Z';
  f.transport.fetch = createFixtureActivityTransport({ records }); await f.sync.run(); assert.equal((await f.progress()).distanceKm, 32.25525);
  f.transport.fetch = createFixtureActivityTransport({ scenario: 'empty' }); await f.sync.run(); assert.equal((await f.progress()).distanceKm, 0); assert.deepEqual((await f.progress()).unlockedMilestoneIds, rewards);
  await f.repository.setGoal(1); await f.sync.run(); assert.deepEqual((await f.progress()).unlockedMilestoneIds, rewards);
});

test('bajar objetivo sin cambios de distancia no desbloquea premios', async t => {
  const f = await fixture(t); await f.repository.setGoal(1000); await f.sync.run(); assert.deepEqual((await f.progress()).unlockedMilestoneIds, []);
  await f.repository.setGoal(1); await f.sync.run(); assert.deepEqual((await f.progress()).unlockedMilestoneIds, []);
});

test('una cuenta, partial y stale simultáneos, conserva último dato y fecha conocida', async t => {
  const f = await fixture(t, { both: false }); await f.sync.run(); const p = await f.progress(); assert.equal(p.partial, true); assert.equal(p.stale, false); assert.equal(p.updatedAt, new Date(f.time.now).toISOString());
  f.transport.fetch = createFixtureActivityTransport({ scenario: 'rate-limit' }); assert.equal((await f.sync.run()).status, 'stale');
  const stale = await f.progress(); assert.equal(stale.distanceKm, p.distanceKm); assert.equal(stale.updatedAt, p.updatedAt); assert.equal(stale.partial, true); assert.equal(stale.stale, true);
  let calls = 0; f.transport.fetch = async () => { calls++; throw Error(); }; assert.equal((await f.sync.run()).status, 'idle'); assert.equal(calls, 0);
  f.advance(); f.transport.fetch = createFixtureActivityTransport(); await f.sync.run(); assert.equal((await f.progress()).stale, false);
});

for (const status of [401,403,429,500,503]) test(`HTTP ${status} conserva snapshot, no revoca por inferencia ni reintenta inmediatamente`, async t => {
  const f = await fixture(t, { both: false }); await f.sync.run(); const old = await f.progress(); let count = 0;
  f.transport.fetch = async () => { count++; return Response.json({ secret: 'never expose this' }, { status }); };
  assert.equal((await f.sync.run()).status, 'stale'); assert.equal((await f.progress()).distanceKm, old.distanceKm); assert.equal((await f.progress()).updatedAt, old.updatedAt);
  assert.equal((await f.repository.read()).state.auth.slots[0].status, 'connected'); await f.sync.run(); assert.equal(count, 1);
});

test('error en última página no borra ni confirma páginas parciales', async t => {
  const f = await fixture(t); await f.sync.run(); const old = await f.progress();
  f.transport.fetch = createFixtureActivityTransport({ scenario: 'last-page-error' }); await f.sync.run();
  assert.equal((await f.progress()).distanceKm, old.distanceKm); assert.equal((await f.progress()).stale, true);
});

for (const mode of ['missing-terminal','overlap','conflict','malformed','changing','page-limit']) test(`paginación ${mode}: rechaza snapshot inseguro sin borrados`, async t => {
  const f = await fixture(t, { both: false, options: { perPage: 2, maxPages: mode === 'page-limit' ? 1 : 25 } });
  // Establish valid data independently of the intentionally small traversal limit.
  const established = createActivitySync({ repository: f.repository, oauth: f.service, client: createActivityClient({ enabled: true, fetchProvider: createFixtureActivityTransport() }), clock: () => f.time.now });
  await established.run(); const old = await f.progress(); let pass = 0;
  const row = (id, distance = 20) => ({ id, distance, sport_type: 'Run', manual: false, private: true, start_date: '2026-11-01T10:00:00Z' });
  f.transport.fetch = async url => {
    const page = Number(new URL(url).searchParams.get('page')); if (page === 1) pass++;
    if (mode === 'malformed') return Response.json([{ id: 1 }]);
    if (mode === 'changing') return Response.json(page === 1 ? [row(1, pass)] : []);
    if (mode === 'missing-terminal') return Response.json([row(page)]);
    if (mode === 'overlap') return Response.json([row(1), row(2)]);
    if (mode === 'conflict') return Response.json([row(1), row(1, 30)]);
    return Response.json([row(1), row(2)]);
  };
  assert.equal((await f.sync.run()).status, 'stale'); assert.equal((await f.progress()).distanceKm, old.distanceKm);
});

test('varias páginas cortas intermedias llegan a vacía en ambos recorridos y se importan', async t => {
  const f = await fixture(t, { both: false });
  const calls = [];
  f.transport.fetch = async url => {
    const page = Number(new URL(url).searchParams.get('page'));
    calls.push(page);
    const row = (id, start_date) => ({ id, distance: id * 1000, sport_type: 'Walk', manual: false, private: true, start_date });
    const pages = [
      [row(1, '2026-11-01T10:00:00Z')],
      [row(2, '2026-11-01T10:00:00Z')],
      [row(3, '2026-11-01T09:00:00Z')],
      [],
    ];
    assert.ok(page >= 1 && page <= pages.length);
    return Response.json(pages[page - 1]);
  };
  assert.equal((await f.sync.run()).status, 'synced');
  assert.deepEqual(calls, [1, 2, 3, 4, 1, 2, 3, 4]);
  const p = await f.progress();
  assert.equal(p.distanceKm, 6); assert.equal(p.stale, false); assert.equal(p.partial, true);
  assert.equal((await f.repository.getState()).participants[0].initialReconciled, true);
});

test('duplicados idénticos en una página se deduplican, sin sumar doble', async t => {
  const f = await fixture(t, { both: false }); const records = activityFixtures('empty'); const row = activityFixtures()[101][0]; records[101] = [row, row];
  f.transport.fetch = createFixtureActivityTransport({ records }); await f.sync.run(); assert.equal((await f.progress()).distanceKm, .25);
});

test('renovación expirada, fallo temporal y revocación explícita del refresh', async t => {
  const f = await fixture(t, { both: false }); await f.sync.run(); const old = await f.progress();
  f.time.now += 120000; await f.sync.run(); assert.equal(f.counts.refresh, 1);
  f.time.now += 120000; f.provider.refresh = async () => { throw Error('provider_unavailable'); }; await f.sync.run(); assert.equal((await f.progress()).distanceKm, old.distanceKm);
  f.advance(); f.provider.refresh = async () => { throw Error('provider_revoked'); }; await f.sync.run();
  assert.equal((await f.repository.read()).state.auth.slots[0].status, 'revoked'); let calls = 0; f.transport.fetch = async () => { calls++; throw Error(); }; await f.sync.run(); assert.equal(calls, 0);
});

test('scope read_all se comprueba antes de consultar o refrescar', async t => {
  const f = await fixture(t, { both: false }); await f.repository.updatePrivate(s => { s.policy.participants[0].scopes = ['activity:read']; });
  let calls = 0; f.transport.fetch = async () => { calls++; throw Error(); }; await f.sync.run(); assert.equal(calls, 0); assert.equal((await f.progress()).stale, true);
});

for (const action of ['revoke','delete']) test(`${action} en carrera y reconexión: tarea antigua no resucita datos ni premios`, async t => {
  const f = await fixture(t, { both: false }); await f.sync.run(); let enter; const entered = new Promise(r => { enter = r; }); let release; const blocked = new Promise(r => { release = r; }); const normal = createFixtureActivityTransport(); let first = true;
  f.transport.fetch = async (...args) => { if (first) { first = false; enter(); await blocked; } return normal(...args); };
  const pending = f.sync.run(); await entered;
  await f.repository.transitionAuth({ type: action, slot: 'slot-a', actor, now: f.time.now, requestVerified: true, purgeMilestones: true });
  if (action === 'delete') { assert.equal((await f.progress()).distanceKm, 0); assert.deepEqual((await f.progress()).unlockedMilestoneIds, []); }
  await f.connect('slot-a', 101); release(); await pending;
  assert.equal((await f.repository.getState()).participants[0].initialReconciled, false);
  f.transport.fetch = createFixtureActivityTransport(); await f.sync.run(); assert.equal((await f.repository.getState()).participants[0].initialReconciled, true);
});

test('lease durable entre instancias, scheduled waitUntil y recuperación tras expiración', async t => {
  const f = await fixture(t, { both: false }); let release; const blocked = new Promise(r => { release = r; }); let enter; const entered = new Promise(r => { enter = r; }); const normal = createFixtureActivityTransport(); let first = true;
  f.transport.fetch = async (...args) => { if (first) { first = false; enter(); await blocked; } return normal(...args); };
  let waited; const pending = f.sync.scheduled({}, {}, { waitUntil: work => { waited = work; } }); assert.equal(waited, pending); await entered;
  const other = createActivitySync({ repository: f.repository, oauth: f.service, client: createActivityClient({ enabled: true, fetchProvider: normal }), clock: () => f.time.now });
  assert.deepEqual(await other.run(), { status: 'busy' });
  f.time.now += 120001; await other.run(); const p = await f.progress(); release(); await pending; assert.deepEqual(await f.progress(), p);
});

test('pérdida de clave no vacía datos ni consulta actividades', async t => {
  const f = await fixture(t, { both: false }); await f.sync.run(); const p = await f.progress();
  await f.repository.updatePrivate(state => { state.sealedTokens['slot-a'].ciphertext = 'A'.repeat(64); });
  let calls = 0; f.transport.fetch = async () => { calls++; throw Error(); }; await f.sync.run();
  assert.equal(calls,0); assert.equal((await f.progress()).distanceKm,p.distanceKm); assert.equal((await f.progress()).stale,true);
});

test('whitelist de persistencia descarta títulos, GPS, atleta y campos extra de HTTP', async t => {
  const f = await fixture(t, { both:false }); const records = activityFixtures('empty');
  records[101] = [{ ...activityFixtures()[101][0],name:'sensitive-title',map:{summary_polyline:'sensitive-gps'},athlete:{id:88888},description:'sensitive-description' }];
  f.transport.fetch = createFixtureActivityTransport({ records }); await f.sync.run();
  assert.equal((await f.progress()).distanceKm,.25); assert.doesNotMatch(JSON.stringify((await f.repository.read()).state),/sensitive-title|sensitive-gps|88888|sensitive-description/);
});

test('sincronización durante refresh pendiente y supresión no envía nuevas consultas', async t => {
  const f = await fixture(t, { both:false }); await f.sync.run(); f.time.now += 120000;
  let enter; const entered = new Promise(r => { enter = r; }); let release; const blocked = new Promise(r => { release = r; });
  f.provider.refresh = async () => { enter(); await blocked; return f.response(); };
  let calls = 0; f.transport.fetch = async () => { calls++; throw Error(); };
  const work = f.sync.run(); await entered;
  await f.repository.transitionAuth({ type:'delete',slot:'slot-a',actor,now:f.time.now,requestVerified:true,purgeMilestones:true });
  release(); await work; assert.equal(calls,0); assert.equal((await f.progress()).distanceKm,0); assert.deepEqual((await f.progress()).unlockedMilestoneIds,[]);
});

test('dos trabajos reclamados simultáneamente adquieren una sola lease CAS', async t => {
  const f = await fixture(t, { both:false });
  const other = createActivitySync({ repository:f.repository,oauth:f.service,client:createActivityClient({enabled:true,fetchProvider:createFixtureActivityTransport()}),clock:()=>f.time.now });
  const statuses = (await Promise.all([f.sync.run(),other.run()])).map(r=>r.status).sort(); assert.deepEqual(statuses,['busy','synced']);
});

for (const at of [1,8]) test(`pérdida de scope durante lectura ${at}: descarta snapshot aunque generación siga igual`, async t => {
  const f=await fixture(t,{both:false});await f.sync.run();const old=await f.progress();let calls=0;const normal=createFixtureActivityTransport();
  f.transport.fetch=async(...args)=>{const response=await normal(...args);if(++calls===at)await f.repository.updatePrivate(state=>{state.policy.participants[0].scopes=[];});return response;};
  await f.sync.run();assert.equal((await f.progress()).distanceKm,old.distanceKm);assert.equal((await f.progress()).stale,true);assert.equal((await f.progress()).partial,true);
});
