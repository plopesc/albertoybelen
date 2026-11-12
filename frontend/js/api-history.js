/** Backend IDs are authoritative; only presentation acknowledgements live in this browser. */
export function createApiHistory(storage, { gameId, endpoint, milestoneIds }) {
  const key = `strava-adventure:api-notices:v1:${gameId}:${endpoint}`;
  const allowed = new Set([...milestoneIds, 'finish']);
  let unlocked = new Set(), seen = new Set(), pending = [], persistent = Boolean(storage), initialized = false, existing = false;
  function readSeen() {
    try {
      const raw = storage?.getItem(key);
      if (raw === null || raw === undefined) return;
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || !Array.isArray(saved.seenNoticeIds) || saved.seenNoticeIds.some(id => !allowed.has(id))) throw new Error();
      existing = true; for (const id of saved.seenNoticeIds) seen.add(id);
    } catch { persistent = false; }
  }
  function save() {
    try { if (!storage) throw new Error(); storage.setItem(key, JSON.stringify({ version: 1, seenNoticeIds: [...seen] })); }
    catch { persistent = false; }
  }
  readSeen();
  return {
    applySnapshot(ids) {
      const previous = unlocked;
      unlocked = new Set(ids.filter(id => allowed.has(id)));
      readSeen();
      pending = initialized ? [...unlocked].filter(id => !previous.has(id) && !seen.has(id)) : [];
      if (!initialized) {
        // A new browser cannot tell when shared history was earned. Never celebrate it.
        if (!existing) for (const id of unlocked) seen.add(id);
        if (unlocked.has('finish')) seen.add('finish');
      }
      initialized = true; save();
    },
    getUnlockedIds: () => [...unlocked],
    isUnlocked: id => unlocked.has(id),
    hasSeenNotice(id) { readSeen(); return seen.has(id); },
    markNoticeSeen(id) { if (unlocked.has(id)) { seen.add(id); save(); } },
    isPersistent: () => persistent,
    advance(previousRatio, nextRatio, delta) {
      readSeen();
      const fresh = pending.filter(id => unlocked.has(id) && !seen.has(id)); pending = [];
      // API history can change independently of distance. Never infer an award from a goal.
      if (!(delta > 0) || nextRatio < previousRatio) { for (const id of fresh) seen.add(id); save(); return []; }
      const notices = fresh.filter(id => id !== 'finish' || (previousRatio < 1 && nextRatio >= 1));
      for (const id of fresh) if (!notices.includes(id)) seen.add(id);
      save(); return notices;
    },
  };
}
