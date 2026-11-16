import {stagingCallback} from './lib/staging-transition.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateStagingConfig} from './lib/staging-config.mjs';
import {loadInfrastructureConfig} from './lib/infrastructure-config.mjs';

/** Reviewable proposal only. No runnable remote command or arbitrary target override. */
export function stagingAuthPlan(fixture,metadata=loadInfrastructureConfig()) {
  validateStagingConfig(fixture,metadata);
  return {
    status:'design-only',deploymentAllowed:false,
    target:{...metadata.cloudflare.staging,appEnv:'staging-strava-test'},
    callback:stagingCallback(metadata).redirectUri,
    strategy:{application:'existing-single-app',realOAuth:'staging-exclusive',ddev:'parked',relay:false},
    dataset:metadata.local.stagingAuth,
    proposedConfig:{...fixture,main:'backend/staging-auth-entry.js',vars:{APP_ENV:'staging-strava-test',STAGING_AUTH_ENABLED:'disabled',STAGING_NETWORK_ENABLED:'disabled'}},
    requiredApprovals:['callback-domain-and-two-athlete-capacity','private-remote-operator-channel','new-staging-only-keys','additive-migration-0003','guarded-manual-release-and-rollback'],
  };
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==2)throw Error('Design only: no remote operations or arguments allowed');
  console.log(JSON.stringify(stagingAuthPlan(JSON.parse(readFileSync(new URL('../wrangler.staging.jsonc',import.meta.url),'utf8'))),null,2));
}
