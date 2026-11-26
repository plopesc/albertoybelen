import {STAGING_AUTH_ORIGIN} from './staging-auth-settings.js';
export const MVP_ENABLE='owner-authorized-single-worker-staging';
export const MVP_READY='owner-confirmed-0003-callback-capacity';
export const MVP_ADMIN_PATH='/admin/staging';
export const MVP_ORIGIN=STAGING_AUTH_ORIGIN;
export const MVP_AUTO_SYNC_CRON='0 */3 * * *';
export const MVP_ACTIONS=Object.freeze(['issue','status','sync','enable-sync','disable-sync','enable-auto-sync','disable-auto-sync','revoke-slot','erase-slot','slot-status']);
const slotRemovalFields = {
  'revoke-slot': 'type slot expectedAthleteId generation confirmation',
  'erase-slot': 'type slot expectedAthleteId generation confirmation purgeMilestones',
};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(' ')!==keys.split(' ').sort().join(' '))throw Error('invalid_command');};
export function validateMvpCommand(command,now=Date.now()) {
  exact(command,'version nonce issuedAt expiresAt operation');
  if(command.version!==1||!/^[\w-]{43}$/.test(command.nonce??'')||!Number.isSafeInteger(command.issuedAt)||!Number.isSafeInteger(command.expiresAt)||command.issuedAt>now+30000||command.issuedAt<now-120000||command.expiresAt<=now||command.expiresAt<=command.issuedAt||command.expiresAt-command.issuedAt>120000)throw Error('invalid_command');
  if (command.operation?.type === 'promote-challenge') {
    exact(command.operation,'type confirmation');
    if (command.operation.confirmation !== 'promote-official-2026-11-28') throw Error('invalid_command');
    return command;
  }
  const op=command.operation;if(!op||!MVP_ACTIONS.includes(op.type))throw Error('invalid_command');
  if (Object.hasOwn(slotRemovalFields, op.type)) {
    exact(op, slotRemovalFields[op.type]);
    if (!['slot-a','slot-b'].includes(op.slot) || !Number.isSafeInteger(op.expectedAthleteId) || op.expectedAthleteId <= 0 ||
        !Number.isSafeInteger(op.generation) || op.generation < 0 ||
        op.confirmation !== (op.type === 'erase-slot' ? 'verified-staging-deletion' : 'revoke-staging-consent') ||
        (op.type === 'erase-slot' && typeof op.purgeMilestones !== 'boolean')) throw Error('invalid_command');
    return command;
  }
  exact(op,op.type==='issue'?'type slot expectedAthleteId':['enable-sync','enable-auto-sync'].includes(op.type)?'type confirmation':'type');
  if(op.type==='issue'&&(!['slot-a','slot-b'].includes(op.slot)||!Number.isSafeInteger(op.expectedAthleteId)||op.expectedAthleteId<=0))throw Error('invalid_command');
  if(op.type==='enable-sync'&&op.confirmation!=='enable-staging-sync')throw Error('invalid_command');
  if(op.type==='enable-auto-sync'&&op.confirmation!=='enable-staging-auto-sync')throw Error('invalid_command');
  return command;
}
