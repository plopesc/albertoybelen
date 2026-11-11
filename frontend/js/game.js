import { calculateProgress } from './progress.js';

export const LEGACY_STORAGE_KEY = 'strava-adventure:simulation:v1';
export const STORAGE_KEY = 'strava-adventure:simulation:v2';
export const DEFAULT_STATE = Object.freeze({ distanceKm: 0, goalKm: 100 });

/**
 * Proveedor simulado con objetivo inmutable procedente de la configuración.
 * Contrato DistanceProvider: getState(), addDistance(km), reset(), isPersistent().
 * Cada estado devuelto es una copia de { distanceKm, goalKm }.
 * localStorage v2 solo conserva { version: 2, distanceKm }, nunca configuración.
 */
export function createSimulatedProvider(storage, goalKm = DEFAULT_STATE.goalKm) {
  calculateProgress(0, goalKm);
  let state = { distanceKm: 0, goalKm };
  let persistent = Boolean(storage);

  function save(distanceKm) {
    calculateProgress(distanceKm, goalKm);
    state = { distanceKm, goalKm };
    try {
      if (!storage) throw new Error('Almacenamiento no disponible');
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, distanceKm }));
      persistent = true;
    } catch {
      persistent = false;
    }
    return { ...state };
  }

  try {
    const current = storage?.getItem(STORAGE_KEY);
    if (current !== null && current !== undefined) {
      const saved = JSON.parse(current);
      if (saved?.version !== 2) throw new Error('Versión de estado no compatible');
      calculateProgress(saved.distanceKm, goalKm);
      state = { distanceKm: saved.distanceKm, goalKm };
    } else {
      const legacy = storage?.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null && legacy !== undefined) {
        const saved = JSON.parse(legacy);
        // El objetivo anterior se ignora, incluso si estaba dañado.
        calculateProgress(saved?.distanceKm, goalKm);
        save(saved.distanceKm);
      }
    }
  } catch {
    state = { distanceKm: 0, goalKm };
    persistent = false;
  }

  return {
    getState: () => ({ ...state }),
    isPersistent: () => persistent,
    addDistance(km) {
      if (!Number.isFinite(km) || km < 0) {
        throw new RangeError('Los kilómetros añadidos deben ser positivos o cero.');
      }
      return save(state.distanceKm + km);
    },
    reset: () => save(0),
  };
}

/** Selección explícita: real no tiene proveedor todavía y no lee datos simulados. */
export function createDistanceProvider(game, storage) {
  calculateProgress(0, game.goalKm);
  if (game.mode === 'simulation') return createSimulatedProvider(storage, game.goalKm);
  if (game.mode === 'real') return null;
  throw new RangeError('Modo de proveedor no compatible.');
}
