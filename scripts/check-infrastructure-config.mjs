import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadInfrastructureConfig, validateLocalTarget} from './lib/infrastructure-config.mjs';
import {validateStagingConfig} from './lib/staging-config.mjs';
import {STAGING_AUTH_ORIGIN,STAGING_AUTH_SETTINGS,STAGING_AUTH_DATASET} from '../backend/staging-auth-settings.js';
import {PILOT_ORIGIN, PILOT_SETTINGS} from '../backend/pilot.js';

export function checkInfrastructureFiles(root = new URL('../', import.meta.url)) {
  const read = path => readFileSync(new URL(path, root), 'utf8');
  const config = loadInfrastructureConfig(new URL('config.json', root));
  const assert = (condition, label) => {if(!condition) throw Error(`Infrastructure consistency mismatch: ${label}`);};
  validateStagingConfig(JSON.parse(read('wrangler.staging.jsonc')), config);
  for (const [name, file] of Object.entries({stagingAuth:'wrangler.staging-auth.local.jsonc',fixtures:'wrangler.local.jsonc', oauthMock:'wrangler.oauth.local.jsonc', ownerPilot:'wrangler.pilot.local.jsonc'})) {
    validateLocalTarget(JSON.parse(read(file)), name, config);
  }
  const {ddev, profiles} = config.local;
  assert(STAGING_AUTH_ORIGIN===config.cloudflare.staging.apiOrigin && STAGING_AUTH_DATASET===config.local.stagingAuth.datasetId && isDeepStrictEqual({...STAGING_AUTH_SETTINGS,datasetId:STAGING_AUTH_DATASET,authEnabled:false,networkEnabled:false},config.local.stagingAuth),'independent staging auth pins');
  assert(/^name:\s*([^\n#]+)/m.exec(read('.ddev/config.yaml'))?.[1].trim() === ddev.projectName, 'DDEV project name');
  for (const [file, port, protocol] of [
    ['.ddev/nginx/oauth-local.conf', ddev.oauthMock.port, 'https'],
    ['.ddev/nginx/frontend-local.conf.example', ddev.frontend.port, 'http'],
    ['.ddev/nginx/staging-read-local.conf.example', ddev.stagingRead.port, 'http'],
  ]) {
    const text = read(file);
    const hosts = [...text.matchAll(/(?:\$host != |proxy_set_header Host )([^; )]+)/g)].map(match => match[1]);
    const upstreams = [...text.matchAll(/proxy_pass ([^;]+);/g)].map(match => match[1]);
    assert(hosts.length > 0 && hosts.every(host => host === new URL(ddev.origin).hostname), `${file} host`);
    assert(upstreams.length > 0 && upstreams.every(url => url === `${protocol}://${ddev.host}:${port}` + (file.includes('staging-read') ? config.public.progressPath : '')), `${file} upstream`);
  }
  assert(read('.ddev/nginx/staging-read-local.conf.example').includes(`location = ${ddev.stagingRead.path} {`), 'staging nginx route');
  assert(PILOT_ORIGIN === ddev.origin, 'independent pilot origin');
  const {goalKm,startDate,timeZone} = profiles.ownerPilot;
  assert(isDeepStrictEqual(PILOT_SETTINGS, {goalKm,startDate,timeZone}), 'independent pilot settings');
  // These browser pins must stay independent of Node infrastructure metadata.
  const runtime = read('frontend/js/runtime-config.js');
  assert(runtime.includes(`page.origin !== '${ddev.origin}'`) && runtime.includes(`config.game.id !== '${profiles.staging.id}'`) && runtime.includes(`config.api?.url !== '${ddev.stagingRead.path}'`), 'independent browser staging guards');
  assert(profiles.fixtures.id === 'local-ddev-api-fixtures' && profiles.ownerPilot.id === 'local-ddev-owner-pilot', 'existing dataset identities');
  assert(read('.github/workflows/pages.yml').includes('path: frontend/'), 'Pages packages only frontend');
  return config;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if(process.argv.length !== 2) throw Error('No arguments or overrides permitted');
  checkInfrastructureFiles();
  console.log('Infrastructure metadata, Wrangler, DDEV and independent runtime guards agree. No requests sent.');
}
