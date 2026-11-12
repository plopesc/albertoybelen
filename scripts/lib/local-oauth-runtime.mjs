import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localOAuth } from '../../backend/oauth-entry.js';
export async function openLocalOAuth({ mockOnly = false, activityTransport } = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const config = JSON.parse(readFileSync(new URL('../../wrangler.oauth.local.jsonc', import.meta.url), 'utf8'));
  if (config.d1_databases[0].remote !== false || config.d1_databases[0].database_id !== '00000000-0000-0000-0000-000000000025') throw Error('Local binding required');
  const vars = { ...config.vars };
  const privatePath = new URL('../../.dev.vars', import.meta.url);
  for (const line of (existsSync(privatePath) ? readFileSync(privatePath, 'utf8') : '').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) vars[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  if (mockOnly && vars.OAUTH_MODE !== 'mock') throw Error('Mock-only operation');
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ name: config.name, modules: true, script: 'export default {fetch(){return new Response("Private CLI only",{status:404})}}', compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags, d1Databases: { DB: config.d1_databases[0].database_id }, outboundService: () => { throw Error('Network forbidden'); } }), resourcePersistencePath: `${root}.local/oauth-d1/v3`, telemetry: { enabled: false }, logRequests: false });
  try {
    const env = { ...vars, DB: await mf.getD1Database('DB') };
    return { ...localOAuth(env, undefined, activityTransport), env, close: () => mf.dispose() };
  } catch (error) { await mf.dispose(); throw error; }
}
