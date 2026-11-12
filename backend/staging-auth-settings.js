// Independent runtime pins; Node tooling checks these against infrastructure metadata.
export const STAGING_AUTH_ORIGIN = 'https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev';
export const STAGING_AUTH_DATASET = 'staging-strava-test-v1';
export const STAGING_AUTH_SETTINGS = Object.freeze({goalKm:500, startDate:'2026-11-01', timeZone:'Europe/Madrid'});
export const STAGING_AUTH_ENABLE = 'owner-authorized-staging-test';
export const STAGING_NETWORK_ENABLE = 'owner-authorized-staging-network';
export const STAGING_AUTH_LIMITS = Object.freeze({perOperation:24, perQuarter:40, perDay:120, maxPages:5, maxRecords:400});
