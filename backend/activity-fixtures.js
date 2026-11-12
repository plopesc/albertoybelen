/** Synthetic HTTP responses only: no outbound network and no personal data. */
const activity = (id, distance, extra = {}) => ({ id, distance, sport_type: 'Run', start_date: '2026-11-01T10:00:00Z', manual: false, private: false, ...extra });
export function activityFixtures(scenario = 'base') {
  if (!['base', 'corrected', 'empty', 'last-page-error', 'rate-limit'].includes(scenario)) throw new Error('Unknown local fixture');
  if (scenario === 'empty') return { 101: [], 202: [] };
  const a = Array.from({ length: 230 }, (_, i) => activity(i + 1, 250));
  a.push(activity(500, 9999, { manual: true }), activity(501, 9999, { sport_type: 'Ride' }), activity(502, 5.25, { private: true, sport_type: 'Walk', start_date: '2026-10-31T23:00:00Z' }), activity(503, 777, { start_date: '2026-10-31T22:59:59Z' }));
  const b = [activity(1, 45000, { private: true, sport_type: 'Hike' })]; // Same ID, different participant.
  if (scenario === 'corrected') { a.splice(0, 100); a[0].distance = 100; b[0].sport_type = 'Ride'; }
  return { 101: a, 202: b };
}
export function createFixtureActivityTransport({ scenario = 'base', records = activityFixtures(scenario), onRequest } = {}) {
  return async (url, options, { athleteId } = {}) => {
    const query = new URL(url).searchParams;
    const page = Number(query.get('page')), size = Number(query.get('per_page'));
    onRequest?.({ athleteId, page });
    if (scenario === 'rate-limit') return Response.json({ message: 'synthetic limit' }, { status: 429, headers: { 'Retry-After': '900' } });
    if (scenario === 'last-page-error' && athleteId === 101 && page === 3) return Response.json({ message: 'synthetic failure' }, { status: 503 });
    if (!records[athleteId]) return Response.json({}, { status: 401 });
    const rows = records[athleteId].filter(a => Date.parse(a.start_date) > Number(query.get('after')) * 1000 && Date.parse(a.start_date) < Number(query.get('before')) * 1000).sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date));
    return Response.json(rows.slice((page - 1) * size, page * size));
  };
}
