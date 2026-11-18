import {STAGING_AUTH_ORIGIN} from './staging-auth-settings.js';
export const MVP_ENABLE='owner-authorized-single-worker-staging';
export const MVP_READY='owner-confirmed-0003-callback-capacity';
export const MVP_ADMIN_PATH='/admin/staging';
export const MVP_ORIGIN=STAGING_AUTH_ORIGIN;
export const MVP_ACTIONS=Object.freeze(['issue','status','sync','enable-sync','disable-sync']);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('invalid_command');};
export function validateMvpCommand(command,now=Date.now()) {
  exact(command,'version nonce issuedAt expiresAt operation');
  if(command.version!==1||!/^[\w-]{43}$/.test(command.nonce??'')||!Number.isSafeInteger(command.issuedAt)||!Number.isSafeInteger(command.expiresAt)||command.issuedAt>now+30000||command.issuedAt<now-120000||command.expiresAt<=now||command.expiresAt<=command.issuedAt||command.expiresAt-command.issuedAt>120000)throw Error('invalid_command');
  const op=command.operation;if(!op||!MVP_ACTIONS.includes(op.type))throw Error('invalid_command');
  exact(op,op.type==='issue'?'type slot expectedAthleteId':op.type==='enable-sync'?'type confirmation':'type');
  if(op.type==='issue'&&(!['slot-a','slot-b'].includes(op.slot)||!Number.isSafeInteger(op.expectedAthleteId)||op.expectedAthleteId<=0))throw Error('invalid_command');
  if(op.type==='enable-sync'&&op.confirmation!=='enable-staging-sync')throw Error('invalid_command');
  return command;
}
