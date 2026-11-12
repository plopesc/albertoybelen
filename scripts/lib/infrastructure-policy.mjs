// Independent, reviewable safety pins. Never derive these from config.json.
export const STAGING_WORKER = 'albertoybelen-api-staging';
export const STAGING_DATABASE = 'albertoybelen-db-staging';
export const STAGING_DATABASE_ID = 'c6bde806-cf94-4ff3-8c4f-c08b8de477f6';
export const STAGING_ORIGIN = 'https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev';
export const DDEV_ORIGIN = 'https://albertoybelen.ddev.site';
export const LOCAL_TARGETS = Object.freeze({
  fixtures: ['albertoybelen-fixture-local', '00000000-0000-0000-0000-000000000023', 8788, '.local/d1'],
  oauthMock: ['albertoybelen-oauth-local', '00000000-0000-0000-0000-000000000025', 8790, '.local/oauth-d1'],
  ownerPilot: ['albertoybelen-owner-pilot-local', '00000000-0000-0000-0000-000000000029', 8790, '.local/pilot-d1'],
});
