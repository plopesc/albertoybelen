import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorRuntime} from '../helpers/staging-operator-runtime.js';
import {signOperatorCommand} from '../../scripts/lib/staging-operator-client.mjs';
import {createD1Repository} from '../../backend/d1/repository.js';
import {STAGING_AUTH_ORIGIN as origin} from '../../backend/staging-auth-settings.js';

test('RPC privado workerd/D1: HTTP inaccesible, firma, dos cuentas, sync/replay/disable y reinicio',async()=>{
  const f=await operatorRuntime();
  try {
    for(const path of ['/','/execute','/admin','/invite','/api/progress'])for(const method of ['GET','POST','OPTIONS'])assert.equal((await f.operatorFetch(path,{method,headers:{Origin:origin,'Cf-Access-Jwt-Assertion':'forged','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({actor:{authenticated:true,role:'owner'}})}:{})})).status,404);
    assert.equal((await f.operatorFetch()).status,404);
    assert.equal((await f.send({actor:{authenticated:true,role:'owner'}})).status,'rejected');
    const fixtures=createD1Repository(f.db),snapshot=await fixtures.read();
    for(const [slot,id] of [['slot-a',101],['slot-b',202]]) {
      const issue=await f.execute({type:'issue',slot,expectedAthleteId:id});assert.equal(issue.status,'issued');
      const invite=await f.publicFetch('/invite');const cookie=invite.headers.get('Set-Cookie').split(';')[0];
      const start=await f.publicFetch('/invite/start',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(issue.invitation).hash.slice(1)})});assert.equal(start.status,200);
      const authorize=new URL((await start.json()).authorizeUrl);
      const callback=await f.publicFetch(`/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:`synthetic-code-${id}`,scope:'activity:read_all'})}`,{headers:{Cookie:cookie}});assert.match(callback.headers.get('Set-Cookie'),/=success;/);
    }
    assert.equal((await f.execute({type:'sync'})).status,'disabled');
    assert.equal((await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'})).status,'enabled');
    const envelope=await signOperatorCommand({privateKey:f.identity.privateKey,keyId:f.identity.policy.id,subject:f.identity.policy.subject,operation:{type:'sync'}});
    assert.equal((await f.send(envelope)).status,'synced');const count=await f.requestCount();assert.equal((await f.send(envelope)).status,'replay');assert.equal(await f.requestCount(),count);
    const dto=await(await f.publicFetch('/api/progress')).json();assert.equal(dto.distanceKm,2);assert.equal(dto.partial,false);assert.doesNotMatch(JSON.stringify(dto),/operator|audit|receipt|slot-|token|athlete/);
    for(const path of ['/admin','/execute','/api/sync'])assert.equal((await f.publicFetch(path)).status,404);
    await f.restart();assert.equal((await f.send(envelope)).status,'replay');assert.equal((await f.execute({type:'status'})).progress.distanceKm,2);
    assert.equal((await f.execute({type:'disable-sync'})).status,'disabled');assert.equal((await f.execute({type:'sync'})).status,'disabled');
    assert.equal((await f.execute({type:'erase',slot:'slot-a',confirmation:'verified-staging-deletion',purgeMilestones:true})).status,'erased');assert.equal((await(await f.publicFetch('/api/progress')).json()).distanceKm,1);
    assert.deepEqual(await createD1Repository(f.db).read(),snapshot);
    const state=(await createD1Repository(f.db,{dataset:'staging-strava-test-v1'}).read()).state;
    assert.doesNotMatch(JSON.stringify(state.stagingOperator),/invite#|slot-|expectedAthlete|payload|signature|synthetic-owner/);
  } finally {await f.close();}
});

test('release cerrada sin activar OAuth/red ni inicializar datos aunque llegue un comando firmado',async()=>{
  const f=await operatorRuntime({closed:true});
  try {
    for(const path of ['/api/progress','/invite','/oauth/callback'])assert.equal((await f.publicFetch(path)).status,503);
    assert.equal((await f.execute({type:'status'})).status,'unavailable');
    assert.equal((await f.db.prepare('SELECT count(*) n FROM staging_auth_game_state').first()).n,0);
    assert.equal((await f.db.prepare('SELECT count(*) n FROM game_state').first()).n,0);
    assert.equal(await f.requestCount(),0);
  }finally{await f.close();}
});
