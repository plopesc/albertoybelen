import { isDeepStrictEqual } from 'node:util';

import {loadInfrastructureConfig, validateInfrastructureConfig} from './infrastructure-config.mjs';
import {STAGING_WORKER, STAGING_DATABASE, STAGING_DATABASE_ID} from './infrastructure-policy.mjs';
export {STAGING_WORKER, STAGING_DATABASE, STAGING_DATABASE_ID};
export function validateStagingConfig(config, infrastructure = loadInfrastructureConfig()) {
  validateInfrastructureConfig(infrastructure);
  const target = infrastructure.cloudflare.staging;
  const expected = {
    name:target.workerName, main:'backend/staging-entry.js', compatibility_date:'2026-11-01', compatibility_flags:['nodejs_compat'],
    workers_dev:true, preview_urls:false, send_metrics:false, observability:{enabled:false}, triggers:{crons:[]}, vars:{APP_ENV:target.appEnv},
    d1_databases:[{binding:target.binding,database_name:target.databaseName,database_id:target.databaseId,migrations_dir:'backend/d1/migrations',remote:false}],
  };
  if (!isDeepStrictEqual(config, expected)) throw new Error('Staging configuration mismatch; execution blocked');
}
export function stagingCommand(config, args, env = {}) {
  validateStagingConfig(config);
  const [operation, confirm] = args;
  if (['check','dry-run'].includes(operation)) {
    if (args.length !== 1) throw new Error('No additional arguments permitted');
    return operation === 'check' ? null : ['deploy','--dry-run','--outdir','dist'];
  }
  if (!['list','migrate','deploy'].includes(operation) || args.length !== 2 || confirm !== '--confirm-staging') throw new Error('Use check/dry-run or a manual staging operation with --confirm-staging; no overrides permitted');
  if (!/^[a-fA-F0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '')) throw new Error('Select and verify CLOUDFLARE_ACCOUNT_ID manually before a remote operation');
  return operation === 'deploy' ? ['deploy'] : ['d1','migrations',operation === 'list' ? 'list' : 'apply','DB','--remote'];
}
export function stagingEnvironment(original, remote, logPath = 'staging.log') {
  const env = {...original,CLOUDFLARE_SEND_METRICS:'false',WRANGLER_LOG_PATH:logPath};
  const cloudflareAllowed = new Set(['CLOUDFLARE_SEND_METRICS','WRANGLER_LOG_PATH',...(remote ? ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'] : [])]);
  for (const key of Object.keys(env)) {
    if (/^(STRAVA_|PILOT_|OAUTH_|ALLOW_REAL_|TOKEN_ENCRYPTION_|TOKEN_PREVIOUS_)/.test(key) || (/^(CLOUDFLARE_|WRANGLER_)/.test(key) && !cloudflareAllowed.has(key))) delete env[key];
  }
  return env;
}
