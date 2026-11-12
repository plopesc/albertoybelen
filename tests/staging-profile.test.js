import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{spawnSync}from'node:child_process';
test('preparación staging idempotente, sin tocar local.json/público ni sobrescribir un perfil editado',()=>{
 const root=mkdtempSync(join(tmpdir(),'staging-profile-'));
 try{
  for(const dir of ['scripts/lib','frontend/js','frontend/config'])mkdirSync(join(root,dir),{recursive:true});
  for(const file of ['scripts/prepare-staging-view.mjs','scripts/lib/staging-read.mjs','frontend/js/http-progress.js'])writeFileSync(join(root,file),readFileSync(file));
  writeFileSync(join(root,'package.json'),'{"type":"module"}');const base=JSON.stringify({game:{title:'A y B',mode:'simulation'},rewards:{}});writeFileSync(join(root,'frontend/config/game.json'),base);writeFileSync(join(root,'frontend/config/local.json'),'pilot-profile-untouched');
  const command=()=>spawnSync(process.execPath,[join(root,'scripts/prepare-staging-view.mjs')]);assert.equal(command().status,0);const path=join(root,'frontend/config/staging.local.json'),first=readFileSync(path,'utf8');assert.equal(command().status,0);assert.equal(readFileSync(path,'utf8'),first);assert.equal(readFileSync(join(root,'frontend/config/local.json'),'utf8'),'pilot-profile-untouched');assert.equal(readFileSync(join(root,'frontend/config/game.json'),'utf8'),base);
  writeFileSync(path,'edited-staging-profile');assert.notEqual(command().status,0);assert.equal(readFileSync(path,'utf8'),'edited-staging-profile');
 }finally{rmSync(root,{recursive:true,force:true});}
});
