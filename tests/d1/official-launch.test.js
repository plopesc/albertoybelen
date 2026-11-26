import test from 'node:test';
import assert from 'node:assert/strict';
import {mvpRuntime} from '../helpers/staging-mvp-runtime.js';
import {MVP_ORIGIN} from '../../backend/staging-mvp-policy.js';
import {createD1Repository} from '../../backend/d1/repository.js';

test('promoción cerrada, presentación sin cuentas y reconciliación desde la medianoche de Madrid',async()=>{
  const f=await mvpRuntime({officialClock:true});
  try {
    const promotion={type:'promote-challenge',confirmation:'promote-official-2026-11-28'};
    const pages=()=>f.request('/api/progress',{headers:{Origin:'https://plopesc.github.io'}});
    assert.equal((await pages()).headers.get('X-Challenge-Start'),null);
    await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'});
    assert.equal((await f.execute(promotion)).status,'failed');
    await f.execute({type:'disable-sync'});
    const repo=createD1Repository(f.db,{dataset:'staging-strava-test-v1'});
    await repo.updatePrivate(state=>{
      state.policy.unlockedMilestoneIds=['milestone-20'];
      state.sealedTokens['slot-a']={slot:'slot-a',generation:0,version:1,keyVersion:'synthetic',nonce:'abcdefghijklmnop',ciphertext:'synthetic-ciphertext-envelope'};
    });
    assert.equal((await f.execute(promotion)).status,'failed');
    assert.ok((await repo.read()).state.sealedTokens['slot-a']);
    await repo.updatePrivate(state=>{delete state.sealedTokens['slot-a'];});
    assert.equal((await f.execute(promotion)).status,'promoted');
    assert.equal((await f.execute(promotion)).status,'failed');
    const launch=await pages();
    assert.equal(launch.headers.get('X-Challenge-Start'),'2026-11-28');
    assert.equal(launch.headers.get('Access-Control-Expose-Headers'),'X-Challenge-Start');
    assert.deepEqual(await launch.json(),{schemaVersion:1,source:'strava',distanceKm:0,partial:true,stale:false,updatedAt:null,unlockedMilestoneIds:[]});
    assert.equal(await f.requestCount(),0);

    async function connect(slot,id) {
      const invitation=await f.execute({type:'issue',slot,expectedAthleteId:id});
      assert.equal(invitation.status,'issued');
      const cookie=(await f.request('/invite')).headers.get('Set-Cookie').split(';')[0];
      const start=await f.request('/invite/start',{
        method:'POST',headers:{Origin:MVP_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},
        body:JSON.stringify({token:new URL(invitation.invitation).hash.slice(1)}),
      });
      const url=new URL((await start.json()).authorizeUrl);
      const callback=await f.request(`/oauth/callback?${new URLSearchParams({state:url.searchParams.get('state'),code:`synthetic-code-${id}`,scope:'activity:read_all'})}`,{headers:{Cookie:cookie}});
      assert.match(callback.headers.get('Set-Cookie'),/=success;/);
    }
    await connect('slot-a',101);
    await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'});
    assert.equal((await f.execute({type:'sync'})).status,'synced');
    let dto=await (await pages()).json();
    assert.equal(dto.distanceKm,1.234);assert.equal(dto.partial,true);
    await connect('slot-b',202);
    assert.equal((await f.execute({type:'sync'})).status,'synced');
    await f.restart();
    dto=await (await pages()).json();
    assert.equal(dto.distanceKm,2.468);assert.equal(dto.partial,false);
    assert.deepEqual(dto.unlockedMilestoneIds,[]);
    assert.equal((await f.execute(promotion)).status,'failed');
    assert.equal((await (await pages()).json()).distanceKm,2.468);
  } finally {await f.close();}
});
