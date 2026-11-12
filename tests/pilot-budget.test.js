import test from 'node:test';import assert from 'node:assert/strict';
import {pilotFixture}from'./helpers/pilot-fixture.js';
import {createPilotTransport,PILOT_LIMITS}from'../backend/pilot-budget.js';
const address='https://www.strava.com/api/v3/athlete/activities?after=1&before=2000000000&page=1&per_page=100';
const options={redirect:'error'};
function transport(f,fetchProvider){return createPilotTransport({repository:f.runtime.repository,ready:()=>f.runtime.ready(),clock:()=>f.time.now,fetchProvider});}

test('presupuesto local durable 20/15min y 60/día entre procesos, sin bucles',async t=>{
 const f=await pilotFixture(t);let requests=0;const fetchProvider=async()=>{requests++;return Response.json([]);};
 for(let i=0;i<20;i++)await transport(f,fetchProvider)(address,options);
 await assert.rejects(transport(f,fetchProvider)(address,options));assert.equal(requests,20);
 f.time.now+=900001;
 for(let i=0;i<20;i++)await transport(f,fetchProvider)(address,options);
 f.time.now+=900001;
 for(let i=0;i<20;i++)await transport(f,fetchProvider)(address,options);
 f.time.now+=900001;await assert.rejects(transport(f,fetchProvider)(address,options));assert.equal(requests,60);
 assert.equal((await f.runtime.status()).requests,60);
 f.time.now=Date.parse('2026-11-02T00:00:01Z');await transport(f,fetchProvider)(address,options);assert.equal(requests,61);
});

test('límite 12 por proceso/operación no se evita haciendo múltiples llamadas',async t=>{
 const f=await pilotFixture(t);let calls=0;const fetch=transport(f,async()=>{calls++;return Response.json([]);});
 for(let i=0;i<PILOT_LIMITS.perOperation;i++)await fetch(address,options);
 await assert.rejects(fetch(address,options));assert.equal(calls,12);
});

for(const headers of [
 {'X-RateLimit-Limit':'100,1000','X-RateLimit-Usage':'95,10'},
 {'X-ReadRateLimit-Limit':'100,1000','X-ReadRateLimit-Usage':'1,980'},
 {'X-RateLimit-Limit':'bad','X-RateLimit-Usage':'1,1'},
 {'X-RateLimit-Limit':'100,1000'},
])test(`headers de cuota detienen llamadas posteriores: ${Object.keys(headers).join(',')}`,async t=>{
 const f=await pilotFixture(t);let calls=0;const provider=async()=>{calls++;return Response.json([],{headers});};
 await transport(f,provider)(address,options);await assert.rejects(transport(f,provider)(address,options));assert.equal(calls,1);assert.ok((await f.runtime.status()).blockedUntil>f.time.now);
});

for(const retry of ['3600','Sun, 01 Nov 2026 13:00:00 GMT'])test(`429 Retry-After ${retry}: enfriamiento persistente y métricas anónimas`,async t=>{
 const f=await pilotFixture(t);const fetch=transport(f,async()=>Response.json({secret:'should not persist'},{status:429,headers:{'Retry-After':retry}}));
 await fetch(address,options);const status=await f.runtime.status();assert.equal(status.blockedUntil,f.time.now+3600000);assert.deepEqual(status.responses,{'429':1});assert.equal(JSON.stringify(status).includes('should not persist'),false);
 await f.runtime.erase();await assert.rejects(transport(f,async()=>{throw Error('Forbidden');})(address,options));
});

test('allowlist URL/método/redirect y respuesta desviada: falla cerrada sin secretos',async t=>{
 const f=await pilotFixture(t);let calls=0;const fetch=transport(f,async()=>{calls++;return Response.json([]);});
 for(const url of ['http://www.strava.com/api/v3/athlete/activities','https://evil.invalid/oauth/token','https://www.strava.com/api/v3/athletes/101','https://user@www.strava.com/oauth/token'])await assert.rejects(fetch(url,options));
 await assert.rejects(fetch(address,{redirect:'follow'}));assert.equal(calls,0);
 const diverted=transport(f,async()=>{const response=Response.json([]);Object.defineProperty(response,'url',{value:'https://evil.invalid/'});return response;});await assert.rejects(diverted(address,options),/pilot_transport_unavailable/);
});

test('dos reservas CAS concurrentes no superan el presupuesto',async t=>{
 const f=await pilotFixture(t);const provider=async()=>Response.json([]);
 for(let i=0;i<19;i++)await transport(f,provider)(address,options);
 const results=await Promise.allSettled([transport(f,provider)(address,options),transport(f,provider)(address,options)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.runtime.status()).requests,20);
});

test('redirect manual en workerd: no sigue 302 ni reenvía credenciales',async t=>{
 const f=await pilotFixture(t);let calls=0;
 const fetch=transport(f,async(url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://evil.invalid/'}});});
 await assert.rejects(fetch(address,options),/pilot_transport_unavailable/);assert.equal(calls,1);
});
