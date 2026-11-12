import { startInstant } from '../policy/distance-policy.js';

export class ActivityError extends Error {
  constructor(code, retryMs = 60000) { super(code); this.retryMs = retryMs; }
}

/** Transport is injected. Real outbound requests require a separate explicit opt-in. */
export function createActivityClient({ fetchProvider, enabled = false, timeoutMs = 5000 } = {}) {
  return {
    async page({ accessToken, athleteId, after, before, page, perPage, signal }) {
      if (!enabled || typeof fetchProvider !== 'function') throw new ActivityError('activity_transport_disabled');
      const url = new URL('https://www.strava.com/api/v3/athlete/activities');
      url.search = new URLSearchParams({ after, before, page, per_page: perPage });
      try {
        const response = await fetchProvider(url.href, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), headers: { Authorization: `Bearer ${accessToken}` } }, { athleteId });
        if (!response.ok) {
          // An activity 401/403 alone does not prove OAuth revocation. Preserve data.
          if (response.status === 429) {
            const value = response.headers.get('Retry-After');
            const seconds = value && /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
            throw new ActivityError('activity_rate_limited', Math.max(900000, Math.min(86400000, Number.isFinite(seconds) ? seconds * 1000 : 0)));
          }
          throw new ActivityError('activity_unavailable');
        }
        // Bound the decoded response as well as pages/records; never log raw payloads.
        const reader = response.body?.getReader();
        if (!reader) throw new ActivityError('activity_incomplete');
        const chunks = []; let length = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.byteLength;
            if (length > 2 * 1024 * 1024) throw new ActivityError('activity_incomplete');
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (!Array.isArray(data) || data.length > perPage) throw new ActivityError('activity_incomplete');
        return data;
      } catch (error) {
        if (error instanceof ActivityError) throw error;
        throw new ActivityError('activity_unavailable');
      }
    },
  };
}

function normalize(raw) {
  const validId = typeof raw?.id === 'number' ? Number.isSafeInteger(raw.id) && raw.id > 0 : typeof raw?.id === 'string' && /^[1-9]\d{0,19}$/.test(raw.id);
  const sport = raw?.sport_type ?? raw?.type;
  if (!validId || typeof sport !== 'string' || !sport || sport.length > 64 || typeof raw.manual !== 'boolean' || typeof raw.private !== 'boolean' || !Number.isFinite(raw.distance) || raw.distance < 0 || typeof raw.start_date !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(raw.start_date) || !Number.isFinite(Date.parse(raw.start_date))) throw new ActivityError('activity_incomplete');
  return { id: String(raw.id), sport_type: sport, distance: raw.distance, start_date: new Date(raw.start_date).toISOString(), manual: raw.manual, private: raw.private };
}

/** Two identical, bounded full traversals. No partial page set is ever committed. */
export async function completeActivitySnapshot({ client, credentials, config, before, guard, signal, perPage = 100, maxPages = 25, maxRecords = 2000 }) {
  const start = startInstant(config.startDate, config.timeZone);
  const after = Math.floor(start / 1000) - 1; // API 'after' is exclusive; exact inclusive filter below.
  async function scan() {
    const records = new Map(); let previousTime = Infinity, count = 0;
    for (let page = 1; page <= maxPages; page++) {
      signal.throwIfAborted();
      await guard();
      const rows = await client.page({ accessToken: credentials.accessToken, athleteId: credentials.athleteId, after, before, page, perPage, signal });
      signal.throwIfAborted();
      if (!Array.isArray(rows) || rows.length > perPage) throw new ActivityError('activity_incomplete');
      if (rows.length === 0) return [...records.values()].filter(a => Date.parse(a.start_date) >= start).sort((a, b) => a.id.localeCompare(b.id));
      // Strava permits short intermediate pages; only an empty page ends a scan.
      count += rows.length;
      if (count > maxRecords) throw new ActivityError('activity_limit');
      const pageIds = new Set();
      for (const raw of rows) {
        const row = normalize(raw), time = Date.parse(row.start_date);
        if (time > previousTime || time >= before * 1000 || time <= after * 1000) throw new ActivityError('activity_inconsistent');
        previousTime = time;
        const old = records.get(row.id);
        // Identical duplicates within a page are harmless; overlap between pages is unsafe.
        if (old && (!pageIds.has(row.id) || JSON.stringify(old) !== JSON.stringify(row))) throw new ActivityError('activity_inconsistent');
        records.set(row.id, row); pageIds.add(row.id);
      }
    }
    throw new ActivityError('activity_limit');
  }
  const first = await scan(), second = await scan();
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new ActivityError('activity_inconsistent');
  return second;
}
