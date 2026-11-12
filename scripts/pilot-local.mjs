import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {pilotRoot,privateDirectory,pilotConfig,pilotVariables,openPilotLocal} from './lib/pilot-local-runtime.mjs';
import {assertDdevProject,assertPortsFree} from './lib/ddev-preflight.mjs';
const [operation,flag]=process.argv.slice(2);
const networkOperations=['dev','issue','sync','refresh'];
if(!['prepare','migrate','check','dev','issue','sync','status','refresh','revoke','erase','rotate'].includes(operation)||process.argv.length>4||(flag!==undefined&&flag!=='--authorize-owner-pilot')||(networkOperations.includes(operation)&&flag!=='--authorize-owner-pilot')||(!networkOperations.includes(operation)&&flag!==undefined))throw Error('Local pilot command rejected; network-capable commands require explicit --authorize-owner-pilot after human authorization');
let runtime;
try {
 if(networkOperations.includes(operation))assertDdevProject();
 const config=pilotConfig();
 if(operation==='prepare') {
  if(existsSync(`${privateDirectory}/.dev.vars`))throw Error();
  mkdirSync(privateDirectory,{recursive:true,mode:0o700});chmodSync(privateDirectory,0o700);
  writeFileSync(`${privateDirectory}/.dev.vars`,`STRAVA_CLIENT_ID=\nSTRAVA_CLIENT_SECRET=\nPILOT_OWNER_ATHLETE_ID=\nTOKEN_ENCRYPTION_KEY_VERSION=v1\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`,{mode:0o600});
  console.log('Isolated private template/key prepared. Pilot remains disabled; no requests sent.');
 } else if(['dev','migrate'].includes(operation)) {
  if(operation==='dev'){await assertPortsFree([8790]);runtime=await openPilotLocal({authorized:true});await runtime.ready();await runtime.close();runtime=undefined;}
  mkdirSync(privateDirectory,{recursive:true,mode:0o700});
  // Private config directory isolates Wrangler's automatic .dev.vars discovery from mocks.
  const generated={...config,main:`${pilotRoot}${config.main}`,d1_databases:config.d1_databases.map(db=>({...db,migrations_dir:`${pilotRoot}${db.migrations_dir}`}))};
  writeFileSync(`${privateDirectory}/wrangler.json`,JSON.stringify(generated),{mode:0o600});
  const args=operation==='dev'?['dev','--local','--local-protocol','https','--log-level','error','--var','PILOT_ENABLED:owner-authorized-local-pilot']:['d1','migrations','apply','DB','--local'];
  const env={...process.env,CLOUDFLARE_SEND_METRICS:'false',WRANGLER_LOG_PATH:'/dev/null'};
  for(const key of Object.keys(env))if(key.startsWith('CLOUDFLARE_')&&key!=='CLOUDFLARE_SEND_METRICS')delete env[key];
  console.log(operation==='dev'?'Starting authorized local pilot; output suppressed to protect private configuration.':'Applying migrations to the isolated local pilot binding.');
  const result=spawnSync(process.execPath,[`${pilotRoot}node_modules/wrangler/bin/wrangler.js`,...args,'--config',`${privateDirectory}/wrangler.json`,'--persist-to',`${pilotRoot}.local/pilot-d1`],{cwd:privateDirectory,stdio:'ignore',env});process.exitCode=result.status??1;
  if(result.status!==0)console.error('Local Wrangler operation failed; output suppressed. Review local configuration without sharing secrets.');
 } else {
  runtime=await openPilotLocal({authorized:networkOperations.includes(operation)});
  if(operation==='check'){await runtime.validate();console.log('Local configuration ready; activation remains disabled and no request sent.');}
  if(operation==='issue'){
   const link=await runtime.issue();mkdirSync(privateDirectory,{recursive:true,mode:0o700});writeFileSync(`${privateDirectory}/invitation.url`,link+'\n',{mode:0o600});chmodSync(`${privateDirectory}/invitation.url`,0o600);console.log('Owner-only invitation saved privately; no URL printed or opened.');
  }
  if(operation==='sync')console.log(JSON.stringify(await runtime.sync()));
  if(operation==='refresh'){await runtime.refresh();console.log('Credentials checked/refreshed privately; nothing printed.');}
  if(operation==='rotate'){await runtime.vault.ready();await runtime.service.rotate('slot-a');console.log('Vault ciphertext rotated privately.');}
  if(operation==='revoke'){await runtime.revoke();console.log('Local consent revoked; credentials removed. Provider-side deauthorization is manual.');}
  if(operation==='erase'){
   const request=JSON.parse(readFileSync(0,'utf8'));if(request.confirm!=='erase-owner-pilot')throw Error();
   await runtime.erase();if(existsSync(`${privateDirectory}/invitation.url`))unlinkSync(`${privateDirectory}/invitation.url`);console.log('Local pilot data cleared; anonymous quota counters retained to prevent budget bypass.');
  }
  if(['status','sync'].includes(operation))console.log(JSON.stringify(await runtime.status()));
 }
} catch {console.error('Local pilot operation failed; private details omitted.');process.exitCode=1;}
finally{await runtime?.close();}
