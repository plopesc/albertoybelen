import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {validateStagingRelease,stagingReleasePlan} from './lib/staging-release-config.mjs';
const [operation]=process.argv.slice(2);
try {
  if(process.argv.length!==3||!['check','plan','dry-run'].includes(operation))throw Error('No remote commands or overrides');
  const read=name=>JSON.parse(readFileSync(new URL(`../${name}`,import.meta.url),'utf8'));
  const oauth=read('wrangler.staging-oauth.jsonc'),operator=read('wrangler.staging-operator.jsonc'),fixture=read('wrangler.staging.jsonc');
  validateStagingRelease(oauth,operator,fixture);
  if(operation==='plan')console.log(JSON.stringify(stagingReleasePlan(oauth,operator,fixture),null,2));
  else if(operation==='dry-run') {
    for(const config of [oauth,operator]) {
      // In-memory esbuild only: no Wrangler, automatic env discovery, subprocess or network.
      const result=await build({absWorkingDir:new URL('../',import.meta.url).pathname,entryPoints:[config.main],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:workers'],metafile:true,logLevel:'silent'});
      if(Object.keys(result.metafile.inputs).some(path=>/(^|\/)\.local\/|(^|\/)\.dev\.vars|(^|\/)\.env/.test(path)))throw Error('Private input forbidden');
      console.log(`${config.name}: local bundle ${result.outputFiles[0].contents.length} bytes; closed; no deployment.`);
    }
  } else console.log('Closed OAuth release, private operator and fixture rollback agree with independent target pins. No remote operation available.');
} catch {console.error('Staging OAuth preparation blocked: inspect fixed configs, independent allowlist and closed-mode defaults. Only check/plan/dry-run without overrides are allowed.');process.exitCode=1;}
