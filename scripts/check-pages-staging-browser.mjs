import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {extname,resolve,relative,sep} from 'node:path';
import {chromium} from 'playwright';
import {PAGES_STAGING_PROGRESS_URL} from '../frontend/js/http-progress.js';

const origin='https://plopesc.github.io',prefix='/albertoybelen/',apiOrigin=new URL(PAGES_STAGING_PROGRESS_URL).origin;
const output=resolve(process.env.PAGES_STAGING_OUTPUT??'artifacts/pages-staging');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-background-networking']});
const snapshots=[
 {schemaVersion:1,source:'strava',distanceKm:62.66,partial:true,stale:false,updatedAt:'2026-11-18T10:00:00Z',unlockedMilestoneIds:['milestone-20','milestone-40']},
 {schemaVersion:1,source:'strava',distanceKm:500,partial:true,stale:false,updatedAt:'2026-11-18T10:01:00Z',unlockedMilestoneIds:['milestone-20','milestone-40','milestone-60','milestone-80','finish']},
 {schemaVersion:1,source:'strava',distanceKm:62.66,partial:true,stale:true,updatedAt:'2026-11-18T10:01:00Z',unlockedMilestoneIds:['milestone-20','milestone-40','milestone-60','milestone-80','finish']},
 {schemaVersion:1,source:'strava',distanceKm:0,partial:true,stale:true,updatedAt:'2026-11-18T10:01:00Z',unlockedMilestoneIds:['milestone-20','milestone-40','milestone-60','milestone-80','finish']},
];
let reads=0;const requests=[],pageRequests=[];
try {
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.abort());
 await page.route(`${origin}${prefix}**`,async route=>{
  const url=new URL(route.request().url());pageRequests.push({url:url.href,referrer:route.request().headers().referer});let path=decodeURIComponent(url.pathname.slice(prefix.length));if(!path)path='index.html';
  const file=resolve('frontend',path),relativePath=relative(resolve('frontend'),file);if(relativePath.startsWith(`..${sep}`)||relativePath==='..')return route.abort();
  try{const body=await readFile(file);const type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[extname(file)]??'application/octet-stream';await route.fulfill({status:200,contentType:type,body});}catch{await route.fulfill({status:404,body:'not found'});}
 });
 await page.route(`${apiOrigin}/api/progress`,async route=>{
  const request=route.request(),headers=request.headers();requests.push({url:request.url(),method:request.method(),origin:headers.origin,referrer:headers.referer,authorization:headers.authorization,cookie:headers.cookie});
  const snapshot=snapshots[Math.min(reads++,snapshots.length-1)];await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://plopesc.github.io','Vary':'Origin','Cache-Control':'no-store'},body:JSON.stringify(snapshot)});
 });
 await page.goto(`${origin}${prefix}?pages-staging=strava&utm_source=chatgpt.com`);await page.waitForFunction(()=>document.getElementById('api-card')?.dataset.state==='ready');
 assert.equal(await page.locator('#distance').innerText(),'62,66');assert.equal(await page.locator('#goal').innerText(),'500');assert.equal(await page.locator('#mode-label').innerText(),'PRUEBA · STAGING STRAVA');assert.match(await page.locator('#api-source').innerText(),/PRUEBA · STAGING STRAVA/);assert.match(await page.locator('#api-state').innerText(),/parcial/i);assert.equal(await page.locator('#simulation-card').isVisible(),false);assert.match(await page.locator('#milestones [data-milestone="milestone-20"]').getAttribute('aria-label'),/abrir imagen desbloqueada/);
 await page.screenshot({path:resolve(output,'mobile-partial.png'),fullPage:true});if(await page.locator('#milestone-dialog').isVisible())await page.getByRole('button',{name:/cerrar recuerdos/i}).click();
 await page.getByRole('button',{name:/actualizar/i}).click();await page.waitForFunction(()=>document.getElementById('distance')?.textContent==='500');assert.equal(await page.locator('#completion-card').isVisible(),true);if(await page.locator('#milestone-dialog').isVisible())await page.getByRole('button',{name:/cerrar recuerdos/i}).click();await page.screenshot({path:resolve(output,'mobile-complete.png'),fullPage:true});
 await page.getByRole('button',{name:/actualizar/i}).click();await page.waitForFunction(()=>document.getElementById('distance')?.textContent==='62,66');assert.equal(await page.locator('#completion-card').isVisible(),true);
 await page.getByRole('button',{name:/actualizar/i}).click();await page.waitForFunction(()=>document.getElementById('distance')?.textContent==='0');assert.equal(await page.locator('#completion-card').isVisible(),true);assert.match(await page.locator('#milestones [data-milestone="milestone-80"]').getAttribute('aria-label'),/abrir imagen desbloqueada/);
 assert.deepEqual(requests.map(x=>x.method),['GET','GET','GET','GET']);assert.ok(requests.every(x=>x.url===PAGES_STAGING_PROGRESS_URL&&x.origin===origin&&x.referrer===undefined&&x.authorization===undefined&&x.cookie===undefined));assert.ok(pageRequests.some(x=>x.url===`${origin}${prefix}config/pages-staging.json`&&x.referrer===undefined));assert.deepEqual(errors,[]);
 const desktop=await context.newPage();await desktop.setViewportSize({width:1280,height:900});await desktop.route('**/*',route=>route.abort());
 await desktop.route(`${origin}${prefix}**`,async route=>{const url=new URL(route.request().url());let path=decodeURIComponent(url.pathname.slice(prefix.length));if(!path)path='index.html';const file=resolve('frontend',path);try{await route.fulfill({status:200,contentType:extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':extname(file)==='.json'?'application/json':'text/html',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'not found'});}});
  await desktop.route(`${apiOrigin}/api/progress`,async route=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'},body:JSON.stringify(snapshots[0])}));
  await desktop.goto(`${origin}${prefix}?pages-staging=strava`);await desktop.waitForFunction(()=>document.getElementById('api-card')?.dataset.state==='ready');assert.equal(await desktop.locator('#distance').innerText(),'62,66');await desktop.screenshot({path:resolve(output,'desktop-partial.png'),fullPage:true});
 await (await import('node:fs/promises')).writeFile(resolve(output,'manifest.json'),JSON.stringify({synthetic:true,realStravaRequests:0,realCloudflareRequests:0,origin,profile:'pages-staging-strava',apiUrl:PAGES_STAGING_PROGRESS_URL,snapshots:[62.66,500,62.66,0],requests:requests.length},null,2)+'\n');
 await context.close();await desktop.close();console.log('GitHub Pages opt-in UI verified with intercepted synthetic responses (0, 62.66, 500 and rollback); no external requests.');
}finally{await browser.close();}
