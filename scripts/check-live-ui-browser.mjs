import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {extname,resolve,relative,sep} from 'node:path';
import {chromium,devices} from 'playwright';
import {PAGES_MODE} from '../frontend/js/pages-mode.js';
const endpoint='https://production-browser.example/api/progress';

const origin='https://plopesc.github.io',prefix='/albertoybelen/',output=resolve(process.env.LIVE_UI_OUTPUT??'artifacts/live-ui');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-background-networking']});
const snapshots=[
 {schemaVersion:1,source:'strava',distanceKm:0,partial:true,stale:false,updatedAt:null,unlockedMilestoneIds:[]},
 {schemaVersion:1,source:'strava',distanceKm:62.6602,partial:true,stale:true,updatedAt:'2026-11-28T10:00:00Z',unlockedMilestoneIds:['milestone-20','milestone-40']},
 {schemaVersion:1,source:'strava',distanceKm:500,partial:false,stale:false,updatedAt:'2026-11-28T10:02:00Z',unlockedMilestoneIds:['milestone-20','milestone-40','milestone-60','milestone-80','finish']},
];
let reads=0;const requests=[];
async function servePage(route,live=true){
 const url=new URL(route.request().url());let path=decodeURIComponent(url.pathname.slice(prefix.length));if(!path)path='index.html';
 const mode=live?'live':'simulation';
 if(path==='js/pages-mode.js'&&PAGES_MODE!==mode) return route.fulfill({contentType:'text/javascript',body:`export const PAGES_MODE = '${mode}';`});
 if(live&&path==='js/http-progress.js'){
  const source=await readFile('frontend/js/http-progress.js','utf8');
  return route.fulfill({contentType:'text/javascript',body:source.replace(/export const PAGES_PRODUCTION_PROGRESS_URL = [^;]+;/,`export const PAGES_PRODUCTION_PROGRESS_URL = '${endpoint}';`)});
 }
 if(live&&path==='config/pages-live.json'){
  const profile=JSON.parse(await readFile('frontend/config/pages-live.json','utf8'));
  profile.api.url=endpoint;
  return route.fulfill({json:profile});
 }
 const file=resolve('frontend',path),relativePath=relative(resolve('frontend'),file);if(relativePath.startsWith(`..${sep}`)||relativePath==='..')return route.abort();
 try{await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[extname(file)]??'application/octet-stream',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'not found'});}
}
async function openLivePage(context,viewport,instant,mode='official'){
 const page=await context.newPage();await page.setViewportSize(viewport);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.abort());await page.route(`${origin}${prefix}**`,route=>servePage(route));
 await page.clock.setFixedTime(new Date(instant));
 await page.route(endpoint,async route=>{
  const req=route.request(),headers=await req.allHeaders();
  requests.push({url:req.url(),method:req.method(),referer:headers.referer,cookie:headers.cookie,authorization:headers.authorization});
  const snapshot=mode!=='official'?snapshots[1]:snapshots[Math.min(reads++,snapshots.length-1)];
  const cors={'Cache-Control':'no-store','Access-Control-Allow-Origin':origin};
  Object.assign(cors,{'X-Challenge-Start':mode==='wrong-date'?'2026-11-01':'2026-11-28','X-Challenge-Environment':mode==='pilot'?'staging':'production','Access-Control-Expose-Headers':'X-Challenge-Start, X-Challenge-Environment'});
  await route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify(snapshot)});
 });
 await page.goto(`${origin}${prefix}?utm_source=presentacion`);
 await page.waitForFunction(expected=>document.getElementById('api-card')?.dataset.state===expected,mode==='official'?'ready':'error');
 assert.deepEqual(errors,[]);
 return page;
}
async function checkDemoRewards(context, device) {
 const demo=await context.newPage();
 const demoReads=[];
 await demo.route('**/*',route=>route.abort());
 await demo.route(`${origin}${prefix}**`,route=>servePage(route,false));
 demo.on('request',req=>demoReads.push(req.url()));
 await demo.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'));
 await demo.goto(`${origin}${prefix}?utm_source=demo`);
 const increment=demo.locator('[data-km="10"]');
 await increment.waitFor();
 assert.equal(await demo.locator('#mode-label').innerText(),'MODO SIMULADO');
 assert.equal(await demo.locator('#api-card').isVisible(),false);
 const photo=demo.locator('#reward-photo'),dialog=demo.locator('#milestone-dialog');
 for(const [title,file] of [
  ['Antes del «sí, quiero», ya había unas cuantas historias.','milestone-20.webp'],
  ['Algunas noches se acaban. Las anécdotas se quedan para siempre.','milestone-40.webp'],
  ['Si hay que hacer el ridículo, que sea en buena compañía.','milestone-60.webp'],
  ['Qué suerte seguir compartiendo la vida y sus celebraciones con vosotros.','milestone-80.webp'],
  ['¡Por vosotros y por todo lo que viene!','milestone-100.webp'],
 ]){
  await increment.click();
  await increment.click();
  await dialog.waitFor();
  assert.equal(await demo.locator('#reward-description').innerText(),title);
  assert.equal(await demo.locator('#reward-close').evaluate(node=>node===document.activeElement),true);
  await demo.locator('#reward-view').click();
  await photo.waitFor();
  await photo.evaluate(img=>img.decode());
  assert.ok((await photo.getAttribute('src')).endsWith('/'+file));

  await photo.scrollIntoViewIfNeeded();
  const layout=await photo.evaluate(img=>{
   const {width,height,left,right,top,bottom}=img.getBoundingClientRect();
   const dialog=img.closest('dialog');
   const panel=dialog.getBoundingClientRect();
   return {width,height,left,right,top,bottom,panelLeft:panel.left,panelRight:panel.right,
    panelTop:panel.top,panelBottom:panel.bottom,viewportWidth:innerWidth,
    viewportHeight:innerHeight,intrinsicRatio:img.naturalWidth/img.naturalHeight,objectFit:getComputedStyle(img).objectFit};
  });
  assert.ok(layout.width>0 && layout.height>0, `${device} ${file} visible`);
  assert.ok(Math.abs(layout.width/layout.height-layout.intrinsicRatio)<0.01, `${device} ${file} keeps its natural proportions`);
  assert.notEqual(layout.objectFit,'cover');
  assert.ok(layout.left>=layout.panelLeft && layout.right<=layout.panelRight && layout.panelRight<=layout.viewportWidth);
  assert.ok(layout.top>=Math.max(0,layout.panelTop) && layout.bottom<=Math.min(layout.viewportHeight,layout.panelBottom)+1,
    `${device} ${file} can be seen entirely inside the dialog`);
  assert.ok(layout.height<=layout.viewportHeight*0.60+1, `${device} ${file} fits the viewport`);

  if(file==='milestone-40.webp'||file==='milestone-100.webp'){
   const scene=file==='milestone-40.webp'?'portrait':'final';
   if(scene==='final')assert.match(await demo.locator('#reward-message').innerText(),/¡Salud!/);
   await dialog.screenshot({path:resolve(output,`reward-${device}-${scene}-after.png`),animations:'disabled'});
   // Reapply the original fixed frame for the review comparison only.
   const formerFrame=await demo.addStyleTag({content:`
    .reward-photo-wrap { margin: 8px 0 0; border: 2px solid #a98b53; padding: 6px; background: #182e23; box-shadow: 0 3px 0 #12261c; }
    .reward-photo-wrap img { display: block; width: 100%; height: auto; max-width: none; max-height: none; aspect-ratio: 20 / 13; object-fit: cover; box-shadow: none; }
    .reward-photo-wrap figcaption { padding: 8px 4px 2px; }
   `});
   await dialog.screenshot({path:resolve(output,`reward-${device}-${scene}-before.png`),animations:'disabled'});
   await formerFrame.evaluate(style=>style.remove());
  }
  if(device==='mobile'&&file==='milestone-100.webp'){
   const viewport=demo.viewportSize();
   await demo.setViewportSize({width:viewport.width,height:360});
   const scroll=await dialog.evaluate(node=>{
    node.scrollTop=node.scrollHeight;
    return {top:node.scrollTop,height:node.clientHeight,total:node.scrollHeight};
   });
   assert.ok(scroll.total>scroll.height && scroll.top>0,'short mobile viewport scrolls inside the dialog');
   await demo.setViewportSize(viewport);
  }
  await demo.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await increment.evaluate(node=>node===document.activeElement),true);
 }
 assert.ok(demoReads.every(url=>url.startsWith(origin+prefix) && !url.includes('/api/') && !url.includes('/config/pages-live.json')));
 await demo.close();
}

try{
 const mobileContext=await browser.newContext({...devices['iPhone 13'],reducedMotion:'reduce'});
 const desktopDemo=await browser.newContext({viewport:{width:1440,height:1000}});
 await checkDemoRewards(mobileContext,'mobile');
 await checkDemoRewards(desktopDemo,'desktop');
 await desktopDemo.close();
 const before=await openLivePage(mobileContext,{width:390,height:844},'2026-11-27T22:59:59Z');
 assert.equal(await before.locator('#distance').innerText(),'0,00');
 assert.match(await before.locator('#api-state').innerText(),/empieza el 28/);
 assert.equal(requests.length,0);
 await before.close();
 const pilot=await openLivePage(mobileContext,{width:390,height:844},'2026-11-27T23:00:00Z','pilot');
 assert.equal(await pilot.locator('#progress').isVisible(),false);
 assert.equal(await pilot.locator('#completion-card').isVisible(),false);
 await pilot.close();
 const wrongDate=await openLivePage(mobileContext,{width:390,height:844},'2026-11-27T23:00:00Z','wrong-date');
 assert.equal(await wrongDate.locator('#progress').isVisible(),false);
 await wrongDate.close();
 const mobile=await openLivePage(mobileContext,{width:390,height:844},'2026-11-27T23:00:00Z');
 assert.equal(await mobile.locator('#distance').innerText(),'0,00');
 assert.match(await mobile.locator('#api-state').innerText(),/cuentas de Strava pendiente/);
 await mobile.screenshot({path:resolve(output,'mobile-launch.png'),fullPage:true});
 async function refresh(page, distance){
  await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__visibilityState??'visible'}));
  await page.evaluate(()=>{window.__visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));window.__visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(value=>document.getElementById('distance')?.textContent===value,distance);
 }
 await refresh(mobile,'62,66');
 assert.equal(await mobile.locator('body').getAttribute('class'),'live-presentation');
 assert.equal(await mobile.locator('#distance').innerText(),'62,66');assert.equal(await mobile.locator('#remaining').innerText(),'437,34');assert.equal(await mobile.locator('#goal').innerText(),'500');
 for(const selector of ['header.site-header .mode','#api-source','#api-refresh','#api-instruction','#journey-message','#data-source'])assert.equal(await mobile.locator(selector).isVisible(),false,`${selector} hidden in live`);
 assert.match(await mobile.locator('#api-state').innerText(),/parcial/i);assert.match(await mobile.locator('#api-state').innerText(),/actualización pendiente/i);assert.match(await mobile.locator('#api-updated').innerText(),/actualización conocida/i);
 assert.match(await mobile.locator('.intro .eyebrow').innerText(),/NUESTRO RECORRIDO/);
 const layout=await mobile.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,remaining:document.querySelector('#remaining').getBoundingClientRect().toJSON(),remainingText:getComputedStyle(document.querySelector('#remaining').parentElement).whiteSpace}));
 assert.ok(layout.scroll<=layout.width,`mobile horizontal overflow: ${JSON.stringify(layout)}`);assert.equal(layout.remainingText,'nowrap');await mobile.screenshot({path:resolve(output,'mobile-live.png'),fullPage:true});
 await refresh(mobile,'500,00');
 assert.equal(requests.length,5,'two rejected responses, one launch read and two tab refreshes');assert.equal(await mobile.locator('#remaining').innerText(),'0,00');assert.equal(await mobile.locator('#completion-card').isVisible(),true);assert.equal(await mobile.getByRole('button',{name:'ABRIR EL REGALO DE PABLO Y DANI'}).isVisible(),true);assert.match(await mobile.locator('#status').innerText(),/¡Y ahora empieza lo bueno!/);
 if(await mobile.locator('#milestone-dialog').isVisible())await mobile.getByRole('button',{name:/seguir el camino/i}).click();await mobile.screenshot({path:resolve(output,'mobile-complete.png'),fullPage:true});
 reads=1;const desktopContext=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),desktop=await openLivePage(desktopContext,{width:1440,height:1000},'2026-11-28T12:00:00Z');
 assert.equal(await desktop.locator('#distance').innerText(),'62,66');assert.equal(await desktop.locator('#remaining').innerText(),'437,34');
 const desktopLayout=await desktop.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,grid:getComputedStyle(document.querySelector('.adventure-layout')).gridTemplateColumns}));assert.ok(desktopLayout.scroll<=desktopLayout.width,`desktop horizontal overflow: ${JSON.stringify(desktopLayout)}`);await desktop.screenshot({path:resolve(output,'desktop-live.png'),fullPage:true});
 assert.deepEqual(requests.map(x=>x.method),Array(6).fill('GET'));assert.ok(requests.every(x=>x.url===endpoint&&x.referer===undefined&&x.cookie===undefined&&x.authorization===undefined));
 await writeFile(resolve(output,'manifest.json'),JSON.stringify({synthetic:true,realStravaRequests:0,realCloudflareRequests:0,profile:'official-pages-root',viewports:[{width:390,height:844},{width:1440,height:1000}],requests:requests.length,snapshots:[0,62.6602,500]},null,2)+'\n');
 await mobileContext.close();await desktopContext.close();console.log('Five photos and live presentation verified on mobile and desktop using intercepted responses only.');
}finally{await browser.close();}
