import {writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {OPERATOR_AUDIENCE,OPERATOR_TARGET} from '../../backend/staging-operator-policy.js';
import {newSecret} from '../../auth/invitation-machine.js';
/** Signing is offline. The private key remains in trusted terminal memory. No HTTP client. */
export async function signOperatorCommand({privateKey,keyId,subject,operation,now=Date.now(),nonce=newSecret()}) {
  const command={audience:OPERATOR_AUDIENCE,target:OPERATOR_TARGET.worker,dataset:OPERATOR_TARGET.dataset,subject,issuedAt:now,expiresAt:now+120000,nonce,operation};
  const payload=Buffer.from(JSON.stringify(command)).toString('base64url');
  const signature=Buffer.from(await crypto.subtle.sign('Ed25519',privateKey,new TextEncoder().encode(JSON.stringify([1,keyId,payload])))).toString('base64url');
  return {version:1,keyId,payload,signature};
}
/** A private response is delivered to a new 0600 file only, never stdout/artifacts. */
export function savePrivateOperatorResponse(directory,response) {
  const path=resolve(directory),parent=lstatSync(path);
  if(!path.endsWith(`${sep}.local${sep}staging-operator`)||!parent.isDirectory()||parent.isSymbolicLink()||realpathSync(path)!==path||(parent.mode&0o077))throw Error('Private gitignored operator output directory required');
  writeFileSync(join(path,'response.json'),JSON.stringify(response)+'\n',{flag:'wx',mode:0o600});
}
