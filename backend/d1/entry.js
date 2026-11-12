import { createWorker } from '../worker.js';
import { createD1Repository } from './repository.js';
function localWorker(env) {
  if (env.APP_ENV !== 'local-fixtures' || !env.DB) throw new Error('Local fixtures binding required');
  return createWorker({ repository: createD1Repository(env.DB) });
}
export default {
  async fetch(request, env) {
    try { return await localWorker(env).fetch(request); }
    catch { return Response.json({ error: 'local_storage_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  },
  scheduled(event, env, context) { return localWorker(env).scheduled(event, env, context); },
};
