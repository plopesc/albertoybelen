// Snapshots inventados: solo ejecución manual/local, sin cuentas ni tokens reales.
const activity = (id, distance) => ({ id, distance, sport_type: 'Run', manual: false, private: false, start_date: '2026-11-01T00:00:00+01:00' });
export function defaultFixtureEvents() {
  return ['slot-a', 'slot-b'].flatMap((participantId, index) => [
    { participantId, generation: 0, status: 'connected', scopes: ['activity:read_all'] },
    { participantId, generation: 0, status: 'success', complete: true, syncedAt: '2026-11-02T12:00:00Z', activities: [activity('fixture-activity', index ? 2750.25 : 1250.5)] },
  ]);
}
