// Self-contained synthetic pilot: never loads private files or opens a Strava URL.
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm}from'node:fs/promises';import{readFileSync,statSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{Miniflare,convertV4MiniflareOptions}from'miniflare';import{build}from'esbuild';import{chromium}from'playwright';
import{createPilot,PILOT_ORIGIN}from'../backend/pilot.js';import{pilotEnvironment,pilotRows}from'../tests/helpers/pilot-fixture.js';
const dir=await mkdtemp(join(tmpdir(),'pilot-browser-'));let mf,browser;
try{
 const env=pilotEnvironment();let requests=0;
 const fake=async(address)=>{
  const url=new URL(address);assert.equal(url.origin,'https://www.strava.com');requests++;
  if(url.pathname==='/oauth/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,athlete:{id:101}});
  assert.equal(url.pathname,'/api/v3/athlete/activities');return Response.json(url.searchParams.get('page')==='1'?pilotRows():[]);
 };
 const bundle=await build({entryPoints:['backend/pilot-entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
 mf=new Miniflare({...convertV4MiniflareOptions({https:true,host:'127.0.0.1',port:8790,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000029'},outboundService:request=>fake(request.url)}),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false},logRequests:false});
 await mf.ready;const db=await mf.getD1Database('DB');const migrations=new URL('../backend/d1/migrations/',import.meta.url);
 for(const file of(await readdir(migrations)).sort())for(const sql of(await readFile(new URL(file,migrations),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 const pilot=createPilot({...env,DB:db},{fetchProvider:fake});const link=await pilot.issue();const logStart=statSync('/var/log/nginx/access.log').size;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});const page=await context.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).origin===PILOT_ORIGIN?route.continue():route.abort());
 await page.goto(`${PILOT_ORIGIN}/invite`);
 const authorize=await page.evaluate(async(token)=>{
  const response=await fetch('/invite/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw Error('Synthetic start failed');return(await response.json()).authorizeUrl;
 },new URL(link).hash.slice(1));
 const url=new URL(authorize);assert.equal(url.origin,'https://www.strava.com');assert.equal(url.searchParams.get('scope'),'activity:read_all');assert.equal(url.searchParams.get('redirect_uri'),`${PILOT_ORIGIN}/oauth/callback`);
 // Simulate the provider callback locally. Do not navigate to the authorize URL.
 await page.goto(`${PILOT_ORIGIN}/oauth/callback?${new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code',scope:'activity:read_all'})}`);
 assert.equal(page.url(),`${PILOT_ORIGIN}/oauth/result`);
 assert.match(await page.locator('main').innerText(),/Autorización guardada/i);
 const cookies=await context.cookies();const session=cookies.find(c=>c.name==='__Host-strava-attempt');assert.equal(session.secure,true);assert.equal(session.httpOnly,true);assert.equal(session.sameSite,'Lax');
 await pilot.sync();const response=await page.request.get(`${PILOT_ORIGIN}/api/progress`);const dto=await response.json();assert.equal(dto.source,'strava-pilot');assert.equal(dto.distanceKm,2.2345);assert.equal(dto.partial,true);assert.equal(dto.stale,false);assert.equal(requests,5);assert.doesNotMatch(JSON.stringify(dto),/token|athlete|slot-|scopes|synthetic/);
 const logTail=readFileSync('/var/log/nginx/access.log').subarray(logStart).toString();for(const value of [new URL(link).hash.slice(1),url.searchParams.get('state'),'synthetic-code'])assert.equal(logTail.includes(value),false);
 console.log('Synthetic pilot DDEV HTTPS: callback in workerd, secure cookie, clean URL, encrypted D1 and 2.2345 km partial aggregate verified. No Strava URL opened or real request sent.');
}finally{await browser?.close();await mf?.dispose();await rm(dir,{recursive:true,force:true});}
