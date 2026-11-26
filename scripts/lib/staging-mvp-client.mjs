import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {MVP_ADMIN_PATH,MVP_ORIGIN,validateMvpCommand} from '../../backend/staging-mvp-policy.js';
import {readMvpPrivate,mvpPrivateDirectory} from './staging-mvp-private.mjs';
import {validatePublicProgress} from '../../frontend/js/http-progress.js';
export function mvpCommand(operation,now=Date.now()) {
  return validateMvpCommand({version:1,nonce:randomBytes(32).toString('base64url'),issuedAt:now,expiresAt:now+120000,operation},now);
}
export async function callMvp({root,operation,fetchAdmin=globalThis.fetch}) {
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('Secure TLS required');
  const token=readMvpPrivate(root,'admin-token');if(!/^[\w-]{43}$/.test(token))throw Error('Invalid private credential');
  const command=mvpCommand(operation);
  const response=await fetchAdmin(MVP_ORIGIN+MVP_ADMIN_PATH,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(command)});
  if(response.status!==200||response.redirected||response.headers.get('Cache-Control')!=='no-store')throw Error('Admin unavailable');
  const reader=response.body?.getReader();if(!reader)throw Error('Admin unavailable');const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw Error('Admin unavailable');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(operation.type==='promote-challenge'&&result.status==='promoted')return{status:'promoted'};
  if(!['issued','ok','synced','stale','idle','busy','disabled','enabled','replay','failed','unavailable'].includes(result.status))throw Error('Admin unavailable');
  if(result.status==='issued') {
    if(operation.type!=='issue'||Object.keys(result).sort().join()!=='invitation,status')throw Error('Invalid response');
    const url=new URL(result.invitation);if(url.origin!==MVP_ORIGIN||url.pathname!=='/invite'||url.search||url.username||url.password||!/^#[\w-]{43}$/.test(url.hash))throw Error('Invalid response');
    const file=`invitation-${operation.slot}-${randomBytes(6).toString('hex')}.url`;
    writeFileSync(join(mvpPrivateDirectory(root),file),url.href+'\n',{flag:'wx',mode:0o600});
    return{status:'issued',file:`.local/staging-mvp/${file}`};
  }
  if(result.status==='ok'&&operation.type==='status'&&(typeof result.syncDisabled!=='boolean'||typeof result.autoSyncEnabled!=='boolean'||!(result.lastAutomaticSync===null||result.lastAutomaticSync&&Object.keys(result.lastAutomaticSync).sort().join()==='at,status'&&typeof result.lastAutomaticSync.at==='string'&&Number.isFinite(Date.parse(result.lastAutomaticSync.at))&&['synced','idle','busy','stale','disabled','failed'].includes(result.lastAutomaticSync.status))))throw Error('Invalid response');
  if(result.status==='ok'&&operation.type==='status')return{status:'ok',syncDisabled:result.syncDisabled,autoSyncEnabled:result.autoSyncEnabled,lastAutomaticSync:result.lastAutomaticSync,progress:validatePublicProgress({schemaVersion:1,source:'strava',...result.progress},{expectedSource:'strava'})};
  if(['enable-auto-sync','disable-auto-sync'].includes(operation.type)&&result.status===(operation.type==='enable-auto-sync'?'enabled':'disabled')&&result.autoSyncEnabled!==(operation.type==='enable-auto-sync'))throw Error('Invalid response');
  return{status:result.status};
}
