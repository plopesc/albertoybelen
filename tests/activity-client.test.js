import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createActivityClient, completeActivitySnapshot } from '../backend/strava-activities.js';
import { createFixtureActivityTransport } from '../backend/activity-fixtures.js';
import { startInstant } from '../policy/distance-policy.js';
const signal = () => AbortSignal.timeout(5000);
const options = { accessToken: 'synthetic-private', after: 1, before: 2000000000, page: 1, perPage: 100 };

test('cliente usa HTTP local inyectado, parámetros y bearer privados, sin llamadas reales', async t => {
  let received;
  const server = createServer((request, response) => { received = { url: request.url, authorization: request.headers.authorization }; response.setHeader('Content-Type','application/json'); response.end('[]'); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const client = createActivityClient({ enabled: true, fetchProvider: (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://www.strava.com'); assert.equal(parsed.pathname, '/api/v3/athlete/activities'); assert.equal(init.redirect, 'error');
    return fetch(`http://127.0.0.1:${server.address().port}${parsed.pathname}${parsed.search}`, init);
  } });
  assert.deepEqual(await client.page({ ...options, signal: signal() }), []);
  assert.equal(received.authorization, 'Bearer synthetic-private'); assert.equal(new URL(received.url,'http://local').searchParams.get('per_page'),'100'); assert.equal(received.url.includes('private'),false);
});

test('timeout y payload demasiado grande, JSON inválido y página incompleta', async () => {
  const cases = [() => new Response('{'), () => Response.json({ activities: [] }), () => new Response('x'.repeat(2*1024*1024+1)), () => Response.json(Array(101).fill({}))];
  for (const response of cases) {
    const client = createActivityClient({ enabled: true, fetchProvider: async () => response() });
    await assert.rejects(client.page({ ...options, signal: signal() }), /activity_/);
  }
  const client = createActivityClient({ enabled: true, timeoutMs: 20, fetchProvider: (url, init) => new Promise((resolve,reject) => init.signal.addEventListener('abort',() => reject(Error('synthetic timeout')), { once: true })) });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(client.page({ ...options, signal: signal() }), /activity_unavailable/); } finally { clearTimeout(keepAlive); }
});

for (const startDate of ['2026-11-01','2026-10-25','2026-03-29']) test(`medianoche inclusiva Europe/Madrid ${startDate}, sin depender de autorización ni offset`, async () => {
  const start = startInstant(startDate);
  const row = (id, time) => ({ id, distance: id, start_date: new Date(time).toISOString(), sport_type: 'Walk', manual: false, private: true });
  const records = { 101: [row(1,start-500),row(2,start),row(3,start+1)] };
  const client = createActivityClient({ enabled: true, fetchProvider: createFixtureActivityTransport({ records }) });
  const result = await completeActivitySnapshot({ client, credentials: { accessToken: 'synthetic', athleteId:101 }, config: { startDate, timeZone:'Europe/Madrid' }, before: Math.floor(start/1000)+100, guard: async () => {}, signal: signal() });
  assert.deepEqual(result.map(a => a.id), ['2','3']);
});

test('límites de registros y plazo global descartan importación', async () => {
  const client = createActivityClient({ enabled:true, fetchProvider:createFixtureActivityTransport() });
  const base = { client, credentials:{ accessToken:'synthetic',athleteId:101 },config:{startDate:'2026-11-01',timeZone:'Europe/Madrid'},before:Date.parse('2026-11-02')/1000,guard:async()=>{},signal:signal() };
  await assert.rejects(completeActivitySnapshot({ ...base,maxRecords:10 }), /activity_limit/);
  await assert.rejects(completeActivitySnapshot({ ...base,signal:AbortSignal.abort() }));
});

test('transporte real apagado por defecto y errores no filtran secretos', async () => {
  let calls = 0; const client = createActivityClient({ fetchProvider: async () => { calls++; throw Error('sensitive bearer'); } });
  await assert.rejects(client.page({ ...options,signal:signal() }), /activity_transport_disabled/); assert.equal(calls,0);
  const broken = createActivityClient({ enabled:true,fetchProvider:async()=>{throw Error('sensitive bearer');} });
  await assert.rejects(broken.page({ ...options,signal:signal() }), error => error.message === 'activity_unavailable');
});

test('modo real no permite ni refrescar credenciales desde sync', async () => {
  const { createActivitySync } = await import('../backend/activity-sync.js');
  let calls=0;const sync=createActivitySync({enabled:false,repository:{updatePrivate(){calls++;}},oauth:{credentials(){calls++;}},client:{}});
  await assert.rejects(sync.run(),/activity_transport_disabled/);assert.equal(calls,0);
});
