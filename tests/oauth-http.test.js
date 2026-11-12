import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthFixture,origin} from './helpers/oauth-fixture.js';
import {createOAuthRouter} from '../backend/oauth-http.js';
import {createWorker} from '../backend/worker.js';
function router(f){return createOAuthRouter({service:f.service,provider:f.provider,origin,publicWorker:createWorker({repository:f.repository})});}
function cookie(response){return response.headers.get('Set-Cookie').split(';')[0];}
test('rutas privadas: cookies seguras, CSP, no-store, callback limpio sin tokens públicos',async t=>{
 const f=await oauthFixture(t);const r=router(f);const invite=await r.fetch(new Request(`${origin}/invite`));
 assert.equal(invite.status,200);assert.match(invite.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);assert.match(invite.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 const token=await f.issue();const headers={Origin:origin,Cookie:cookie(invite),'Content-Type':'application/json'};
 const started=await r.fetch(new Request(`${origin}/invite/start`,{method:'POST',headers,body:JSON.stringify({token})}));assert.equal(started.status,200);
 const state=new URL((await started.json()).authorizeUrl).searchParams.get('state');
 const response=await r.fetch(new Request(`${origin}/oauth/callback?${new URLSearchParams({state,code:'synthetic-code',scope:'activity:read_all'})}`,{headers:{Cookie:headers.Cookie}}));
 assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/oauth/result');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Cache-Control'),'no-store');
 const publicData=await(await r.fetch(new Request(`${origin}/api/progress`))).json();assert.equal(JSON.stringify(publicData).includes('slot-'),false);assert.equal(JSON.stringify(publicData).includes('token'),false);
});
test('CSRF/origen, HTTP, campos de slot y administración pública se rechazan',async t=>{
 const f=await oauthFixture(t);const r=router(f);
 assert.equal((await r.fetch(new Request('http://albertoybelen.ddev.site/invite'))).status,400);
 assert.equal((await r.fetch(new Request(`${origin}/invite/start`,{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'}))).status,403);
 for(const path of ['/admin/invitations','/privacy/delete','/connection/revoke','/oauth/token'])assert.equal((await r.fetch(new Request(`${origin}${path}`))).status,404);
 const page=await r.fetch(new Request(`${origin}/invite`));const token=await f.issue();
 const malicious=await r.fetch(new Request(`${origin}/invite/start`,{method:'POST',headers:{Origin:origin,Cookie:cookie(page),'Content-Type':'application/json'},body:JSON.stringify({token,slot:'slot-b'})}));assert.equal(malicious.status,400);
});
test('callback con parámetros repetidos o sin state no refleja datos ni canjea códigos',async t=>{
 const f=await oauthFixture(t);const r=router(f);for(const query of ['code=not-a-secret','state=a&state=b&code=not-a-secret']) {
  const response=await r.fetch(new Request(`${origin}/oauth/callback?${query}`));assert.equal(response.headers.get('Location'),'/oauth/result');assert.equal((await response.text()).includes('not-a-secret'),false);
 }assert.equal(f.counts.exchange,0);
});
test('límite de cuerpo rechaza peticiones sobredimensionadas sin consumir invitaciones',async t=>{
 const f=await oauthFixture(t);const response=await router(f).fetch(new Request(`${origin}/invite/start`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(4096)}));assert.equal(response.status,400);
});
