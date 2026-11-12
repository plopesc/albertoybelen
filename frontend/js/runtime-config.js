import { loadGameConfig } from './config.js';
import { resolveProgressEndpoint } from './http-progress.js';
export const LOCAL_CONFIG_URL = new URL('../config/local.json', import.meta.url);
export const STAGING_CONFIG_URL = new URL('../config/staging.local.json', import.meta.url);
export async function loadRuntimeConfig({ pageUrl = globalThis.location.href, fetchConfig = globalThis.fetch } = {}) {
  const page = new URL(pageUrl), local = page.searchParams.getAll('local-api'), staging = page.searchParams.getAll('staging-api');
  let config;
  if (staging.length) {
    if (local.length || page.origin !== 'https://albertoybelen.ddev.site' || staging.length !== 1 || staging[0] !== '1') throw new Error('El perfil staging solo está disponible explícitamente en DDEV HTTPS.');
    try { config = await loadGameConfig(fetchConfig, STAGING_CONFIG_URL); }
    catch { throw new Error('No se pudo cargar el perfil staging. Ejecuta frontend:staging:prepare.'); }
    if (config.game.mode !== 'real' || config.game.id !== 'local-ddev-cloudflare-staging' || config.api?.url !== '/api/staging/progress' || config.api.allowFixtures !== true) throw new Error('El perfil staging debe identificar su dataset y proxy de lectura.');
  } else if (local.length) {
    if (page.origin !== 'https://albertoybelen.ddev.site' || local.length !== 1 || local[0] !== '1') throw new Error('El arranque local solo está disponible en DDEV HTTPS.');
    try { config = await loadGameConfig(fetchConfig, LOCAL_CONFIG_URL); }
    catch { throw new Error('No se pudo cargar la configuración local. Ejecuta frontend:local:prepare.'); }
    if (config.game.mode !== 'real' || !config.game.id.startsWith('local-ddev-') || !config.api) throw new Error('La configuración local debe identificar su dataset y API.');
  } else config = await loadGameConfig(fetchConfig);
  if (config.game.mode === 'real' && config.api) resolveProgressEndpoint(config.api.url, pageUrl, config.api.allowFixtures);
  return config;
}
