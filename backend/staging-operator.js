import {hashSecret} from '../auth/invitation-machine.js';
import {verifyOperatorCommand} from './staging-operator-policy.js';
const actor=Object.freeze({authenticated:true,role:'owner'});
const control=state=>state.stagingOperator??={syncDisabled:true,epoch:0,receipts:{},audit:[]};

/** Signed private RPC capability. No HTTP route and no actor/role supplied by a client. */
export function createStagingOperator(env,{runtime,clock=Date.now}) {
  return {
    async execute(envelope) {
      let command;
      try{command=await verifyOperatorCommand(envelope,env,clock());}catch{return{status:'rejected'};}
      const op=command.operation,nonce=hashSecret(command.nonce);
      const priority=['status','disable-sync','revoke','erase'].includes(op.type);
      let claimed;
      try {
        claimed=await runtime.repository.updatePrivate(state=>{
          const c=control(state),now=clock();
          for(const [id,row] of Object.entries(c.receipts))if(row.expiresAt<=now)delete c.receipts[id];
          if(c.receipts[nonce])return 'replay';
          if(Object.keys(c.receipts).length>=1000)return 'busy';
          c.receipts[nonce]={expiresAt:command.expiresAt,status:'pending'};
          if(!priority&&c.lease?.expiresAt>now){c.receipts[nonce].status='busy';return 'busy';}
          if(!priority)c.lease={nonce,expiresAt:Math.min(command.expiresAt,now+120000)};
          return 'claimed';
        });
      }catch{return{status:'unavailable'};}
      if(claimed!=='claimed')return{status:claimed};
      let result={status:'failed'};
      const fence=state=>state.stagingOperator?.lease?.nonce===nonce&&state.stagingOperator.lease.expiresAt>clock();
      try {
        if(op.type==='issue')result={status:'issued',invitation:await runtime.admin.issue({actor,slot:op.slot,expectedAthleteId:op.expectedAthleteId,fence})};
        else if(op.type==='sync')result=await runtime.admin.sync({actor,fence});
        else if(op.type==='status') {
          const {state}=await runtime.repository.read(),budget=state.stagingBudget;
          result={status:'ok',progress:await runtime.repository.getProgress(),syncDisabled:control(state).syncDisabled,budget:{requests:budget?.requests??0,blockedUntil:budget?.blockedUntil??0,quarterCount:budget?.quarterCount??0,dayCount:budget?.dayCount??0}};
        } else if(['disable-sync','enable-sync'].includes(op.type)) {
          await runtime.repository.updatePrivate(state=>{const c=control(state);if(op.type==='enable-sync'&&!fence(state))throw Error('operator_rejected');c.syncDisabled=op.type==='disable-sync';c.epoch++;});result={status:op.type==='disable-sync'?'disabled':'enabled'};
        } else if(op.type==='revoke') {const r=await runtime.admin.revoke({actor,slot:op.slot});result={status:r.ok?'revoked':'failed'};}
        else if(op.type==='erase') {const r=await runtime.admin.erase({actor,slot:op.slot,verified:true,purgeMilestones:op.purgeMilestones});result={status:r.ok?'erased':'failed'};}
        else if(op.type==='rotate') {await runtime.admin.rotate({actor,slot:op.slot,fence});result={status:'rotated'};}
      }catch{result={status:'failed'};}
      try {
        await runtime.repository.updatePrivate(state=>{
          const c=control(state);if(c.receipts[nonce])c.receipts[nonce].status=result.status;
          c.audit.push({action:op.type,status:result.status,at:clock()});c.audit=c.audit.slice(-100);
          if(c.lease?.nonce===nonce)delete c.lease;
        });
      }catch{return{status:'unavailable'};}
      // Invitation is delivered once in RAM to the private caller; never stored in receipts/audit.
      return result;
    },
  };
}
