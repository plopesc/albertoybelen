import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,statSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {operatorFixture,operatorIdentity} from './helpers/staging-operator-fixture.js';
import {createStagingOperator} from '../backend/staging-operator.js';
import {savePrivateOperatorResponse} from '../scripts/lib/staging-operator-client.mjs';
const enable={type:'enable-sync',confirmation:'enable-staging-sync'};

test('firma requerida, claims exactos y sin rol suministrado por JSON; rechazo sin escribir D1',async t=>{
  const f=await operatorFixture(t);const before=await f.runtime.repository.read();
  for(const value of [{},{actor:{authenticated:true,role:'owner'}},{version:1,keyId:'synthetic-owner',payload:'bad',signature:'a'.repeat(86)}])assert.equal((await f.operator.execute(value)).status,'rejected');
  const good=await f.sign({type:'status'});
  for(const change of [e=>e.signature='a'.repeat(86),e=>e.keyId='unknown',e=>e.actor={authenticated:true},e=>e.payload+='x',e=>delete e.signature]){const e=structuredClone(good);change(e);assert.equal((await f.operator.execute(e)).status,'rejected');}
  const cmd=JSON.parse(Buffer.from(good.payload,'base64url'));
  for(const change of [c=>c.audience='production',c=>c.target='albertoybelen-api',c=>c.dataset='local-fixtures',c=>c.subject='staging-other',c=>c.expiresAt=f.time.now,c=>c.issuedAt=f.time.now+30001,c=>c.expiresAt+=600000,c=>c.actor={authenticated:true,role:'owner'},c=>c.operation={type:'status',role:'owner'}]){
    const c=structuredClone(cmd);change(c);assert.equal((await f.operator.execute(await f.raw(c))).status,'rejected');
  }
  assert.deepEqual(await f.runtime.repository.read(),before);
});

test('política de clave limita slots y acciones, sin escalada con firma válida',async t=>{
  const f=await operatorFixture(t,{operations:['issue','status'],slots:['slot-a']});
  assert.equal((await f.execute({type:'issue',slot:'slot-b',expectedAthleteId:202})).status,'rejected');
  assert.equal((await f.execute({type:'sync'})).status,'rejected');
  assert.equal((await f.execute({type:'issue',slot:'slot-a',expectedAthleteId:101,actor:{authenticated:true}})).status,'rejected');
  assert.equal((await f.execute({type:'issue',slot:'slot-a',expectedAthleteId:101})).status,'issued');
  const status=await f.execute({type:'status'});assert.equal(status.status,'ok');assert.equal(status.syncDisabled,true);assert.doesNotMatch(JSON.stringify(status),/slot-|athlete|invitation|token|synthetic-owner/);
  // Key revocation is effective before any nonce/database write.
  f.env.STAGING_OPERATOR_KEYS='[]';assert.equal((await f.execute({type:'status'})).status,'rejected');
});

test('invitación se entrega una vez, reemisión invalida anterior y no hay links en auditoría/receipts',async t=>{
  const f=await operatorFixture(t);const command=await f.sign({type:'issue',slot:'slot-a',expectedAthleteId:101});
  const results=await Promise.all([f.operator.execute(command),f.openOperator().execute(command)]);
  assert.equal(results.filter(r=>r.status==='issued').length,1);assert.equal(results.filter(r=>r.status==='replay').length,1);
  const first=results.find(r=>r.status==='issued').invitation;
  const second=await f.execute({type:'issue',slot:'slot-a',expectedAthleteId:101});assert.equal(second.status,'issued');
  await assert.rejects(f.begin('slot-a',101,first));
  const attempt=await f.begin('slot-a',101,second.invitation);assert.match((await f.callback(attempt)).headers.get('Set-Cookie'),/=success;/);
  const operator=(await f.runtime.repository.read()).state.stagingOperator;
  const text=JSON.stringify(operator);assert.doesNotMatch(text,/invite#|expectedAthlete|accountHash|slot-a|subject|payload|synthetic-owner/);assert.equal(text.includes(new URL(second.invitation).hash.slice(1)),false);assert.equal(operator.audit.length,2);
});

test('confirmaciones destructivas explícitas, idempotencia y API pública sin admin ni campos privados',async t=>{
  const f=await operatorFixture(t);await f.connect();await f.connect('slot-b',202);
  assert.equal((await f.execute({type:'sync'})).status,'disabled');assert.equal((await f.execute(enable)).status,'enabled');
  assert.equal((await f.execute({type:'sync'})).status,'synced');assert.equal((await f.progress()).distanceKm,2);
  for(const op of [{type:'revoke',slot:'slot-a',confirmation:'yes'},{type:'erase',slot:'slot-a',confirmation:'verified-staging-deletion'},{type:'erase',slot:'slot-a',confirmation:'no',purgeMilestones:true}])assert.equal((await f.execute(op)).status,'rejected');
  const revoke=await f.sign({type:'revoke',slot:'slot-a',confirmation:'revoke-staging-account'});assert.equal((await f.operator.execute(revoke)).status,'revoked');assert.equal((await f.operator.execute(revoke)).status,'replay');assert.equal((await f.progress()).distanceKm,2);
  assert.equal((await f.execute({type:'erase',slot:'slot-a',confirmation:'verified-staging-deletion',purgeMilestones:true})).status,'erased');assert.equal((await f.progress()).distanceKm,1);
  for(const path of ['/admin','/execute','/operator','/api/sync'])assert.equal((await f.request(path)).status,404);
  assert.doesNotMatch(JSON.stringify(await f.progress()),/operator|lease|audit|receipt|slot-|athlete|token/);
});

test('desactivar sync cancela publicación pendiente, incluso tras rehabilitar, sin volver a aplicarla',async t=>{
  const f=await operatorFixture(t);await f.connect();await f.connect('slot-b',202);await f.execute(enable);await f.execute({type:'sync'});
  const old=await f.progress();f.source.rows[101][0].distance=900000;
  let release,started;const blocked=new Promise(r=>release=r),entered=new Promise(r=>started=r);let once=true;
  f.source.beforeResponse=async()=>{if(once){once=false;started();await blocked;}};
  const sync=f.execute({type:'sync'});await entered;
  assert.equal((await f.execute({type:'issue',slot:'slot-a',expectedAthleteId:101})).status,'busy');
  assert.equal((await f.execute({type:'disable-sync'})).status,'disabled');
  assert.equal((await f.execute(enable)).status,'busy'); // cannot bypass an active operator lease
  release();await sync;assert.deepEqual(await f.progress(),old);
  assert.equal((await f.execute({type:'sync'})).status,'disabled');
  assert.equal((await f.execute(enable)).status,'enabled');
  f.source.beforeResponse=null;assert.equal((await f.execute({type:'sync'})).status,'synced');assert.equal((await f.progress()).distanceKm,901);
});

test('emergencia y supresión durante sync no resucitan datos; nuevo operador recupera tras lease vencido',async t=>{
  const f=await operatorFixture(t);await f.connect();await f.execute(enable);await f.execute({type:'sync'});
  let release,started;const blocked=new Promise(r=>release=r),entered=new Promise(r=>started=r);f.source.beforeResponse=async()=>{started();await blocked;};
  const sync=f.execute({type:'sync'});await entered;
  assert.equal((await f.execute({type:'erase',slot:'slot-a',confirmation:'verified-staging-deletion',purgeMilestones:true})).status,'erased');release();await sync;
  assert.equal((await f.progress()).distanceKm,0);assert.deepEqual((await f.runtime.repository.read()).state.sealedTokens,{});
  await f.runtime.repository.updatePrivate(state=>{state.stagingOperator.lease={nonce:'synthetic-crashed-lease',expiresAt:f.time.now+120000};});
  assert.equal((await f.execute(enable)).status,'busy');f.time.now+=120001;assert.equal((await f.execute(enable)).status,'enabled');
});

test('capacidades y política ausentes fallan cerrado; otra clave no firma comandos del dueño',async t=>{
  const f=await operatorFixture(t),command=await f.sign({type:'status'});const impostor=await operatorIdentity();
  const signed={...command,signature:Buffer.from(await crypto.subtle.sign('Ed25519',impostor.privateKey,new TextEncoder().encode(JSON.stringify([command.version,command.keyId,command.payload])))).toString('base64url')};assert.equal((await f.operator.execute(signed)).status,'rejected');
  for(const field of ['STAGING_OPERATOR_ENABLED','STAGING_CALLBACK_CONFIRMED','STAGING_OPERATOR_INGRESS','STAGING_ATHLETE_CAPACITY','STAGING_OPERATOR_KEYS']) {
    const env={...f.env};delete env[field];assert.equal((await createStagingOperator(env,{runtime:f.open(),clock:()=>f.time.now}).execute(command)).status,'rejected');
  }
});

test('salida privada solo en .local/staging-operator 0700, archivo nuevo 0600 sin sobrescritura/symlink',()=>{
  const root=mkdtempSync(join(tmpdir(),'operator-response-'));
  try {
    const dir=join(root,'.local/staging-operator');mkdirSync(dir,{recursive:true,mode:0o700});
    savePrivateOperatorResponse(dir,{invitation:'synthetic-private-only'});assert.equal(statSync(join(dir,'response.json')).mode&0o777,0o600);assert.match(readFileSync(join(dir,'response.json'),'utf8'),/synthetic-private-only/);
    assert.throws(()=>savePrivateOperatorResponse(dir,{}));const arbitrary=join(root,'artifacts');mkdirSync(arbitrary,{mode:0o700});assert.throws(()=>savePrivateOperatorResponse(arbitrary,{}));
    const alias=join(root,'alias');symlinkSync(dir,alias);assert.throws(()=>savePrivateOperatorResponse(alias,{}));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('supresión firmada durante callback invalida el intercambio y la rotación usa el vault existente',async t=>{
  const f=await operatorFixture(t);const issue=await f.execute({type:'issue',slot:'slot-a',expectedAthleteId:101});const attempt=await f.begin('slot-a',101,issue.invitation);
  let release,started;const blocked=new Promise(r=>release=r),entered=new Promise(r=>started=r);f.source.beforeTokenResponse=async()=>{started();await blocked;};
  const callback=f.callback(attempt);await entered;
  assert.equal((await f.execute({type:'erase',slot:'slot-a',confirmation:'verified-staging-deletion',purgeMilestones:true})).status,'erased');release();assert.match((await callback).headers.get('Set-Cookie'),/=error;/);
  assert.deepEqual((await f.runtime.repository.read()).state.sealedTokens,{});
  f.source.beforeTokenResponse=null;await f.connect('slot-b',202);const before=(await f.runtime.repository.read()).state.sealedTokens['slot-b'].version;
  assert.equal((await f.execute({type:'rotate',slot:'slot-b'})).status,'rotated');assert.equal((await f.runtime.repository.read()).state.sealedTokens['slot-b'].version,before+1);
});

test('firma liga keyId/versión y nonce no se puede reusar tras cambiar de clave autorizada',async t=>{
  const f=await operatorFixture(t),command=await f.sign({type:'status'});assert.equal((await f.operator.execute(command)).status,'ok');
  const next=await operatorIdentity();next.policy.id='synthetic-next';f.env.STAGING_OPERATOR_KEYS=JSON.stringify([f.identity.policy,next.policy]);
  assert.equal((await f.openOperator().execute({...command,keyId:next.policy.id})).status,'rejected');
  const payload=JSON.parse(Buffer.from(command.payload,'base64url'));
  const {signOperatorCommand}=await import('../scripts/lib/staging-operator-client.mjs');
  const replay=await signOperatorCommand({privateKey:next.privateKey,keyId:next.policy.id,subject:next.policy.subject,operation:{type:'status'},now:f.time.now,nonce:payload.nonce});
  assert.equal((await f.openOperator().execute(replay)).status,'replay');
});
