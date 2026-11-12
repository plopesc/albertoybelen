import test from 'node:test';import assert from 'node:assert/strict';import {createServer}from'node:http';
import {pilotFixture,pilotRows}from'./helpers/pilot-fixture.js';

test('flujo opt-in completo mediante servidor HTTP falso: canje, doble paginado y refresh',async t=>{
 let f;const seen=[];let refreshes=0;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://loopback');seen.push(url.pathname);res.setHeader('Content-Type','application/json');
  if(url.pathname==='/oauth/token'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=new URLSearchParams(Buffer.concat(chunks).toString());
   assert.equal(body.get('client_secret'),'synthetic-client-secret');assert.equal(body.get('client_id'),'12345');
   if(body.get('grant_type')==='refresh_token'){refreshes++;assert.equal(body.get('refresh_token'),'synthetic-refresh');}
   else{assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('code'),'synthetic-code');}
   res.end(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(f.time.now/1000)+120,athlete:{id:101}}));return;
  }
  assert.equal(url.pathname,'/api/v3/athlete/activities');assert.equal(req.headers.authorization,'Bearer synthetic-access');assert.equal(url.searchParams.get('per_page'),'100');
  res.end(JSON.stringify(url.searchParams.get('page')==='1'?pilotRows():[]));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 f=await pilotFixture(t,{httpTransport:async(address,options)=>{
  const url=new URL(address);assert.equal(url.origin,'https://www.strava.com');
  const response=await fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`,options);
  // The interceptor supplies a synthetic Response; the pilot never follows a redirect.
  return new Response(response.body,{status:response.status,headers:response.headers});
 }});
 assert.match((await f.connect()).headers.get('Set-Cookie'),/=success;/);await f.runtime.sync();assert.equal((await f.runtime.status()).progress.distanceKm,2.2345);
 f.time.now+=120000;f.reopen();await f.runtime.sync();assert.equal(refreshes,1);assert.equal(seen.filter(p=>p==='/api/v3/athlete/activities').length,8);
});
