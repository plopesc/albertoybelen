import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistanceProvider, createSimulatedProvider, DEFAULT_STATE, STORAGE_KEY, LEGACY_STORAGE_KEY } from '../frontend/js/game.js';

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('inicia a cero con el objetivo de configuración, validado antes de leer almacenamiento', () => {
  assert.deepEqual(createSimulatedProvider(memoryStorage()).getState(), DEFAULT_STATE);
  assert.deepEqual(createSimulatedProvider(memoryStorage(), 42.2).getState(), { distanceKm: 0, goalKm: 42.2 });
  for (const value of [0, -1, NaN, Infinity, '100']) assert.throws(() => createSimulatedProvider(undefined, value), RangeError);
});
test('suma +1/+5/+10, reinicia y persiste solo distancia en v2', () => {
  const storage = memoryStorage();
  const provider = createSimulatedProvider(storage, 42.2);
  for (const km of [1, 5, 10]) provider.addDistance(km);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), { version: 2, distanceKm: 16 });
  assert.deepEqual(createSimulatedProvider(storage, 80).getState(), { distanceKm: 16, goalKm: 80 });
  assert.deepEqual(provider.reset(), { distanceKm: 0, goalKm: 42.2 });
  assert.equal(createSimulatedProvider(storage).getState().distanceKm, 0);
});
test('migra distancia válida de v1 sin arrastrar el objetivo anterior, incluso si era inválido', () => {
  for (const goalKm of [1, 900, 0, 'bad', null]) {
    const original = JSON.stringify({ distanceKm: 16, goalKm });
    const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: original });
    assert.deepEqual(createSimulatedProvider(storage, 50).getState(), { distanceKm: 16, goalKm: 50 });
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), { version: 2, distanceKm: 16 });
    assert.equal(storage.getItem(LEGACY_STORAGE_KEY), original);
  }
});
test('v2 prevalece sobre v1; un estado nuevo corrupto no resucita distancias antiguas', () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({ version: 2, distanceKm: 2, goalKm: 999 }),
    [LEGACY_STORAGE_KEY]: JSON.stringify({ distanceKm: 90, goalKm: 200 }),
  });
  assert.deepEqual(createSimulatedProvider(storage, 30).getState(), { distanceKm: 2, goalKm: 30 });
  storage.setItem(STORAGE_KEY, '{');
  const provider = createSimulatedProvider(storage, 30);
  assert.deepEqual(provider.getState(), { distanceKm: 0, goalKm: 30 });
  assert.equal(provider.isPersistent(), false);
});
test('rechaza sumas inválidas y desbordamiento sin alterar el estado', () => {
  const provider = createSimulatedProvider(memoryStorage());
  provider.addDistance(5);
  for (const value of [-1, NaN, Infinity, '5']) assert.throws(() => provider.addDistance(value), RangeError);
  assert.equal(provider.getState().distanceKm, 5);
  provider.addDistance(Number.MAX_VALUE);
  assert.throws(() => provider.addDistance(Number.MAX_VALUE), RangeError);
  assert.equal(provider.getState().distanceKm, Number.MAX_VALUE);
});
test('recupera almacenamiento corrupto o distancias inválidas y vuelve a guardar', () => {
  for (const key of [LEGACY_STORAGE_KEY, STORAGE_KEY]) {
    for (const raw of ['{', 'null', '{}', '[]', '{"version":2,"distanceKm":-1}', '{"version":2,"distanceKm":"5"}']) {
      const storage = memoryStorage({ [key]: raw });
      const provider = createSimulatedProvider(storage, 50);
      assert.deepEqual(provider.getState(), { distanceKm: 0, goalKm: 50 });
      provider.addDistance(1);
      assert.equal(provider.isPersistent(), true);
      assert.equal(createSimulatedProvider(storage, 50).getState().distanceKm, 1);
    }
  }
});
test('funciona en memoria si no hay almacenamiento o está bloqueado/lleno', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const full = { getItem: () => null, setItem() { throw new Error('quota'); } };
  for (const storage of [undefined, denied, full]) {
    const provider = createSimulatedProvider(storage, 70);
    assert.equal(provider.addDistance(5).distanceKm, 5);
    assert.equal(provider.isPersistent(), false);
  }
});
test('conserva la distancia migrada en memoria si no puede escribir v2', () => {
  const storage = { getItem: (key) => key === LEGACY_STORAGE_KEY ? '{"distanceKm":12,"goalKm":999}' : null, setItem() { throw new Error('quota'); } };
  const provider = createSimulatedProvider(storage, 50);
  assert.deepEqual(provider.getState(), { distanceKm: 12, goalKm: 50 });
  assert.equal(provider.isPersistent(), false);
});
test('el estado entregado es una copia y no expone un cambio de objetivo', () => {
  const provider = createSimulatedProvider(memoryStorage(), 40);
  provider.getState().distanceKm = 999;
  provider.addDistance(1).goalKm = 0;
  assert.deepEqual(provider.getState(), { distanceKm: 1, goalKm: 40 });
  assert.equal(provider.setGoal, undefined);
});
test('selección de modo explícita: real no lee ni escribe almacenamiento y nunca simula', () => {
  const noAccess = { getItem() { assert.fail('real no debe leer simulación'); }, setItem() { assert.fail('real no debe escribir simulación'); } };
  assert.equal(createDistanceProvider({ mode: 'real', goalKm: 50 }, noAccess), null);
  const simulated = createDistanceProvider({ mode: 'simulation', goalKm: 25 }, memoryStorage());
  assert.deepEqual(simulated.addDistance(5), { distanceKm: 5, goalKm: 25 });
  for (const mode of ['', 'REAL', 'other', undefined]) assert.throws(() => createDistanceProvider({ mode, goalKm: 50 }, noAccess), /Modo/);
});
