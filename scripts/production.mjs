import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {privateDirectory,privateFile} from './lib/staging-private-files.mjs';
import {startInstant} from '../frontend/js/challenge-time.js';
import {validateGameConfig} from '../frontend/js/config.js';
import {PAGES_PRODUCTION_PROGRESS_URL,validatePublicProgress} from '../frontend/js/http-progress.js';
import {PRODUCTION_TARGET,PRODUCTION_WORKER,PRODUCTION_DATABASE,PRODUCTION_DATASET,PRODUCTION_SETTINGS,PRODUCTION_CRON,PRODUCTION_ADMIN_PATH,requireProductionTarget} from '../backend/production-target.js';
import {validateProductionCommand} from '../backend/production-command.js';

const root=fileURLToPath(new URL('../',import.meta.url)), [command,...args]=process.argv.slice(2);
const entry='backend/production-entry.js';
const configPath='wrangler.production.generated.json';
function verified() {
  const target=requireProductionTarget();
  const page=validateGameConfig(JSON.parse(readFileSync(join(root,'frontend/config/pages-live.json'),'utf8')));
  if(PAGES_PRODUCTION_PROGRESS_URL!==target.origin+'/api/progress'||page.api?.url!==PAGES_PRODUCTION_PROGRESS_URL||page.api.allowFixtures!==false) throw Error('pages_origin_mismatch');
  if(page.game.mode!=='real'||page.game.presentation!=='live'||page.game.id!=='alberto-belen-reto-2026'||
      Object.entries(PRODUCTION_SETTINGS).some(([key,value])=>page.game[key]!==value)) throw Error('pages_challenge_mismatch');
  return target;
}

try {
  if(command==='dry-run' && !args.length) {
    await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*'],logLevel:'silent'});
    console.log('Production Worker bundled locally.');
  } else if(command==='check' && !args.length) {
    verified();
    console.log('Production pins and Pages endpoint agree.');
  } else if(command==='pages-check' && !args.length) {
    verified();
    if(Date.now()<startInstant(PRODUCTION_SETTINGS.startDate,PRODUCTION_SETTINGS.timeZone)) throw Error('premature_release');
    console.log('Production Pages gate passed.');
  } else if(command==='render' && (args.length===0 || args.length===1&&args[0]==='--enable-oauth')) {
    const target=verified();
    const config={
      name:PRODUCTION_WORKER,main:entry,compatibility_date:'2026-11-01',compatibility_flags:['nodejs_compat'],
      workers_dev:target.routing==='workers.dev',preview_urls:false,
      ...(target.routing==='custom-domain'?{routes:[{pattern:new URL(target.origin).hostname,custom_domain:true}]}:{}),
      d1_databases:[{binding:'DB',database_name:PRODUCTION_DATABASE,database_id:target.databaseId,migrations_dir:'backend/d1/production-migrations'}],
      vars:{APP_ENV:PRODUCTION_DATASET,PRODUCTION_OAUTH:args.length?'owner-enabled':'disabled',TOKEN_ENCRYPTION_KEY_VERSION:'v1'},
      triggers:{crons:[PRODUCTION_CRON]},
      observability:{enabled:false},
    };
    writeFileSync(join(root,configPath),JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(configPath);
  } else if(command==='admin' && args.length===2 && args[1]==='--confirm-production-admin') {
    const target=verified();
    if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0') throw Error('insecure_tls');
    const directory=privateDirectory(root,['.local','production']);
    const read=name=>privateFile(join(directory,name),4096).toString().trim();
    const token=read('admin-token');
    if (!/^[\w-]{43}$/.test(token)) throw Error('invalid_admin_token');
    const type=args[0]==='invite'?'issue':args[0];
    const operation=type==='issue'?{...JSON.parse(read('invitation-request.json')),type}
      : ['enable-sync','enable-auto-sync'].includes(type)?{type,confirmation:type.replace('enable-','enable-production-')}:{type};
    const now=Date.now(),body={version:1,audience:PRODUCTION_DATASET,issuedAt:now,expiresAt:now+120000,nonce:randomBytes(32).toString('base64url'),operation};
    validateProductionCommand(body,now);
    const response=await fetch(target.origin+PRODUCTION_ADMIN_PATH,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(120000)});
    if(!response.ok || response.headers.get('Cache-Control')!=='no-store') throw Error('admin_unavailable');
    if(!response.body) throw Error('admin_unavailable');
    const chunks=[];
    let bytes=0;
    for await (const chunk of response.body) {
      bytes+=chunk.byteLength;
      if(bytes>16384) throw Error('invalid_response');
      chunks.push(chunk);
    }
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(type==='issue' && result.status==='issued') {
      const url=new URL(result.invitation);
      if(url.origin!==target.origin||url.username||url.password||url.pathname!=='/invite'||url.search||!/^#[\w-]{43}$/.test(url.hash)) throw Error('invalid_invitation');
      const name=`invitation-${randomBytes(8).toString('hex')}.url`;
      writeFileSync(join(directory,name),url.href+'\n',{mode:0o600,flag:'wx'});
      console.log(`Invitation saved privately in .local/production/${name}`);
    } else if (type==='status' && result.status==='ok') {
      const {progress,syncDisabled,autoSyncEnabled}=result;
      if(typeof syncDisabled!=='boolean'||typeof autoSyncEnabled!=='boolean') throw Error('invalid_response');
      console.log(JSON.stringify({syncDisabled,autoSyncEnabled,progress:validatePublicProgress({...progress,schemaVersion:1,source:'strava'},{expectedSource:'strava'})},null,2));
    } else if (type==='slot-status' && result.status==='ok') {
      const slots=result.slots;
      if(!Array.isArray(slots)||slots.length!==2||new Set(slots.map(s=>s.id)).size!==2||slots.some(s=>!['slot-a','slot-b'].includes(s.id)||!['disconnected','connected','revoked','deleted'].includes(s.status)||!Number.isSafeInteger(s.generation)||s.generation<0)) throw Error('invalid_response');
      console.log(JSON.stringify(slots.map(({id,status,generation})=>({id,status,generation}))));
    } else if (['enabled','disabled','synced','idle','stale'].includes(result.status)) {
      console.log(result.status);
      if(result.status==='stale') process.exitCode=1;
    } else throw Error('operation_failed');
  } else throw Error('invalid_command');
} catch {
  console.error('Production blocked. Check the verified pins, explicit operation, private inputs and Worker state.');
  process.exitCode=1;
}
