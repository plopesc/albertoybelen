import { hashSecret, newSecret } from '../auth/invitation-machine.js';
import { completeActivitySnapshot } from './strava-activities.js';

/** Durable CAS lease across Workers/CLI processes; generation checks fence late work. */
export function createActivitySync({ repository, oauth, client, clock = Date.now, snapshotOptions = {}, enabled = true }) {
  return {
    async run() {
      if (!enabled) throw new Error('activity_transport_disabled');
      const hash = hashSecret(newSecret());
      const claimed = await repository.updatePrivate(state => {
        state.syncControl ??= { slots: {} };
        if (state.syncControl.lease?.expiresAt > clock()) return null;
        state.syncControl.lease = { hash, expiresAt: clock() + 120000 };
        return state.policy.participants.filter(p => p.connected && !p.deleted && (state.syncControl.slots[p.id]?.retryAt ?? 0) <= clock()).map(p => ({ id: p.id, generation: p.generation }));
      });
      if (!claimed) return { status: 'busy' };
      let failed = false;
      const active = (state, job) => state.syncControl?.lease?.hash === hash && state.syncControl.lease.expiresAt > clock() && state.policy.participants.some(p => p.id === job.id && p.generation === job.generation && p.connected && !p.deleted) && state.auth.slots.some(p => p.id === job.id && p.generation === job.generation && p.status === 'connected');
      try {
        for (const job of claimed) {
          try {
            const guard = async () => {
              const { state } = await repository.read();
              if (!active(state, job) || !state.policy.participants.find(p => p.id === job.id)?.scopes.includes('activity:read_all')) throw new Error('sync_cancelled');
            };
            await guard();
            const participant = (await repository.getState()).participants.find(p => p.id === job.id);
            if (!participant.scopes.includes('activity:read_all')) throw new Error('authorization_required');
            const tokens = await oauth.credentials(job.id);
            if (!tokens.scopes.includes('activity:read_all')) throw new Error('authorization_required');
            const before = Math.floor(clock() / 1000) + 1;
            const config = (await repository.getState()).config;
            const activities = await completeActivitySnapshot({ ...snapshotOptions, client, credentials: tokens, config, before, guard, signal: AbortSignal.timeout(45000) });
            await repository.updatePrivate(state => {
              if (!active(state, job)) return;
              if (!state.policy.participants.find(p => p.id === job.id).scopes.includes('activity:read_all')) throw new Error('authorization_required');
              // A date/rules change during traversal invalidates the snapshot. Goal changes
              // are allowed but do not unlock anything without an actual distance increase.
              if (state.policy.config.startDate !== config.startDate || state.policy.config.timeZone !== config.timeZone) throw new Error('sync_cancelled');
              repository.applyPrivateEffect(state, { participantId: job.id, generation: job.generation, status: 'success', complete: true, activities, syncedAt: new Date(clock()).toISOString() });
              state.syncControl.slots[job.id] = { syncedAt: new Date(clock()).toISOString(), retryAt: 0 };
            });
          } catch (error) {
            failed = true;
            await repository.updatePrivate(state => {
              if (!active(state, job)) return;
              repository.applyPrivateEffect(state, { participantId: job.id, generation: job.generation, status: 'error' });
              state.syncControl.slots[job.id] = { ...state.syncControl.slots[job.id], retryAt: clock() + Math.max(60000, Math.min(86400000, error.retryMs || 60000)) };
            });
          }
        }
        return { status: failed ? 'stale' : claimed.length ? 'synced' : 'idle' };
      } finally {
        await repository.updatePrivate(state => { if (state.syncControl?.lease?.hash === hash) delete state.syncControl.lease; });
      }
    },
    scheduled(event, env, context) {
      const work = this.run(); context?.waitUntil(work); return work;
    },
  };
}
