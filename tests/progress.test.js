import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProgress } from '../frontend/js/progress.js';

test('cero kilómetros está en la salida', () => {
  assert.deepEqual(calculateProgress(0, 100), {
    distanceKm: 0, goalKm: 100, ratio: 0, percentage: 0, remainingKm: 100, complete: false,
  });
});
test('calcula un progreso parcial y distancias decimales', () => {
  const result = calculateProgress(2.5, 10);
  assert.equal(result.ratio, 0.25);
  assert.equal(result.percentage, 25);
  assert.equal(result.remainingKm, 7.5);
  assert.equal(result.complete, false);
});
test('la distancia objetivo está en la meta', () => {
  const result = calculateProgress(100, 100);
  assert.equal(result.ratio, 1);
  assert.equal(result.percentage, 100);
  assert.equal(result.remainingKm, 0);
  assert.equal(result.complete, true);
});
test('superar el objetivo conserva los kilómetros y limita el progreso', () => {
  const result = calculateProgress(120, 100);
  assert.equal(result.distanceKm, 120);
  assert.equal(result.ratio, 1);
  assert.equal(result.percentage, 100);
  assert.equal(result.remainingKm, 0);
});
test('rechaza objetivos inválidos', () => {
  for (const goal of [0, -1, NaN, Infinity, -Infinity, '100', null, undefined]) {
    assert.throws(() => calculateProgress(5, goal), RangeError);
  }
});
test('rechaza distancias negativas y no numéricas', () => {
  for (const distance of [-1, NaN, Infinity, -Infinity, '5', null, undefined]) {
    assert.throws(() => calculateProgress(distance, 100), RangeError);
  }
});
test('el progreso y los kilómetros restantes permanecen dentro de sus límites', () => {
  for (const goal of [0.1, 1, 42.2, 100, Number.MAX_VALUE]) {
    for (const distance of [0, 0.05, 1, 30, 100, 1000, Number.MAX_VALUE]) {
      const result = calculateProgress(distance, goal);
      assert.ok(result.ratio >= 0 && result.ratio <= 1);
      assert.ok(result.percentage >= 0 && result.percentage <= 100);
      assert.ok(result.remainingKm >= 0);
    }
  }
});
