import {WorkerEntrypoint} from 'cloudflare:workers';
import {OPERATOR_ENABLE} from './staging-operator-policy.js';
export default class extends WorkerEntrypoint {
  async fetch() {return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
  async execute(envelope) {
    if(this.env.APP_ENV!=='staging-operator-private'||this.env.STAGING_OPERATOR_ENABLED!==OPERATOR_ENABLE)return{status:'unavailable'};
    try{return await this.env.STAGING_AUTH_TARGET.execute(envelope);}catch{return{status:'unavailable'};}
  }
}
