import {stagingAuthFixture} from './staging-auth-fixture.js';
import {createStagingOperator} from '../../backend/staging-operator.js';
import {OPERATOR_ENABLE,OPERATOR_READINESS,OPERATOR_ACTIONS} from '../../backend/staging-operator-policy.js';
import {signOperatorCommand} from '../../scripts/lib/staging-operator-client.mjs';
export async function operatorIdentity({operations=[...OPERATOR_ACTIONS],slots=['slot-a','slot-b']}={}) {
  const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const policy={id:'synthetic-owner',subject:'staging-test-owner',publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),operations,slots};
  return{...pair,policy};
}
export async function operatorFixture(t,options={}) {
  const f=stagingAuthFixture(t),identity=await operatorIdentity(options);
  Object.assign(f.env,OPERATOR_READINESS,{STAGING_OPERATOR_ENABLED:OPERATOR_ENABLE,STAGING_OPERATOR_KEYS:JSON.stringify([identity.policy])});
  const open=()=>createStagingOperator(f.env,{runtime:f.open(),clock:()=>f.time.now});
  const sign=operation=>signOperatorCommand({privateKey:identity.privateKey,keyId:identity.policy.id,subject:identity.policy.subject,operation,now:f.time.now});
  return{...f,identity,operator:open(),openOperator:open,sign,async execute(operation){return open().execute(await sign(operation));},async raw(command){const payload=Buffer.from(JSON.stringify(command)).toString('base64url');return {version:1,keyId:identity.policy.id,payload,signature:Buffer.from(await crypto.subtle.sign('Ed25519',identity.privateKey,new TextEncoder().encode(JSON.stringify([1,identity.policy.id,payload])))).toString('base64url')};}};
}
