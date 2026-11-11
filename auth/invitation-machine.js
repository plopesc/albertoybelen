import { createHash, randomBytes } from 'node:crypto';

// Solo prototipo local. Los hashes y decisiones del actor proceden de un adaptador confiable.
export const hashSecret = value => createHash('sha256').update(value).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const owner = actor => actor?.authenticated === true && actor?.role === 'owner';
const verifiedSubject = (actor, slot) => owner(actor) || (actor?.authenticated === true && actor?.verified === true && actor?.slot === slot);
export function createInvitationState() {
  return { slots: ['slot-a', 'slot-b'].map(id => ({ id, status: 'disconnected', generation: 0, accountHash: null, expectedAccountHash: null, milestonesPurged: false })), invitations: {}, attempts: {}, retiredHashes: [], failures: {} };
}

/** Reductor sin IO. La persistencia futura deberá aplicar cada transición con CAS/transacción. */
export function transitionInvitation(input, event) {
  const state = structuredClone(input);
  const effects = [];
  const reply = (code, ok = false) => ({ state, result: { ok, code }, effects });
  const now = event.now;
  if (!Number.isFinite(now)) return reply('invalid_request');
  const slotFor = id => state.slots.find(slot => slot.id === id);
  function invalidate(slot, purge = false) {
    for (const [key, invite] of Object.entries(state.invitations)) if (invite.slot === slot.id) {
      if (purge) delete state.invitations[key]; else if (invite.status !== 'used') invite.status = 'revoked';
    }
    for (const [key, attempt] of Object.entries(state.attempts)) if (attempt.slot === slot.id) {
      if (purge) delete state.attempts[key]; else attempt.status = 'invalidated';
    }
  }
  if (event.type === 'issue') {
    if (!owner(event.actor)) return reply('unauthorized');
    const slot = slotFor(event.slot);
    if (!slot || slot.status === 'connected' || !validHash(event.tokenHash) || !validHash(event.expectedAccountHash) || !Number.isFinite(event.expiresAt) || event.expiresAt <= now || event.expiresAt > now + 86400000 || state.retiredHashes.includes(event.tokenHash)) return reply('invalid_request');
    invalidate(slot);
    slot.expectedAccountHash = event.expectedAccountHash;
    state.retiredHashes.push(event.tokenHash);
    state.invitations[event.tokenHash] = { slot: slot.id, generation: slot.generation, expiresAt: event.expiresAt, status: 'issued' };
    return reply('issued', true);
  }
  if (event.type === 'begin') {
    if (!validHash(event.sessionHash)) return reply('invalid_invitation');
    const failures = state.failures[event.sessionHash];
    if (failures && failures.until > now && failures.count >= 5) return reply('rate_limited');
    const invite = state.invitations[event.tokenHash];
    const slot = invite && slotFor(invite.slot);
    if (!invite || !slot || invite.generation !== slot.generation || invite.expiresAt <= now || ['used', 'revoked'].includes(invite.status) || event.slot !== undefined) {
      const entry = failures?.until > now ? failures : { count: 0, until: now + 60000 };
      entry.count++; state.failures[event.sessionHash] = entry;
      return reply('invalid_invitation');
    }
    const pending = Object.values(state.attempts).find(attempt => attempt.invitationHash === event.tokenHash && attempt.status === 'pending' && attempt.expiresAt > now);
    if (pending) return reply('attempt_in_progress');
    if (!validHash(event.stateHash) || state.attempts[event.stateHash]) return reply('invalid_request');
    for (const attempt of Object.values(state.attempts)) if (attempt.invitationHash === event.tokenHash && attempt.status === 'pending') attempt.status = 'expired';
    invite.status = 'reserved';
    state.attempts[event.stateHash] = { invitationHash: event.tokenHash, slot: slot.id, generation: slot.generation, sessionHash: event.sessionHash, expiresAt: Math.min(invite.expiresAt, now + 600000), status: 'pending' };
    return reply('consent_pending', true);
  }
  if (event.type === 'callback') {
    const attempt = state.attempts[event.stateHash];
    const invite = attempt && state.invitations[attempt.invitationHash];
    const slot = attempt && slotFor(attempt.slot);
    if (!attempt || attempt.status !== 'pending' || attempt.sessionHash !== event.sessionHash || !slot || !invite || invite.status !== 'reserved' || attempt.generation !== slot.generation || event.slot !== undefined) return reply('invalid_callback');
    if (attempt.expiresAt <= now || invite.expiresAt <= now) { attempt.status = 'expired'; invite.status = 'issued'; return reply('expired'); }
    if (event.cancelled === true) { attempt.status = 'cancelled'; invite.status = 'issued'; return reply('cancelled'); }
    if (event.providerStatus !== 'valid' || !Array.isArray(event.scopes) || !event.scopes.includes('activity:read_all')) {
      attempt.status = 'failed'; invite.status = 'issued'; return reply('authorization_failed');
    }
    if (!validHash(event.accountHash) || event.accountHash !== slot.expectedAccountHash || (slot.accountHash && slot.accountHash !== event.accountHash) || state.slots.some(other => other.id !== slot.id && other.accountHash === event.accountHash)) {
      attempt.status = 'failed'; invite.status = 'issued'; return reply('account_not_allowed');
    }
    const generation = slot.generation;
    const afterDeletion = slot.status === 'deleted';
    slot.status = 'connected'; slot.accountHash = event.accountHash;
    if (afterDeletion) { slot.generation++; slot.milestonesPurged = false; }
    attempt.status = 'completed'; invite.status = 'used';
    effects.push({ participantId: slot.id, generation, status: 'connected', scopes: ['activity:read_all'], ...(afterDeletion ? { verified: true, newConsent: true } : {}) });
    return reply('connected', true);
  }
  if (event.type === 'revoke' || event.type === 'delete') {
    const slot = slotFor(event.slot);
    if (!slot || !verifiedSubject(event.actor, event.slot) || (event.type === 'delete' && event.requestVerified !== true)) return reply('unauthorized');
    // Puede haber una invitación nueva aunque la cuenta siga revocada/suprimida.
    // Cancelarla es necesario incluso cuando el efecto de política ya se aplicó.
    invalidate(slot, event.type === 'delete' || slot.status === 'deleted');
    slot.expectedAccountHash = null;
    const additionalPurge = event.type === 'delete' && event.purgeMilestones === true && slot.milestonesPurged !== true;
    if (event.type === 'delete' && slot.status === 'deleted' && !additionalPurge) return reply('deleted', true);
    if (event.type === 'revoke' && ['revoked', 'deleted'].includes(slot.status)) return reply('revoked', true);
    const generation = slot.generation;
    slot.generation++; slot.status = event.type === 'delete' ? 'deleted' : 'revoked';
    if (event.type === 'delete') { slot.accountHash = null; slot.expectedAccountHash = null; slot.milestonesPurged = event.purgeMilestones === true; }
    effects.push({ participantId: slot.id, generation, status: event.type === 'delete' ? 'deleted' : 'revoked', ...(event.type === 'delete' ? { verified: true, purgeMilestones: event.purgeMilestones === true } : {}) });
    return reply(slot.status, true);
  }
  return reply('invalid_request');
}
