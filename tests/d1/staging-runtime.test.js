import test from'node:test';import assert from'node:assert/strict';import{readFile,readdir,mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{build}from'esbuild';import{Miniflare,convertV4MiniflareOptions}from'miniflare';
import{createD1Repository}from'../../backend/d1/repository.js';import{defaultFixtureEvents}from'../../backend/fixtures.js';
test('config staging: Worker y migraciones existentes en D1 solo local; HTTP y reinicio sin OAuth/Cron',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'staging-local-'));let mf;
 try{
  const config=JSON.parse(await readFile('wrangler.staging.jsonc','utf8'));const bundle=await build({entryPoints:[config.main],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
  const options={...convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:config.vars,d1Databases:{DB:config.d1_databases[0].database_id},outboundService:()=>{throw Error('Remote access forbidden');}}),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false}};
  mf=new Miniflare(options);let db=await mf.getD1Database('DB');assert.equal((await mf.dispatchFetch('http://local/api/progress')).status,503);
  const migrations=new URL('../../backend/d1/migrations/',import.meta.url);for(const file of(await readdir(migrations)).sort())for(const sql of(await readFile(new URL(file,migrations),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const initial=await(await mf.dispatchFetch('http://local/api/progress')).json();assert.equal(initial.distanceKm,0);assert.equal(initial.source,'fixture');assert.equal(initial.partial,true);
  await createD1Repository(db).applyEvents(defaultFixtureEvents());const response=await mf.dispatchFetch('http://local/api/progress');const dto=await response.json();assert.equal(dto.distanceKm,4.00075);assert.equal(dto.partial,false);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.doesNotMatch(JSON.stringify(dto),/slot-|token|scope|athlete|c6bde806/);
  for(const path of ['/invite','/oauth/callback','/api/sync','/__scheduled'])assert.equal((await mf.dispatchFetch(`http://local${path}`)).status,404);
  await mf.dispose();mf=new Miniflare(options);assert.deepEqual(await(await mf.dispatchFetch('http://local/api/progress')).json(),dto);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
