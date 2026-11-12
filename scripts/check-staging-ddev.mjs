import assert from'node:assert/strict';import{readFile,mkdir}from'node:fs/promises';import{resolve,extname,sep}from'node:path';import{chromium}from'playwright';
import{stagingReadServer,stagingViewConfig,STAGING_READ_URL,STAGING_READ_PORT}from'./lib/staging-read.mjs';import{assertDdevProject,assertPortsFree}from'./lib/ddev-preflight.mjs';
if(process.argv.length!==2)throw Error('No extra arguments');assertDdevProject();await assertPortsFree([STAGING_READ_PORT]);
const origin='https://albertoybelen.ddev.site',root=resolve('frontend'),output=resolve('artifacts/staging-ddev');await mkdir(output,{recursive:true});const config=stagingViewConfig(JSON.parse(await readFile(resolve(root,'config/game.json'),'utf8')));
const dto=(km,ids,partial=true)=>({schemaVersion:1,source:'fixture',distanceKm:km,partial,stale:false,updatedAt:km?'2026-11-01T12:00:00Z':null,unlockedMilestoneIds:ids});let current=dto(0,[]),bad=false,calls=0,browser;
const server=stagingReadServer({fetchUpstream:async(url,init)=>{assert.equal(url,STAGING_READ_URL);assert.deepEqual(init.headers,{Accept:'application/json'});calls++;return bad?new Response('{'):Response.json(current);}});
await new Promise(r=>server.listen(STAGING_READ_PORT,'127.0.0.1',r));
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',ignoreHTTPSErrors:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin){await route.abort();return;}
  if(!url.pathname.startsWith('/frontend/')){assert.notEqual(url.pathname,'/api/progress');await route.continue();return;}
  if(url.pathname==='/frontend/config/staging.local.json'){await route.fulfill({json:config});return;}
  const file=resolve(root,decodeURIComponent(url.pathname.slice('/frontend/'.length))||'index.html');if(!file.startsWith(root+sep)){await route.abort();return;}
  try{await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.jpeg':'image/jpeg','.jpg':'image/jpeg'})[extname(file)]??'application/octet-stream'});}catch{await route.fulfill({status:404,body:'not_found'});}
 });
 await context.addInitScript(()=>localStorage.setItem('strava-adventure:simulation:v2',JSON.stringify({version:2,distanceKm:999})));
 const ready=()=>page.waitForFunction(()=>document.getElementById('api-card').dataset.state==='ready');const refresh=async()=>{await page.locator('#api-refresh').click();await ready();};const dismiss=async()=>{while(await page.locator('#milestone-dialog').isVisible()){if(await page.locator('#reward-next').isVisible())await page.locator('#reward-next').click();else await page.locator('#reward-close').click();}};
 await page.goto(`${origin}/frontend/?staging-api=1`);await ready();assert.equal(await page.locator('#distance').innerText(),'0');assert.match(await page.locator('#api-source').innerText(),/DATOS FICTICIOS.*STAGING CLOUDFLARE/);assert.equal(await page.locator('#simulation-card').isVisible(),false);await page.screenshot({path:resolve(output,'mobile-zero.png'),fullPage:true});
 current=dto(40,['milestone-20','milestone-40']);await refresh();await dismiss();assert.equal(await page.locator('#distance').innerText(),'40');await page.screenshot({path:resolve(output,'mobile-partial.png'),fullPage:true});
 current=dto(105,['milestone-20','milestone-40','milestone-60','milestone-80','finish']);await refresh();await dismiss();assert.equal(await page.locator('#percentage').innerText(),'100 %');
 current=dto(20,current.unlockedMilestoneIds);await refresh();await page.reload();await ready();assert.equal(await page.locator('#completion-card').isVisible(),true);assert.equal(await page.locator('#milestone-dialog').isVisible(),false);await page.screenshot({path:resolve(output,'mobile-history.png'),fullPage:true});
 const before=calls;assert.equal((await page.request.post(`${origin}/api/staging/progress`,{data:{action:'sync'}})).status(),405);assert.equal((await page.request.get(`${origin}/api/staging/progress?url=https://invalid.example`)).status(),400);assert.equal(calls,before);
 bad=true;await page.locator('#api-refresh').click();await page.waitForFunction(()=>document.getElementById('api-card').dataset.state==='error');assert.equal(await page.locator('#distance').innerText(),'20');assert.match(await page.locator('#api-state').innerText(),/último dato/);assert.deepEqual(errors,[]);
 console.log('DDEV staging viewer: real local Nginx → read proxy → mocked upstream; zero/partial/100%/history/reload/error and GET-only restrictions verified. Pilot ports untouched; zero Cloudflare HTTP requests.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
