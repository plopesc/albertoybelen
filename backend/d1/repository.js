import { createDistanceState, applyParticipantSync, publicProgress } from '../../policy/distance-policy.js';
import { createInvitationState, transitionInvitation } from '../../auth/invitation-machine.js';

export const NAMESPACE = 'local-fixtures';
export const FIXTURE_SETTINGS = Object.freeze({ startDate: '2026-11-01', timeZone: 'Europe/Madrid', goalKm: 100 });
const fresh = () => ({ policy: createDistanceState(FIXTURE_SETTINGS), auth: createInvitationState(), metadata: {} });
const key = (participant, activity) => JSON.stringify([participant, String(activity)]);

/** Single canonical domain document plus relational projections, committed in one D1 batch. */
export function createD1Repository(db, { settings = FIXTURE_SETTINGS, dataset = NAMESPACE } = {}) {
  if (![NAMESPACE, 'staging-strava-test-v1'].includes(dataset)) throw Error('Unsupported repository dataset');
  const namespace = dataset;
  const prefix = dataset === NAMESPACE ? '' : 'staging_auth_';
  const freshState = () => ({ ...fresh(), policy: createDistanceState(settings) });
  // Only fixed SQL identifiers from this repository are translated; never user input.
  const prepare = (sql, ...values) => db.prepare(sql.replace(/\b(game_state|transaction_guard|participants|activities|rewards|invitations|oauth_attempts|oauth_credentials|oauth_sessions)\b/g, name => prefix + name)).bind(...values);
  async function initialize() {
    await prepare('INSERT OR IGNORE INTO game_state(id,revision,document) VALUES(?,0,?)', namespace, JSON.stringify(freshState())).run();
  }
  async function read() {
    await initialize();
    const row = await prepare('SELECT revision,document FROM game_state WHERE id=?', namespace).first();
    const state = JSON.parse(row.document);
    state.sealedTokens ??= {}; state.oauthSessions ??= {}; state.syncControl ??= { slots: {} };
    return { revision: row.revision, state };
  }
  async function commit(revision, state) {
    const statements = [
      prepare('INSERT INTO transaction_guard(id,valid) VALUES(1,COALESCE((SELECT revision=? FROM game_state WHERE id=?),0)) ON CONFLICT(id) DO UPDATE SET valid=excluded.valid', revision, namespace),
      prepare('UPDATE game_state SET revision=revision+1,document=? WHERE id=?', JSON.stringify(state), namespace),
      prepare('DELETE FROM oauth_credentials'), prepare('DELETE FROM oauth_sessions'), prepare('DELETE FROM oauth_attempts'), prepare('DELETE FROM invitations'), prepare('DELETE FROM activities'), prepare('DELETE FROM rewards'), prepare('DELETE FROM participants'),
    ];
    for (const p of state.policy.participants) {
      statements.push(prepare('INSERT INTO participants VALUES(?,?,?,?,?,?,?,?)', p.id, p.generation, +p.connected, +p.deleted, +p.initialReconciled, +p.stale, JSON.stringify(p.scopes), p.syncedAt));
      for (const a of p.activities) {
        const m = state.metadata[key(p.id, a.id)];
        if (!m) throw new Error('Activity metadata missing');
        statements.push(prepare('INSERT INTO activities VALUES(?,?,?,?,?,?,?,?)', p.id, a.id, m.startUtc, m.distance, a.validMeters, m.sport, +m.manual, +m.private));
      }
    }
    for (const id of state.policy.unlockedMilestoneIds) statements.push(prepare('INSERT INTO rewards VALUES(?)', id));
    for (const [hash, i] of Object.entries(state.auth.invitations)) statements.push(prepare('INSERT INTO invitations VALUES(?,?,?,?,?)', hash, i.slot, i.generation, i.expiresAt, i.status));
    for (const [hash, a] of Object.entries(state.auth.attempts)) statements.push(prepare('INSERT INTO oauth_attempts VALUES(?,?,?,?,?,?,?)', hash, a.invitationHash, a.slot, a.generation, a.sessionHash, a.expiresAt, a.status));
    for (const row of Object.values(state.sealedTokens ?? {})) statements.push(prepare('INSERT INTO oauth_credentials VALUES(?,?,?,?,?,?)', row.slot, row.generation, row.version, row.keyVersion, row.nonce, row.ciphertext));
    for (const [hash, session] of Object.entries(state.oauthSessions ?? {})) statements.push(prepare('INSERT INTO oauth_sessions VALUES(?,?)', hash, session.expiresAt));
    await db.batch(statements);
  }
  async function mutate(change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { revision, state } = await read();
      const result = await change(state);
      try { await commit(revision, state); return result; }
      catch (error) {
        // Only a changed revision is retryable; integrity errors must remain visible.
        if ((await read()).revision === revision || attempt === 2) throw error;
      }
    }
  }
  function apply(state, event) {
    const previous = state.policy;
    state.policy = applyParticipantSync(previous, event);
    const before = previous.participants.find(p => p.id === event.participantId);
    const after = state.policy.participants.find(p => p.id === event.participantId);
    if (after.generation !== before.generation && ['revoked', 'deleted'].includes(event.status)) {
      const slot = state.auth.slots.find(p => p.id === event.participantId);
      if (slot.generation === before.generation) {
        state.auth = transitionInvitation(state.auth, { type: event.status === 'deleted' ? 'delete' : 'revoke', now: 0, slot: slot.id, actor: { authenticated: true, role: 'owner' }, requestVerified: true, purgeMilestones: event.purgeMilestones }).state;
        state.auth.slots.find(p => p.id === slot.id).generation = after.generation;
      }
    }
    if (before.generation === event.generation && before.connected && !before.deleted && event.status === 'success') {
      for (const a of event.activities) if (!a.deleted) {
        // Whitelist only the fields required for rule evaluation; never store names/GPS.
        const instant = new Date(a.start_date);
        if (!Number.isFinite(instant.getTime()) || !Number.isFinite(a.distance) || a.distance < 0) throw new Error('Invalid activity metadata');
        state.metadata[key(event.participantId, a.id)] = { startUtc: instant.toISOString(), distance: a.distance, sport: a.sport_type ?? a.type ?? null, manual: a.manual !== false, private: a.private !== false };
      }
    }
    if (after.generation !== before.generation || !after.connected) delete (state.sealedTokens ?? {})[event.participantId];
    if (after.generation !== before.generation) delete (state.syncControl?.slots ?? {})[event.participantId];
    const live = new Set(state.policy.participants.flatMap(p => p.activities.map(a => key(p.id, a.id))));
    for (const id of Object.keys(state.metadata)) if (!live.has(id)) delete state.metadata[id];
  }
  return {
    read, commit,
    // Private service API only; never exposed as a generic HTTP mutation.
    updatePrivate: mutate,
    applyPrivateEffect: apply,
    async getState() { return (await read()).state.policy; },
    async getProgress() { return publicProgress(await this.getState()); },
    applyEvents(events) { return mutate(state => { for (const event of events) apply(state, event); }); },
    markFailures() { return mutate(state => { for (const p of state.policy.participants.filter(p => p.connected)) apply(state, { participantId: p.id, generation: p.generation, status: 'error' }); }); },
    transitionAuth(event) {
      return mutate(state => {
        const next = transitionInvitation(state.auth, event);
        state.auth = next.state;
        for (const effect of next.effects) apply(state, effect);
        return next.result;
      });
    },
    setGoal(goalKm) {
      createDistanceState({ ...FIXTURE_SETTINGS, goalKm });
      return mutate(state => { state.policy.config.goalKm = goalKm; });
    },
    resetForTests(confirmation) {
      if (confirmation !== namespace) throw new Error('Explicit local fixture confirmation required');
      return mutate(state => {
        const next = freshState();
        for (const p of next.policy.participants) p.generation = state.policy.participants.find(old => old.id === p.id).generation + 1;
        for (const p of next.auth.slots) p.generation = next.policy.participants.find(old => old.id === p.id).generation;
        Object.assign(state, next, { sealedTokens: {}, oauthSessions: {}, syncControl: { slots: {} } });
      });
    },
  };
}

/** Credentials are deliberately unavailable until a separately reviewed encrypted vault exists. */
export const credentialVault = Object.freeze({
  async store() { throw new Error('Credential storage disabled: future encryption key must live outside D1 and Git'); },
  async load() { throw new Error('No credentials in local fixtures'); },
});
