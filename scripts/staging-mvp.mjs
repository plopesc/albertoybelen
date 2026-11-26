import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {validateMvpConfiguration,mvpConfiguration} from './lib/staging-mvp-config.mjs';
import {runMvpWrangler} from './lib/staging-mvp-runner.mjs';
import {prepareMvpPrivate,readMvpPrivate,rotateMvpAdmin} from './lib/staging-mvp-private.mjs';
import {callMvp} from './lib/staging-mvp-client.mjs';
import {requireStagingAccount} from './lib/staging-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),argv=process.argv.slice(2),[operation,flag]=argv;
try {
  const read=name=>JSON.parse(readFileSync(new URL(`../${name}`,import.meta.url),'utf8'));
  const config=read('wrangler.staging-mvp.jsonc'),fixture=read('wrangler.staging.jsonc');validateMvpConfiguration(config,fixture);
  if(['check','plan','dry-run','prepare'].includes(operation)&&argv.length===1) {
    if(operation==='prepare'){prepareMvpPrivate(root);console.log('Private templates and new AES/admin keys prepared locally. No remote request.');}
    else if(operation==='dry-run') {
      const result=await build({absWorkingDir:root,entryPoints:[config.main],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*'],metafile:true,logLevel:'silent'});
      if(Object.keys(result.metafile.inputs).some(p=>/(^|\/)\.local\/|(^|\/)\.dev\.vars|(^|\/)\.env/.test(p)))throw Error();
      console.log('Single Worker bundled locally. No Wrangler, secrets, network or deployment.');
    } else console.log(JSON.stringify({status:'ready-locally',target:config.name,database:config.d1_databases[0].database_name,closedConfiguration:config.vars,releaseNeedsConfirmation:true,requiresExistingMigration:'0003_staging_auth_test.sql',secrets:['STRAVA_CLIENT_ID','STRAVA_CLIENT_SECRET','TOKEN_ENCRYPTION_KEY','TOKEN_ENCRYPTION_KEY_VERSION','STAGING_ADMIN_TOKEN'],operatorWorker:false,cron:{schedule:config.triggers.crons[0],utc:true,automaticSyncDefault:false}},null,2));
  } else if(operation==='rotate-admin'&&argv.length===2&&flag==='--confirm-local-key-rotation'){rotateMvpAdmin(root);console.log('New local admin credential prepared. Update the Worker Secret manually; AES unchanged.');}
  else if(['deploy','secret','secret-delete'].includes(operation))console.log(JSON.stringify(runMvpWrangler({root,config,fixture,env:process.env,argv})));
  else if (['revoke-slot','erase-slot'].includes(operation) && argv.length === 3 &&
      flag === '--confirm-staging-admin' &&
      argv[2] === (operation === 'erase-slot' ? '--confirm-verified-deletion' : '--confirm-revocation')) {
    requireStagingAccount(process.env);
    const input = JSON.parse(readMvpPrivate(root,'slot-removal.json'));
    const confirmation = operation === 'erase-slot' ? 'verified-staging-deletion' : 'revoke-staging-consent';
    const result = await callMvp({root,operation:{...input,type:operation,confirmation}});
    if (result.status !== (operation === 'erase-slot' ? 'erased' : 'revoked')) throw Error();
    console.log(JSON.stringify(result));
  }
  else if(['invite','status','slot-status','sync','enable-sync','disable-sync','enable-auto-sync','disable-auto-sync'].includes(operation)&&flag==='--confirm-staging-admin'&&((operation==='enable-auto-sync'&&argv.length===3&&argv[2]==='--confirm-staging-auto-sync')||(operation!=='enable-auto-sync'&&argv.length===2))) {
    requireStagingAccount(process.env);
    const op=operation==='invite'?JSON.parse(readMvpPrivate(root,'invitation-request.json')):['enable-sync','enable-auto-sync'].includes(operation)?{type:operation,confirmation:operation==='enable-sync'?'enable-staging-sync':'enable-staging-auto-sync'}:{type:operation};
    if(operation==='invite'&&op.type!=='issue')throw Error();
    console.log(JSON.stringify(await callMvp({root,operation:op}),null,2));
  } else throw Error();
} catch {console.error('Staging MVP blocked or failed. Check fixed configuration, explicit confirmation, private files, migration and secrets; private diagnostics suppressed. No automatic retry, migration or fallback.');process.exitCode=1;}
