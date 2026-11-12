import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {STAGING_WORKER, STAGING_DATABASE, STAGING_DATABASE_ID, STAGING_ORIGIN, DDEV_ORIGIN, LOCAL_TARGETS} from './infrastructure-policy.mjs';

function requireValue(condition, path) {
  // Never print supplied values: a rejected file might contain a secret.
  if (!condition) throw Error(`Invalid infrastructure configuration: ${path}; execution blocked`);
}
function keys(value, expected, path) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), expected.split(' ').sort()), path);
}
function exact(value, expected, path) { requireValue(isDeepStrictEqual(value, expected), path); }
function freeze(value) { for (const child of Object.values(value)) if(child && typeof child === 'object') freeze(child); return Object.freeze(value); }

export function validateInfrastructureConfig(config) {
  keys(config, 'schemaVersion cloudflare local public', 'root keys');
  exact(config.schemaVersion, 1, 'schemaVersion');
  keys(config.cloudflare, 'staging production', 'cloudflare keys');
  // Independent identity pins also validate URLs, UUIDs, binding and disabled Cron.
  exact(config.cloudflare.staging, {workerName:STAGING_WORKER, databaseName:STAGING_DATABASE,
    databaseId:STAGING_DATABASE_ID, binding:'DB', apiOrigin:STAGING_ORIGIN, appEnv:'staging-fixtures', cronEnabled:false}, 'protected staging target');
  exact(config.cloudflare.production, {workerName:'albertoybelen-api', databaseName:'albertoybelen-db',
    configured:false, deployEnabled:false}, 'reserved production metadata');
  keys(config.local, 'ddev profiles', 'local keys');
  const ddev = config.local.ddev;
  keys(ddev, 'projectName origin callbackPath host fixtures oauthMock ownerPilot frontend stagingRead', 'ddev keys');
  exact([ddev.projectName, ddev.origin, ddev.callbackPath, ddev.host],
    ['albertoybelen', DDEV_ORIGIN, '/oauth/callback', '127.0.0.1'], 'protected DDEV origin/host/callback');
  for (const [key, [name, id, port, persistence]] of Object.entries(LOCAL_TARGETS)) {
    exact(ddev[key], {workerName:name, databaseName:name, databaseId:id, binding:'DB', port, persistence}, `protected local target ${key}`);
  }
  // OAuth mock and owner pilot intentionally share 8790: mutually exclusive modes.
  exact(ddev.frontend, {port:8791}, 'frontend port');
  exact(ddev.stagingRead, {port:8792, path:'/api/staging/progress'}, 'staging read route');
  keys(config.local.profiles, 'fixtures ownerPilot staging', 'profile keys');
  const ids = new Set();
  for (const [name, profile] of Object.entries(config.local.profiles)) {
    keys(profile, 'id goalKm startDate timeZone apiPath allowFixtures', `profile ${name} keys`);
    requireValue(/^local-ddev-[a-z-]+$/.test(profile.id) && !ids.has(profile.id), 'isolated dataset IDs'); ids.add(profile.id);
    requireValue(typeof profile.goalKm === 'number' && Number.isFinite(profile.goalKm) && profile.goalKm > 0, `profile ${name} goalKm`);
    exact(profile.startDate, '2026-11-01', `profile ${name} synthetic startDate`);
    exact(profile.timeZone, 'Europe/Madrid', `profile ${name} timeZone`);
    exact(profile.apiPath, name === 'staging' ? ddev.stagingRead.path : '/api/progress', `profile ${name} apiPath`);
    exact(profile.allowFixtures, name !== 'ownerPilot', `profile ${name} source separation`);
  }
  exact(config.public, {pagesOrigin:'https://plopesc.github.io', pagesPath:'/albertoybelen/', progressPath:'/api/progress'}, 'public locations');
  return freeze(config);
}
export function loadInfrastructureConfig(path = new URL('../../config.json', import.meta.url)) {
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw Error('Invalid infrastructure configuration: unreadable strict JSON; execution blocked'); }
  return validateInfrastructureConfig(config);
}

/** Validate static Wrangler files without making the runtime depend on Node metadata. */
export function validateLocalTarget(wrangler, name, infrastructure = loadInfrastructureConfig()) {
  validateInfrastructureConfig(infrastructure);
  requireValue(Object.hasOwn(LOCAL_TARGETS, name), 'local target selection');
  keys(wrangler, 'name main compatibility_date compatibility_flags workers_dev preview_urls send_metrics vars dev d1_databases', `Wrangler ${name} keys`);
  exact(wrangler.compatibility_date, '2026-11-01', `Wrangler ${name} compatibility date`);
  exact(wrangler.compatibility_flags, ['nodejs_compat'], `Wrangler ${name} compatibility flags`);
  const target = infrastructure.local.ddev[name];
  exact(wrangler.name, target.workerName, `Wrangler ${name} worker`);
  exact(wrangler.dev, {ip:infrastructure.local.ddev.host, port:target.port}, `Wrangler ${name} host/port`);
  exact(wrangler.d1_databases, [{binding:target.binding, database_name:target.databaseName, database_id:target.databaseId,
    migrations_dir:'backend/d1/migrations', remote:false}], `Wrangler ${name} D1`);
  requireValue(wrangler.workers_dev === false && wrangler.preview_urls === false && wrangler.send_metrics === false &&
    !['account_id','env','route','routes','triggers','build'].some(key => Object.hasOwn(wrangler, key)), `Wrangler ${name} local only`);
  exact(wrangler.main, {fixtures:'backend/d1/entry.js',oauthMock:'backend/oauth-entry.js',ownerPilot:'backend/pilot-entry.js'}[name], `Wrangler ${name} entry`);
  exact(wrangler.vars, name === 'ownerPilot' ? {APP_ENV:'local-owner-pilot', PILOT_ENABLED:'disabled'} :
    name === 'oauthMock' ? {APP_ENV:'local-fixtures', OAUTH_MODE:'mock', TOKEN_ENCRYPTION_KEY_VERSION:'v1'} : {APP_ENV:'local-fixtures'}, `Wrangler ${name} mode`);
  return wrangler;
}
