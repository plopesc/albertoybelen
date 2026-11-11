import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvitationState, transitionInvitation, hashSecret, newSecret } from '../auth/invitation-machine.js';
import { createDistanceState, applyParticipantSync, publicProgress } from '../policy/distance-policy.js';
import { createWorker } from '../backend/worker.js';
const now = Date.parse('2026-11-01T09:00:00Z');
const owner = { authenticated: true, role: 'owner' };
const h = value => hashSecret(`synthetic-only-${value}`);
function model() {
  let state = createInvitationState();
  return {
    state: () => structuredClone(state),
    run(event) { const result = transitionInvitation(state, { now, ...event }); state = result.state; return result; },
    issue(slot = 'slot-a', token = 'invite-a', account = 'account-a') { return this.run({ type: 'issue', actor: owner, slot, tokenHash: h(token), expectedAccountHash: h(account), expiresAt: now + 3600000 }); },
    begin(token = 'invite-a', nonce = 'state-a', session = 'session-a', extra = {}) { return this.run({ type: 'begin', tokenHash: h(token), stateHash: h(nonce), sessionHash: h(session), ...extra }); },
    callback(nonce = 'state-a', account = 'account-a', session = 'session-a', extra = {}) { return this.run({ type: 'callback', stateHash: h(nonce), sessionHash: h(session), accountHash: h(account), providerStatus: 'valid', scopes: ['activity:read_all'], ...extra }); },
    revoke(slot = 'slot-a') { return this.run({ type: 'revoke', actor: owner, slot }); },
    delete(slot = 'slot-a', extra = {}) { return this.run({ type: 'delete', actor: owner, slot, requestVerified: true, ...extra }); },
  };
}
test('secretos aleatorios de 256 bits y solo hashes en el estado persistible', () => {
  const token = newSecret(), other = newSecret();
  assert.notEqual(token, other); assert.equal(Buffer.from(token, 'base64url').length, 32);
  const m = model(); m.run({ type: 'issue', actor: owner, slot: 'slot-a', tokenHash: hashSecret(token), expectedAccountHash: h('account-a'), expiresAt: now + 1000 });
  assert.equal(JSON.stringify(m.state()).includes(token), false);
});
test('dos invitaciones independientes vinculan exclusivamente sus slots', () => {
  const m = model(); m.issue(); m.issue('slot-b', 'invite-b', 'account-b');
  m.begin(); m.begin('invite-b', 'state-b', 'session-b');
  assert.equal(m.callback().result.code, 'connected');
  assert.equal(m.callback('state-b', 'account-b', 'session-b').result.code, 'connected');
  assert.deepEqual(m.state().slots.map(slot => slot.status), ['connected', 'connected']);
});
test('emitir requiere responsable y canjear requiere invitación válida, no parámetro de slot', () => {
  const m = model(); assert.equal(m.run({ type: 'issue', actor: { authenticated: false }, slot: 'slot-a' }).result.code, 'unauthorized');
  assert.equal(m.begin('inventada').result.code, 'invalid_invitation');
  m.issue(); assert.equal(m.begin('invite-a', 'state-a', 'session-a', { slot: 'slot-b' }).result.ok, false);
  assert.equal(m.begin().result.ok, true);
  assert.equal(m.callback('state-a', 'account-a', 'session-a', { slot: 'slot-b' }).result.ok, false);
});
test('expiración de enlace e intento, cancelación y reintento no consumen el enlace', () => {
  const m = model(); m.issue();
  assert.equal(m.begin('invite-a', 'state-a', 'session-a', { now: now + 3600000 }).result.ok, false);
  m.begin(); assert.equal(m.callback('state-a', 'account-a', 'session-a', { cancelled: true }).result.code, 'cancelled');
  m.begin('invite-a', 'retry'); assert.equal(m.callback('retry', 'account-a', 'session-a', { now: now + 600000 }).result.code, 'expired');
  m.begin('invite-a', 'retry-2', 'session-a', { now: now + 600001 });
  assert.equal(m.callback('retry-2', 'account-a', 'session-a', { now: now + 600002 }).result.code, 'connected');
});
test('doble clic y carreras serializadas: un solo intento y un solo canje', () => {
  const m = model(); m.issue(); m.begin();
  assert.equal(m.begin('invite-a', 'racing').result.code, 'attempt_in_progress');
  assert.equal(m.callback().result.ok, true);
  assert.equal(m.callback().result.code, 'invalid_callback');
  assert.equal(m.begin().result.code, 'invalid_invitation');
});
test('callback expirado no libera la reserva de un intento posterior', () => {
  const m = model(); m.issue(); m.begin();
  m.begin('invite-a', 'new-attempt', 'session-a', { now: now + 600001 });
  assert.equal(m.callback('state-a', 'account-a', 'session-a', { now: now + 600002 }).result.ok, false);
  assert.equal(m.callback('new-attempt', 'account-a', 'session-a', { now: now + 600003 }).result.ok, true);
});
test('state inválido, cookie de otra sesión y cuenta equivocada no vinculan', () => {
  const m = model(); m.issue(); m.begin();
  assert.equal(m.callback('wrong').result.ok, false);
  assert.equal(m.callback('state-a', 'account-a', 'wrong-session').result.ok, false);
  assert.equal(m.callback('state-a', 'wrong-account').result.code, 'account_not_allowed');
  assert.equal(m.state().slots[0].status, 'disconnected');
});
test('misma cuenta no puede asociarse a ambos slots', () => {
  const m = model(); m.issue(); m.begin(); m.callback();
  m.issue('slot-b', 'invite-b', 'account-a'); m.begin('invite-b', 'state-b', 'session-b');
  assert.equal(m.callback('state-b', 'account-a', 'session-b').result.code, 'account_not_allowed');
});
test('cancelación del proveedor, revocación y falta de permiso privado permiten reintento seguro', () => {
  for (const extra of [{ cancelled: true }, { providerStatus: 'revoked' }, { scopes: ['activity:read'] }]) {
    const m = model(); m.issue(); m.begin(); assert.equal(m.callback('state-a', 'account-a', 'session-a', extra).result.ok, false);
    m.begin('invite-a', 'retry'); assert.equal(m.callback('retry').result.ok, true);
  }
});
test('revocar no reactiva invitación usada; nueva invitación reconecta el mismo slot', () => {
  const m = model(); m.issue(); m.begin(); m.callback(); m.revoke();
  assert.equal(m.begin().result.ok, false);
  assert.equal(m.issue('slot-a', 'invite-a').result.ok, false);
  m.issue('slot-a', 'new-invite'); m.begin('new-invite', 'new-state');
  const result = m.callback('new-state');
  assert.equal(result.result.code, 'connected'); assert.equal(result.effects[0].generation, 1);
});
test('supresión exige solicitud verificada y autorización del sujeto, nunca solo enlace', () => {
  const m = model(); m.issue(); m.begin(); m.callback();
  for (const actor of [{ tokenHash: h('invite-a') }, { authenticated: true, verified: true, slot: 'slot-b' }, { authenticated: false, role: 'owner' }]) assert.equal(m.delete('slot-a', { actor }).result.code, 'unauthorized');
  assert.equal(m.delete('slot-a', { requestVerified: false }).result.code, 'unauthorized');
  assert.equal(m.state().slots[0].status, 'connected');
});
test('supresión invalida callbacks pendientes, purga cuenta y no afecta al otro slot', () => {
  const m = model(); m.issue(); m.begin(); m.issue('slot-b', 'invite-b', 'account-b'); m.begin('invite-b', 'state-b', 'session-b'); m.callback('state-b', 'account-b', 'session-b');
  m.delete(); assert.equal(m.callback().result.ok, false); assert.equal(m.begin().result.ok, false);
  assert.equal(m.state().slots[0].accountHash, null); assert.equal(m.state().slots[0].expectedAccountHash, null);
  assert.equal(m.state().slots[1].status, 'connected');
  assert.equal(Object.keys(m.state().attempts).length, 1);
  assert.equal(m.delete().effects.length, 0);
});
test('limitación de intentos y reemisión invalidan el enlace anterior sin revelar participantes', () => {
  const m = model(); m.issue(); m.issue('slot-a', 'reissued');
  assert.equal(m.begin().result.code, 'invalid_invitation');
  for (let i = 0; i < 4; i++) m.begin('bad');
  assert.equal(m.begin('bad').result.code, 'rate_limited');
  assert.equal(m.begin('reissued', 'new-state', 'session-a', { now: now + 60001 }).result.ok, true);
});
test('integración Worker local: revocar conserva agregado, borrar elimina y jobs viejos no resucitan', async () => {
  const m = model(); const worker = createWorker({ initialState: createDistanceState(), loadFixture: async () => [] });
  const apply = async result => { for (const event of result.effects) await worker.applyLocalEvent(event); };
  m.issue(); m.begin(); await apply(m.callback());
  const snapshot = { participantId: 'slot-a', generation: 0, status: 'success', complete: true, syncedAt: '2026-11-01T10:00:00Z', activities: [{ id: 'synthetic-activity', sport_type: 'Run', manual: false, private: false, start_date: '2026-11-01T09:00:00Z', distance: 40000 }] };
  await worker.applyLocalEvent(snapshot);
  const progress = async () => (await worker.fetch(new Request('https://example.invalid/api/progress'))).json();
  await apply(m.revoke()); assert.equal((await progress()).distanceKm, 40); assert.equal((await progress()).partial, true);
  m.issue('slot-a', 'reconnect'); m.begin('reconnect', 'reconnect-state'); await apply(m.callback('reconnect-state'));
  await apply(m.delete()); assert.equal((await progress()).distanceKm, 0);
  await worker.applyLocalEvent(snapshot); assert.equal((await progress()).distanceKm, 0);
  m.issue('slot-a', 'after-deletion'); m.begin('after-deletion', 'fresh-state'); const consent = m.callback('fresh-state'); await apply(consent);
  assert.equal(consent.state.slots[0].generation, 3);
  await worker.applyLocalEvent({ ...snapshot, generation: 2 }); assert.equal((await progress()).distanceKm, 0);
  await worker.applyLocalEvent({ ...snapshot, generation: 3 }); assert.equal((await progress()).distanceKm, 40);
  const json = JSON.stringify(await progress()); assert.equal(json.includes('slot-a'), false); assert.equal(json.includes('synthetic-activity'), false);
});
test('supresión adicional de hitos solo ante decisión verificada explícita', () => {
  let state = createDistanceState(); state.unlockedMilestoneIds = ['finish'];
  state = applyParticipantSync(state, { participantId: 'slot-a', generation: 0, status: 'deleted', verified: true, purgeMilestones: true });
  assert.deepEqual(publicProgress(state).unlockedMilestoneIds, []);
});

test('segunda supresión cancela una reconexión pendiente aunque el slot continúe deleted', () => {
  const m = model(); m.delete(); m.issue(); m.begin();
  const generation = m.state().slots[0].generation;
  const result = m.delete();
  assert.equal(result.result.code, 'deleted');
  assert.equal(result.effects.length, 0, 'la política ya conoce la supresión');
  assert.equal(result.state.slots[0].generation, generation);
  assert.equal(result.state.slots[0].expectedAccountHash, null);
  assert.deepEqual(result.state.invitations, {});
  assert.deepEqual(result.state.attempts, {});
  assert.equal(m.callback().result.code, 'invalid_callback');
  assert.equal(m.begin().result.code, 'invalid_invitation');
  assert.deepEqual(m.delete().effects, []);
});
test('segunda revocación cancela una reconexión pendiente aunque el slot continúe revoked', () => {
  const m = model(); m.issue(); m.begin(); m.callback(); m.revoke();
  m.issue('slot-a', 'reconnect'); m.begin('reconnect', 'pending-state');
  const generation = m.state().slots[0].generation;
  const result = m.revoke();
  assert.equal(result.result.code, 'revoked');
  assert.equal(result.effects.length, 0);
  assert.equal(result.state.slots[0].generation, generation);
  assert.equal(result.state.slots[0].expectedAccountHash, null);
  assert.equal(m.callback('pending-state').result.code, 'invalid_callback');
  assert.equal(m.begin('reconnect', 'another-attempt').result.code, 'invalid_invitation');
  assert.deepEqual(m.revoke().effects, []);
});
test('revocar de nuevo un slot suprimido cancela el intento sin debilitar su supresión', () => {
  const m = model(); m.delete(); m.issue(); m.begin();
  const generation = m.state().slots[0].generation;
  assert.deepEqual(m.revoke().effects, []);
  assert.equal(m.state().slots[0].status, 'deleted');
  assert.equal(m.state().slots[0].generation, generation);
  assert.equal(m.state().slots[0].expectedAccountHash, null);
  assert.deepEqual(m.state().invitations, {});
  assert.equal(m.callback().result.ok, false);
});
test('Worker: segunda orden cancela reconexión sin resucitar aportaciones ni alterar otro slot', async () => {
  for (const action of ['delete', 'revoke']) {
    const m = model(); const worker = createWorker({ initialState: createDistanceState(), loadFixture: async () => [] });
    const apply = async result => { for (const event of result.effects) await worker.applyLocalEvent(event); return result; };
    const progress = async () => (await worker.fetch(new Request('https://example.invalid/api/progress'))).json();
    m.issue(); m.begin(); await apply(m.callback());
    m.issue('slot-b', 'invite-b', 'account-b'); m.begin('invite-b', 'state-b', 'session-b'); await apply(m.callback('state-b', 'account-b', 'session-b'));
    const event = (participantId, distance, generation = 0) => ({ participantId, generation, status: 'success', complete: true, syncedAt: '2026-11-01T10:00:00Z', activities: [{ id: 'fixture', sport_type: 'Walk', manual: false, private: false, start_date: '2026-11-01T09:00:00Z', distance }] });
    await worker.applyLocalEvent(event('slot-a', 40000)); await worker.applyLocalEvent(event('slot-b', 10000));
    await apply(m[action]());
    m.issue('slot-a', 'reconnect'); m.begin('reconnect', 'pending-state');
    await apply(m[action]());
    const rejected = m.callback('pending-state');
    assert.equal(rejected.result.code, 'invalid_callback'); assert.deepEqual(rejected.effects, []);
    await apply(rejected);
    await worker.applyLocalEvent(event('slot-a', 90000, 0));
    await worker.applyLocalEvent(event('slot-a', 90000, 1));
    assert.equal((await progress()).distanceKm, action === 'delete' ? 10 : 50);
    await worker.applyLocalEvent(event('slot-b', 20000));
    assert.equal((await progress()).distanceKm, action === 'delete' ? 20 : 60);
    // Una invitación distinta y posterior sí permite consentimiento nuevo.
    m.issue('slot-a', 'fresh-invite'); m.begin('fresh-invite', 'fresh-state');
    await apply(m.callback('fresh-state'));
    const generation = m.state().slots[0].generation;
    await worker.applyLocalEvent(event('slot-a', 5000, generation));
    assert.equal((await progress()).distanceKm, 25);
  }
});

test('segunda supresión con purga adicional cumple la nueva orden y mantiene generaciones coherentes', async () => {
  const m = model(); const initialState = createDistanceState(); initialState.unlockedMilestoneIds = ['finish'];
  const worker = createWorker({ initialState, loadFixture: async () => [] });
  const apply = async result => { for (const event of result.effects) await worker.applyLocalEvent(event); return result; };
  const progress = async () => (await worker.fetch(new Request('https://example.invalid/api/progress'))).json();
  await apply(m.delete()); assert.deepEqual((await progress()).unlockedMilestoneIds, ['finish']);
  const result = await apply(m.delete('slot-a', { purgeMilestones: true }));
  assert.deepEqual(result.effects, [{ participantId: 'slot-a', generation: 1, status: 'deleted', verified: true, purgeMilestones: true }]);
  assert.equal(m.state().slots[0].generation, 2);
  assert.deepEqual((await progress()).unlockedMilestoneIds, []);
  assert.deepEqual(m.delete('slot-a', { purgeMilestones: true }).effects, []);
  assert.equal(m.state().slots[0].generation, 2);
  m.issue(); m.begin(); const consent = await apply(m.callback());
  assert.equal(consent.result.ok, true); assert.equal(m.state().slots[0].generation, 3);
  await worker.applyLocalEvent({ participantId: 'slot-a', generation: 3, status: 'success', complete: true, syncedAt: '2026-11-01T10:00:00Z', activities: [{ id: 'fresh-after-purge', sport_type: 'Run', manual: false, private: false, start_date: '2026-11-01T09:00:00Z', distance: 1000 }] });
  assert.equal((await progress()).distanceKm, 1, 'la generación del consentimiento nuevo debe coincidir en Worker y auth');
  assert.equal(m.state().slots[0].milestonesPurged, false);
});
