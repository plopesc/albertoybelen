import test from 'node:test';
import assert from 'node:assert/strict';
import { createMilestoneHistory } from '../frontend/js/milestone-history.js';
import { createMilestoneQueue } from '../frontend/js/milestones.js';
import { FINAL_REWARD } from '../frontend/js/final-reward.js';
import { calculateProgress } from '../frontend/js/progress.js';

function fixture() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const options = { gameId: 'final-test', milestones: [], initialRatio: .99 };
  const history = createMilestoneHistory(storage, options);
  return { storage, options, history, queue: createMilestoneQueue([FINAL_REWARD], history) };
}
test('99→100 desbloquea finish una sola vez; exceso y retroceso no repiten evento', () => {
  const { history, queue } = fixture();
  assert.equal(queue.advance(.99, 1, 1).current, 'finish');
  queue.acknowledgeCurrent(); queue.close();
  assert.equal(queue.advance(1, 1, 10).current, null);
  assert.equal(queue.advance(1, .95, -15).current, null);
  assert.equal(queue.advance(.95, 1, 5).current, null);
  assert.equal(history.isUnlocked('finish'), true);
  assert.equal(queue.reopen('finish'), true);
  assert.equal(calculateProgress(110, 100).percentage, 100);
});
test('carga, objetivo nuevo y avisos pendientes no reabren automáticamente el regalo final', () => {
  const { storage, options, history, queue } = fixture();
  queue.advance(.99, 1, 1); queue.close();
  const restored = createMilestoneHistory(storage, { ...options, initialRatio: 100 / 700 });
  const pending = createMilestoneQueue([FINAL_REWARD], restored);
  assert.equal(pending.restorePending().current, null);
  assert.equal(restored.isUnlocked('finish'), true);
  assert.equal(pending.reopen('finish'), true);
  assert.equal('unlockedAt' in history, false);
});
