/** Contrato sintético puro. No realiza IO, OAuth, persistencia ni llamadas remotas. */
const sports = new Set(['Run', 'Walk', 'Hike']);
const clone = value => structuredClone(value);
export function startInstant(startDate, timeZone = 'Europe/Madrid') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(Date.parse(startDate)) || new Date(startDate).toISOString().slice(0, 10) !== startDate) throw new Error('Fecha inválida');
  const target = Date.parse(`${startDate}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const delta = target - represented;
    if (!delta) return instant;
    instant += delta;
  }
  throw new Error('Medianoche inexistente o ambigua');
}
export function eligibleMeters(activity, { startDate, timeZone = 'Europe/Madrid' }, scopes = []) {
  if (!activity || !sports.has(activity.sport_type ?? activity.type) || activity.manual !== false) return 0;
  if (activity.private !== false && !scopes.includes('activity:read_all')) return 0;
  if (typeof activity.start_date !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(activity.start_date)) throw new Error('Instante con zona requerido');
  const instant = Date.parse(activity.start_date);
  if (!Number.isFinite(instant) || !Number.isFinite(activity.distance) || activity.distance < 0) throw new Error('Actividad inválida');
  return instant >= startInstant(startDate, timeZone) ? activity.distance : 0;
}
export function createDistanceState({ participants = ['slot-a', 'slot-b'], startDate = '2026-11-01', timeZone = 'Europe/Madrid', goalKm = 100, milestones = [20,40,60,80].map(percent => ({ id: `milestone-${percent}`, percent })) } = {}) {
  startInstant(startDate, timeZone);
  if (!Number.isFinite(goalKm) || goalKm <= 0 || participants.length !== 2 || new Set(participants).size !== 2 || participants.some(id => typeof id !== 'string' || !id)) throw new Error('Configuración inválida');
  if (!Array.isArray(milestones) || milestones.some(m => !m || typeof m.id !== 'string' || m.id === 'finish' || !Number.isFinite(m.percent) || m.percent <= 0 || m.percent >= 100) || new Set(milestones.map(m => m.id)).size !== milestones.length) throw new Error('Hitos inválidos');
  return { config: { startDate, timeZone, goalKm, milestones: clone(milestones) }, participants: participants.map(id => ({ id, generation: 0, connected: false, deleted: false, stale: false, scopes: [], activities: [], syncedAt: null })), unlockedMilestoneIds: [] };
}
function meters(state) {
  return state.participants.reduce((sum, p) => sum + p.activities.reduce((subtotal, a) => subtotal + a.validMeters, 0), 0);
}
export function publicProgress(state) {
  const timestamps = state.participants.filter(p => p.syncedAt !== null).map(p => p.syncedAt).filter(Boolean).sort();
  return { distanceKm: meters(state) / 1000, partial: state.participants.some(p => !p.connected || !p.scopes.includes('activity:read_all')), stale: state.participants.some(p => p.stale), updatedAt: timestamps[0] ?? null, unlockedMilestoneIds: [...state.unlockedMilestoneIds] };
}
export function applyParticipantSync(input, event) {
  const state = clone(input), p = state.participants.find(p => p.id === event.participantId);
  if (!p) throw new Error('Slot desconocido');
  // Los eventos siempre llevan la generación capturada al encolar el trabajo.
  if (event.generation !== p.generation) return state;
  if (event.status === 'deleted') {
    if (event.verified !== true) throw new Error('Supresión no autorizada');
    p.activities = []; p.scopes = []; p.connected = false; p.deleted = true; p.stale = false; p.syncedAt = null; p.generation++;
    if (event.purgeMilestones === true) state.unlockedMilestoneIds = [];
    return state;
  }
  if (p.deleted) {
    // Decisión interna de autenticación ficticia; nunca flags confiables de una petición pública.
    if (event.status === 'connected' && event.newConsent === true && event.verified === true) {
      p.deleted = false; p.connected = true; p.scopes = [...(event.scopes ?? [])];
      p.activities = []; p.syncedAt = null; p.stale = false; p.generation++;
    }
    return state;
  }
  if (event.status === 'revoked') { p.connected = false; p.scopes = []; p.stale = true; p.generation++; return state; }
  if (event.status === 'connected') {
    p.connected = true; p.scopes = [...(event.scopes ?? [])];
    return state;
  }
  if (!p.connected) return state;
  if (event.status === 'error') { p.stale = true; return state; }
  if (event.status !== 'success') throw new Error('Estado desconocido');
  if (!Array.isArray(event.activities) || !Number.isFinite(Date.parse(event.syncedAt))) throw new Error('Snapshot inválido');
  const before = meters(state), records = new Map(event.complete === true ? [] : p.activities.map(a => [a.id, a]));
  for (const activity of event.activities) {
    if (!activity || !['string', 'number'].includes(typeof activity.id) || !String(activity.id)) throw new Error('ID inválido');
    const id = String(activity.id);
    if (activity.deleted === true) { records.delete(id); continue; }
    records.set(id, { id, validMeters: eligibleMeters(activity, state.config, p.scopes) });
  }
  p.activities = [...records.values()].sort((a,b) => a.id.localeCompare(b.id));
  p.syncedAt = event.syncedAt; p.stale = false;
  const after = meters(state);
  if (!Number.isFinite(after)) throw new Error('Total fuera de rango');
  if (after > before) {
    for (const m of [...state.config.milestones, { id: 'finish', percent: 100 }]) {
      if (after / 1000 >= state.config.goalKm * m.percent / 100 && !state.unlockedMilestoneIds.includes(m.id)) state.unlockedMilestoneIds.push(m.id);
    }
  }
  return state;
}
