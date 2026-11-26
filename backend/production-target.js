import {STAGING_AUTH_ORIGIN} from './staging-auth-settings.js';

export const PRODUCTION_WORKER = 'albertoybelen-api';
export const PRODUCTION_DATABASE = 'albertoybelen-db';
export const PRODUCTION_DATASET = 'production-strava-v1';
export const PRODUCTION_MIGRATION = '0001_production_strava.sql';
export const PRODUCTION_CRON = '0 */3 * * *';
export const PRODUCTION_ADMIN_PATH = '/admin/production';
export const PRODUCTION_SETTINGS = Object.freeze({goalKm:500,startDate:'2026-11-28',timeZone:'Europe/Madrid'});

export const PRODUCTION_TARGET = Object.freeze({
  origin:'https://albertoybelen-api.autumn-dream-2a39.workers.dev',
  databaseId:'af0021ea-9c23-44b5-8a7d-6f281aaa02dc',
  routing:'workers.dev',
});

export function requireProductionTarget(target = PRODUCTION_TARGET) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(target.databaseId ?? '') ||
      target.databaseId === 'c6bde806-cf94-4ff3-8c4f-c08b8de477f6' ||
      target.databaseId.startsWith('00000000-0000-0000-0000-')) throw Error('production_database_unverified');
  const url = new URL(target.origin);
  if (url.origin !== target.origin || url.protocol !== 'https:' || url.port ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(url.hostname) ||
      url.hostname === new URL(STAGING_AUTH_ORIGIN).hostname || url.hostname === 'plopesc.github.io' ||
      url.hostname.endsWith('.ddev.site') || url.hostname.includes('staging') || !['workers.dev','custom-domain'].includes(target.routing)) throw Error('production_origin_unverified');
  if (target.routing === 'workers.dev'
      ? !new RegExp(`^${PRODUCTION_WORKER}\\.[a-z0-9-]+\\.workers\\.dev$`).test(url.hostname)
      : url.hostname.endsWith('.workers.dev')) throw Error('production_route_unverified');
  return target;
}
