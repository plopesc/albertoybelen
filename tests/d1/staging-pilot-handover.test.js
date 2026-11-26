import test from 'node:test';
import assert from 'node:assert/strict';
import {mvpRuntime} from '../helpers/staging-mvp-runtime.js';
import {mvpCommand} from '../../scripts/lib/staging-mvp-client.mjs';
import {MVP_ORIGIN} from '../../backend/staging-mvp-policy.js';
import {createD1Repository} from '../../backend/d1/repository.js';

test('retirada verificada del piloto y consentimiento posterior en ambas plazas', async () => {
  const f = await mvpRuntime();
  try {
    async function begin(slot, id) {
      const issued = await f.execute({type:'issue',slot,expectedAthleteId:id});
      assert.equal(issued.status,'issued');
      const cookie = (await f.request('/invite')).headers.get('Set-Cookie').split(';')[0];
      const start = await f.request('/invite/start',{
        method:'POST',headers:{Origin:MVP_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},
        body:JSON.stringify({token:new URL(issued.invitation).hash.slice(1)}),
      });
      const authorize = new URL((await start.json()).authorizeUrl);
      return async (consentingId, scope='activity:read_all') => f.request(
        `/oauth/callback?${new URLSearchParams({state:authorize.searchParams.get('state'),code:`synthetic-code-${consentingId}`,scope})}`,
        {headers:{Cookie:cookie}},
      );
    }
    const oldCallback = await begin('slot-a',101);
    assert.match((await oldCallback(101)).headers.get('Set-Cookie'),/=success;/);
    assert.equal((await f.execute({type:'issue',slot:'slot-a',expectedAthleteId:202})).status,'failed');
    await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'});
    assert.equal((await f.execute({type:'sync'})).status,'synced');

    const repository = createD1Repository(f.db,{dataset:'staging-strava-test-v1'});
    await repository.updatePrivate(state=>{state.policy.unlockedMilestoneIds=['milestone-20'];});
    const generation = (await f.execute({type:'status'})).slots.find(slot=>slot.id==='slot-a').generation;
    const erase={type:'erase-slot',slot:'slot-a',expectedAthleteId:101,generation,confirmation:'verified-staging-deletion',purgeMilestones:true};
    assert.equal((await f.execute(erase)).status,'failed');
    await f.execute({type:'disable-sync'});
    assert.equal((await f.execute({...erase,expectedAthleteId:202})).status,'failed');
    assert.equal((await f.execute({...erase,generation:generation+1})).status,'failed');
    const revoke={type:'revoke-slot',slot:'slot-a',expectedAthleteId:101,generation,confirmation:'revoke-staging-consent'};
    assert.equal((await f.execute(revoke)).status,'revoked');
    assert.equal((await f.execute({type:'status'})).progress.distanceKm,1);
    assert.equal((await f.execute(erase)).status,'failed');
    assert.equal((await f.execute({type:'issue',slot:'slot-a',expectedAthleteId:202})).status,'failed');

    const command=mvpCommand({...erase,generation:generation+1});
    assert.equal((await (await f.send(command)).json()).status,'erased');
    assert.equal((await (await f.send(command)).json()).status,'replay');
    const empty = await f.execute({type:'status'});
    assert.deepEqual(empty.progress,{distanceKm:0,partial:true,stale:false,updatedAt:null,unlockedMilestoneIds:[]});
    const sealed = await f.db.prepare('SELECT COUNT(*) n FROM staging_auth_oauth_credentials').first();
    assert.equal(sealed.n,0);
    assert.doesNotMatch(JSON.stringify(empty),/athlete|accountHash|ciphertext|expectedAthleteId/);
    const before=await f.requestCount();
    assert.doesNotMatch((await oldCallback(101)).headers.get('Set-Cookie')??'',/=success;/);
    assert.equal(await f.requestCount(),before);
    const replacement = await begin('slot-a',202);
    assert.doesNotMatch((await replacement(101)).headers.get('Set-Cookie')??'',/=success;/);
    const alberto = await begin('slot-a',202);
    assert.match((await alberto(202)).headers.get('Set-Cookie'),/=success;/);
    const belen = await begin('slot-b',101);
    assert.match((await belen(101)).headers.get('Set-Cookie'),/=success;/);
    await repository.applyEvents([{participantId:'slot-a',generation,status:'success',activities:[],syncedAt:'2026-11-28T10:00:00Z'}]);
    const now=Date.now(), minute=Math.floor(now/60000);
    await repository.updatePrivate(state=>{
      state.stagingAdminQuota={minute,day:Math.floor(now/86400000),minuteCount:20,dayCount:20};
    });
    assert.equal((await f.execute({type:'status'})).status,'limited');
    await repository.updatePrivate(state=>{state.stagingAdminQuota.minute--;});

    await f.execute({type:'enable-sync',confirmation:'enable-staging-sync'});
    assert.equal((await f.execute({type:'sync'})).status,'synced');
    const official = await f.execute({type:'status'});
    assert.equal(official.progress.distanceKm,2);
    assert.equal(official.progress.partial,false);
    assert.deepEqual(official.progress.unlockedMilestoneIds,[]);
  } finally {
    await f.close();
  }
});
