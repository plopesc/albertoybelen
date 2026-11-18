import {verifyOperatorCommand} from './staging-operator-policy.js';
import {createStagingCommandExecutor} from './staging-command-executor.js';
export function createStagingOperator(env,{runtime,clock=Date.now}) {
  const executor=createStagingCommandExecutor({runtime,clock});
  return {async execute(envelope) {
    let command;
    try{command=await verifyOperatorCommand(envelope,env,clock());}catch{return{status:'rejected'};}
    return executor.execute(command);
  }};
}
