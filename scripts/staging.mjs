import {atStage,diagnosticCode} from './lib/staging-diagnostics.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {stagingCommand,STAGING_WORKER,STAGING_DATABASE,STAGING_DATABASE_ID} from './lib/staging-config.mjs';
import {createStagingRunner} from './lib/staging-runner.mjs';
import {runStagingD1} from './lib/staging-d1.mjs';
import {BACKUP_ID} from './lib/staging-d1-policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const config=atStage('TARGET_CONFIG',()=>JSON.parse(readFileSync(`${root}wrangler.staging.jsonc`,'utf8')));
  const runWrangler=createStagingRunner(root,config,process.env),argv=process.argv.slice(2);
  if(['d1-check','d1-plan','backup','inspect-backup','list','migrate'].includes(argv[0])) {
    console.log(JSON.stringify(runStagingD1({root,config,argv,env:process.env,runWrangler}),null,2));
  } else {
    const args=stagingCommand(config,argv,process.env);
    console.log(`Staging target: ${STAGING_WORKER}; DB=${STAGING_DATABASE}; ID=${STAGING_DATABASE_ID}; binding=DB; Cron=none.`);
    if(args)runWrangler(args);
  }
} catch(error) {
  console.error(`Staging diagnostic: ${diagnosticCode(error)}`);
  console.error('Staging operation blocked or failed. Verify fixed target/account, pinned migrations, private backup evidence and explicit confirmation. No fallback, restore, deploy or retry is performed automatically.');
  if(BACKUP_ID.test(error.backupId??''))console.error(`Incomplete private backup ID: ${error.backupId}`);
  process.exitCode=1;
}
