import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {randomBytes} from 'node:crypto';
import {PRODUCTION_DATASET,PRODUCTION_MIGRATION,PRODUCTION_ADMIN_PATH,PRODUCTION_CRON,requireProductionTarget} from '../../backend/production-target.js';
import {PAGES_STAGING_PROGRESS_URL} from '../../frontend/js/http-progress.js';

const target={origin:'https://production-runtime.example',routing:'custom-domain',databaseId:'fd70fb63-8cfb-4406-a3d7-a3a12aaf6f67'}; // Mock only.
const start=Date.parse('2026-11-27T23:00:00Z');
const now=start+3600000;
const pages='https://plopesc.github.io';
const token=randomBytes(32).toString('base64url');
const flags=['nodejs_compat'];
const bindings={APP_ENV:PRODUCTION_DATASET,PRODUCTION_ADMIN_TOKEN:token,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),TOKEN_ENCRYPTION_KEY_VERSION:'v1',STRAVA_CLIENT_ID:'123',STRAVA_CLIENT_SECRET:'synthetic'};
const compile=async options=>(await build({...options,bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:workers']})).outputFiles[0].text;

test('production pins reject unverified targets and staging coordinates',()=>{
  assert.throws(()=>requireProductionTarget({origin:null,routing:null,databaseId:null}));
  assert.throws(()=>requireProductionTarget({...target,origin:new URL(PAGES_STAGING_PROGRESS_URL).origin}));
  assert.throws(()=>requireProductionTarget({...target,databaseId:'c6bde806-cf94-4ff3-8c4f-c08b8de477f6'}));
  assert.throws(()=>requireProductionTarget({...target,origin:target.origin+'/api/progress'}));
});

test('production D1, empty presentation, CORS, guarded OAuth and inclusive Madrid boundary',async()=>{
  const script=await compile({stdin:{resolveDir:process.cwd(),contents:`
    import {createProductionWorker} from './backend/production-worker.js';
    const app = createProductionWorker({target:${JSON.stringify(target)},clock:()=>${now}});
    export default {fetch:(request,env)=>app.fetch(request,{...env,PRODUCTION_OAUTH:request.headers.has('X-Local-Test-OAuth')?'owner-enabled':'disabled'}),
      scheduled:(event,env)=>app.scheduled(event,{...env,PRODUCTION_OAUTH:'owner-enabled'})};
  `}});
  const provider=await compile({entryPoints:['tests/helpers/staging-strava-worker.js'],banner:{js:`Date.now=()=>${now};`}});
  const mf=new Miniflare({...convertV4MiniflareOptions({workers:[
    {name:'production-test',modules:true,script,compatibilityDate:'2026-11-01',compatibilityFlags:flags,bindings,d1Databases:{DB:'production-test-db'},outboundService:{name:'provider'}},
    {name:'provider',modules:true,script:provider,compatibilityDate:'2026-11-01',compatibilityFlags:flags,outboundService:()=>{throw Error('Network forbidden');}},
  ]}),telemetry:{enabled:false}});
  try {
    const db=await mf.getD1Database('DB','production-test');
    const request=(path,init={})=>mf.dispatchFetch(target.origin+path,{redirect:'manual',...init});
    const progress=(headers={Origin:pages})=>request('/api/progress',{headers});
    assert.equal((await progress()).status,503);
    await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT)').run();
    const ddl=await readFile(new URL(`../../backend/d1/production-migrations/${PRODUCTION_MIGRATION}`,import.meta.url),'utf8');
    for(const sql of ddl.split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare('INSERT INTO d1_migrations VALUES(1,?)').bind('0003_staging_auth_test.sql').run();
    assert.equal((await progress()).status,503);
    await db.prepare('UPDATE d1_migrations SET name=? WHERE id=1').bind(PRODUCTION_MIGRATION).run();
    await db.prepare('CREATE TABLE staging_auth_game_state (id TEXT)').run();
    assert.equal((await progress()).status,503);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM production_game_state').first()).count,0);
    await db.prepare('DROP TABLE staging_auth_game_state').run();
    const initial=await progress();
    assert.equal(initial.status,200);
    assert.equal(initial.headers.get('Access-Control-Allow-Origin'),pages);
    assert.equal(initial.headers.get('X-Challenge-Start'),'2026-11-28');
    assert.equal(initial.headers.get('X-Challenge-Environment'),'production');
    assert.match(initial.headers.get('Access-Control-Expose-Headers'),/X-Challenge-Start/);
    assert.deepEqual(await initial.json(),{schemaVersion:1,source:'strava',distanceKm:0,partial:true,stale:false,updatedAt:null,unlockedMilestoneIds:[]});
    assert.equal((await progress({Origin:pages,Cookie:'test=1'})).status,403);
    assert.equal((await progress({Origin:'https://other.example'})).headers.get('Access-Control-Allow-Origin'),null);
    assert.equal((await request('/api/progress',{method:'OPTIONS',headers:{Origin:pages}})).headers.get('Access-Control-Allow-Origin'),null);
    assert.equal((await request('/invite')).status,404);

    const envelope=operation=>({version:1,audience:PRODUCTION_DATASET,issuedAt:now,expiresAt:now+120000,nonce:randomBytes(32).toString('base64url'),operation});
    const command=(body,{oauth=true,extra={}}={})=>request(PRODUCTION_ADMIN_PATH,{method:'POST',headers:{
      ...(oauth?{'X-Local-Test-OAuth':'1'}:{}),Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
    const execute=async operation=>(await command(envelope(operation))).json();
    const status=envelope({type:'slot-status'});
    const first=await command(status);
    assert.equal(first.status,200,await first.clone().text());
    assert.equal(first.headers.get('Access-Control-Allow-Origin'),null);
    assert.deepEqual((await first.json()).slots.map(s=>s.status),['disconnected','disconnected']);
    assert.equal((await (await command(status)).json()).status,'replay');
    assert.equal((await command(envelope({type:'status'}),{extra:{Origin:pages}})).status,403);
    assert.equal((await command({...envelope({type:'status'}),audience:'staging-strava-test-v1'})).status,400);
    assert.equal((await command(envelope({type:'promote-challenge',confirmation:'promote-official-2026-11-28'}))).status,400);
    assert.equal((await (await command(envelope({type:'issue',slot:'slot-a',expectedAthleteId:101}),{oauth:false})).json()).status,'failed');
    await (await mf.getWorker('production-test')).scheduled({cron:PRODUCTION_CRON,scheduledTime:now});
    assert.equal(await (await mf.getWorker('provider')).count(),0);

    async function connect(slot,id) {
      const invitation=await execute({type:'issue',slot,expectedAthleteId:id});
      assert.equal(invitation.status,'issued');
      const enabled={'X-Local-Test-OAuth':'1'};
      const invite=await request('/invite',{headers:enabled});
      const cookie=invite.headers.get('Set-Cookie').split(';')[0];
      const begin=()=>request('/invite/start',{method:'POST',headers:{...enabled,Cookie:cookie,Origin:target.origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(invitation.invitation).hash.slice(1)})});
      const start=await begin();
      const oauth=new URL((await start.json()).authorizeUrl);
      assert.equal(oauth.searchParams.get('redirect_uri'),target.origin+'/oauth/callback');
      const query=new URLSearchParams({state:oauth.searchParams.get('state'),code:`synthetic-code-${id}`,scope:'activity:read_all'});
      const callback=await request('/oauth/callback?'+query,{headers:{...enabled,Cookie:cookie}});
      assert.match(callback.headers.get('Set-Cookie'),/=success;/);
      assert.equal((await begin()).status,400);
    }
    await connect('slot-a',101);
    assert.equal((await execute({type:'enable-sync',confirmation:'enable-production-sync'})).status,'enabled');
    assert.equal((await execute({type:'sync'})).status,'synced');
    let snapshot=await (await progress()).json();
    assert.equal(snapshot.distanceKm,1.234);assert.equal(snapshot.partial,true);
    await connect('slot-b',202);
    assert.equal((await execute({type:'sync'})).status,'synced');
    snapshot=await (await progress()).json();
    assert.equal(snapshot.distanceKm,2.468);assert.equal(snapshot.partial,false);
    assert.doesNotMatch(JSON.stringify(snapshot),/slot-|athlete|token/);
    const stored=(await db.prepare('SELECT ciphertext FROM production_oauth_credentials').all()).results;
    assert.equal(stored.length,2);assert.doesNotMatch(JSON.stringify(stored),/synthetic-access|synthetic-refresh/);
  } finally { await mf.dispose(); }
});
