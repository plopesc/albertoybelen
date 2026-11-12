// Browser uses a loopback-only TLS/CONNECT mock, including native HTTP redirects.
// No credentials or persistent state are read from the project or environment.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {browserMockNetwork} from './lib/staging-auth-browser-network.mjs';
import {createStagingAuth} from '../backend/staging-auth.js';
import {stagingEnvironment,stagingMock,stagingActor as actor} from '../tests/helpers/staging-auth-fixture.js';
import {STAGING_AUTH_ORIGIN as origin,STAGING_NETWORK_ENABLE} from '../backend/staging-auth-settings.js';
if(process.argv.length!==2)throw Error('No arguments or real-network flags supported');
const dir=await mkdtemp(join(tmpdir(),'staging-auth-browser-'));let mf,browser,network;
try {
  const bundle=await build({entryPoints:['backend/staging-auth-entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
  const env={...stagingEnvironment(),STAGING_NETWORK_ENABLED:STAGING_NETWORK_ENABLE};
  const mock=stagingMock({now:Date.now()});
  mf=new Miniflare({...convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000040'},outboundService:async request=>mock.fetch(request.url,{method:request.method,headers:request.headers,body:request.method==='POST'?await request.text():undefined})}),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false},logRequests:false});
  const db=await mf.getD1Database('DB');const migrations=new URL('../backend/d1/migrations/',import.meta.url);
  for(const file of(await readdir(migrations)).sort())for(const sql of(await readFile(new URL(file,migrations),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const open=()=>createStagingAuth({...env,DB:db},{fetchProvider:mock.fetch});
  const output=resolve('artifacts/staging-auth');await mkdir(output,{recursive:true});
  let currentAthlete=101;
  network=await browserMockNetwork({directory:dir,worker:mf,athlete:()=>currentAthlete});
  browser=await chromium.launch({headless:true,proxy:{server:network.proxy},args:['--no-sandbox','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  for(const [slot,id] of [['slot-a',101],['slot-b',202]]) {
    currentAthlete=id;
    const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    if(slot==='slot-a') {
      await page.goto(`${origin}/invite`);assert.match(await page.locator('h1').innerText(),/Staging/);
      await page.screenshot({path:join(output,'invite.png'),fullPage:true});
      const csrf=await page.evaluate(async()=> (await fetch('/invite/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status);assert.equal(csrf,400);
    }
    const link=await open().admin.issue({actor,slot,expectedAthleteId:id});
    await page.goto('about:blank');await page.goto(link);await page.waitForURL('https://www.strava.com/oauth/authorize?**');
    await page.locator('#consent').click();await page.waitForURL(`${origin}/oauth/result`);
    assert.match(await page.locator('main').innerText(),/Autorización guardada/);assert.equal(page.url(),`${origin}/oauth/result`);
    const cookie=(await context.cookies()).find(c=>c.name==='__Host-strava-attempt');assert.ok(cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');
    if(slot==='slot-b')await page.screenshot({path:join(output,'result.png'),fullPage:true});
    await page.reload();assert.doesNotMatch(await page.locator('main').innerText(),/Autorización guardada/); // one-use result cookie
    await context.close();
  }
  await open().admin.sync({actor});
  const response=await mf.dispatchFetch(`${origin}/api/progress`);const dto=await response.json();assert.equal(dto.distanceKm,2);assert.equal(dto.partial,false);assert.equal(dto.source,'strava');
  assert.doesNotMatch(JSON.stringify(dto),/athlete|token|slot-|scope/);
  const state=JSON.stringify((await open().repository.read()).state);for(const value of ['synthetic-access','synthetic-refresh',env.STRAVA_CLIENT_SECRET,env.TOKEN_ENCRYPTION_KEY])assert.equal(state.includes(value),false);
  await writeFile(join(output,'manifest.json'),JSON.stringify({synthetic:true,realStravaRequests:0,realCloudflareRequests:0,interceptedBrowserRequests:network.intercepted,cases:['two-private-invitations','HTTPS-callback','secure-cookie','clean-result-url','one-use-result','encrypted-D1','aggregate-progress'],screenshots:['invite.png','result.png']},null,2)+'\n');
  console.log('Staging OAuth browser: two synthetic accounts, intercepted provider, HTTPS callback, secure cookies, clean URLs, encrypted D1 and aggregate verified. No real requests.');
} finally {await browser?.close();await network?.close();await mf?.dispose();await rm(dir,{recursive:true,force:true});}
