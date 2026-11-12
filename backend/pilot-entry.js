import { createPilot } from './pilot.js';
export default {
  async fetch(request, env) {
    try { return await createPilot(env).fetch(request); }
    catch { return Response.json({ error: 'local_pilot_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
  },
  // Deliberately no scheduled handler: real synchronization is CLI-only.
};
