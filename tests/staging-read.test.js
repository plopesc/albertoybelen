import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
import{readStaging,stagingReadServer,STAGING_READ_URL,STAGING_READ_PORT,stagingViewConfig}from'../scripts/lib/staging-read.mjs';
import{resolveProgressEndpoint,createHttpProgressProvider}from'../frontend/js/http-progress.js';import{loadRuntimeConfig,STAGING_CONFIG_URL}from'../frontend/js/runtime-config.js';
const dto=(extra={})=>({schemaVersion:1,source:'fixture',distanceKm:0,partial:true,stale:false,updatedAt:null,unlockedMilestoneIds:[],...extra});

test('proxy solo GET a URL aprobada, sin cookie/autorización o headers recibidos',async t=>{
 let calls=0;const server=stagingReadServer({fetchUpstream:async(url,init)=>{calls++;assert.equal(url,STAGING_READ_URL);assert.equal(url,'https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/api/progress');assert.equal(init.method,'GET');assert.deepEqual(init.headers,{Accept:'application/json'});assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);return Response.json(dto(),{headers:{'Set-Cookie':'private=hidden','Location':'https://invalid.example/','Cache-Control':'public, max-age=3600'}});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));const origin=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(`${origin}/api/progress`,{headers:{Cookie:'synthetic-private',Authorization:'Bearer synthetic-private',Origin:'https://untrusted.example','X-Upstream':'https://evil.invalid'}});assert.equal(response.status,200);assert.deepEqual(await response.json(),dto());assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Location'),null);
 for(const path of ['/api/progress?url=https://evil.invalid','/oauth/callback','/api/sync','/api/progress/','/'])assert.equal((await fetch(`${origin}${path}`)).status,404);
 for(const method of ['POST','PUT','DELETE','HEAD','OPTIONS'])assert.equal((await fetch(`${origin}/api/progress`,{method})).status,405);assert.equal(calls,1);assert.equal(STAGING_READ_PORT,8792);
});

test('error/redirección/JSON/source/campos excesivos fallan sin devolver detalle privado',async()=>{
 for(const response of [()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}),()=>new Response('sensitive',{status:503}),()=>new Response('{'),()=>Response.json(dto({source:'strava-pilot'})),()=>Response.json(dto({athleteId:'sensitive'})),()=>new Response('x'.repeat(65537))])await assert.rejects(readStaging({fetchUpstream:async()=>response()}),error=>error.message==='staging_unavailable');
});

test('timeout y cancelación llegan al upstream incluso ante mocks que ignoran signal',async()=>{
 let captured;await assert.rejects(readStaging({timeoutMs:10,fetchUpstream:async(url,init)=>{captured=init.signal;return new Promise(()=>{});}}),/staging_unavailable/);assert.equal(captured.aborted,true);
 const controller=new AbortController();const work=readStaging({signal:controller.signal,fetchUpstream:async(url,init)=>{captured=init.signal;return new Promise(()=>{});}});controller.abort();await assert.rejects(work);assert.equal(captured.aborted,true);
});

test('TLS inseguro aborta antes de enviar',async()=>{
 const previous=process.env.NODE_TLS_REJECT_UNAUTHORIZED;process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';let calls=0;
 try{await assert.rejects(readStaging({fetchUpstream:async()=>{calls++;return Response.json(dto());}}));assert.equal(calls,0);}finally{if(previous===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=previous;}
});

test('perfil staging separado: opt-in solo DDEV, sin mezclarse con local o producción',async()=>{
 const profile=stagingViewConfig({game:{title:'A y B',mode:'simulation'},rewards:{}});assert.equal(profile.game.id,'local-ddev-cloudflare-staging');assert.equal(profile.game.goalKm,100);assert.equal(profile.game.startDate,'2026-11-01');assert.equal(profile.game.timeZone,'Europe/Madrid');
 const fetchConfig=async url=>{assert.equal(String(url),String(STAGING_CONFIG_URL));return Response.json(profile);};const pageUrl='https://albertoybelen.ddev.site/frontend/?staging-api=1';assert.equal((await loadRuntimeConfig({pageUrl,fetchConfig})).game.id,profile.game.id);
 for(const page of ['https://plopesc.github.io/albertoybelen/?staging-api=1','https://albertoybelen.ddev.site/frontend/?staging-api=1&local-api=1','https://albertoybelen.ddev.site/frontend/?staging-api=1&staging-api=1','https://albertoybelen.ddev.site/frontend/?staging-api=0'])await assert.rejects(loadRuntimeConfig({pageUrl:page,fetchConfig}));
 assert.equal(resolveProgressEndpoint('/api/staging/progress',pageUrl,true),'https://albertoybelen.ddev.site/api/staging/progress');assert.throws(()=>resolveProgressEndpoint('/api/staging/progress','https://plopesc.github.io/albertoybelen/',true));assert.throws(()=>resolveProgressEndpoint(STAGING_READ_URL,pageUrl,true));assert.throws(()=>resolveProgressEndpoint('/api/staging/progress',pageUrl,false));
 const p=createHttpProgressProvider({url:'/api/staging/progress',pageUrl,allowFixtures:true,fetchProgress:async()=>Response.json(dto({source:'strava'}))});await p.refresh();assert.equal(p.getState().snapshot,null);
});

test('CLI smoke/proxy no admiten activación implícita ni upstream arbitrario',()=>{
 for(const [script,args]of [['scripts/staging-read-smoke.mjs',[]],['scripts/staging-read-smoke.mjs',['https://evil.invalid']],['scripts/staging-read-proxy.mjs',['--upstream','https://evil.invalid']],['scripts/staging-read-proxy-config.mjs',['enable','extra']]])assert.notEqual(spawnSync(process.execPath,[script,...args]).status,0);
});

test('desconectar cliente del proxy cancela el GET upstream',async t=>{
 let enter,stopped;const entered=new Promise(r=>{enter=r;}),aborted=new Promise(r=>{stopped=r;});
 const server=stagingReadServer({fetchUpstream:async(url,init)=>{init.signal.addEventListener('abort',stopped,{once:true});enter();return new Promise(()=>{});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const controller=new AbortController();const work=fetch(`http://127.0.0.1:${server.address().port}/api/progress`,{signal:controller.signal});await entered;controller.abort();await assert.rejects(work);await aborted;
});

test('proveedor staging mantiene la respuesta más nueva y valida fixture exclusivamente',async()=>{
 let first,count=0;const p=createHttpProgressProvider({url:'/api/staging/progress',pageUrl:'https://albertoybelen.ddev.site/frontend/?staging-api=1',allowFixtures:true,fetchProgress:()=>++count===1?new Promise(r=>{first=r;}):Promise.resolve(Response.json(dto({distanceKm:40}))) });
 const old=p.refresh();await p.refresh();first(Response.json(dto({distanceKm:20})));await old;assert.equal(p.getState().snapshot.distanceKm,40);
});
