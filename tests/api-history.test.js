import test from'node:test';import assert from'node:assert/strict';import{createApiHistory}from'../frontend/js/api-history.js';
const options={gameId:'local-ddev-api',endpoint:'https://albertoybelen.ddev.site/api/progress',milestoneIds:['milestone-20','milestone-40']};
function storage(){const m=new Map([['strava-adventure:simulation:v2',JSON.stringify({version:2,distanceKm:999})],['strava-adventure:milestones:v2:local-ddev-api',JSON.stringify({unlockedIds:['finish']})]]);return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),m};}

test('API IDs únicos autorizan premios; simulación/localStorage nunca desbloquean',()=>{
 const s=storage(),h=createApiHistory(s,options);h.applySnapshot([]);assert.equal(h.isUnlocked('finish'),false);h.advance(0,1,999);assert.deepEqual(h.getUnlockedIds(),[]);
 h.applySnapshot(['milestone-20','finish']);assert.equal(h.isUnlocked('finish'),true);h.applySnapshot(['milestone-20']);assert.equal(h.isUnlocked('finish'),false);
 const record=[...s.m].find(([k])=>k.startsWith('strava-adventure:api-notices:'));assert.deepEqual(Object.keys(JSON.parse(record[1])).sort(),['seenNoticeIds','version']);
});

test('primera carga o nuevo navegador con final histórico no celebra ni infiere por meta',()=>{
 const h=createApiHistory(storage(),options);h.applySnapshot(['finish']);assert.equal(h.hasSeenNotice('finish'),true);assert.deepEqual(h.advance(0,1,100),[]);
 const fresh=createApiHistory(undefined,options);fresh.applySnapshot(['finish']);assert.deepEqual(fresh.advance(0,1,100),[]);
});

test('avisos nuevos durante refresco, final solo cruzando 100%; descenso y cambio de meta no celebran',()=>{
 const s=storage(),h=createApiHistory(s,options);h.applySnapshot([]);h.applySnapshot(['milestone-20']);assert.deepEqual(h.advance(0,.2,20),['milestone-20']);h.markNoticeSeen('milestone-20');
 h.applySnapshot(['milestone-20','finish']);assert.deepEqual(h.advance(.2,1,80),['finish']);h.markNoticeSeen('finish');
 h.applySnapshot(['milestone-20','finish']);assert.deepEqual(h.advance(1,.8,-20),[]);assert.equal(h.isUnlocked('finish'),true);
 const other=createApiHistory(storage(),options);other.applySnapshot([]);other.applySnapshot(['finish']);assert.deepEqual(other.advance(.2,1,0),[]);assert.equal(other.hasSeenNotice('finish'),true);
 const alreadyAbove=createApiHistory(storage(),options);alreadyAbove.applySnapshot([]);alreadyAbove.applySnapshot(['finish']);assert.deepEqual(alreadyAbove.advance(1,1,5),[]);
});

test('múltiples pestañas comparten solo avisos vistos; reload nunca restaura celebración final',()=>{
 const s=storage(),a=createApiHistory(s,options),b=createApiHistory(s,options);a.applySnapshot([]);b.applySnapshot([]);
 a.applySnapshot(['finish']);assert.deepEqual(a.advance(.5,1,50),['finish']);a.markNoticeSeen('finish');b.applySnapshot(['finish']);assert.deepEqual(b.advance(.5,1,50),[]);
 const reload=createApiHistory(s,options);reload.applySnapshot(['finish']);assert.equal(reload.hasSeenNotice('finish'),true);assert.deepEqual(reload.advance(0,1,100),[]);
});

test('almacenamiento bloqueado o corrupto no inventa premios ni impide reabrir API',()=>{
 for(const s of [undefined,{getItem(){throw Error();},setItem(){throw Error();}},{getItem(){return '{';},setItem(){}}]){const h=createApiHistory(s,options);h.applySnapshot(['finish']);assert.equal(h.isUnlocked('finish'),true);assert.equal(h.hasSeenNotice('finish'),true);assert.equal(h.isPersistent(),false);}
});

test('avisos archivados sobreviven al catálogo y restaurarlos no fabrica un nuevo aviso',()=>{
 const s=storage(),small={...options,milestoneIds:['milestone-20']};
 const hidden=createApiHistory(s,small);hidden.applySnapshot(['milestone-20','milestone-40']);assert.equal(hidden.isUnlocked('milestone-40'),false);assert.equal(hidden.hasSeenNotice('milestone-40'),true);
 const restored=createApiHistory(s,options);restored.applySnapshot(['milestone-20','milestone-40']);assert.equal(restored.isUnlocked('milestone-40'),true);assert.equal(restored.hasSeenNotice('milestone-40'),true);assert.equal(restored.isPersistent(),true);
});
