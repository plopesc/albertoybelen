import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthFixture,actor} from './helpers/oauth-fixture.js';
import {createTokenVault} from '../auth/token-vault.js';
import {createOAuthService} from '../auth/oauth-service.js';

test('concesión consume enlace y guarda solo ciphertext con permisos e identidad verificados',async t=>{
 const f=await oauthFixture(t);const input=await f.begin();assert.equal(await f.service.callback(input),true);
 const snapshot=await f.repository.read();const serialized=JSON.stringify(snapshot);
 assert.equal(serialized.includes('fixture-access-sensitive'),false);assert.equal(serialized.includes('fixture-refresh-sensitive'),false);
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM oauth_credentials').get().n,1);
 assert.equal(snapshot.state.auth.slots[0].status,'connected');assert.equal((await f.repository.getProgress()).partial,true);
 await assert.rejects(f.service.start(input));await assert.rejects(f.service.callback(input));assert.equal(f.counts.exchange,1);
});
test('denegación permite reintentar el enlace sin canjear código ni consumir invitación',async t=>{
 const f=await oauthFixture(t);const input=await f.begin();assert.equal(await f.service.callback({...input,error:'access_denied'}),false);assert.equal(f.counts.exchange,0);
 const url=await f.service.start(input);assert.equal(new URL(url).searchParams.has('state'),true);
});
test('state ausente/erróneo, cookie cruzada y expiración no llaman al proveedor',async t=>{
 const f=await oauthFixture(t);const input=await f.begin();
 for(const change of [{state:null},{state:'forged'},{session:await f.service.session()}])await assert.rejects(f.service.callback({...input,...change}));
 f.time.now+=600001;await assert.rejects(f.service.callback(input));assert.equal(f.counts.exchange,0);
});
test('scopes insuficientes o escritura se rechazan; permisos de respuesta también',async t=>{
 for(const scope of ['read','activity:write','activity:read_all,activity:write']){const f=await oauthFixture(t);const input=await f.begin();await assert.rejects(f.service.callback({...input,scope}));assert.equal(f.counts.exchange,0);}
 const f=await oauthFixture(t,{provider:{exchange:async()=>({access_token:'fake',refresh_token:'fake',expires_at:Date.parse('2026-11-01T13:00:00Z')/1000,athlete:{id:101},scope:'read'})}});await assert.rejects(f.service.callback(await f.begin()));
});
test('cuenta equivocada o duplicada no se vincula ni guarda credenciales',async t=>{
 const f=await oauthFixture(t);assert.equal(await f.service.callback(await f.begin()),true);
 assert.equal(await f.service.callback(await f.begin('slot-b',101)),false);
 assert.equal(Object.keys((await f.repository.read()).state.sealedTokens).length,1);
 const g=await oauthFixture(t,{provider:{exchange:async()=>({access_token:'fake',refresh_token:'fake',expires_at:Date.parse('2026-11-01T13:00:00Z')/1000,athlete:{id:999},scope:'activity:read_all'})}});assert.equal(await g.service.callback(await g.begin()),false);
});
test('dos callbacks concurrentes canjean una sola vez y consumen una sola vinculación',async t=>{
 const f=await oauthFixture(t);const input=await f.begin();const results=await Promise.allSettled([f.service.callback(input),f.service.callback(input)]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value===true).length,1);assert.equal(f.counts.exchange,1);
});
test('error de red/429 no guarda tokens y permite un intento nuevo',async t=>{
 for(const message of ['provider_unavailable','provider_rate_limited']){const f=await oauthFixture(t,{provider:{exchange:async()=>{throw new Error(message);}}});const input=await f.begin();await assert.rejects(f.service.callback(input),/authorization_failed/);assert.equal(Object.keys((await f.repository.read()).state.sealedTokens).length,0);await f.service.start(input);}
});
test('sin clave no empieza el consentimiento ni se consume la invitación',async t=>{
 const f=await oauthFixture(t);const service=createOAuthService({repository:f.repository,provider:f.provider,vault:createTokenVault(),clock:()=>f.time.now});
 const token=await f.issue();const session=await service.session();await assert.rejects(service.start({token,session}),/vault_unavailable/);
 assert.equal(Object.values((await f.repository.read()).state.auth.invitations)[0].status,'issued');
});
test('renovación concurrente se reserva una vez y persiste tokens nuevos cifrados',async t=>{
 const f=await oauthFixture(t);await f.service.callback(await f.begin());f.time.now+=70000;
 const result=await Promise.allSettled([f.service.credentials('slot-a'),f.service.credentials('slot-a')]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.counts.refresh,1);
 const state=(await f.repository.read()).state;assert.equal(state.sealedTokens['slot-a'].version,2);assert.equal(JSON.stringify(state).includes('fixture-refreshed'),false);
});
test('refresh revocado retira credenciales; fallo temporal conserva ciphertext y marca stale',async t=>{
 for(const message of ['provider_revoked','provider_rate_limited']){const f=await oauthFixture(t,{provider:{refresh:async()=>{throw new Error(message);}}});await f.service.callback(await f.begin());f.time.now+=70000;await assert.rejects(f.service.credentials('slot-a'));
 const state=(await f.repository.read()).state;if(message==='provider_revoked'){assert.equal(state.sealedTokens['slot-a'],undefined);assert.equal(state.auth.slots[0].status,'revoked');}else{assert.ok(state.sealedTokens['slot-a']);assert.equal(state.policy.participants[0].stale,true);}}
});
test('supresión durante un canje impide que la respuesta tardía reconecte la cuenta',async t=>{
 let release,started;const gate=new Promise(resolve=>release=resolve);const entered=new Promise(resolve=>started=resolve);
 const f=await oauthFixture(t);f.provider.exchange=async()=>{started();await gate;return f.response();};const input=await f.begin();const callback=f.service.callback(input);await entered;
 await f.repository.transitionAuth({type:'delete',slot:'slot-a',now:f.time.now,actor,requestVerified:true});release();assert.equal(await callback,false);
 const state=(await f.repository.read()).state;assert.equal(state.auth.slots[0].status,'deleted');assert.equal(state.sealedTokens['slot-a'],undefined);
});
test('revocación durante renovación descarta credenciales tardías y no resucita el slot',async t=>{
 let release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 const f=await oauthFixture(t);await f.service.callback(await f.begin());f.time.now+=70000;f.provider.refresh=async()=>{started();await gate;return f.response();};const refreshing=f.service.credentials('slot-a');await entered;
 await f.repository.transitionAuth({type:'revoke',slot:'slot-a',now:f.time.now,actor});release();await assert.rejects(refreshing);
 assert.equal((await f.repository.read()).state.sealedTokens['slot-a'],undefined);
});
test('fallo de cifrado tras intercambio no consume ni vincula parcialmente',async t=>{
 const f=await oauthFixture(t);f.provider.exchange=async()=>{delete f.keys.v1;return f.response();};
 await assert.rejects(f.service.callback(await f.begin()));const state=(await f.repository.read()).state;
 assert.equal(state.auth.slots[0].status,'disconnected');assert.equal(Object.keys(state.sealedTokens).length,0);
 assert.equal(Object.values(state.auth.invitations)[0].status,'issued');
});
test('429 aplica espera antes de permitir otra renovación y conserva el dato anterior',async t=>{
 let calls=0;const f=await oauthFixture(t,{provider:{refresh:async()=>{calls++;throw new Error('provider_rate_limited');}}});
 await f.service.callback(await f.begin());f.time.now+=70000;await assert.rejects(f.service.credentials('slot-a'));await assert.rejects(f.service.credentials('slot-a'),/refresh_deferred/);assert.equal(calls,1);
 f.time.now+=60001;await assert.rejects(f.service.credentials('slot-a'));assert.equal(calls,2);
});
test('dos autorizaciones independientes y nueva invitación tras revocar mantienen el slot correcto',async t=>{
 const f=await oauthFixture(t);await f.service.callback(await f.begin());
 f.provider.exchange=async()=>f.response(202);assert.equal(await f.service.callback(await f.begin('slot-b',202)),true);
 await f.repository.transitionAuth({type:'revoke',now:f.time.now,actor,slot:'slot-a'});assert.equal((await f.repository.read()).state.sealedTokens['slot-a'],undefined);assert.ok((await f.repository.read()).state.sealedTokens['slot-b']);
 f.provider.exchange=async()=>f.response(101);assert.equal(await f.service.callback(await f.begin('slot-a',101)),true);assert.equal((await f.repository.read()).state.sealedTokens['slot-a'].generation,1);
});
test('rotación del servicio recifra por versión sin cambiar identidad ni exponer credenciales',async t=>{
 const f=await oauthFixture(t);await f.service.callback(await f.begin());const before=(await f.repository.read()).state.sealedTokens['slot-a'];
 const keys={...f.keys,v2:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')};const service=createOAuthService({repository:f.repository,provider:f.provider,vault:createTokenVault({keys,activeVersion:'v2'}),clock:()=>f.time.now});
 await service.rotate('slot-a');const row=(await f.repository.read()).state.sealedTokens['slot-a'];assert.equal(row.keyVersion,'v2');assert.equal(row.version,before.version+1);assert.equal(row.ciphertext===before.ciphertext,false);
 assert.equal((await service.credentials('slot-a')).athleteId,101);
});
test('ciphertext corrupto falla cerrado sin intentar renovar con credenciales ilegibles',async t=>{
 const f=await oauthFixture(t);await f.service.callback(await f.begin());await f.repository.updatePrivate(state=>{const row=state.sealedTokens['slot-a'];row.ciphertext=(row.ciphertext[0]==='A'?'B':'A')+row.ciphertext.slice(1);});
 await assert.rejects(f.service.credentials('slot-a'),/vault_unavailable/);assert.equal(f.counts.refresh,0);
 delete f.keys.v1;await f.repository.transitionAuth({type:'delete',slot:'slot-a',now:f.time.now,actor,requestVerified:true});assert.equal(Object.keys((await f.repository.read()).state.sealedTokens).length,0);
});
