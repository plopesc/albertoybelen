export const PILOT_LIMITS = Object.freeze({ perOperation: 12, perQuarter: 20, perDay: 60, maxPages: 5, maxRecords: 400 });
const unavailable = (retryMs = 60000) => Object.assign(new Error('pilot_request_deferred'), { retryMs });
const pair = value => {
  if (typeof value !== 'string' || !/^\d+,\s*\d+$/.test(value)) return null;
  const values = value.split(',').map(Number);
  return values.every(n => Number.isSafeInteger(n) && n >= 0) ? values : null;
};

/** All OAuth/activity requests share durable conservative limits. No URL or body is logged. */
export function createPilotTransport({ repository, ready, fetchProvider = fetch, clock = Date.now }) {
  let operationCount = 0;
  return async (address, options) => {
    await ready();
    const url = new URL(address);
    const token = url.pathname === '/oauth/token' && options.method === 'POST' && !url.search;
    const activities = url.pathname === '/api/v3/athlete/activities' && (options.method ?? 'GET') === 'GET' && [...url.searchParams.keys()].sort().join(',') === 'after,before,page,per_page' && [...url.searchParams.values()].every(v => /^\d+$/.test(v));
    if (url.origin !== 'https://www.strava.com' || url.username || url.password || url.hash || (!token && !activities) || options.redirect !== 'error') throw new Error('pilot_request_rejected');
    if (++operationCount > PILOT_LIMITS.perOperation) throw unavailable();
    const now = clock();
    const permitted = await repository.updatePrivate(state => {
      const b = state.pilotBudget ??= { quarterStart: now, quarterCount: 0, day: new Date(now).toISOString().slice(0,10), dayCount: 0, requests: 0, responses: {}, networkErrors: 0, blockedUntil: 0 };
      if (now - b.quarterStart >= 900000) { b.quarterStart = now; b.quarterCount = 0; }
      const day = new Date(now).toISOString().slice(0,10);
      if (b.day !== day) { b.day = day; b.dayCount = 0; }
      if (b.blockedUntil > now) return false;
      if (b.dayCount >= PILOT_LIMITS.perDay) { b.blockedUntil = Date.parse(`${day}T00:00:00Z`) + 86400000; return false; }
      if (b.quarterCount >= PILOT_LIMITS.perQuarter) { b.blockedUntil = b.quarterStart + 900000; return false; }
      b.quarterCount++; b.dayCount++; b.requests++; return true;
    });
    if (!permitted) throw unavailable();
    let response;
    try {
      // workerd rejects redirect:'error'. Translate the caller's fail-on-redirect
      // intent to manual handling; never follow a 3xx with credentials attached.
      response = await fetchProvider(url.href, { ...options, redirect: 'manual' });
      if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url && response.url !== url.href)) throw new Error('Unexpected response URL');
    } catch {
      await repository.updatePrivate(state => {
        if (!state.pilotBudget) return; // A reset/deletion must not be undone by late work.
        state.pilotBudget.networkErrors++;
        state.pilotBudget.blockedUntil = Math.max(state.pilotBudget.blockedUntil, clock() + 60000);
      });
      throw new Error('pilot_transport_unavailable');
    }
    await repository.updatePrivate(state => {
      const b = state.pilotBudget; if (!b) return;
      const status = String(response.status); b.responses[status] = (b.responses[status] ?? 0) + 1;
      let until = 0;
      for (const prefix of ['X-RateLimit', 'X-ReadRateLimit']) {
        const limitHeader = response.headers.get(`${prefix}-Limit`), usageHeader = response.headers.get(`${prefix}-Usage`);
        if (limitHeader === null && usageHeader === null) continue; // OAuth may omit these headers; local caps still apply.
        const limit = pair(limitHeader), usage = pair(usageHeader);
        if (!limit || !usage) { until = Math.max(until, clock() + 900000); continue; }
        b.reportedLimits ??= {};
        b.reportedLimits[prefix === 'X-RateLimit' ? 'overall' : 'read'] = { limit, usage };
        if (limit[0] - usage[0] <= 5) until = Math.max(until, clock() + 900000);
        if (limit[1] - usage[1] <= 20) until = Math.max(until, Date.parse(`${new Date(clock()).toISOString().slice(0,10)}T00:00:00Z`) + 86400000);
      }
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After');
        const milliseconds = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry) - clock();
        until = Math.max(until, clock() + Math.max(900000, Math.min(86400000, Number.isFinite(milliseconds) ? milliseconds : 0)));
      } else if (!response.ok) until = Math.max(until, clock() + 60000);
      b.blockedUntil = Math.max(b.blockedUntil, until);
    });
    return response;
  };
}
