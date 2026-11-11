/** Configuración pública, independiente del DOM y del estado persistido. */
export const CONFIG_URL = new URL('../config/game.json', import.meta.url);
const DEFAULT_CHECKPOINTS = [20, 40, 60, 80];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateGameConfig(value) {
  if (!isObject(value) || !isObject(value.game)) {
    throw new Error('La configuración debe incluir el objeto game.');
  }
  const { title, goalKm, startDate, mode, timeZone = 'UTC' } = value.game;
  if (typeof title !== 'string' || !title.trim()) {
    throw new Error('game.title debe ser un texto no vacío.');
  }
  if (!Number.isFinite(goalKm) || goalKm <= 0) {
    throw new Error('game.goalKm debe ser un número positivo y finito.');
  }
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate.startsWith('0000')) {
    throw new Error('game.startDate debe ser una fecha existente con formato YYYY-MM-DD.');
  }
  const date = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== startDate) {
    throw new Error('game.startDate debe ser una fecha existente con formato YYYY-MM-DD.');
  }
  if (mode !== 'simulation' && mode !== 'real') {
    throw new Error('game.mode debe ser exactamente simulation o real.');
  }
  try {
    if (typeof timeZone !== 'string' || !timeZone.trim()) throw new Error();
    new Intl.DateTimeFormat('es-ES', { timeZone });
  } catch {
    throw new Error('game.timeZone debe ser una zona horaria IANA válida, como UTC o Europe/Madrid.');
  }
  if (value.rewards !== undefined && !isObject(value.rewards)) {
    throw new Error('rewards debe ser un objeto.');
  }
  const { checkpoints = DEFAULT_CHECKPOINTS, finish = 100 } = value.rewards ?? {};
  if (!Array.isArray(checkpoints) || checkpoints.some((percent, index) =>
    !Number.isFinite(percent) || percent <= 0 || percent >= 100 ||
    (index > 0 && percent <= checkpoints[index - 1]))) {
    throw new Error('rewards.checkpoints debe contener porcentajes únicos, crecientes y mayores que 0 y menores que 100.');
  }
  if (finish !== 100) throw new Error('rewards.finish debe ser 100.');
  return Object.freeze({
    game: Object.freeze({ title: title.trim(), goalKm, startDate, timeZone, mode }),
    rewards: Object.freeze({ checkpoints: Object.freeze([...checkpoints]), finish }),
  });
}

export async function loadGameConfig(fetchConfig = globalThis.fetch) {
  let response;
  try {
    response = await fetchConfig(CONFIG_URL, { cache: 'no-store' });
  } catch (cause) {
    throw new Error('No se pudo descargar config/game.json. Comprueba la conexión o el archivo.', { cause });
  }
  if (!response.ok) {
    throw new Error(`No se pudo cargar config/game.json (HTTP ${response.status}).`);
  }
  let value;
  try {
    value = await response.json();
  } catch (cause) {
    throw new Error('El archivo config/game.json no contiene JSON válido.', { cause });
  }
  return validateGameConfig(value);
}
