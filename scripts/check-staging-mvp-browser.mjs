import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {mvpRuntime} from '../tests/helpers/staging-mvp-runtime.js';
import {browserMockNetwork} from './lib/staging-auth-browser-network.mjs';
import {frontendServer} from './lib/frontend-server.mjs';
import {stagingStravaViewConfig} from './lib/staging-read.mjs';
import {prepareMvpPrivate} from './lib/staging-mvp-private.mjs';
import {callMvp} from './lib/staging-mvp-client.mjs';
import {MVP_ORIGIN} from '../backend/staging-mvp-policy.js';
if(process.argv.length!==2)throw Error('Only the closed synthetic browser test is supported');
const f=await mvpRuntime();let browser,network,server;
try {
 const output=resolve('artifacts/staging-mvp');await mkdir(output,{recursive:true});
 prepareMvpPrivate(f.directory);await writeFile(join(f.directory,'.local/staging-mvp/admin-token'),f.env.STAGING_ADMIN_TOKEN,{mode:0o600});
 const admin=operation=>callMvp({root:f.directory,operation,fetchAdmin:(url,options)=>f.mf.dispatchFetch(url,options)});
 const issue=await admin({type:'issue',slot:'slot-a',expectedAthleteId:101});assert.equal(issue.status,'issued');
 network=await browserMockNetwork({directory:f.directory,worker:{dispatchFetch:(url,options)=>f.mf.dispatchFetch(url,options)},athlete:()=>101});
 browser=await chromium.launch({headless:true,proxy:{server:network.proxy,bypass:'127.0.0.1,localhost'},args:['--no-sandbox','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}}),page=await context.newPage();
 await page.goto((await readFile(join(f.directory,issue.file),'utf8')).trim());await page.waitForURL('https://www.strava.com/oauth/authorize?**');await page.locator('#consent').click();await page.waitForURL(`${MVP_ORIGIN}/oauth/result`);
 assert.match(await page.locator('main').innerText(),/Autorización guardada/);await page.screenshot({path:join(output,'oauth-result.png'),fullPage:true});
 assert.equal(await page.evaluate(async()=> (await fetch('/admin/staging',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status),403);
 await context.close();
 assert.equal((await admin({type:'sync'})).status,'disabled');assert.equal((await admin({type:'enable-sync',confirmation:'enable-staging-sync'})).status,'enabled');assert.equal((await admin({type:'sync'})).status,'synced');
 const config=stagingStravaViewConfig(JSON.parse(await readFile('frontend/config/game.json','utf8')));
 server=frontendServer({root:resolve('frontend'),handle:async(req,res)=>{
  if(req.url==='/frontend/config/game.json'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(config));return true;}
  if(req.url==='/api/staging/strava-progress'){const dto=await(await f.request('/api/progress')).json();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(dto));return true;}
  return false;
 }});await new Promise(r=>server.listen(0,'127.0.0.1',r));const local=`http://127.0.0.1:${server.address().port}`;
 for(const [name,viewport]of Object.entries({mobile:{width:390,height:844},desktop:{width:1280,height:900}})){
  const c=await browser.newContext({viewport,reducedMotion:'reduce'}),p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>new URL(r.request().url()).origin===local?r.continue():r.abort());
  assert.equal((await p.goto(local+'/frontend/')).status(),200);await p.locator('#api-card').waitFor({state:'attached'});await p.waitForFunction(()=>document.getElementById('api-card').dataset.state==='ready');
  assert.equal(await p.locator('#distance').innerText(),'1,00');assert.equal(await p.locator('#mode-label').innerText(),'STAGING · STRAVA');assert.match(await p.locator('#api-state').innerText(),/parcial/i);assert.doesNotMatch(await p.locator('#api-source').innerText(),/FICTICI|PILOTO/);assert.equal(await p.locator('#simulation-card').isVisible(),false);assert.notEqual(await p.locator('#traveler').getAttribute('visibility'),'hidden');
  await p.screenshot({path:join(output,`${name}-strava.png`),fullPage:true});await p.reload();await p.waitForFunction(()=>document.getElementById('api-card').dataset.state==='ready');assert.equal(await p.locator('#distance').innerText(),'1,00');assert.deepEqual(errors,[]);await c.close();
 }
 assert.equal((await admin({type:'disable-sync'})).status,'disabled');
 await writeFile(join(output,'manifest.json'),JSON.stringify({synthetic:true,realStravaRequests:0,realCloudflareRequests:0,oneApiWorker:true,adminBearer:true,privateCliInvitation:true,secureCallback:true,encryptedD1:true,manualSync:true,source:'strava',partialWithOneAccount:true,screenshots:['oauth-result.png','mobile-strava.png','desktop-strava.png']},null,2)+'\n');
 console.log('Single-Worker staging MVP: private CLI invitation, mock TLS OAuth, encrypted D1, manual sync and mobile/desktop Strava map verified. No external requests.');
}finally{await browser?.close();await network?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
