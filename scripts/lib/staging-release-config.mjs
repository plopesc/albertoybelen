import {isDeepStrictEqual} from 'node:util';
import {validateStagingConfig} from './staging-config.mjs';
import {loadInfrastructureConfig,validateInfrastructureConfig} from './infrastructure-config.mjs';
import {STAGING_OPERATOR_WORKER,STAGING_WORKER,STAGING_DATABASE,STAGING_DATABASE_ID} from './infrastructure-policy.mjs';

export function validateStagingRelease(oauth,operator,fixture,metadata=loadInfrastructureConfig()) {
  validateInfrastructureConfig(metadata);validateStagingConfig(fixture,metadata);
  const common={compatibility_date:'2026-11-01',compatibility_flags:['nodejs_compat'],preview_urls:false,send_metrics:false,observability:{enabled:false},triggers:{crons:[]}};
  const expectedOauth={...common,name:STAGING_WORKER,main:'backend/staging-release-entry.js',workers_dev:true,
    vars:{APP_ENV:'staging-strava-test',STAGING_AUTH_ENABLED:'disabled',STAGING_NETWORK_ENABLED:'disabled',STAGING_OPERATOR_ENABLED:'disabled',STAGING_CALLBACK_CONFIRMED:'disabled',STAGING_OPERATOR_INGRESS:'disabled',STAGING_ATHLETE_CAPACITY:'disabled'},
    d1_databases:[{binding:'DB',database_name:STAGING_DATABASE,database_id:STAGING_DATABASE_ID,migrations_dir:'backend/d1/migrations',remote:false}]};
  const expectedOperator={...common,name:STAGING_OPERATOR_WORKER,main:'backend/staging-operator-entry.js',workers_dev:false,
    vars:{APP_ENV:'staging-operator-private',STAGING_OPERATOR_ENABLED:'disabled'},
    services:[{binding:'STAGING_AUTH_TARGET',service:STAGING_WORKER,entrypoint:'StagingOperatorTarget'}]};
  if(!isDeepStrictEqual(oauth,expectedOauth)||!isDeepStrictEqual(operator,expectedOperator))throw Error('Closed staging OAuth/operator release mismatch; execution blocked');
}
export function stagingReleasePlan(oauth,operator,fixture,metadata=loadInfrastructureConfig()) {
  validateStagingRelease(oauth,operator,fixture,metadata);
  return {mode:'closed-staging-oauth',deploymentAllowed:false,apiWorker:oauth.name,database:{name:oauth.d1_databases[0].database_name,id:oauth.d1_databases[0].database_id,binding:'DB'},operatorWorker:operator.name,operatorPublic:false,callback:`${metadata.cloudflare.staging.apiOrigin}/oauth/callback`,changesFromFixture:['entry: backend/staging-release-entry.js','APP_ENV: staging-strava-test','auth/network/operator and readiness switches: disabled'],rollback:{configuration:'wrangler.staging.jsonc',entry:fixture.main,mode:'staging-fixtures'},blocked:['authorized-private-terminal-ingress','callback-domain-and-two-athlete-capacity','new-staging-secrets-and-signing-policy','authorized-backup-migration-0003-and-release'],remoteOperations:[]};
}
