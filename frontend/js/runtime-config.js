import { loadGameConfig } from './config.js';
import { PAGES_STAGING_PROGRESS_URL, resolveProgressEndpoint } from './http-progress.js';
export const LOCAL_CONFIG_URL = new URL('../config/local.json', import.meta.url);
export const STAGING_CONFIG_URL = new URL('../config/staging.local.json', import.meta.url);
export const STAGING_STRAVA_CONFIG_URL = new URL('../config/staging-strava.local.json', import.meta.url);
export const PAGES_STAGING_CONFIG_URL = new URL('../config/pages-staging.json', import.meta.url);
const PAGES_ORIGIN = 'https://plopesc.github.io';
const PAGES_PATH = '/albertoybelen/';
export async function loadRuntimeConfig({ pageUrl = globalThis.location.href, fetchConfig = globalThis.fetch } = {}) {
  const page = new URL(pageUrl), local = page.searchParams.getAll('local-api'), staging = page.searchParams.getAll('staging-api'), pages = page.searchParams.getAll('pages-staging');
  let config;
  if (pages.length) {
    if (pages.length !== 1 || pages[0] !== 'strava' || local.length || staging.length || page.origin !== PAGES_ORIGIN || !page.pathname.startsWith(PAGES_PATH) || [...page.searchParams.keys()].some(key => key !== 'pages-staging') || page.hash) throw new Error('La prueba Strava solo está disponible mediante su enlace explícito de GitHub Pages.');
    try { config = await loadGameConfig(fetchConfig, PAGES_STAGING_CONFIG_URL); }
    catch { throw new Error('No se pudo cargar el perfil de prueba de GitHub Pages.'); }
    if (config.game.mode !== 'real' || config.game.id !== 'pages-staging-strava' || config.game.goalKm !== 500 || config.game.startDate !== '2026-11-01' || config.game.timeZone !== 'Europe/Madrid' || config.api?.url !== PAGES_STAGING_PROGRESS_URL || config.api.allowFixtures !== false) throw new Error('El perfil Pages debe usar únicamente el progreso agregado de staging.');
  } else if (staging.length) {
    if (local.length || page.origin !== 'https://albertoybelen.ddev.site' || staging.length !== 1 || !['1','strava'].includes(staging[0])) throw new Error('El perfil staging solo está disponible explícitamente en DDEV HTTPS.');
    try { config = await loadGameConfig(fetchConfig, staging[0]==='strava'?STAGING_STRAVA_CONFIG_URL:STAGING_CONFIG_URL); }
    catch { throw new Error('No se pudo cargar el perfil staging. Ejecuta frontend:staging:prepare.'); }
    if(staging[0]==='strava') {
      if(config.game.mode!=='real'||config.game.id!=='local-ddev-cloudflare-staging-strava'||config.api?.url!=='/api/staging/strava-progress'||config.api.allowFixtures!==false)throw new Error('El perfil staging Strava debe estar aislado y rechazar fixtures.');
    } else if (config.game.mode !== 'real' || config.game.id !== 'local-ddev-cloudflare-staging' || config.api?.url !== '/api/staging/progress' || config.api.allowFixtures !== true) throw new Error('El perfil staging debe identificar su dataset y proxy de lectura.');
  } else if (local.length) {
    if (page.origin !== 'https://albertoybelen.ddev.site' || local.length !== 1 || local[0] !== '1') throw new Error('El arranque local solo está disponible en DDEV HTTPS.');
    try { config = await loadGameConfig(fetchConfig, LOCAL_CONFIG_URL); }
    catch { throw new Error('No se pudo cargar la configuración local. Ejecuta frontend:local:prepare.'); }
    if (config.game.mode !== 'real' || !config.game.id.startsWith('local-ddev-') || !config.api) throw new Error('La configuración local debe identificar su dataset y API.');
  } else config = await loadGameConfig(fetchConfig);
  if (config.game.mode === 'real' && config.api) resolveProgressEndpoint(config.api.url, pageUrl, config.api.allowFixtures);
  return config;
}
