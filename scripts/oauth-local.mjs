import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {hashSecret,newSecret} from '../auth/invitation-machine.js';
import {openLocalOAuth} from './lib/local-oauth-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const operation=process.argv[2];
if(process.argv.length!==3||!['init-mock','migrate','dev','admin'].includes(operation))throw new Error('Only init-mock/migrate/dev/admin without extra arguments');
if(operation==='init-mock') {
 if(existsSync('.dev.vars'))throw new Error('Refusing to replace existing private configuration');
 writeFileSync('.dev.vars',`OAUTH_MODE=mock\nTOKEN_ENCRYPTION_KEY_VERSION=v1\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`,{mode:0o600});
 console.log('Mock configuration created privately; key not printed.');
} else if(operation==='dev'||operation==='migrate') {
 const args=operation==='dev'?['dev','--local','--local-protocol','https','--log-level','error']:['d1','migrations','apply','DB','--local'];
 const env={...process.env,CLOUDFLARE_SEND_METRICS:'false',WRANGLER_LOG_PATH:'.local/oauth-wrangler.log'};
 for(const name of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL','CLOUDFLARE_ACCOUNT_ID'])delete env[name];
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args,'--config','wrangler.oauth.local.jsonc','--persist-to','.local/oauth-d1'],{cwd:root,stdio:'inherit',env});process.exit(result.status??1);
} else {
 let mf;
 try {
  const request=JSON.parse(readFileSync(0,'utf8'));
  mf=await openLocalOAuth();
  const {repository,service,vault}=mf;
  if(request.action==='issue') {
   await vault.ready();
   if(!['slot-a','slot-b'].includes(request.slot)||!Number.isSafeInteger(request.expectedAthleteId)||request.expectedAthleteId<=0)throw Error();
   const token=newSecret();const now=Date.now();
   const result=await repository.transitionAuth({type:'issue',actor:{authenticated:true,role:'owner'},now,slot:request.slot,expectedAccountHash:hashSecret(String(request.expectedAthleteId)),tokenHash:hashSecret(token),expiresAt:now+3600000});
   if(!result.ok)throw Error();
   mkdirSync('.local/private-invitations',{recursive:true,mode:0o700});chmodSync('.local/private-invitations',0o700);
   writeFileSync(`.local/private-invitations/${request.slot}.url`,`https://albertoybelen.ddev.site/invite#${token}\n`,{mode:0o600});chmodSync(`.local/private-invitations/${request.slot}.url`,0o600);
   console.log('Private invitation saved under .local/private-invitations (not printed).');
  } else if(['revoke','delete'].includes(request.action)) {
   if(request.action==='delete'&&request.confirm!=='verified-deletion')throw Error();
   const result=await repository.transitionAuth({type:request.action,slot:request.slot,now:Date.now(),actor:{authenticated:true,role:'owner'},requestVerified:request.action==='delete',purgeMilestones:request.purgeMilestones===true});if(!result.ok)throw Error();console.log('Local lifecycle operation applied.');
  } else if(request.action==='refresh') {await service.credentials(request.slot);console.log('Credentials available privately; no token printed.');}
  else if(request.action==='rotate') {await service.rotate(request.slot);console.log('Ciphertext re-encrypted; no key or token printed.');}
  else throw Error();
 } catch {console.error('Local administrative operation failed; no secrets printed.');process.exitCode=1;}
 finally {await mf?.close();}
}
