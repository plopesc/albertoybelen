import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createStravaAdapter} from '../auth/strava-adapter.js';
test('adaptador backend intercambia y renueva con servidor HTTP simulado, nunca URL de navegador con secretos',async()=>{
 const received=[];const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;received.push(new URLSearchParams(text));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({access_token:'fixture-http-access',refresh_token:'fixture-http-refresh',expires_at:2000000000,athlete:{id:101}}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const local=`http://127.0.0.1:${server.address().port}`;const adapter=createStravaAdapter({clientId:'fixture-client',clientSecret:'fixture-client-secret',enabled:true,fetchProvider:(url,options)=>{assert.equal(url,'https://www.strava.com/oauth/token');return fetch(local,options);}});
  const authorization=new URL(adapter.authorizeUrl({state:'synthetic-state',redirectUri:'https://albertoybelen.ddev.site/oauth/callback'}));
  assert.equal(authorization.searchParams.has('client_secret'),false);assert.equal(authorization.searchParams.get('scope'),'activity:read_all');
  await adapter.exchange('fixture-code');await adapter.refresh('fixture-refresh');
  assert.equal(received[0].get('grant_type'),'authorization_code');assert.equal(received[1].get('grant_type'),'refresh_token');assert.equal(received[0].get('client_secret'),'fixture-client-secret');
 } finally {await new Promise(resolve=>server.close(resolve));}
});
test('transporte requiere opt-in explícito, rechaza red/429/credenciales inválidas sin filtrar respuesta',async()=>{
 let calls=0;await assert.rejects(createStravaAdapter({fetchProvider:async()=>{calls++;}}).exchange('unused'));assert.equal(calls,0);
 for(const [status,message]of [[429,'provider_rate_limited'],[401,'provider_unavailable'],[500,'provider_unavailable']]) {
  const adapter=createStravaAdapter({enabled:true,clientId:'fixture',clientSecret:'fixture',fetchProvider:async()=>new Response('must-not-leak',{status})});await assert.rejects(adapter.exchange('fixture'),new RegExp(message));
 }
 const adapter=createStravaAdapter({enabled:true,clientId:'fixture',clientSecret:'fixture',fetchProvider:async()=>{throw new Error('must-not-leak');}});await assert.rejects(adapter.exchange('fixture'),/provider_unavailable/);
});

test('invalid_grant confirmado se distingue de errores de configuración de aplicación',async()=>{
 for(const [detail,expected]of [[{error:'invalid_grant'},'provider_revoked'],[{errors:[{resource:'RefreshToken',code:'invalid'}]},'provider_revoked'],[{errors:[{resource:'Application',field:'client_secret',code:'invalid'}]},'provider_unavailable']]){
 const adapter=createStravaAdapter({enabled:true,clientId:'fixture',clientSecret:'fixture',fetchProvider:async()=>Response.json(detail,{status:400})});await assert.rejects(adapter.refresh('fixture'),new RegExp(expected));
 }
});
