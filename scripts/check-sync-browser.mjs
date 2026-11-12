import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const vars = readFileSync(new URL('../.dev.vars',import.meta.url),'utf8');
if (!/^OAUTH_MODE=mock$/m.test(vars)) throw Error('Mock-only browser check');
const origin = 'https://albertoybelen.ddev.site';
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const context = await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  const page = await context.newPage();
  await page.route('**/*',route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`${origin}/frontend/`,{waitUntil:'networkidle'});
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/progress',{cache:'no-store'});
    return {status:response.status,cache:response.headers.get('Cache-Control'),dto:await response.json()};
  });
  assert.equal(result.status,200);assert.equal(result.cache,'no-store');assert.equal(result.dto.distanceKm,102.50525);assert.equal(result.dto.partial,false);assert.equal(result.dto.stale,false);assert.ok(result.dto.unlockedMilestoneIds.includes('finish'));
  assert.deepEqual(Object.keys(result.dto).sort(),['schemaVersion','source','distanceKm','partial','stale','updatedAt','unlockedMilestoneIds'].sort());
  console.log('DDEV HTTPS browser: public aggregate 102.50525 km, complete, fresh, finish persisted; schema whitelist verified.');
} finally {await browser.close();}
