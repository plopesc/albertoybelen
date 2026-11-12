import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localOAuth } from '../../backend/oauth-entry.js';
import { createMockProvider } from '../../auth/strava-adapter.js';
import { hashSecret, newSecret } from '../../auth/invitation-machine.js';
import { createFixtureActivityTransport } from '../../backend/activity-fixtures.js';

test('Worker scheduled real + D1 local: OAuth cifrado, HTTP agregado, reinicio, borrados y premios', async () => {
  const dir = await mkdtemp(join(tmpdir(),'alberto-sync-')); let mf;
  try {
    const bundle = await build({ entryPoints:['backend/oauth-entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*'] });
    const env = { APP_ENV:'local-fixtures',OAUTH_MODE:'mock',TOKEN_ENCRYPTION_KEY_VERSION:'v1',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64') };
    const options = { ...convertV4MiniflareOptions({ modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000025'},outboundService:()=>{throw Error('Outbound network forbidden');} }),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false} };
    mf = new Miniflare(options); let db = await mf.getD1Database('DB');
    const migrations = new URL('../../backend/d1/migrations/',import.meta.url);
    for (const file of (await readdir(migrations)).sort()) for (const sql of (await readFile(new URL(file,migrations),'utf8')).split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(sql).run();
    const provider = createMockProvider('https://albertoybelen.ddev.site');
    let runtime = localOAuth({ ...env,DB:db },provider);
    for (const [slot,id] of [['slot-a',101],['slot-b',202]]) {
      const token = newSecret(),now = Date.now();
      await runtime.repository.transitionAuth({ type:'issue',slot,now,expiresAt:now+60000,tokenHash:hashSecret(token),expectedAccountHash:hashSecret(String(id)),actor:{authenticated:true,role:'owner'} });
      const session = await runtime.service.session(),url = new URL(await runtime.service.start({token,session}));
      assert.equal(await runtime.service.callback({ state:url.searchParams.get('state'),session,code:provider.issueCode({athleteId:id}),scope:'activity:read_all' }),true);
    }
    await (await mf.getWorker()).scheduled({ scheduledTime:Date.now(),cron:'local-test-only' });
    let response = await mf.dispatchFetch('http://local/api/progress'); const first = await response.json();
    assert.equal(response.status,200); assert.equal(first.distanceKm,102.50525); assert.equal(first.partial,false); assert.equal(first.stale,false); assert.ok(first.unlockedMilestoneIds.includes('finish'));
    assert.doesNotMatch(JSON.stringify(first), /athlete|slot-|token|scopes/);
    assert.equal((await db.prepare('SELECT count(*) n FROM activities').first()).n,234);
    await mf.dispose(); mf = new Miniflare(options); db = await mf.getD1Database('DB');
    assert.deepEqual(await (await mf.dispatchFetch('http://local/api/progress')).json(),first);
    await (await mf.getWorker()).scheduled({ scheduledTime:Date.now(),cron:'local-test-only' });
    assert.equal((await (await mf.dispatchFetch('http://local/api/progress')).json()).distanceKm,first.distanceKm);
    runtime = localOAuth({ ...env,DB:db },undefined,createFixtureActivityTransport({ scenario:'corrected' }));
    await runtime.sync.run(); assert.equal((await runtime.repository.getProgress()).distanceKm,32.35525);
    runtime = localOAuth({ ...env,DB:db },undefined,createFixtureActivityTransport({ scenario:'empty' }));
    await runtime.sync.run(); const empty = await runtime.repository.getProgress(); assert.equal(empty.distanceKm,0); assert.deepEqual(empty.unlockedMilestoneIds,first.unlockedMilestoneIds);
    const privateState = JSON.stringify((await runtime.repository.read()).state);
    assert.doesNotMatch(privateState,/fixture-access-|fixture-refresh-|"name"|"map"/);
    await mf.dispose(); mf = new Miniflare(options);
    const recovered = await (await mf.dispatchFetch('http://local/api/progress')).json(); assert.equal(recovered.distanceKm,0); assert.ok(recovered.unlockedMilestoneIds.includes('finish'));
  } finally { await mf?.dispose(); await rm(dir,{recursive:true,force:true}); }
});
