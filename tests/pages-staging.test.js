import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig, PAGES_STAGING_CONFIG_URL } from '../frontend/js/runtime-config.js';
import { CONFIG_URL, validateGameConfig } from '../frontend/js/config.js';
import { createHttpProgressProvider, hasPagesTrackingParams, isPagesStagingPage, PAGES_STAGING_PROGRESS_URL, resolveProgressEndpoint } from '../frontend/js/http-progress.js';

const page='https://plopesc.github.io/albertoybelen/?pages-staging=strava';
const trackedPage=`${page}&utm_source=chatgpt.com`;
const dto=(extra={})=>({schemaVersion:1,source:'strava',distanceKm:62.66,partial:true,stale:false,updatedAt:'2026-11-18T10:00:00Z',unlockedMilestoneIds:['milestone-20','milestone-40'],...extra});
const profile=validateGameConfig({game:{id:'pages-staging-strava',title:'Alberto y Belén · Prueba Strava Staging',goalKm:500,startDate:'2026-11-01',timeZone:'Europe/Madrid',mode:'real'},rewards:{milestones:[20,40,60,80],finish:100},api:{url:PAGES_STAGING_PROGRESS_URL,allowFixtures:false}});

test('Pages conserva la simulación predeterminada y habilita solo el perfil explícito de prueba',async()=>{
 let requested;const simulation=await loadRuntimeConfig({pageUrl:'https://plopesc.github.io/albertoybelen/',fetchConfig:async url=>{requested=String(url);return Response.json({game:{id:'alberto-belen',title:'Juego',goalKm:100,startDate:'2027-01-01',mode:'simulation'}});}});
 assert.equal(requested,String(CONFIG_URL));assert.equal(simulation.game.mode,'simulation');
 const queryOnly=await loadRuntimeConfig({pageUrl:'https://plopesc.github.io/albertoybelen/?presentation=live',fetchConfig:async()=>Response.json({game:{id:'alberto-belen',title:'Juego',goalKm:100,startDate:'2027-01-01',mode:'simulation'}})});
 assert.equal(queryOnly.game.presentation,'standard');assert.equal(queryOnly.game.mode,'simulation');
 const staging=await loadRuntimeConfig({pageUrl:trackedPage,fetchConfig:async url=>{requested=String(url);assert.equal(requested,String(PAGES_STAGING_CONFIG_URL));return Response.json(profile);}});
 assert.equal(staging.game.id,'pages-staging-strava');assert.equal(staging.game.goalKm,500);assert.equal(staging.game.startDate,'2026-11-01');assert.equal(staging.game.timeZone,'Europe/Madrid');assert.equal(staging.api.url,PAGES_STAGING_PROGRESS_URL);
});

test('solo ignora UTM estándar acotados en el opt-in Pages y nunca los propaga al endpoint',async()=>{
 const full='https://plopesc.github.io/albertoybelen/?pages-staging=strava&utm_source=chatgpt.com&utm_medium=share&utm_campaign=noviembre-2026&utm_content=link.1&utm_term=prueba';
 assert.equal(isPagesStagingPage(full),true);assert.equal(hasPagesTrackingParams(full),true);
 assert.equal(resolveProgressEndpoint(PAGES_STAGING_PROGRESS_URL,full,false),PAGES_STAGING_PROGRESS_URL);
 let profileUrl;await loadRuntimeConfig({pageUrl:full,fetchConfig:async url=>{profileUrl=String(url);return Response.json(profile);}});assert.equal(profileUrl,String(PAGES_STAGING_CONFIG_URL));
 const options=[];const provider=createHttpProgressProvider({url:PAGES_STAGING_PROGRESS_URL,pageUrl:full,fetchProgress:async(url,init)=>{options.push({url,init});return Response.json(dto());}});await provider.refresh();assert.equal(provider.getState().status,'ready');assert.deepEqual(options.map(x=>x.url),[PAGES_STAGING_PROGRESS_URL]);
});

test('Pages rechaza host, ruta, parámetros duplicados/mezclados, query arbitraria y perfil alterado',async()=>{
 let calls=0;const fetchConfig=async()=>{calls++;return Response.json(profile);};
 for(const bad of [
  'https://evil.example/albertoybelen/?pages-staging=strava',
  'https://plopesc.github.io/other/?pages-staging=strava',
  `${page}&pages-staging=strava`,`${page}&local-api=1`,`${page}&staging-api=strava`,`${page}&url=https://evil.example`,`${page}#fragment`,
  `${trackedPage}&utm_source=again`,`${page}&utm_source=https%3A%2F%2Fevil.example`,`${page}&utm_campaign=evil%26pages-staging%3Dstrava`,`${page}&utm_source=`,`${page}&utm_source=${'x'.repeat(101)}`,
  'https://plopesc.github.io/albertoybelen/?staging-api=strava',
  'https://plopesc.github.io/albertoybelen/?utm_source=chatgpt.com',
  'https://albertoybelen.ddev.site/frontend/?staging-api=1&utm_source=chatgpt.com',
 ])await assert.rejects(loadRuntimeConfig({pageUrl:bad,fetchConfig}));
 const tampered=structuredClone(profile);tampered.api.url='https://attacker.example/api/progress';
 await assert.rejects(loadRuntimeConfig({pageUrl:page,fetchConfig:async()=>Response.json(tampered)}),/El perfil Pages debe usar únicamente el progreso agregado/);assert.equal(calls,0);
 await assert.rejects(loadRuntimeConfig({pageUrl:trackedPage,fetchConfig:async()=>{throw Error('synthetic profile load failure');}}),/No se pudo cargar el perfil de prueba de GitHub Pages/);
 await assert.rejects(loadRuntimeConfig({pageUrl:`${trackedPage}&utm_source=https%3A%2F%2Fevil.example`,fetchConfig}),/solo está disponible mediante su enlace explícito/);
});

test('allowlist remota indépendante, destino exacto e risposta solo source=strava',async()=>{
 assert.equal(resolveProgressEndpoint(PAGES_STAGING_PROGRESS_URL,page,false),PAGES_STAGING_PROGRESS_URL);
 for(const address of [
  'https://evil.example/api/progress',
  'https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/admin/staging',
  'https://albertoybelen-api-staging.autumn-dream-2a39.workers.dev/api/progress?url=https://evil.example',
  'https://user@albertoybelen-api-staging.autumn-dream-2a39.workers.dev/api/progress',
 ])assert.throws(()=>resolveProgressEndpoint(address,page,false));
 for(const location of ['https://evil.example/albertoybelen/?pages-staging=strava','https://plopesc.github.io/albertoybelen/?pages-staging=strava&x=1','https://plopesc.github.io/albertoybelen/?pages-staging=strava&utm_source=https%3A%2F%2Fevil.example'])assert.throws(()=>resolveProgressEndpoint(PAGES_STAGING_PROGRESS_URL,location,false));
 for(const source of ['fixture','strava-pilot','strava']){
  const options=[];const provider=createHttpProgressProvider({url:PAGES_STAGING_PROGRESS_URL,pageUrl:page,fetchProgress:async(url,init)=>{options.push({url,init});return Response.json(dto({source}));}});await provider.refresh();
  assert.equal(provider.getState().status,source==='strava'?'ready':'error');assert.equal(provider.getState().snapshot?.source,source==='strava'?'strava':undefined);
 if(source==='strava'){assert.equal(options[0].url,PAGES_STAGING_PROGRESS_URL);assert.equal(options[0].init.method,undefined);assert.equal(options[0].init.credentials,'omit');assert.equal(options[0].init.redirect,'error');assert.equal(options[0].init.cache,'no-store');assert.equal(options[0].init.referrerPolicy,'no-referrer');assert.deepEqual(options[0].init.headers,{Accept:'application/json'});}
 }
});

test('los datos de prueba ocupan namespace de progreso separado del juego simulado',()=>{
 assert.notEqual(profile.game.id,'alberto-belen');assert.notEqual(profile.api.url,'/api/progress');assert.equal(profile.rewards.milestones.map(x=>x.id).join(','),'milestone-20,milestone-40,milestone-60,milestone-80');
});

test('progreso agregado acepta cero, distancia parcial, objetivo y retroceso conservando hitos archivados',async()=>{
 const distances=[0,62.66,500,62.66];let index=0;const archived=['milestone-20','milestone-40','milestone-60','milestone-80','finish'];
 const provider=createHttpProgressProvider({url:PAGES_STAGING_PROGRESS_URL,pageUrl:page,fetchProgress:async()=>Response.json(dto({distanceKm:distances[index],partial:index<3,stale:index===3,updatedAt:'2026-11-18T10:00:00Z',unlockedMilestoneIds:index<2?[]:archived}))});
 for(const distance of distances){await provider.refresh();assert.equal(provider.getState().snapshot.distanceKm,distance);index++;}
 assert.equal(provider.getState().snapshot.distanceKm,62.66);assert.deepEqual(provider.getState().snapshot.unlockedMilestoneIds,archived);assert.equal(provider.getState().snapshot.stale,true);
});
