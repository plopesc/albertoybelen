import { readFileSync } from 'node:fs';
import { openLocalOAuth } from './lib/local-oauth-runtime.mjs';
import { hashSecret, newSecret } from '../auth/invitation-machine.js';
import { createFixtureActivityTransport } from '../backend/activity-fixtures.js';
import { createMockProvider } from '../auth/strava-adapter.js';
import { createOAuthService } from '../auth/oauth-service.js';
const [operation, scenario = 'base'] = process.argv.slice(2);
if (process.argv.length > 4 || !['seed','sync','scheduled','verify','reset'].includes(operation) || !['base','corrected','empty','last-page-error','rate-limit'].includes(scenario) || (operation !== 'sync' && scenario !== 'base')) throw Error('Only local seed/sync/scheduled/verify/reset and named fixture scenarios');
let runtime;
try {
  runtime = await openLocalOAuth({ mockOnly: true, activityTransport: createFixtureActivityTransport({ scenario }) });
  if (operation === 'seed') {
    await runtime.vault.ready();
    const state = (await runtime.repository.read()).state;
    if (state.auth.slots.some(p => p.status === 'connected')) throw Error('Refusing to replace connected accounts');
    const provider = createMockProvider('https://albertoybelen.ddev.site');
    const service = createOAuthService({ repository: runtime.repository, vault: runtime.vault, provider });
    for (const [slot, id] of [['slot-a',101],['slot-b',202]]) {
      const token = newSecret(), now = Date.now();
      const issued = await runtime.repository.transitionAuth({ type: 'issue', slot, actor: { authenticated: true, role: 'owner' }, now, expiresAt: now + 60000, tokenHash: hashSecret(token), expectedAccountHash: hashSecret(String(id)) });
      if (!issued.ok) throw Error('Invitation failed');
      const session = await service.session();
      const url = new URL(await service.start({ token, session }));
      if (!await service.callback({ state: url.searchParams.get('state'), session, code: provider.issueCode({ athleteId: id }), scope: 'activity:read_all' })) throw Error('Mock authorization failed');
    }
    console.log('Two synthetic consents stored encrypted; no activities imported yet.');
  } else if (operation === 'sync') console.log(JSON.stringify(await runtime.sync.run()));
  else if (operation === 'scheduled') {
    let work;
    const { default: entry } = await import('../backend/oauth-entry.js');
    await entry.scheduled({ scheduledTime: Date.now(), cron: 'local-simulation-only' }, runtime.env, { waitUntil(value) { work = value; } });
    await work; console.log('Local scheduled handler completed; no Cron configured.');
  } else if (operation === 'reset') {
    const request = JSON.parse(readFileSync(0,'utf8'));
    if (request.confirm !== 'erase-local-fixtures') throw Error('Explicit confirmation required');
    await runtime.repository.resetForTests('local-fixtures'); console.log('Local synthetic state cleared; encryption key retained privately.');
  }
  console.log(JSON.stringify(await runtime.repository.getProgress()));
} catch { console.error('Local fixture synchronization failed; private error omitted.'); process.exitCode = 1; }
finally { await runtime?.close(); }
