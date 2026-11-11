/** Solo se instancia en simulación. El modo real futuro usará estado de backend. */
export const HISTORY_STORAGE_PREFIX = 'strava-adventure:milestones:v2:';
export const LEGACY_HISTORY_STORAGE_PREFIX = 'strava-adventure:milestones:v1:';
export const FINISH_MILESTONE_ID = 'finish';
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const validRatio = value => Number.isFinite(value) && value >= 0 && value <= 1;
const validIds = value => Array.isArray(value) && value.every(validId);

/** Los logros y los avisos vistos no dependen del porcentaje actual. */
export function createUnlockState(milestones, unlockedIds = [], seenNoticeIds = []) {
  const definitions = [...milestones, { id: FINISH_MILESTONE_ID, percent: 100 }];
  let unlocked = new Set(unlockedIds.filter(validId));
  let seen = new Set(seenNoticeIds.filter(id => unlocked.has(id)));
  return {
    getUnlockedIds: () => [...unlocked],
    getSeenNoticeIds: () => [...seen],
    isUnlocked: id => unlocked.has(id),
    hasSeenNotice: id => seen.has(id),
    markNoticeSeen(id) {
      if (!unlocked.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    advance(previousRatio, nextRatio, distanceDelta) {
      if (!validRatio(previousRatio) || !validRatio(nextRatio) || nextRatio < previousRatio || !Number.isFinite(distanceDelta) || distanceDelta <= 0) return [];
      const newlyUnlocked = definitions.filter(item => !unlocked.has(item.id) && nextRatio >= item.percent / 100);
      for (const item of newlyUnlocked) unlocked.add(item.id);
      return newlyUnlocked.map(item => item.id);
    },
    seedFromProgress(ratio) {
      if (!validRatio(ratio)) return;
      for (const item of definitions) if (ratio >= item.percent / 100) unlocked.add(item.id);
    },
    reset() { unlocked = new Set(); seen = new Set(); },
  };
}

export function createMilestoneHistory(storage, { gameId, milestones, initialRatio }) {
  const key = `${HISTORY_STORAGE_PREFIX}${gameId}`;
  let state;
  let persistent = Boolean(storage);
  let fresh = false;
  function fromExistingProgress() {
    const restored = createUnlockState(milestones);
    restored.seedFromProgress(initialRatio);
    // Una primera instalación no puede distinguir los logros antiguos de los nuevos.
    for (const id of restored.getUnlockedIds()) restored.markNoticeSeen(id);
    return restored;
  }
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) {
      const legacyRaw = storage?.getItem(`${LEGACY_HISTORY_STORAGE_PREFIX}${gameId}`);
      if (legacyRaw !== null && legacyRaw !== undefined) {
        const legacy = JSON.parse(legacyRaw);
        if (legacy?.version !== 1 || legacy.gameId !== gameId || !validIds(legacy.unlockedIds)) throw new Error('Historial anterior inválido');
        state = createUnlockState(milestones, legacy.unlockedIds, legacy.unlockedIds);
      } else state = fromExistingProgress();
      fresh = true;
    } else {
      const saved = JSON.parse(raw);
      if (saved?.version !== 2 || saved.gameId !== gameId || !validIds(saved.unlockedIds) || !validIds(saved.seenNoticeIds) || !saved.seenNoticeIds.every(id => saved.unlockedIds.includes(id))) throw new Error('Historial inválido');
      state = createUnlockState(milestones, saved.unlockedIds, saved.seenNoticeIds);
    }
  } catch {
    // No sobrescribir un registro dañado ni resucitar v1 al cargar un v2 inválido.
    state = fromExistingProgress();
    persistent = false;
  }
  function save() {
    try {
      if (!storage) throw new Error('Almacenamiento no disponible');
      storage.setItem(key, JSON.stringify({ version: 2, gameId, unlockedIds: state.getUnlockedIds(), seenNoticeIds: state.getSeenNoticeIds() }));
      persistent = true;
    } catch { persistent = false; }
  }
  if (fresh) save();
  return {
    getUnlockedIds: state.getUnlockedIds,
    getSeenNoticeIds: state.getSeenNoticeIds,
    isUnlocked: state.isUnlocked,
    hasSeenNotice: state.hasSeenNotice,
    markNoticeSeen(id) {
      if (state.markNoticeSeen(id)) save();
    },
    isPersistent: () => persistent,
    advance(previousRatio, nextRatio, distanceDelta) {
      const newlyUnlocked = state.advance(previousRatio, nextRatio, distanceDelta);
      if (newlyUnlocked.length || !persistent) save();
      return newlyUnlocked;
    },
    reset() { state.reset(); save(); },
  };
}
