import { calculateProgress } from './progress.js';

export const STORAGE_KEY = 'strava-adventure:simulation:v1';
export const DEFAULT_STATE = Object.freeze({ distanceKm: 0, goalKm: 100 });

/**
 * Puerto de datos consumido por la interfaz. Un proveedor devuelve copias del
 * estado; las escrituras devuelven el estado actualizado. Un adaptador futuro
 * puede reemplazar este proveedor sin cambiar los cálculos ni el mapa.
 * @typedef {Object} DistanceProvider
 * @property {() => {distanceKm: number, goalKm: number}} getState
 * @property {(km: number) => {distanceKm: number, goalKm: number}} addDistance
 * @property {(km: number) => {distanceKm: number, goalKm: number}} setGoal
 * @property {() => {distanceKm: number, goalKm: number}} reset
 * @property {() => boolean} isPersistent
 */

/** @returns {DistanceProvider} */
export function createSimulatedProvider(storage) {
  let state = { ...DEFAULT_STATE };
  let persistent = Boolean(storage);

  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw !== null && raw !== undefined) {
      const saved = JSON.parse(raw);
      calculateProgress(saved.distanceKm, saved.goalKm);
      state = { distanceKm: saved.distanceKm, goalKm: saved.goalKm };
    }
  } catch {
    // Estado dañado: comenzar de nuevo. Almacenamiento bloqueado: usar memoria.
    state = { ...DEFAULT_STATE };
    persistent = false;
  }

  function save(next) {
    calculateProgress(next.distanceKm, next.goalKm);
    state = next;
    try {
      if (!storage) throw new Error('Almacenamiento no disponible');
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      persistent = true;
    } catch {
      persistent = false;
    }
    return { ...state };
  }

  return {
    getState: () => ({ ...state }),
    isPersistent: () => persistent,
    addDistance(km) {
      if (!Number.isFinite(km) || km < 0) {
        throw new RangeError('Los kilómetros añadidos deben ser positivos o cero.');
      }
      return save({ ...state, distanceKm: state.distanceKm + km });
    },
    setGoal: (goalKm) => save({ ...state, goalKm }),
    reset: () => save({ ...state, distanceKm: 0 }),
  };
}
