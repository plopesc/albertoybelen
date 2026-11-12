import {randomBytes} from 'node:crypto';
import {sqliteD1} from './sqlite-d1.js';
import {createD1Repository} from '../../backend/d1/repository.js';
import {createTokenVault} from '../../auth/token-vault.js';
import {createOAuthService} from '../../auth/oauth-service.js';
import {hashSecret,newSecret} from '../../auth/invitation-machine.js';
export const origin='https://albertoybelen.ddev.site';
export const actor={authenticated:true,role:'owner'};
export async function oauthFixture(t,{provider:override}={}) {
 const db=sqliteD1();t.after(()=>db.close());const repository=createD1Repository(db);
 const time={now:Date.parse('2026-11-01T12:00:00Z')};const keys={v1:randomBytes(32).toString('base64')};const vault=createTokenVault({keys});
 const counts={exchange:0,refresh:0};
 const response=(id=101)=>({access_token:'fixture-access-sensitive',refresh_token:'fixture-refresh-sensitive',expires_at:Math.floor(time.now/1000)+120,athlete:{id},scope:'activity:read_all'});
 const provider={authorizeUrl:({state})=>`${origin}/oauth/mock/authorize?${new URLSearchParams({state})}`,exchange:async()=>{counts.exchange++;return response();},refresh:async()=>{counts.refresh++;return {...response(),access_token:'fixture-refreshed-access',refresh_token:'fixture-refreshed-refresh'};},...override};
 const service=createOAuthService({repository,vault,provider,origin,clock:()=>time.now});
 async function issue(slot='slot-a',id=101) {
  const token=newSecret();await repository.transitionAuth({type:'issue',now:time.now,actor,slot,tokenHash:hashSecret(token),expectedAccountHash:hashSecret(String(id)),expiresAt:time.now+3600000});return token;
 }
 async function begin(slot='slot-a',id=101) {
  const token=await issue(slot,id);const session=await service.session();const url=await service.start({token,session});return {token,session,state:new URL(url).searchParams.get('state'),code:'synthetic-code',scope:'activity:read_all'};
 }
 return {db,repository,vault,keys,time,counts,provider,response,service,issue,begin};
}
