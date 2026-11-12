// Closed TLS proxy + native RPC/mocked provider Workers. No external DNS or forwarding.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {operatorRuntime} from '../tests/helpers/staging-operator-runtime.js';
import {browserMockNetwork} from './lib/staging-auth-browser-network.mjs';
import {STAGING_AUTH_ORIGIN as origin} from '../backend/staging-auth-settings.js';
if(process.argv.length!==2)throw Error('Only the isolated synthetic test is supported');
const f=await operatorRuntime();let browser,network,currentAthlete=101;
try {
  network=await browserMockNetwork({directory:f.directory,worker:{dispatchFetch:(url,options)=>f.mf.dispatchFetch(url,options)},athlete:()=>currentAthlete});
  browser=await chromium.launch({headless:true,proxy:{server:network.proxy},args:['--no-sandbox','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  const output=resolve('artifacts/staging-operator');await mkdir(output,{recursive:true});
  for(const [slot,id] of [['slot-a',101],['slot-b',202]]) {
    currentAthlete=id;const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    const result=await f.execute({type:'issue',slot,expectedAthleteId:id});assert.equal(result.status,'issued');
    await page.goto(result.invitation);await page.waitForURL('https://www.strava.com/oauth/authorize?**');await page.locator('#consent').click();await page.waitForURL(`${origin}/oauth/result`);
    assert.match(await page.locator('main').innerText(),/Autorización guardada/);
    const cookie=(await context.cookies()).find(c=>c.name==='__Host-strava-attempt');assert.ok(cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');
    const rejected=await page.evaluate(async()=> (await fetch('/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor:{authenticated:true,role:'owner'},operation:{type:'sync'}})})).status);assert.equal(rejected,404);
    if(slot==='slot-b')await page.screenshot({path:join(output,'result.png'),fullPage:true});
    await page.reload();assert.doesNotMatch(await page.locator('main').innerText(),/Autorización guardada/);await context.close();
  }
  assert.equal((await f.execute({type:'sync'})).status,'disabled');
  assert.equal((await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'})).status,'enabled');assert.equal((await f.execute({type:'sync'})).status,'synced');
  const dto=await(await f.publicFetch('/api/progress')).json();assert.equal(dto.distanceKm,2);assert.equal(dto.partial,false);assert.doesNotMatch(JSON.stringify(dto),/operator|audit|receipt|athlete|token|slot-/);
  assert.equal((await f.execute({type:'disable-sync'})).status,'disabled');assert.equal((await f.execute({type:'sync'})).status,'disabled');
  await writeFile(join(output,'manifest.json'),JSON.stringify({synthetic:true,realCloudflareRequests:0,realStravaRequests:0,privateServiceBindingRPC:true,signedCommands:true,twoAccounts:true,defaultSyncDisabled:true,publicAdminRejected:true,secureCookies:true,cleanCallback:true,aggregate:true,screenshots:['result.png']},null,2)+'\n');
  console.log('Private operator browser: signed service-binding RPC, two mock accounts, secure callback, public admin rejected, aggregate and sync disable verified; local TLS/provider only.');
} finally {await browser?.close();await network?.close();await f.close();}
