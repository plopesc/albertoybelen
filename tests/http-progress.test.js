import test from 'node:test';import assert from 'node:assert/strict';
import{createHttpProgressProvider,validatePublicProgress,resolveProgressEndpoint,MAX_UNLOCKED_IDS}from'../frontend/js/http-progress.js';
import{loadRuntimeConfig,LOCAL_CONFIG_URL}from'../frontend/js/runtime-config.js';
const pageUrl='https://albertoybelen.ddev.site/frontend/?local-api=1';
const ids=['milestone-20','milestone-40'];
const dto=(extra={})=>({schemaVersion:1,source:'fixture',distanceKm:25.125,partial:true,stale:false,updatedAt:'2026-11-01T12:00:00Z',unlockedMilestoneIds:['milestone-20'],...extra});
const settings={url:'/api/progress',pageUrl,milestoneIds:ids,allowFixtures:true};

test('HTTP valida y normaliza solo contrato público, sin datos adicionales',()=>{
 const raw=dto();assert.equal(validatePublicProgress(raw,settings).updatedAt,'2026-11-01T12:00:00.000Z');assert.deepEqual(raw.updatedAt,'2026-11-01T12:00:00Z');
 for(const change of [{schemaVersion:2},{distanceKm:-1},{distanceKm:Infinity},{distanceKm:'4'},{partial:0},{stale:'false'},{updatedAt:'invalid'},{updatedAt:'2026-02-31T00:00:00Z'},{updatedAt:'2026-11-01T24:01:00Z'},{updatedAt:123},{partial:false,updatedAt:null},{unlockedMilestoneIds:['../unknown']},{unlockedMilestoneIds:['finish','finish']},{source:'other'},{athleteId:101},{access_token:'private'}])assert.throws(()=>validatePublicProgress(dto(change),settings),/invalid_response/);
 for(const key of Object.keys(raw)){const bad=dto();delete bad[key];assert.throws(()=>validatePublicProgress(bad,settings));}
 assert.throws(()=>validatePublicProgress(dto(),{...settings,allowFixtures:false}));
 assert.equal(validatePublicProgress(dto({source:'strava',partial:false}),{...settings,allowFixtures:false}).partial,false);
});

test('endpoint mismo origen HTTPS, subdirectorio Pages y fixtures locales explícitos',()=>{
 assert.equal(resolveProgressEndpoint('/api/progress',pageUrl,true),'https://albertoybelen.ddev.site/api/progress');
 assert.equal(resolveProgressEndpoint('/api/progress','https://plopesc.github.io/albertoybelen/',false),'https://plopesc.github.io/api/progress');
 assert.equal(resolveProgressEndpoint('/api/progress','http://127.0.0.1:8000/albertoybelen/',true),'http://127.0.0.1:8000/api/progress');
 for(const url of ['https://evil.invalid/api/progress','http://albertoybelen.ddev.site/api/progress','https://user:secret@albertoybelen.ddev.site/api/progress','/api/progress?token=x','/api/progress#secret','/oauth/callback'])assert.throws(()=>resolveProgressEndpoint(url,pageUrl,true));
 assert.throws(()=>resolveProgressEndpoint('/api/progress','https://plopesc.github.io/albertoybelen/',true));
});

test('proveedor no usa storage ni credenciales, sin caché y GET público únicamente',async()=>{
 let calls=0;const p=createHttpProgressProvider({...settings,fetchProgress:async(url,options)=>{calls++;assert.equal(url,'https://albertoybelen.ddev.site/api/progress');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');return Response.json(dto());}});
 assert.equal(p.getState().snapshot,null);const statuses=[];p.subscribe(s=>statuses.push(s.status));await p.refresh();assert.deepEqual(statuses,['loading','ready']);assert.equal(calls,1);assert.equal(p.getState().snapshot.distanceKm,25.125);
 const copy=p.getState();copy.snapshot.distanceKm=999;assert.equal(p.getState().snapshot.distanceKm,25.125);
});

test('fallos red/HTTP/JSON/campos conservan último snapshot y no inventan progreso',async()=>{
 for(const bad of [async()=>{throw Error('private server detail');},async()=>new Response('private',{status:503}),async()=>new Response('{'),async()=>Response.json(dto({scopes:['private']})),async()=>new Response('x'.repeat(65537))]){
  let transport=async()=>Response.json(dto());const p=createHttpProgressProvider({...settings,fetchProgress:(...args)=>transport(...args)});await p.refresh();transport=bad;await p.refresh();assert.equal(p.getState().status,'error');assert.equal(p.getState().snapshot.distanceKm,25.125);assert.equal(JSON.stringify(p.getState()).includes('private'),false);
  const empty=createHttpProgressProvider({...settings,fetchProgress:bad});await empty.refresh();assert.equal(empty.getState().snapshot,null);
 }
});

test('timeout incluso si fetch o body ignoran abort; última respuesta gana',async()=>{
 for(const fetchProgress of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}))]){
  const p=createHttpProgressProvider({...settings,timeoutMs:10,fetchProgress});await p.refresh();assert.equal(p.getState().error,'timeout');assert.equal(p.getState().snapshot,null);
 }
 let first;let count=0;const p=createHttpProgressProvider({...settings,fetchProgress:()=>++count===1?new Promise(r=>{first=r;}):Promise.resolve(Response.json(dto({distanceKm:40})))});
 const a=p.refresh();await p.refresh();first(Response.json(dto({distanceKm:99})));await a;assert.equal(p.getState().snapshot.distanceKm,40);
});

test('dispose cancela avisos pendientes; fuente no cambia silenciosamente entre refresh',async()=>{
 let transport=async()=>Response.json(dto());const p=createHttpProgressProvider({...settings,fetchProgress:()=>transport()});await p.refresh();transport=async()=>Response.json(dto({source:'strava-pilot'}));await p.refresh();assert.equal(p.getState().status,'error');assert.equal(p.getState().snapshot.source,'fixture');
 let finish;const other=createHttpProgressProvider({...settings,fetchProgress:()=>new Promise(r=>{finish=r;})});let events=0;other.subscribe(()=>events++);const work=other.refresh();other.dispose();finish(Response.json(dto()));await work;assert.equal(events,1);assert.equal(other.getState().snapshot,null);
});

test('config local explícita solo en DDEV, pública no lee archivo ignorado',async()=>{
 const base={game:{id:'local-ddev-test',title:'A y B',goalKm:100,startDate:'2026-11-01',timeZone:'Europe/Madrid',mode:'real'},api:{url:'/api/progress',allowFixtures:true}};
 let calls=[];const fetchConfig=async url=>{calls.push(String(url));return Response.json(base);};
 const local=await loadRuntimeConfig({pageUrl,fetchConfig});assert.equal(local.game.mode,'real');assert.deepEqual(calls,[String(LOCAL_CONFIG_URL)]);
 for(const page of ['https://plopesc.github.io/albertoybelen/?local-api=1','https://evil.invalid/?local-api=1','https://albertoybelen.ddev.site/?local-api=0','https://albertoybelen.ddev.site/?local-api=1&local-api=1'])await assert.rejects(loadRuntimeConfig({pageUrl:page,fetchConfig}));
 calls=[];await loadRuntimeConfig({pageUrl:'https://albertoybelen.ddev.site/frontend/',fetchConfig});assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/config/game.json'));
});

test('archivo de premios no depende del catálogo; formato y límite global siguen estrictos',()=>{
 const archived=Array.from({length:MAX_UNLOCKED_IDS},(_,i)=>`archived-${i}`);
 assert.deepEqual(validatePublicProgress(dto({unlockedMilestoneIds:archived}),{allowFixtures:true,milestoneIds:[]}).unlockedMilestoneIds,archived);
 assert.throws(()=>validatePublicProgress(dto({unlockedMilestoneIds:[...archived,'one-too-many']}),settings),/invalid_response/);
 for(const id of ['',null,20,'Uppercase','contains space','a'.repeat(65),'<script>'])assert.throws(()=>validatePublicProgress(dto({unlockedMilestoneIds:[id]}),settings),/invalid_response/);
});

test('retirar/restaurar catálogo conserva DTO policy legítimo y premio archivado sin ocultar kilómetros',async()=>{
 const {createDistanceState,applyParticipantSync,publicProgress}=await import('../policy/distance-policy.js');
 const {createApiHistory}=await import('../frontend/js/api-history.js');
 let state=createDistanceState({goalKm:100,startDate:'2026-11-01',timeZone:'Europe/Madrid',milestones:[{id:'milestone-20',percent:20},{id:'milestone-40',percent:40}]});
 state=applyParticipantSync(state,{participantId:'slot-a',generation:0,status:'connected',scopes:['activity:read_all']});
 state=applyParticipantSync(state,{participantId:'slot-a',generation:0,status:'success',complete:true,syncedAt:'2026-11-01T12:00:00Z',activities:[{id:1,distance:40000,start_date:'2026-11-01T10:00:00Z',sport_type:'Run',manual:false,private:false}]});
 state.config.milestones=state.config.milestones.filter(m=>m.id!=='milestone-40');
 const p=createHttpProgressProvider({...settings,milestoneIds:['milestone-20'],fetchProgress:async()=>Response.json({schemaVersion:1,source:'fixture',...publicProgress(state)})});
 await p.refresh();assert.equal(p.getState().status,'ready');const dto=p.getState().snapshot;assert.equal(dto.distanceKm,40);assert.deepEqual(dto.unlockedMilestoneIds,['milestone-20','milestone-40']);
 const visible=createApiHistory(undefined,{gameId:'retire-restore',endpoint:p.endpoint,milestoneIds:['milestone-20']});visible.applySnapshot(dto.unlockedMilestoneIds);assert.equal(visible.isUnlocked('milestone-40'),false);
 state.config.milestones.push({id:'milestone-40',percent:40});await p.refresh();
 const restored=createApiHistory(undefined,{gameId:'retire-restore',endpoint:p.endpoint,milestoneIds:['milestone-20','milestone-40']});restored.applySnapshot(p.getState().snapshot.unlockedMilestoneIds);assert.equal(restored.isUnlocked('milestone-40'),true);assert.equal(p.getState().snapshot.distanceKm,40);assert.deepEqual(state.unlockedMilestoneIds,['milestone-20','milestone-40']);
});
