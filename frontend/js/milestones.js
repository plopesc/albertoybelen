/** Cola de revelaciones independiente de DOM, almacenamiento y proveedor. */
export const DEFAULT_MILESTONES = Object.freeze([0.2, 0.4, 0.6, 0.8]);
const validRatio = value => Number.isFinite(value) && value >= 0 && value <= 1;

export function crossedMilestones(previousRatio, nextRatio, milestones = DEFAULT_MILESTONES) {
  if (!validRatio(previousRatio) || !validRatio(nextRatio) || nextRatio <= previousRatio) return [];
  return [...new Set(milestones)].filter(value => value > previousRatio && value <= nextRatio).sort((a, b) => a - b);
}

export function createMilestoneQueue(milestones = DEFAULT_MILESTONES) {
  const thresholds = [...new Set(milestones)].filter(value => Number.isFinite(value) && value > 0 && value < 1).sort((a, b) => a - b);
  let ratio = null;
  let current = null;
  let pending = [];
  const isUnlocked = threshold => ratio !== null && thresholds.includes(threshold) && threshold <= ratio;
  const state = () => ({ current, pending: [...pending], unlocked: thresholds.filter(isUnlocked) });
  return {
    getState: state,
    isUnlocked,
    synchronize(nextRatio) {
      ratio = validRatio(nextRatio) ? nextRatio : null;
      pending = pending.filter(isUnlocked);
      if (current !== null && !isUnlocked(current)) { current = null; pending = []; }
      return state();
    },
    advance(previousRatio, nextRatio) {
      this.synchronize(nextRatio);
      for (const threshold of crossedMilestones(previousRatio, nextRatio, thresholds)) {
        if (threshold !== current && !pending.includes(threshold)) pending.push(threshold);
      }
      pending.sort((a, b) => a - b);
      if (current === null) current = pending.shift() ?? null;
      return state();
    },
    reopen(threshold) {
      if (!isUnlocked(threshold)) return false;
      current = threshold; pending = [];
      return true;
    },
    next() { current = pending.shift() ?? null; return state(); },
    close() { current = null; pending = []; return state(); },
  };
}
