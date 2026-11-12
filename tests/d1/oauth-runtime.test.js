import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createD1Repository} from '../../backend/d1/repository.js';
import {hashSecret,newSecret} from '../../auth/invitation-machine.js';
import {localOAuth} from '../../backend/oauth-entry.js';
const origin='https://albertoybelen.ddev.site';
test('Servicio OAuth con D1 real local: consentimiento mock, ciphertext y recuperación al reiniciar',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'alberto-oauth-'));let mf;
 try {
 const bundle=await build({entryPoints:['backend/oauth-entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
 const env={APP_ENV:'local-fixtures',OAUTH_MODE:'mock',TOKEN_ENCRYPTION_KEY_VERSION:'v1',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const options={...convertV4MiniflareOptions({https:true,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000025'},outboundService:()=>{throw new Error('Network forbidden');}}),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false}};
 mf=new Miniflare(options);let db=await mf.getD1Database('DB');
 const path=new URL('../../backend/d1/migrations/',import.meta.url);for(const file of(await readdir(path)).sort()){const sql=await readFile(new URL(file,path),'utf8');for(const command of sql.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(command).run();}
 const repository=createD1Repository(db);const token=newSecret();await repository.transitionAuth({type:'issue',actor:{authenticated:true,role:'owner'},slot:'slot-a',now:Date.now(),expiresAt:Date.now()+60000,tokenHash:hashSecret(token),expectedAccountHash:hashSecret('101')});
 const runtime=localOAuth({...env,DB:db});const request=(path,options={})=>runtime.router.fetch(new Request(new URL(path,origin),{redirect:'manual',...options}));
 const invite=await request('/invite');const cookie=invite.headers.get('Set-Cookie').split(';')[0];
 const start=await request('/invite/start',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(start.status,200);
 const authorized=new URL((await start.json()).authorizeUrl);const state=authorized.searchParams.get('state');
 const consent=await request('/oauth/mock/authorize',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({state,account:'101'})});assert.equal(consent.status,303);
 const callback=await request(consent.headers.get('Location'),{headers:{Cookie:cookie}});assert.equal(callback.status,303);assert.equal(callback.headers.get('Location'),'/oauth/result');assert.match(callback.headers.get('Set-Cookie'),/=success;/);
 const stored=await repository.read();assert.equal(Object.keys(stored.state.sealedTokens).length,1);assert.equal(JSON.stringify(stored).includes('fixture-access-'),false);assert.equal(JSON.stringify(stored).includes('fixture-refresh-'),false);
 await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB');
 const recovered=localOAuth({...env,DB:db});const credentials=await recovered.service.credentials('slot-a');assert.equal(credentials.accessToken.startsWith('fixture-access-'),true);
 await recovered.repository.transitionAuth({type:'revoke',slot:'slot-a',actor:{authenticated:true,role:'owner'},now:Date.now()});await assert.rejects(recovered.service.credentials('slot-a'));
 assert.equal((await db.prepare('SELECT count(*) n FROM oauth_credentials').first()).n,0);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
