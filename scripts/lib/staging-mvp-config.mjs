import {isDeepStrictEqual} from 'node:util';
import {loadInfrastructureConfig} from './infrastructure-config.mjs';
import {validateStagingConfig} from './staging-config.mjs';
import {STAGING_WORKER,STAGING_DATABASE,STAGING_DATABASE_ID,STAGING_ORIGIN} from './infrastructure-policy.mjs';
import {MVP_ENABLE,MVP_READY,MVP_ORIGIN} from '../../backend/staging-mvp-policy.js';
import {STAGING_AUTH_ENABLE,STAGING_NETWORK_ENABLE} from '../../backend/staging-auth-settings.js';
export function mvpConfiguration({enabled=false}={}) {
  return {name:STAGING_WORKER,main:'backend/staging-mvp-entry.js',compatibility_date:'2026-11-01',compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,send_metrics:false,observability:{enabled:false},triggers:{crons:[]},
    vars:{APP_ENV:'staging-strava-test',STAGING_AUTH_ENABLED:enabled?STAGING_AUTH_ENABLE:'disabled',STAGING_NETWORK_ENABLED:enabled?STAGING_NETWORK_ENABLE:'disabled',STAGING_MVP_ENABLED:enabled?MVP_ENABLE:'disabled',STAGING_MVP_READY:enabled?MVP_READY:'disabled'},
    d1_databases:[{binding:'DB',database_name:STAGING_DATABASE,database_id:STAGING_DATABASE_ID,migrations_dir:'backend/d1/migrations',remote:false}]};
}
export function validateMvpConfiguration(config,fixture,metadata=loadInfrastructureConfig()) {
  validateStagingConfig(fixture,metadata);
  if(!isDeepStrictEqual(config,mvpConfiguration())||MVP_ORIGIN!==STAGING_ORIGIN||metadata.cloudflare.staging.apiOrigin!==MVP_ORIGIN)throw Error('Staging MVP configuration rejected');
}
