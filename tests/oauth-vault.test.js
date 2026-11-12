import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createTokenVault} from '../auth/token-vault.js';
const context={slot:'slot-a',generation:0,version:1};
test('AES-GCM: nonce aleatorio por escritura, contexto AAD y roundtrip sin secretos en envelope',async()=>{
 const vault=createTokenVault({keys:{v1:randomBytes(32).toString('base64')}});const tokens={accessToken:'synthetic-access',refreshToken:'synthetic-refresh'};
 const a=await vault.seal(tokens,context),b=await vault.seal(tokens,context);
 assert.equal(a.nonce===b.nonce,false);assert.equal(a.ciphertext===b.ciphertext,false);assert.equal(JSON.stringify(a).includes(tokens.accessToken),false);
 assert.deepEqual(await vault.open(a,context),tokens);
 for(const change of [{slot:'slot-b'},{generation:1},{version:2}])await assert.rejects(vault.open(a,{...context,...change}),/vault_unavailable/);
 await assert.rejects(vault.open({...a,keyVersion:'v2'},context),/vault_unavailable/);
 await assert.rejects(vault.open({...a,ciphertext:`${a.ciphertext.slice(0,-4)}AAAA`},context),/vault_unavailable/);
});
test('clave ausente, corrupta o equivocada falla cerrada, sin fallback en claro',async()=>{
 for(const value of [undefined,'', 'invalid',Buffer.alloc(16).toString('base64')])await assert.rejects(createTokenVault({keys:{v1:value}}).seal({},context),/vault_unavailable/);
 const a=createTokenVault({keys:{v1:randomBytes(32).toString('base64')}}),b=createTokenVault({keys:{v1:randomBytes(32).toString('base64')}});
 await assert.rejects(b.open(await a.seal({},context),context),/vault_unavailable/);
});
test('rotación mantiene lectura antigua solo con clave anterior y recifra con nueva versión',async()=>{
 const keys={v1:randomBytes(32).toString('base64'),v2:randomBytes(32).toString('base64')};const old=createTokenVault({keys}),next=createTokenVault({keys,activeVersion:'v2'});
 const row=await old.seal({fixture:true},context);const rotated=await next.seal(await next.open(row,context),{...context,version:2});
 assert.equal(rotated.keyVersion,'v2');assert.deepEqual(await createTokenVault({keys:{v2:keys.v2},activeVersion:'v2'}).open(rotated,{...context,version:2}),{fixture:true});
 await assert.rejects(createTokenVault({keys:{v2:keys.v2},activeVersion:'v2'}).open(row,context));
});
