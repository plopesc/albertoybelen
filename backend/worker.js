import { defaultFixtureEvents } from './fixtures.js';
import { createDistanceState, applyParticipantSync, publicProgress } from '../policy/distance-policy.js';

export const LOCAL_SETTINGS = Object.freeze({ participants: ['slot-a', 'slot-b'], startDate: '2026-11-01', timeZone: 'Europe/Madrid', goalKm: 100, milestones: [20, 40, 60, 80].map(percent => ({ id: `milestone-${percent}`, percent })) });
export const ALLOWED_ORIGINS = Object.freeze(['https://plopesc.github.io', 'https://albertoybelen.ddev.site', 'http://localhost:8787', 'http://127.0.0.1:8787']);

/** Local prototype: optional injected persistence, without network, credentials or active schedule. */
export function createWorker({ initialState = createDistanceState(LOCAL_SETTINGS), loadFixture = async () => defaultFixtureEvents(), allowedOrigins = ALLOWED_ORIGINS, repository, source = 'fixture' } = {}) {
  let state = initialState;
  let tail = Promise.resolve();
  const transact = action => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
  return {
    async fetch(request) {
      const origin = request.headers.get('Origin');
      const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' };
      const reply = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
      if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'origin_not_allowed' }, 403);
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      const url = new URL(request.url);
      if (url.pathname !== '/api/progress') return reply({ error: 'not_found' }, 404);
      if (request.method === 'OPTIONS') {
        if (request.headers.get('Access-Control-Request-Method') !== 'GET' || request.headers.has('Access-Control-Request-Headers')) return reply({ error: 'preflight_not_allowed' }, 403);
        headers['Access-Control-Allow-Methods'] = 'GET';
        return reply(null, 204);
      }
      if (request.method !== 'GET') { headers.Allow = 'GET, OPTIONS'; return reply({ error: 'method_not_allowed' }, 405); }
      try { return reply({ schemaVersion: 1, source, ...publicProgress(repository ? await repository.getState() : state) }); }
      catch { return reply({ error: 'local_storage_unavailable' }, 503); }
    },
    scheduled(event, env, context) {
      const work = transact(async () => {
        // Fixtures provide bounded snapshots/events; no retry loop or external fetch.
        try {
          const events = await loadFixture(event);
          if (!Array.isArray(events) || events.length > 100) throw new Error('Invalid fixture batch');
          if (repository) await repository.applyEvents(events);
          else for (const update of events) state = applyParticipantSync(state, update);
        } catch {
          if (repository) await repository.markFailures();
          else for (const participant of state.participants.filter(p => p.connected)) state = applyParticipantSync(state, { participantId: participant.id, generation: participant.generation, status: 'error' });
          throw new Error('Fixture synchronization failed');
        }
      });
      context?.waitUntil(work);
      return work;
    },
    applyLocalEvent(update) { return transact(async () => { if (repository) await repository.applyEvents([update]); else state = applyParticipantSync(state, update); }); },
  };
}

export default createWorker();
