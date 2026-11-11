/** Cola de presentación: cerrar conserva los logros y los avisos aún no mostrados. */
export function createMilestoneQueue(milestones, history) {
  const ids = new Set(milestones.map(item => item.id));
  const order = new Map(milestones.map((item, index) => [item.id, index]));
  let current = null;
  let pending = [];
  const isUnlocked = id => ids.has(id) && history.isUnlocked(id);
  const needsNotice = id => isUnlocked(id) && !history.hasSeenNotice(id);
  const state = () => ({ current, pending: [...pending], unlocked: [...ids].filter(isUnlocked) });
  return {
    getState: state,
    restorePending() {
      pending = [...ids].filter(needsNotice);
      current = pending.shift() ?? null;
      return state();
    },
    acknowledgeCurrent() { history.markNoticeSeen(current); },
    isUnlocked,
    synchronize() {
      pending = pending.filter(needsNotice);
      if (current !== null && !isUnlocked(current)) { current = null; pending = []; }
      return state();
    },
    advance(previousRatio, nextRatio, distanceDelta) {
      const newlyUnlocked = history.advance(previousRatio, nextRatio, distanceDelta);
      for (const id of newlyUnlocked) if (ids.has(id) && id !== current && !pending.includes(id)) pending.push(id);
      pending.sort((a, b) => order.get(a) - order.get(b));
      if (current === null) current = pending.shift() ?? null;
      return state();
    },
    reopen(id) {
      if (!isUnlocked(id)) return false;
      current = id; pending = [];
      return true;
    },
    next() {
      pending = pending.filter(needsNotice);
      current = pending.shift() ?? null;
      return state();
    },
    close() { current = null; pending = []; return state(); },
  };
}
