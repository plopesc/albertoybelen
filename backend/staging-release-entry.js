import {WorkerEntrypoint} from 'cloudflare:workers';
import authEntry from './staging-auth-entry.js';
import {createStagingAuth} from './staging-auth.js';
import {createStagingOperator} from './staging-operator.js';
import {operatorKeys} from './staging-operator-policy.js';
export class StagingOperatorTarget extends WorkerEntrypoint {
  async execute(envelope) {
    try {return await createStagingOperator(this.env,{runtime:createStagingAuth(this.env)}).execute(envelope);}
    catch{return{status:'unavailable'};}
  }
}
export default {
  async fetch(request,env) {
    try{operatorKeys(env);return await authEntry.fetch(request,env);}
    catch{return Response.json({error:'staging_release_closed'},{status:503,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
  },
};
