/** Solo se instancia en simulación. El modo real futuro usará estado de backend. */
export const HISTORY_STORAGE_PREFIX = 'strava-adventure:milestones:v1:';
export const FINISH_MILESTONE_ID = 'finish';
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const validRatio = value => Number.isFinite(value) && value >= 0 && value <= 1;

/** Estado histórico puro: un retroceso solo cambia la posición actual. */
export function createUnlockState(milestones, unlockedIds = []) {
  const definitions = [...milestones, { id: FINISH_MILESTONE_ID, percent: 100 }];
  let unlocked = new Set(unlockedIds.filter(validId));
  return {
    getUnlockedIds: () => [...unlocked],
    isUnlocked: id => unlocked.has(id),
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
    reset() { unlocked = new Set(); },
  };
}

export function createMilestoneHistory(storage, { gameId, milestones, initialRatio }) {
  const key = `${HISTORY_STORAGE_PREFIX}${gameId}`;
  let state;
  let persistent = Boolean(storage);
  let fresh = false;
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) {
      state = createUnlockState(milestones);
      state.seedFromProgress(initialRatio);
      fresh = true;
    } else {
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || saved.gameId !== gameId || !Array.isArray(saved.unlockedIds) || !saved.unlockedIds.every(validId)) throw new Error('Historial inválido');
      state = createUnlockState(milestones, saved.unlockedIds);
    }
  } catch {
    // No sobrescribir un registro dañado al cargar; continuar con aviso en memoria.
    state = createUnlockState(milestones);
    state.seedFromProgress(initialRatio);
    persistent = false;
  }
  function save() {
    try {
      if (!storage) throw new Error('Almacenamiento no disponible');
      storage.setItem(key, JSON.stringify({ version: 1, gameId, unlockedIds: state.getUnlockedIds() }));
      persistent = true;
    } catch { persistent = false; }
  }
  if (fresh) save();
  return {
    getUnlockedIds: state.getUnlockedIds,
    isUnlocked: state.isUnlocked,
    isPersistent: () => persistent,
    advance(previousRatio, nextRatio, distanceDelta) {
      const newlyUnlocked = state.advance(previousRatio, nextRatio, distanceDelta);
      if (newlyUnlocked.length || !persistent) save();
      return newlyUnlocked;
    },
    reset() { state.reset(); save(); },
  };
}
