import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {extname,resolve,relative,sep} from 'node:path';
import {chromium,devices} from 'playwright';
import {PAGES_STAGING_PROGRESS_URL as endpoint} from '../frontend/js/http-progress.js';

const origin='https://plopesc.github.io',prefix='/albertoybelen/',output=resolve(process.env.LIVE_UI_OUTPUT??'artifacts/live-ui');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-background-networking']});
const snapshots=[
 {schemaVersion:1,source:'strava',distanceKm:0,partial:true,stale:false,updatedAt:null,unlockedMilestoneIds:[]},
 {schemaVersion:1,source:'strava',distanceKm:62.6602,partial:true,stale:true,updatedAt:'2026-11-28T10:00:00Z',unlockedMilestoneIds:['milestone-20','milestone-40']},
 {schemaVersion:1,source:'strava',distanceKm:500,partial:false,stale:false,updatedAt:'2026-11-28T10:02:00Z',unlockedMilestoneIds:['milestone-20','milestone-40','milestone-60','milestone-80','finish']},
];
let reads=0;const requests=[];
async function servePage(route){
 const url=new URL(route.request().url());let path=decodeURIComponent(url.pathname.slice(prefix.length));if(!path)path='index.html';
 const file=resolve('frontend',path),relativePath=relative(resolve('frontend'),file);if(relativePath.startsWith(`..${sep}`)||relativePath==='..')return route.abort();
 try{await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[extname(file)]??'application/octet-stream',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'not found'});}
}
async function openLivePage(context,viewport,instant,mode='official'){
 const page=await context.newPage();await page.setViewportSize(viewport);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.abort());await page.route(`${origin}${prefix}**`,servePage);
 await page.clock.setFixedTime(new Date(instant));
 await page.route(endpoint,async route=>{
  const req=route.request(),headers=await req.allHeaders();
  requests.push({url:req.url(),method:req.method(),referer:headers.referer,cookie:headers.cookie,authorization:headers.authorization});
  const snapshot=mode==='pilot'?snapshots[1]:snapshots[Math.min(reads++,snapshots.length-1)];
  const cors={'Cache-Control':'no-store','Access-Control-Allow-Origin':origin};
  if(mode==='official') Object.assign(cors,{'X-Challenge-Start':'2026-11-28','Access-Control-Expose-Headers':'X-Challenge-Start'});
  await route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify(snapshot)});
 });
 await page.goto(`${origin}${prefix}?utm_source=presentacion`);
 await page.waitForFunction(expected=>document.getElementById('api-card')?.dataset.state===expected,mode==='pilot'?'error':'ready');
 assert.deepEqual(errors,[]);
 return page;
}
try{
 const mobileContext=await browser.newContext({...devices['iPhone 13'],reducedMotion:'reduce'});
 const before=await openLivePage(mobileContext,{width:390,height:844},'2026-11-27T22:59:59Z');
 assert.equal(await before.locator('#distance').innerText(),'0,00');
 assert.match(await before.locator('#api-state').innerText(),/empieza el 28/);
 assert.equal(requests.length,0);
 await before.close();
 const pilot=await openLivePage(mobileContext,{width:390,height:844},'2026-11-27T23:00:00Z','pilot');
 assert.equal(await pilot.locator('#progress').isVisible(),false);
 assert.equal(await pilot.locator('#completion-card').isVisible(),false);
 await pilot.close();
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
 assert.equal(requests.length,4,'one rejected pilot, one launch read and two tab refreshes');assert.equal(await mobile.locator('#remaining').innerText(),'0,00');assert.equal(await mobile.locator('#completion-card').isVisible(),true);assert.equal(await mobile.getByRole('button',{name:'Abrir regalo final'}).isVisible(),true);assert.match(await mobile.locator('#status').innerText(),/¡Reto completado!/);
 if(await mobile.locator('#milestone-dialog').isVisible())await mobile.getByRole('button',{name:/cerrar recuerdos/i}).click();await mobile.screenshot({path:resolve(output,'mobile-complete.png'),fullPage:true});
 reads=1;const desktopContext=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),desktop=await openLivePage(desktopContext,{width:1440,height:1000},'2026-11-28T12:00:00Z');
 assert.equal(await desktop.locator('#distance').innerText(),'62,66');assert.equal(await desktop.locator('#remaining').innerText(),'437,34');
 const desktopLayout=await desktop.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,grid:getComputedStyle(document.querySelector('.adventure-layout')).gridTemplateColumns}));assert.ok(desktopLayout.scroll<=desktopLayout.width,`desktop horizontal overflow: ${JSON.stringify(desktopLayout)}`);await desktop.screenshot({path:resolve(output,'desktop-live.png'),fullPage:true});
 assert.deepEqual(requests.map(x=>x.method),Array(5).fill('GET'));assert.ok(requests.every(x=>x.url===endpoint&&x.referer===undefined&&x.cookie===undefined&&x.authorization===undefined));
 await writeFile(resolve(output,'manifest.json'),JSON.stringify({synthetic:true,realStravaRequests:0,realCloudflareRequests:0,profile:'official-pages-root',viewports:[{width:390,height:844},{width:1440,height:1000}],requests:requests.length,snapshots:[0,62.6602,500]},null,2)+'\n');
 await mobileContext.close();await desktopContext.close();console.log('Live presentation verified at mobile and desktop sizes; one refresh occurs on return to the tab, with intercepted synthetic responses only.');
}finally{await browser.close();}
