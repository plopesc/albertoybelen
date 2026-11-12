import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStagingAuth} from '../../backend/staging-auth.js';
import {createD1Repository} from '../../backend/d1/repository.js';
import {stagingEnvironment,stagingMock,stagingActor as actor} from '../helpers/staging-auth-fixture.js';
import {STAGING_AUTH_ORIGIN as origin,STAGING_NETWORK_ENABLE} from '../../backend/staging-auth-settings.js';

test('staging auth en workerd/D1 temporal: migración aditiva desde 0001/0002, callback dos cuentas, aislamiento y reinicio',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'staging-auth-d1-'));let mf;
  try {
    const bundle=await build({entryPoints:['backend/staging-auth-entry.js'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
    const env={...stagingEnvironment(),STAGING_NETWORK_ENABLED:STAGING_NETWORK_ENABLE};
    const mock=stagingMock({now:Date.now()});
    const options={...convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000040'},outboundService:async request=>mock.fetch(request.url,{method:request.method,headers:request.headers,body:request.method==='POST'?await request.text():undefined})}),resourcePersistencePath:join(dir,'persist'),telemetry:{enabled:false},logRequests:false};
    mf=new Miniflare(options);let db=await mf.getD1Database('DB');
    const migrations=new URL('../../backend/d1/migrations/',import.meta.url);
    const migrate=async file=>{for(const sql of(await readFile(new URL(file,migrations),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();};
    await migrate('0001_local_game.sql');
    await migrate('0002_oauth_vault.sql');
    const fixtures=createD1Repository(db);await fixtures.applyEvents([{participantId:'slot-a',generation:0,status:'connected',scopes:['activity:read_all']}]);
    const fixtureSnapshot=await fixtures.read();
    // Until 0003 is applied, the new entry fails closed instead of using fixture tables.
    assert.equal((await mf.dispatchFetch(`${origin}/api/progress`)).status,503);
    await migrate('0003_staging_auth_test.sql');
    let runtime=createStagingAuth({...env,DB:db},{fetchProvider:mock.fetch});
    async function connect(slot,id) {
      const link=await runtime.admin.issue({actor,slot,expectedAthleteId:id});
      const invite=await mf.dispatchFetch(`${origin}/invite`);assert.equal(invite.status,200);
      const cookie=invite.headers.get('Set-Cookie').split(';')[0];
      const start=await mf.dispatchFetch(`${origin}/invite/start`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(link).hash.slice(1)})});
      assert.equal(start.status,200);const authorize=new URL((await start.json()).authorizeUrl);
      assert.equal(authorize.searchParams.get('redirect_uri'),`${origin}/oauth/callback`);
      const url=`${origin}/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:`synthetic-code-${id}`,scope:'activity:read_all'})}`;
      const response=await mf.dispatchFetch(url,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/oauth/result');assert.match(response.headers.get('Set-Cookie'),/=success;/);
      const replay=await mf.dispatchFetch(url,{headers:{Cookie:cookie},redirect:'manual'});assert.match(replay.headers.get('Set-Cookie'),/=error;/);
    }
    await connect('slot-a',101);await connect('slot-b',202);await runtime.admin.sync({actor});
    const dto=await(await mf.dispatchFetch(`${origin}/api/progress`)).json();assert.equal(dto.source,'strava');assert.equal(dto.distanceKm,2);assert.equal(dto.partial,false);
    assert.doesNotMatch(JSON.stringify(dto),/athlete|token|slot-|scope/);
    assert.deepEqual(await fixtures.read(),fixtureSnapshot);
    assert.equal((await db.prepare('SELECT count(*) n FROM staging_auth_oauth_credentials').first()).n,2);
    assert.doesNotMatch(JSON.stringify((await runtime.repository.read()).state),/synthetic-access|synthetic-refresh|synthetic-private-title|synthetic-GPS/);
    await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB');runtime=createStagingAuth({...env,DB:db},{fetchProvider:mock.fetch});
    assert.deepEqual(await(await mf.dispatchFetch(`${origin}/api/progress`)).json(),dto);
    await runtime.admin.erase({actor,slot:'slot-a',verified:true,purgeMilestones:true});
    assert.equal((await(await mf.dispatchFetch(`${origin}/api/progress`)).json()).distanceKm,1);
    assert.deepEqual(await createD1Repository(db).read(),fixtureSnapshot);
  } finally {await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
