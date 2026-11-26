import {validateMvpCommand} from './staging-mvp-policy.js';
import {PRODUCTION_DATASET} from './production-target.js';

export function validateProductionCommand(command, now) {
  if (!command || command.audience !== PRODUCTION_DATASET) throw Error('invalid_command');
  const {audience, operation, ...envelope} = command;
  const actions = ['status','slot-status','issue','sync','enable-sync','disable-sync','enable-auto-sync','disable-auto-sync'];
  if (!actions.includes(operation?.type)) throw Error('invalid_command');
  if (['enable-sync','enable-auto-sync'].includes(operation.type)) {
    if (operation.confirmation !== operation.type.replace('enable-', 'enable-production-')) throw Error('invalid_confirmation');
    return validateMvpCommand({...envelope,operation:{...operation,confirmation:operation.type.replace('enable-', 'enable-staging-')}},now);
  }
  return validateMvpCommand({...envelope,operation},now);
}
