/** Cálculos puros, independientes del navegador y del proveedor de datos. */
export function calculateProgress(distanceKm, goalKm) {
  if (!Number.isFinite(goalKm) || goalKm <= 0) {
    throw new RangeError('El objetivo debe ser un número mayor que cero.');
  }
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError('La distancia debe ser un número igual o mayor que cero.');
  }
  const ratio = Math.min(1, Math.max(0, distanceKm / goalKm));
  return {
    distanceKm,
    goalKm,
    ratio,
    percentage: ratio * 100,
    remainingKm: Math.max(0, goalKm - distanceKm),
    complete: distanceKm >= goalKm,
  };
}
