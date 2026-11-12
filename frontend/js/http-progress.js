const publicKeys = ['schemaVersion','source','distanceKm','partial','stale','updatedAt','unlockedMilestoneIds'];
const validInstant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);
};
export function resolveProgressEndpoint(address, pageUrl, allowFixtures = false) {
  if (typeof address !== 'string' || !address || typeof allowFixtures !== 'boolean') throw new Error('Configuración de API inválida.');
  const page = new URL(pageUrl), url = new URL(address, page);
  const local = ['albertoybelen.ddev.site','localhost','127.0.0.1','[::1]'].includes(page.hostname);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(page.hostname);
  if (url.origin !== page.origin || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/progress' || (allowFixtures && !local)) throw new Error('La API debe usar el origen permitido y la ruta /api/progress.');
  return url.href;
}

export function validatePublicProgress(raw, { milestoneIds, allowFixtures = false }) {
  const invalid = () => { throw new Error('invalid_response'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== publicKeys.length || Object.keys(raw).some(key => !publicKeys.includes(key)) || raw.schemaVersion !== 1 || !['fixture','strava-pilot','strava'].includes(raw.source) || (raw.source === 'fixture' && !allowFixtures) || !Number.isFinite(raw.distanceKm) || raw.distanceKm < 0 || typeof raw.partial !== 'boolean' || typeof raw.stale !== 'boolean') invalid();
  if (raw.updatedAt !== null && !validInstant(raw.updatedAt)) invalid();
  if (!raw.partial && raw.updatedAt === null) invalid();
  const allowed = new Set([...milestoneIds, 'finish']);
  if (!Array.isArray(raw.unlockedMilestoneIds) || raw.unlockedMilestoneIds.length > allowed.size || raw.unlockedMilestoneIds.some(id => !allowed.has(id)) || new Set(raw.unlockedMilestoneIds).size !== raw.unlockedMilestoneIds.length) invalid();
  return { schemaVersion: 1, source: raw.source, distanceKm: raw.distanceKm, partial: raw.partial, stale: raw.stale, updatedAt: raw.updatedAt === null ? null : new Date(raw.updatedAt).toISOString(), unlockedMilestoneIds: [...raw.unlockedMilestoneIds] };
}

/** Memory-only public DTO. Latest request wins; simulation storage is never consulted. */
export function createHttpProgressProvider({ url, pageUrl, milestoneIds, allowFixtures = false, fetchProgress = globalThis.fetch, timeoutMs = 8000 }) {
  const endpoint = resolveProgressEndpoint(url, pageUrl, allowFixtures);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) throw new Error('Timeout inválido.');
  let state = { status: 'idle', snapshot: null, error: null }, sequence = 0, cancel;
  const listeners = new Set();
  const copy = () => structuredClone(state);
  const emit = () => { for (const listener of listeners) listener(copy()); };
  return {
    endpoint, getState: copy,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { sequence++; cancel?.(); listeners.clear(); },
    async refresh() {
      const current = ++sequence; cancel?.();
      const controller = new AbortController(); let timer;
      const stopped = new Promise((resolve, reject) => {
        cancel = () => { controller.abort(); reject(new Error('cancelled')); };
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
      });
      state = { ...state, status: 'loading', error: null }; emit();
      try {
        const work = (async () => {
          const response = await fetchProgress(endpoint, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
          if (response.status !== 200) throw new Error('unavailable');
          const reader = response.body?.getReader();
          if (!reader) throw new Error('invalid_response');
          const chunks = []; let length = 0;
          try {
            while (true) {
              const { done, value } = await reader.read(); if (done) break;
              length += value.byteLength;
              if (length > 65536) throw new Error('invalid_response');
              chunks.push(value);
            }
          } finally { await reader.cancel().catch(() => {}); }
          const bytes = new Uint8Array(length); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          let raw; try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('invalid_response'); }
          return validatePublicProgress(raw, { milestoneIds, allowFixtures });
        })();
        const snapshot = await Promise.race([work, stopped]);
        if (sequence !== current) return;
        if (state.snapshot && state.snapshot.source !== snapshot.source) throw new Error('invalid_response');
        state = { status: 'ready', snapshot, error: null };
      } catch (error) {
        if (sequence !== current) return;
        state = { ...state, status: 'error', error: ['timeout','invalid_response'].includes(error.message) ? error.message : 'unavailable' };
      } finally { clearTimeout(timer); }
      if (sequence === current) emit();
    },
  };
}
