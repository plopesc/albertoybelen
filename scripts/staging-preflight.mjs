import {readFileSync} from 'node:fs';
import {stagingTransitionPreflight} from './lib/staging-transition.mjs';
try {
  if(process.argv.length!==2)throw Error('No arguments or overrides');
  const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
  console.log(JSON.stringify(stagingTransitionPreflight(read('wrangler.staging-oauth.jsonc'),read('wrangler.staging-operator.jsonc'),read('wrangler.staging.jsonc')),null,2));
} catch {console.error('Local staging preflight blocked: check the fixed metadata, independent guards and closed releases. No remote checks, activation or overrides supported.');process.exitCode=1;}
