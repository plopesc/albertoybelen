import {loadInfrastructureConfig,validateInfrastructureConfig} from './infrastructure-config.mjs';
import {validateStagingRelease} from './staging-release-config.mjs';
import {OPERATOR_READINESS} from '../../backend/staging-operator-policy.js';

export function stagingCallback(metadata=loadInfrastructureConfig()) {
  validateInfrastructureConfig(metadata);
  const redirectUri=`${metadata.cloudflare.staging.apiOrigin}/oauth/callback`;
  if(redirectUri!==OPERATOR_READINESS.STAGING_CALLBACK_CONFIRMED)throw Error('Staging callback disagrees with independent runtime guard');
  return {panelDomain:new URL(redirectUri).hostname,redirectUri};
}
/** Exact panel value and URI only. This validates strings, never provider acceptance. */
export function validateStagingCallback(panelDomain,redirectUri,metadata=loadInfrastructureConfig()) {
  const expected=stagingCallback(metadata);
  if(panelDomain!==expected.panelDomain||redirectUri!==expected.redirectUri)throw Error('Exact staging callback required; no DDEV, relay, scheme/path in panel or URI overrides');
}
export function stagingTransitionPreflight(oauth,operator,fixture,metadata=loadInfrastructureConfig()) {
  validateStagingRelease(oauth,operator,fixture,metadata);
  const callback=stagingCallback(metadata);
  return {
    scope:'local-read-only',remoteChecked:false,transitionExecuted:false,activationAllowed:false,
    architecture:{application:'existing-single-Strava-app',activeRealOAuthTarget:'staging-only-after-approval',simultaneousOAuth:false,relay:false,additionalApplication:false},
    callback:{...callback,providerAcceptance:'unverified',currentPanelDomain:{value:new URL(metadata.local.ddev.origin).hostname,source:'owner-report-issue-44',verified:false}},
    ddev:{policy:'parked',processState:'not-inspected',dataAndCredentials:'preserve-without-reading',resumeRequires:'separate-approval-and-manual-callback-switch'},
    target:{worker:metadata.cloudflare.staging.workerName,database:metadata.cloudflare.staging.databaseName,databaseId:metadata.cloudflare.staging.databaseId,binding:metadata.cloudflare.staging.binding},
    release:{state:'closed',authEnabled:false,networkEnabled:false,operatorEnabled:false,cronEnabled:false,deployAllowed:false},
    provider:{athleteCapacity:'unverified',minimumParticipants:2,countExistingAuthorizations:true,quotas:'unverified-and-shared-by-app'},
    reportedRemote:{source:'owner-report-issue-44-not-live-observation',mode:'fixtures',migration0003:'pending',stagingSecrets:'pending'},
    operatorIngress:'blocked-not-implemented',
    secrets:{state:'pending-no-values-read',appCredentials:'same-existing-app-entered-manually-after-approval',vaultAndSigningKeys:'new-staging-only-keys-no-DDEV-copy'},
    approvals:['verify-capacity-existing-authorizations-and-quotas','verify-exact-staging-hostname-accepted-without-saving','prepare-private-terminal-ingress-and-guarded-active-release','authorize-private-backup-migration-0003-and-staging-secrets','authorize-callback-switch-window','authorize-test-account-then-two-participant-consents'],
    rollback:{callbackPanelDomain:new URL(metadata.local.ddev.origin).hostname,callbackChange:'manual-separate-approval',fixtureConfiguration:'wrangler.staging.jsonc',tokensAndD1:'do-not-copy-delete-revoke-or-restore'},
    warnings:['Local checks do not verify Strava acceptance, athlete capacity, callback setting or remote state.','Changing the callback is not a token/data migration and does not guarantee staging authorization.'],
  };
}
