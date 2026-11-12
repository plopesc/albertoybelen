import test from 'node:test';import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions}from'miniflare';import{build}from'esbuild';import{mkdtemp,readdir,readFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{createPilot,PILOT_ORIGIN}from'../../backend/pilot.js';import{pilotEnvironment,pilotRows}from'../helpers/pilot-fixture.js';

test('piloto D1/workerd local: callback HTTPS en forma, ciphertext, sync y reinicio durable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'alberto-pilot-'));let mf;
 try{
  const bundle=await build({entryPoints:['backend/pilot-entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
  const env=pilotEnvironment();let requests=0;
  const fake=async(address,options)=>{
   const url=new URL(address);assert.equal(url.origin,'https://www.strava.com');requests++;
   if(url.pathname==='/oauth/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,athlete:{id:101}});
   assert.equal(url.pathname,'/api/v3/athlete/activities');return Response.json(url.searchParams.get('page')==='1'?pilotRows():[]);
  };
  const options={...convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000029'},outboundService:request=>fake(request.url,{})}),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false}};
  mf=new Miniflare(options);let db=await mf.getD1Database('DB');
  const migrations=new URL('../../backend/d1/migrations/',import.meta.url);for(const file of(await readdir(migrations)).sort())for(const sql of(await readFile(new URL(file,migrations),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  let pilot=createPilot({...env,DB:db},{fetchProvider:fake});const link=await pilot.issue();
  // Router in Node with a real D1 binding; workerd serves public HTTP below.
  const invite=await pilot.fetch(new Request(`${PILOT_ORIGIN}/invite`));const cookie=invite.headers.get('Set-Cookie').split(';')[0];
  const start=await pilot.fetch(new Request(`${PILOT_ORIGIN}/invite/start`,{method:'POST',headers:{Origin:PILOT_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).hash.slice(1)})}));const authorized=new URL((await start.json()).authorizeUrl);
  const callback=await pilot.fetch(new Request(`${PILOT_ORIGIN}/oauth/callback?${new URLSearchParams({state:authorized.searchParams.get('state'),code:'synthetic-code',scope:'activity:read_all'})}`,{headers:{Cookie:cookie}}));assert.match(callback.headers.get('Set-Cookie'),/=success;/);
  await pilot.sync();assert.equal(requests,5);
  const response=await mf.dispatchFetch(`${PILOT_ORIGIN}/api/progress`);assert.equal(response.status,200);const dto=await response.json();assert.equal(dto.distanceKm,2.2345);assert.equal(dto.partial,true);assert.equal(dto.source,'strava-pilot');
  assert.doesNotMatch(JSON.stringify(dto),/token|athlete|slot-|scope/);assert.equal((await db.prepare('SELECT count(*) n FROM oauth_credentials').first()).n,1);
  assert.doesNotMatch(JSON.stringify((await pilot.repository.read()).state),/synthetic-access|synthetic-refresh|synthetic-private-title|synthetic-GPS/);
  await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB');pilot=createPilot({...env,DB:db},{fetchProvider:fake});
  assert.equal((await pilot.status()).activities,2);assert.equal((await pilot.status()).requests,5);assert.equal((await(await mf.dispatchFetch(`${PILOT_ORIGIN}/api/progress`)).json()).distanceKm,2.2345);
  await pilot.erase();assert.equal((await pilot.status()).activities,0);assert.deepEqual((await pilot.repository.read()).state.sealedTokens,{});
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
