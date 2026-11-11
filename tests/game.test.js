import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulatedProvider, DEFAULT_STATE, STORAGE_KEY } from '../frontend/js/game.js';

function memoryStorage(initial) {
  const entries = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test('inicia con cero kilómetros y objetivo de 100', () => {
  assert.deepEqual(createSimulatedProvider(memoryStorage()).getState(), DEFAULT_STATE);
});
test('suma +1, +5 y +10, configura objetivo y restaura tras recargar', () => {
  const storage = memoryStorage();
  const provider = createSimulatedProvider(storage);
  for (const km of [1, 5, 10]) provider.addDistance(km);
  provider.setGoal(42.2);
  assert.deepEqual(createSimulatedProvider(storage).getState(), { distanceKm: 16, goalKm: 42.2 });
});
test('reinicia los kilómetros, mantiene la meta y persiste', () => {
  const storage = memoryStorage();
  const provider = createSimulatedProvider(storage);
  provider.setGoal(50);
  provider.addDistance(10);
  provider.reset();
  assert.deepEqual(createSimulatedProvider(storage).getState(), { distanceKm: 0, goalKm: 50 });
});
test('rechaza actualizaciones inválidas sin alterar el estado guardado', () => {
  const storage = memoryStorage();
  const provider = createSimulatedProvider(storage);
  provider.addDistance(5);
  for (const value of [0, -5, NaN, Infinity, '100']) {
    assert.throws(() => provider.setGoal(value), RangeError);
  }
  for (const value of [-1, NaN, Infinity, '5']) {
    assert.throws(() => provider.addDistance(value), RangeError);
  }
  assert.deepEqual(createSimulatedProvider(storage).getState(), { distanceKm: 5, goalKm: 100 });
});
test('se recupera de JSON corrupto o de estados inválidos y vuelve a guardar', () => {
  for (const raw of ['{', 'null', '{}', '[]', '{"distanceKm":-1,"goalKm":100}', '{"distanceKm":5,"goalKm":0}']) {
    const storage = memoryStorage(raw);
    const provider = createSimulatedProvider(storage);
    assert.deepEqual(provider.getState(), DEFAULT_STATE);
    provider.addDistance(1);
    assert.equal(provider.isPersistent(), true);
    assert.equal(createSimulatedProvider(storage).getState().distanceKm, 1);
  }
});
test('funciona en memoria si localStorage no existe o deniega acceso', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  for (const storage of [undefined, denied]) {
    const provider = createSimulatedProvider(storage);
    assert.equal(provider.addDistance(5).distanceKm, 5);
    assert.equal(provider.isPersistent(), false);
  }
});
test('un fallo de escritura conserva el progreso en memoria', () => {
  const storage = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const provider = createSimulatedProvider(storage);
  provider.addDistance(10);
  assert.equal(provider.getState().distanceKm, 10);
  assert.equal(provider.isPersistent(), false);
});
test('el estado entregado al consumidor es una copia', () => {
  const provider = createSimulatedProvider(memoryStorage());
  provider.getState().distanceKm = 999;
  provider.addDistance(1).goalKm = 0;
  assert.deepEqual(provider.getState(), { distanceKm: 1, goalKm: 100 });
});
