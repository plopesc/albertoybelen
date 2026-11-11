import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG_URL, loadGameConfig, validateGameConfig } from '../frontend/js/config.js';

const config = () => ({ game: { title: 'Alberto y Belén', goalKm: 100, startDate: '2027-01-01', mode: 'simulation' } });

test('valida la configuración y normaliza valores opcionales sin modificar el original', () => {
  const input = config();
  input.game.futureField = true;
  const result = validateGameConfig(input);
  assert.equal(result.game.timeZone, 'UTC');
  assert.deepEqual(result.rewards, { checkpoints: [20, 40, 60, 80], finish: 100 });
  assert.equal(input.rewards, undefined);
  assert.ok(Object.isFrozen(result.game));
});
test('rechaza estructura, título, objetivo y modos inválidos sin coerción', () => {
  for (const input of [null, [], {}, { game: null }, { game: [] }]) {
    assert.throws(() => validateGameConfig(input), /game/);
  }
  for (const [field, values] of Object.entries({
    title: ['', ' ', 100, null], goalKm: [0, -1, NaN, Infinity, '100', null],
    mode: ['', 'Simulation', 'REAL', 'simulation ', true, null],
  })) {
    for (const value of values) {
      const input = config();
      input.game[field] = value;
      assert.throws(() => validateGameConfig(input), new RegExp(`game.${field}`));
    }
  }
});
test('acepta fechas existentes y rechaza normalizaciones silenciosas del calendario', () => {
  for (const startDate of ['2024-02-29', '2000-02-29', '0001-01-01', '2027-12-31']) {
    const input = config(); input.game.startDate = startDate;
    assert.equal(validateGameConfig(input).game.startDate, startDate);
  }
  for (const startDate of ['2027-02-29', '1900-02-29', '2027-04-31', '2027-13-01', '2027-00-01', '0000-01-01', '2027-1-1', '2027-01-01T00:00:00Z', null]) {
    const input = config(); input.game.startDate = startDate;
    assert.throws(() => validateGameConfig(input), /startDate/);
  }
});
test('valida zona horaria explícita y modo real sin cambiarlo a simulación', () => {
  const input = config(); input.game.mode = 'real'; input.game.timeZone = 'Europe/Madrid';
  assert.equal(validateGameConfig(input).game.mode, 'real');
  assert.equal(validateGameConfig(input).game.timeZone, 'Europe/Madrid');
  for (const timeZone of ['', null, 0, 'Una/ZonaInexistente']) {
    input.game.timeZone = timeZone;
    assert.throws(() => validateGameConfig(input), /timeZone/);
  }
});
test('valida checkpoints opcionales, orden, límites y meta fija', () => {
  for (const checkpoints of [[], [25, 50, 75], [0.1, 99.9]]) {
    const input = config(); input.rewards = { checkpoints, finish: 100 };
    assert.deepEqual(validateGameConfig(input).rewards.checkpoints, checkpoints);
  }
  for (const checkpoints of [null, '20,40', [0, 20], [20, 100], [20, 20], [40, 20], [NaN], [Infinity], ['20']]) {
    const input = config(); input.rewards = { checkpoints };
    assert.throws(() => validateGameConfig(input), /checkpoints/);
  }
  for (const rewards of [null, [], { finish: 80 }, { finish: '100' }]) {
    const input = config(); input.rewards = rewards;
    assert.throws(() => validateGameConfig(input), /rewards/);
  }
});
test('carga con URL relativa al módulo y evita caché del navegador', async () => {
  const result = await loadGameConfig(async (url, options) => {
    assert.equal(url, CONFIG_URL);
    assert.ok(url.pathname.endsWith('/frontend/config/game.json'));
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => config() };
  });
  assert.equal(result.game.goalKm, 100);
});
test('hace visibles los errores de HTTP, red, JSON y validación sin configuración de reserva', async () => {
  await assert.rejects(loadGameConfig(async () => ({ ok: false, status: 404 })), /HTTP 404/);
  await assert.rejects(loadGameConfig(async () => { throw new Error('offline'); }), /descargar/);
  await assert.rejects(loadGameConfig(async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })), /JSON válido/);
  await assert.rejects(loadGameConfig(async () => ({ ok: true, json: async () => ({ game: { ...config().game, mode: 'bad' } }) })), /game.mode/);
});

test('el JSON versionado cumple la validación usada en producción', async () => {
  const raw = await readFile(new URL('../frontend/config/game.json', import.meta.url), 'utf8');
  assert.doesNotThrow(() => validateGameConfig(JSON.parse(raw)));
});
