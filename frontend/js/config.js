/** Configuración pública, independiente del DOM y del estado persistido. */
export const CONFIG_URL = new URL('../config/game.json', import.meta.url);
const DEFAULT_MILESTONES = [20, 40, 60, 80];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateGameConfig(value) {
  if (!isObject(value) || !isObject(value.game)) {
    throw new Error('La configuración debe incluir el objeto game.');
  }
  const { id = 'alberto-belen', title, goalKm, startDate, mode, timeZone = 'UTC' } = value.game;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('game.id debe ser un identificador estable con letras minúsculas, números y guiones.');
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
  if (value.rewards && Object.hasOwn(value.rewards, 'checkpoints')) throw new Error('La clave anterior rewards.checkpoints debe renombrarse a rewards.milestones.');
  const { milestones: input = DEFAULT_MILESTONES, finish = 100 } = value.rewards ?? {};
  if (!Array.isArray(input)) throw new Error('rewards.milestones debe ser una lista de hitos.');
  const ids = new Set();
  const milestones = input.map((raw, index) => {
    const item = typeof raw === 'number' ? { id: `milestone-${raw}`, percent: raw } : raw;
    if (!isObject(item) || !Number.isFinite(item.percent) || item.percent <= 0 || item.percent >= 100 ||
      (index > 0 && item.percent <= (typeof input[index - 1] === 'number' ? input[index - 1] : input[index - 1]?.percent))) {
      throw new Error('rewards.milestones debe contener porcentajes únicos, crecientes y mayores que 0 y menores que 100.');
    }
    // La forma numérica admite decimales; los IDs automáticos usan guiones.
    const milestoneId = typeof raw === 'number' ? `milestone-${String(raw).replace('.', '-')}` : item.id;
    if (typeof milestoneId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(milestoneId) || milestoneId === 'finish' || ids.has(milestoneId)) {
      throw new Error('Cada hito de rewards.milestones necesita un id único y estable; finish está reservado.');
    }
    ids.add(milestoneId);
    for (const field of ['title', 'alt']) if (item[field] !== undefined && (typeof item[field] !== 'string' || !item[field].trim())) throw new Error(`milestones.${field} debe ser texto no vacío.`);
    if (item.image !== undefined && (typeof item.image !== 'string' || !item.image.trim() || /[\\:?#]/.test(item.image) || item.image.startsWith('/') || item.image.split('/').includes('..'))) {
      throw new Error('milestones.image debe ser una ruta local relativa, sin salir del frontend.');
    }
    return Object.freeze({ id: milestoneId, percent: item.percent, ...(item.image !== undefined ? { image: item.image } : {}), ...(item.title !== undefined ? { title: item.title.trim() } : {}), ...(item.alt !== undefined ? { alt: item.alt.trim() } : {}) });
  });
  if (finish !== 100) throw new Error('rewards.finish debe ser 100.');
  let api;
  if (value.api !== undefined) {
    if (!isObject(value.api) || Object.keys(value.api).some(key => !['url','allowFixtures'].includes(key)) || typeof value.api.url !== 'string' || !value.api.url || typeof value.api.allowFixtures !== 'boolean') throw new Error('api requiere url y allowFixtures válidos.');
    api = Object.freeze({ url: value.api.url, allowFixtures: value.api.allowFixtures });
  }
  return Object.freeze({
    game: Object.freeze({ id, title: title.trim(), goalKm, startDate, timeZone, mode }),
    rewards: Object.freeze({ milestones: Object.freeze([...milestones]), finish }),
    ...(api ? { api } : {}),
  });
}

export async function loadGameConfig(fetchConfig = globalThis.fetch, configUrl = CONFIG_URL) {
  let response;
  try {
    response = await fetchConfig(configUrl, { cache: 'no-store' });
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
