import { createD1Repository } from './d1/repository.js';
import { createTokenVault } from '../auth/token-vault.js';
import { createStravaAdapter } from '../auth/strava-adapter.js';
import { createOAuthService } from '../auth/oauth-service.js';
import { hashSecret, newSecret } from '../auth/invitation-machine.js';
import { createOAuthRouter } from './oauth-http.js';
import { createWorker } from './worker.js';
import { createActivityClient } from './strava-activities.js';
import { createActivitySync } from './activity-sync.js';
import { createPilotTransport, PILOT_LIMITS } from './pilot-budget.js';

export const PILOT_ORIGIN = 'https://albertoybelen.ddev.site';
export const PILOT_ENABLE = 'owner-authorized-local-pilot';
export const PILOT_SETTINGS = Object.freeze({ startDate: '2026-11-01', timeZone: 'Europe/Madrid', goalKm: 500 });
const owner = { authenticated: true, role: 'owner' };

/** Separate local binding and manual activation; shares the existing vault and reconciliation. */
export function createPilot(env, { fetchProvider, clock = Date.now } = {}) {
  if (env.APP_ENV !== 'local-owner-pilot' || !env.DB) throw new Error('local_pilot_required');
  const repository = createD1Repository(env.DB, { settings: PILOT_SETTINGS });
  const version = env.TOKEN_ENCRYPTION_KEY_VERSION || 'v1';
  if (env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION === version) throw new Error('vault_unavailable');
  const keys = { [version]: env.TOKEN_ENCRYPTION_KEY };
  if (env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION) keys[env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION] = env.TOKEN_PREVIOUS_ENCRYPTION_KEY;
  const vault = createTokenVault({ keys, activeVersion: version });
  const ownerId = Number(env.PILOT_OWNER_ATHLETE_ID);
  async function validate() {
    if (!/^[1-9]\d*$/.test(env.STRAVA_CLIENT_ID ?? '') || typeof env.STRAVA_CLIENT_SECRET !== 'string' || !env.STRAVA_CLIENT_SECRET.trim() || !Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('pilot_configuration_incomplete');
    await vault.ready();
    const { state } = await repository.read();
    if (state.policy.config.startDate !== PILOT_SETTINGS.startDate || state.policy.config.timeZone !== PILOT_SETTINGS.timeZone || state.policy.config.goalKm !== PILOT_SETTINGS.goalKm) throw new Error('pilot_storage_mismatch');
    const other = state.auth.slots.find(s => s.id === 'slot-b');
    const otherPolicy = state.policy.participants.find(p => p.id === 'slot-b');
    if (other.status === 'connected' || other.accountHash || other.expectedAccountHash || otherPolicy.connected || otherPolicy.scopes.length || otherPolicy.initialReconciled || otherPolicy.syncedAt || otherPolicy.activities.length || state.sealedTokens['slot-b'] || Object.values(state.auth.invitations).some(i => i.slot !== 'slot-a') || Object.values(state.auth.attempts).some(a => a.slot !== 'slot-a')) throw new Error('pilot_owner_only');
    const subject = state.auth.slots.find(s => s.id === 'slot-a');
    if ([subject.accountHash, subject.expectedAccountHash].some(hash => hash && hash !== hashSecret(String(ownerId)))) throw new Error('pilot_owner_only');
  }
  async function ready() {
    if (env.PILOT_ENABLED !== PILOT_ENABLE) throw new Error('pilot_not_authorized');
    await validate();
  }
  const transport = createPilotTransport({ repository, ready, fetchProvider, clock });
  const baseProvider = createStravaAdapter({ enabled: true, clientId: env.STRAVA_CLIENT_ID, clientSecret: env.STRAVA_CLIENT_SECRET, fetchProvider: transport });
  const provider = { ...baseProvider, async authorizeUrl(options) { await ready(); return baseProvider.authorizeUrl(options); } };
  const service = createOAuthService({ repository, provider, vault, origin: PILOT_ORIGIN, clock });
  const engine = createActivitySync({ repository, oauth: service, client: createActivityClient({ enabled: true, fetchProvider: transport }), clock, snapshotOptions: { maxPages: PILOT_LIMITS.maxPages, maxRecords: PILOT_LIMITS.maxRecords } });
  const router = createOAuthRouter({ service, provider, mock: false, origin: PILOT_ORIGIN, publicWorker: createWorker({ repository, source: 'strava-pilot', allowedOrigins: [PILOT_ORIGIN], loadFixture: async () => [] }) });
  return {
    repository, vault, service, validate, ready,
    async fetch(request) {
      await ready();
      const url = new URL(request.url);
      if (url.origin !== PILOT_ORIGIN) throw new Error('pilot_origin_rejected');
      return router.fetch(request);
    },
    async sync() { await ready(); return engine.run(); },
    async issue() {
      await ready(); const token = newSecret(), now = clock();
      const result = await repository.transitionAuth({ type: 'issue', actor: owner, now, slot: 'slot-a', expectedAccountHash: hashSecret(String(ownerId)), tokenHash: hashSecret(token), expiresAt: now + 3600000 });
      if (!result.ok) throw new Error('pilot_invitation_failed');
      return `${PILOT_ORIGIN}/invite#${token}`;
    },
    async refresh() { await ready(); await service.credentials('slot-a'); },
    async revoke() { return repository.transitionAuth({ type: 'revoke', slot: 'slot-a', actor: owner, now: clock() }); },
    async erase() {
      // Reset domain data atomically; the repository retains anonymous budget counters.
      // Never restore a captured budget afterward: a concurrent request may have advanced it.
      await repository.resetForTests('local-fixtures');
    },
    async status() {
      const { state } = await repository.read();
      const b = state.pilotBudget;
      return { activities: state.policy.participants.reduce((n,p) => n + p.activities.length, 0), progress: await repository.getProgress(), limits: PILOT_LIMITS, requests: b?.requests ?? 0, quarterCount: b?.quarterCount ?? 0, dayCount: b?.dayCount ?? 0, quarterResetsAt: b ? b.quarterStart + 900000 : null, blockedUntil: b?.blockedUntil ?? 0, responses: b?.responses ?? {}, reportedLimits: b?.reportedLimits ?? {}, networkErrors: b?.networkErrors ?? 0 };
    },
  };
}
