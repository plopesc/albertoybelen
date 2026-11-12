import {STAGING_AUTH_ORIGIN,STAGING_AUTH_DATASET} from './staging-auth-settings.js';
export const OPERATOR_AUDIENCE='albertoybelen-staging-operator-v1';
export const OPERATOR_ENABLE='owner-authorized-private-staging-operator';
export const OPERATOR_READINESS=Object.freeze({STAGING_CALLBACK_CONFIRMED:`${STAGING_AUTH_ORIGIN}/oauth/callback`,STAGING_OPERATOR_INGRESS:'owner-verified-private-ingress',STAGING_ATHLETE_CAPACITY:'two-approved-test-athletes'});
export const OPERATOR_TARGET=Object.freeze({worker:'albertoybelen-api-staging',dataset:STAGING_AUTH_DATASET});
export const OPERATOR_ACTIONS=Object.freeze(['issue','status','sync','disable-sync','enable-sync','revoke','erase','rotate']);
const fail=()=>{throw Error('operator_rejected');};
export function exactKeys(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.split(' ').sort().join(','))fail();
}
export function operatorKeys(env) {
  if(env.APP_ENV!=='staging-strava-test'||env.STAGING_OPERATOR_ENABLED!==OPERATOR_ENABLE||Object.entries(OPERATOR_READINESS).some(([key,value])=>env[key]!==value))fail();
  let keys;try{if(typeof env.STAGING_OPERATOR_KEYS!=='string'||env.STAGING_OPERATOR_KEYS.length>8192)fail();keys=JSON.parse(env.STAGING_OPERATOR_KEYS);}catch{fail();}
  if(!Array.isArray(keys)||!keys.length||keys.length>4)fail();const ids=new Set();
  for(const key of keys) {
    exactKeys(key,'id subject publicKey operations slots');
    if(typeof key.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(key.id)||ids.has(key.id)||!/^staging-[a-z0-9-]{1,24}$/.test(key.subject)||typeof key.publicKey!=='string'||!/^[\w-]{43}$/.test(key.publicKey)||Buffer.from(key.publicKey,'base64url').length!==32)fail();ids.add(key.id);
    if(!Array.isArray(key.operations)||!key.operations.length||new Set(key.operations).size!==key.operations.length||key.operations.some(op=>!OPERATOR_ACTIONS.includes(op)))fail();
    if(!Array.isArray(key.slots)||new Set(key.slots).size!==key.slots.length||key.slots.some(slot=>!['slot-a','slot-b'].includes(slot)))fail();
    if(key.operations.some(op=>['sync','enable-sync','disable-sync'].includes(op))&&key.slots.length!==2)fail();
  }
  return keys;
}
export async function verifyOperatorCommand(envelope,env,now) {
  const keys=operatorKeys(env);exactKeys(envelope,'version keyId payload signature');
  if(envelope.version!==1||typeof envelope.keyId!=='string'||envelope.keyId.length>32||typeof envelope.payload!=='string'||envelope.payload.length>4096||!/^[\w-]+$/.test(envelope.payload)||typeof envelope.signature!=='string'||!/^[\w-]{86}$/.test(envelope.signature))fail();
  const key=keys.find(key=>key.id===envelope.keyId);if(!key)fail();
  const publicKey=await crypto.subtle.importKey('raw',Buffer.from(key.publicKey,'base64url'),'Ed25519',false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',publicKey,Buffer.from(envelope.signature,'base64url'),new TextEncoder().encode(JSON.stringify([envelope.version,envelope.keyId,envelope.payload]))))fail();
  let command;try{const text=Buffer.from(envelope.payload,'base64url').toString('utf8');command=JSON.parse(text);if(JSON.stringify(command)!==text)fail();}catch{fail();}
  exactKeys(command,'audience target dataset subject issuedAt expiresAt nonce operation');
  if(command.audience!==OPERATOR_AUDIENCE||command.target!==OPERATOR_TARGET.worker||command.dataset!==OPERATOR_TARGET.dataset||command.subject!==key.subject||!Number.isSafeInteger(command.issuedAt)||!Number.isSafeInteger(command.expiresAt)||command.issuedAt>now+30000||command.expiresAt<=now||command.expiresAt<=command.issuedAt||command.expiresAt-command.issuedAt>300000||command.issuedAt<now-300000||typeof command.nonce!=='string'||!/^[\w-]{43}$/.test(command.nonce))fail();
  const op=command.operation;if(!op||!key.operations.includes(op.type))fail();
  const fields={issue:'type slot expectedAthleteId',status:'type',sync:'type','disable-sync':'type','enable-sync':'type confirmation',revoke:'type slot confirmation',erase:'type slot confirmation purgeMilestones',rotate:'type slot'};
  exactKeys(op,fields[op.type]);
  if('slot' in op&&!key.slots.includes(op.slot))fail();
  if(op.type==='issue'&&(!Number.isSafeInteger(op.expectedAthleteId)||op.expectedAthleteId<=0))fail();
  if(op.type==='revoke'&&op.confirmation!=='revoke-staging-account')fail();
  if(op.type==='erase'&&(op.confirmation!=='verified-staging-deletion'||typeof op.purgeMilestones!=='boolean'))fail();
  if(op.type==='enable-sync'&&op.confirmation!=='enable-staging-sync')fail();
  return command;
}
