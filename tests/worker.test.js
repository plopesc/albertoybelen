import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../backend/worker.js';
import { defaultFixtureEvents } from '../backend/fixtures.js';
const get = (worker, options={}) => worker.fetch(new Request('http://localhost/api/progress',options));
const body = async worker => (await get(worker)).json();
test('contrato público: dos cuentas ficticias, sin desglose, objetivo ni IDs individuales', async()=>{
 const w=createWorker(); await w.scheduled({}); const r=await get(w); assert.equal(r.headers.get('Cache-Control'),'no-store');
 const value=await r.json(); assert.equal(value.distanceKm,4.00075); assert.equal(value.schemaVersion,1); assert.equal(value.source,'fixture');
 assert.deepEqual(Object.keys(value).sort(),['schemaVersion','source','distanceKm','updatedAt','partial','stale','unlockedMilestoneIds'].sort());
 assert.equal(JSON.stringify(value).includes('slot-'),false); assert.equal(value.partial,false);
 await w.scheduled({}); assert.deepEqual(await body(w),value);
});
test('CORS exacto, sin credenciales, OPTIONS restringido y 404/405', async()=>{
 const w=createWorker();
 for(const origin of ['https://plopesc.github.io','https://albertoybelen.ddev.site','http://localhost:8787']) {
  const r=await get(w,{headers:{Origin:origin}}); assert.equal(r.status,200); assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin); assert.equal(r.headers.get('Access-Control-Allow-Credentials'),null); assert.equal(r.headers.get('Vary'),'Origin');
 }
 for(const origin of ['null','https://plopesc.github.io.evil.test','https://evil.test']) assert.equal((await get(w,{headers:{Origin:origin}})).status,403);
 assert.equal((await get(w,{method:'POST'})).status,405);
 assert.equal((await w.fetch(new Request('http://localhost/secret'))).status,404);
 assert.equal((await get(w,{method:'OPTIONS',headers:{Origin:'https://plopesc.github.io','Access-Control-Request-Method':'GET'}})).status,204);
 assert.equal((await get(w,{method:'OPTIONS',headers:{Origin:'https://plopesc.github.io','Access-Control-Request-Method':'POST'}})).status,403);
 assert.equal((await get(w,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'}})).status,403);
});
test('partial y stale simultáneos, error429 conserva último snapshot y recuperación idempotente', async()=>{
 let events=defaultFixtureEvents().slice(0,2); const w=createWorker({loadFixture:async()=>events});
 await w.scheduled({}); const before=await body(w); assert.equal(before.partial,true);
 events=[{participantId:'slot-a',generation:0,status:'error',httpStatus:429}]; await w.scheduled({});
 const stale=await body(w); assert.equal(stale.distanceKm,before.distanceKm); assert.equal(stale.updatedAt,before.updatedAt); assert.equal(stale.partial,true); assert.equal(stale.stale,true);
 events=defaultFixtureEvents(); await w.scheduled({}); const recovered=await body(w); await w.scheduled({}); assert.deepEqual(await body(w),recovered); assert.equal(recovered.stale,false);
});
test('load fallido conserva total, marca stale y no filtra error sensible', async()=>{
 let fail=false;const w=createWorker({loadFixture:async()=>{if(fail)throw new Error('slot-a secret');return defaultFixtureEvents();}});
 await w.scheduled({}); fail=true; await assert.rejects(w.scheduled({}),/^Error: Fixture synchronization failed$/); const v=await body(w);assert.equal(v.distanceKm,4.00075);assert.equal(v.stale,true);assert.equal(JSON.stringify(v).includes('secret'),false);
});
test('revocación y supresión bloquean jobs antiguos; otro slot sigue actualizando', async()=>{
 const w=createWorker(); await w.scheduled({});
 await w.applyLocalEvent({participantId:'slot-a',generation:0,status:'revoked'});const revoked=await body(w);assert.equal(revoked.partial,true);assert.equal(revoked.stale,true);
 await w.scheduled({});assert.deepEqual(await body(w),revoked);
 await w.applyLocalEvent({participantId:'slot-a',generation:1,status:'connected',scopes:['activity:read_all']});
 await w.applyLocalEvent({...defaultFixtureEvents()[1],generation:1,activities:[]});assert.equal((await body(w)).distanceKm,2.75025);
 await assert.rejects(w.applyLocalEvent({participantId:'slot-b',generation:0,status:'deleted'}));
 const deletion={participantId:'slot-b',generation:0,status:'deleted',verified:true};await w.applyLocalEvent(deletion);await w.applyLocalEvent(deletion);
 await w.scheduled({});assert.equal((await body(w)).distanceKm,0);
 assert.equal((await w.fetch(new Request('http://localhost/api/delete',{method:'POST'}))).status,404);
 await w.applyLocalEvent({participantId:'slot-b',generation:1,status:'connected',newConsent:true,verified:true,scopes:['activity:read_all']});
 await w.applyLocalEvent({...defaultFixtureEvents()[3],generation:1}); assert.equal((await body(w)).distanceKm,0);
 await w.applyLocalEvent({...defaultFixtureEvents()[3],generation:2}); assert.equal((await body(w)).distanceKm,2.75025);
});
test('scheduled espera waitUntil, serializa carreras y no hace fetch externo', async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('Network forbidden');};
 try{
  const w=createWorker();let queued; const first=w.scheduled({},null,{waitUntil:p=>queued=p});await Promise.all([first,w.scheduled({})]);await queued;assert.equal((await body(w)).distanceKm,4.00075);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('logros se conservan ante retrocesos; supresión puede purgarlos sin resurrección',async()=>{
 const w=createWorker();await w.scheduled({});
 const large={...defaultFixtureEvents()[1],activities:[{id:'x',distance:100000,sport_type:'Run',manual:false,private:false,start_date:'2026-11-01T00:00:00+01:00'}]};await w.applyLocalEvent(large);assert.ok((await body(w)).unlockedMilestoneIds.includes('finish'));
 await w.applyLocalEvent({...large,activities:[]});assert.ok((await body(w)).unlockedMilestoneIds.includes('finish'));
 await w.applyLocalEvent({participantId:'slot-a',generation:0,status:'deleted',verified:true,purgeMilestones:true});await w.scheduled({});assert.deepEqual((await body(w)).unlockedMilestoneIds,[]);
});

test('HTTP no presenta autorización como backfill completo de las dos cuentas', async()=>{
 const fixture=defaultFixtureEvents(); let events=[fixture[0],fixture[2]];
 const w=createWorker({loadFixture:async()=>events});
 await w.scheduled({}); let v=await body(w);
 assert.equal(v.distanceKm,0); assert.equal(v.partial,true); assert.equal(v.stale,false); assert.equal(v.updatedAt,null);
 events=[fixture[1]]; await w.scheduled({}); v=await body(w);
 assert.equal(v.distanceKm,1.2505); assert.equal(v.partial,true); assert.equal(v.stale,false); assert.equal(v.updatedAt,'2026-11-02T12:00:00.000Z');
 events=[{participantId:'slot-b',generation:0,status:'error',httpStatus:429}]; await w.scheduled({}); v=await body(w);
 assert.equal(v.distanceKm,1.2505); assert.equal(v.partial,true); assert.equal(v.stale,true); assert.equal(v.updatedAt,'2026-11-02T12:00:00.000Z');
 events=[{...fixture[3],complete:false}]; await w.scheduled({}); v=await body(w);
 assert.equal(v.distanceKm,4.00075); assert.equal(v.partial,true); assert.equal(v.stale,false); assert.equal(v.updatedAt,'2026-11-02T12:00:00.000Z');
 events=[fixture[3]]; await w.scheduled({}); v=await body(w);
 assert.equal(v.distanceKm,4.00075); assert.equal(v.partial,false); assert.equal(v.stale,false); assert.equal(v.updatedAt,'2026-11-02T12:00:00.000Z');
 events=[{participantId:'slot-b',generation:0,status:'revoked'}];await w.scheduled({});
 events=[{...fixture[2],generation:1}];await w.scheduled({});v=await body(w);
 assert.equal(v.distanceKm,4.00075);assert.equal(v.partial,true);assert.equal(v.stale,true);assert.equal(v.updatedAt,'2026-11-02T12:00:00.000Z');
 events=[{...fixture[3],generation:1,complete:false}];await w.scheduled({});v=await body(w);
 assert.equal(v.partial,true);assert.equal(v.stale,false);assert.equal(v.updatedAt,'2026-11-02T12:00:00.000Z');
 events=[{...fixture[3],generation:1}];await w.scheduled({});v=await body(w);
 assert.equal(v.partial,false);assert.equal(v.stale,false);
 assert.equal(JSON.stringify(v).includes('slot-'),false);
});
