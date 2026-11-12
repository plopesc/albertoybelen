// Self-contained synthetic pilot: never loads private files or opens a Strava URL.
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,mkdir,writeFile}from'node:fs/promises';import{readFileSync,statSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{Miniflare,convertV4MiniflareOptions}from'miniflare';import{build}from'esbuild';import{chromium}from'playwright';
import{createPilot,PILOT_ORIGIN}from'../backend/pilot.js';import{pilotEnvironment,pilotRows}from'../tests/helpers/pilot-fixture.js';
import{assertDdevProject,assertPortsFree}from'./lib/ddev-preflight.mjs';import{frontendServer}from'./lib/frontend-server.mjs';
const phaseA=process.argv[2]==='--phase-a';
if(process.argv.length!==(phaseA?3:2))throw Error('Only optional --phase-a is supported');
if(phaseA){assertDdevProject();await assertPortsFree([8790,8791]);}
const dir=await mkdtemp(join(tmpdir(),'pilot-browser-'));let mf,browser,server;
try{
 const env=pilotEnvironment();let requests=0,rows=pilotRows(),activityStatus=200;
 const fake=async(address)=>{
  const url=new URL(address);assert.equal(url.origin,'https://www.strava.com');requests++;
  if(url.pathname==='/oauth/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,athlete:{id:101}});
  assert.equal(url.pathname,'/api/v3/athlete/activities');
  if(activityStatus!==200)return Response.json({message:'Synthetic rate limit'},{status:activityStatus,headers:{'Retry-After':'900'}});
  return Response.json(url.searchParams.get('page')==='1'?rows:[]);
 };
 const bundle=await build({entryPoints:['backend/pilot-entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
 mf=new Miniflare({...convertV4MiniflareOptions({https:true,host:'127.0.0.1',port:8790,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000029'},outboundService:request=>fake(request.url)}),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false},logRequests:false});
 const listening=await mf.ready;if(phaseA)assert.equal(listening.port,'8790');const db=await mf.getD1Database('DB');const migrations=new URL('../backend/d1/migrations/',import.meta.url);
 for(const file of(await readdir(migrations)).sort())for(const sql of(await readFile(new URL(file,migrations),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 const openPilot=()=>createPilot({...env,DB:db},{fetchProvider:fake});let pilot=openPilot();const link=await pilot.issue();const logStart=statSync('/var/log/nginx/access.log').size;
 if(phaseA){
  const config=JSON.parse(await readFile('frontend/config/game.json','utf8'));
  config.game={...config.game,id:'local-ddev-phase-a-synthetic',title:'Ensayo sintético fase A · Alberto y Belén',mode:'real',goalKm:500,startDate:'2026-11-01',timeZone:'Europe/Madrid'};config.api={url:'/api/progress',allowFixtures:false};
  server=frontendServer({root:resolve('frontend'),handle:async(req,res)=>{if(new URL(req.url,PILOT_ORIGIN).pathname!=='/frontend/config/local.json')return false;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return true;}});
  await new Promise(r=>server.listen(8791,'127.0.0.1',r));
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});const page=await context.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).origin===PILOT_ORIGIN?route.continue():route.abort());
 await page.goto(`${PILOT_ORIGIN}/invite`);
 if(phaseA){
  const rejected=await page.request.post(`${PILOT_ORIGIN}/invite/start`,{headers:{Origin:'https://invalid.example'},data:{token:new URL(link).hash.slice(1)}});assert.equal(rejected.status(),403);assert.equal(requests,0);
 }
 const authorize=await page.evaluate(async(token)=>{
  const response=await fetch('/invite/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw Error('Synthetic start failed');return(await response.json()).authorizeUrl;
 },new URL(link).hash.slice(1));
 const url=new URL(authorize);assert.equal(url.origin,'https://www.strava.com');assert.equal(url.searchParams.get('scope'),'activity:read_all');assert.equal(url.searchParams.get('redirect_uri'),`${PILOT_ORIGIN}/oauth/callback`);
 if(phaseA){
  const rejected=await page.request.get(`${PILOT_ORIGIN}/oauth/callback?${new URLSearchParams({state:'A'.repeat(43),code:'synthetic-code',scope:'activity:read_all'})}`,{maxRedirects:0});assert.equal(rejected.status(),303);assert.match(rejected.headers()['set-cookie'],/=error;/);assert.equal(requests,0);
 }
 // Simulate the provider callback locally. Do not navigate to the authorize URL.
 await page.goto(`${PILOT_ORIGIN}/oauth/callback?${new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code',scope:'activity:read_all'})}`);
 assert.equal(page.url(),`${PILOT_ORIGIN}/oauth/result`);
 assert.match(await page.locator('main').innerText(),/Autorización guardada/i);
 const cookies=await context.cookies();const session=cookies.find(c=>c.name==='__Host-strava-attempt');assert.equal(session.secure,true);assert.equal(session.httpOnly,true);assert.equal(session.sameSite,'Lax');
 if(phaseA){
  const replay=await page.request.get(`${PILOT_ORIGIN}/oauth/callback?${new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code',scope:'activity:read_all'})}`,{maxRedirects:0});assert.equal(replay.status(),303);assert.match(replay.headers()['set-cookie'],/=error;/);assert.equal(requests,1);
 }
 await pilot.sync();const response=await page.request.get(`${PILOT_ORIGIN}/api/progress`);const dto=await response.json();assert.equal(dto.source,'strava-pilot');assert.equal(dto.distanceKm,2.2345);assert.equal(dto.partial,true);assert.equal(dto.stale,false);assert.equal(requests,5);assert.doesNotMatch(JSON.stringify(dto),/token|athlete|slot-|scopes|synthetic/);
 if(phaseA){
  const stored=(await pilot.repository.read()).state;
  assert.equal(Object.keys(stored.sealedTokens).length,1);assert.equal(stored.auth.slots[1].status,'disconnected');
  const privateJson=JSON.stringify(stored);for(const secret of ['synthetic-access','synthetic-refresh',env.STRAVA_CLIENT_SECRET,env.TOKEN_ENCRYPTION_KEY,'synthetic-private-title','synthetic-GPS'])assert.equal(privateJson.includes(secret),false);
  const credentials=await pilot.service.credentials('slot-a');assert.equal(typeof credentials.accessToken,'string');
  const settled=()=>page.waitForFunction(()=>document.getElementById('api-card').dataset.state==='ready');
  const refresh=async()=>{const before=requests;await page.locator('#api-refresh').click();await settled();assert.equal(requests,before);};
  await page.goto(`${PILOT_ORIGIN}/frontend/?local-api=1`);await settled();assert.equal(await page.locator('#distance').innerText(),'2,2345');assert.equal(await page.locator('#goal').innerText(),'500');assert.match(await page.locator('#api-state').innerText(),/parcial/);assert.equal(await page.locator('#simulation-card').isVisible(),false);
  rows=[{...pilotRows()[0],distance:600000}];pilot=openPilot();await pilot.sync();await refresh();
  while(await page.locator('#milestone-dialog').isVisible()){if(await page.locator('#reward-next').isVisible())await page.locator('#reward-next').click();else await page.locator('#reward-close').click();}
  assert.equal(await page.locator('#percentage').innerText(),'100 %');assert.equal(await page.locator('#remaining').innerText(),'0');
  rows=[{...pilotRows()[0],distance:20000}];pilot=openPilot();await pilot.sync();await refresh();assert.equal(await page.locator('#distance').innerText(),'20');assert.equal(await page.locator('#completion-card').isVisible(),true);
  await page.reload();await settled();assert.equal(await page.locator('#milestone-dialog').isVisible(),false);
  activityStatus=429;pilot=openPilot();await pilot.sync();await refresh();assert.match(await page.locator('#api-state').innerText(),/Actualización pendiente/);assert.equal(await page.locator('#distance').innerText(),'20');
  const stopped=requests;pilot=openPilot();await pilot.sync();assert.equal(requests,stopped);await pilot.refresh();assert.equal(requests,stopped);
  await pilot.revoke();await refresh();assert.equal(requests,stopped);assert.deepEqual((await pilot.repository.read()).state.sealedTokens,{});
  await pilot.erase();await refresh();assert.equal(await page.locator('#distance').innerText(),'0');assert.equal(await page.locator('#completion-card').isVisible(),false);
  const clean=(await pilot.repository.read()).state;assert.deepEqual(clean.auth.invitations,{});assert.deepEqual(clean.auth.attempts,{});assert.deepEqual(clean.oauthSessions,{});assert.equal(Object.keys(clean.metadata).length,0);
  const output=resolve('artifacts/phase-a');await mkdir(output,{recursive:true});await writeFile(join(output,'evidence.json'),JSON.stringify({phase:'A',synthetic:true,realStravaRequests:0,interceptedRequests:requests,oauthCiphertext:true,map:true,partial:true,history:true,rateLimit:true,revoked:true,erased:true,phaseB:'pending-authorization'},null,2));
 }
 const logTail=readFileSync('/var/log/nginx/access.log').subarray(logStart).toString();for(const value of [new URL(link).hash.slice(1),url.searchParams.get('state'),'synthetic-code'])assert.equal(logTail.includes(value),false);
 console.log(phaseA?'Phase A complete: synthetic OAuth → encrypted D1 → activity sync → API → DDEV map; history, rate limit, local revoke/erase verified. STOP: phase B pending separate authorization.':'Synthetic pilot DDEV HTTPS: callback in workerd, secure cookie, clean URL, encrypted D1 and 2.2345 km partial aggregate verified. No Strava URL opened or real request sent.');
}finally{await browser?.close();await mf?.dispose();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(dir,{recursive:true,force:true});}
