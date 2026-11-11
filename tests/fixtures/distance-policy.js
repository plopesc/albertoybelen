// Datos inventados: no contienen cuentas, actividades ni tokens reales.
export const reference = { startDate: '2026-11-01', timeZone: 'Europe/Madrid', goalKm: 100 };
export const activity = (id, distance, extra = {}) => ({ id, distance, sport_type: 'Run', manual: false, private: false, start_date: '2026-11-01T00:00:00+01:00', ...extra });
export const sync = (participantId, activities, extra = {}) => ({ participantId, activities, generation: 0, status: 'success', complete: true, syncedAt: '2026-11-02T12:00:00Z', ...extra });
