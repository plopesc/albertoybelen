import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,chmodSync,symlinkSync,rmSync,readFileSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{createServer}from'node:net';import{spawnSync}from'node:child_process';
import{validateDdevProject,assertPortsFree}from'../scripts/lib/ddev-preflight.mjs';import{assertPrivateFiles}from'../scripts/lib/private-permissions.mjs';

test('preflight exige proyecto y configuración montada coincidentes, no otro DDEV',()=>{
 const config='name: albertoybelen\ntype: generic\n';validateDdevProject(config,config,'albertoybelen');
 for(const args of [[config,'name: other'],['name: other','name: other'],[config,config,'other']])assert.throws(()=>validateDdevProject(...args));
});
test('puerto ocupado se rechaza sin detener ni reutilizar el servicio ajeno',async()=>{
 const service=createServer();await new Promise(r=>service.listen(0,'127.0.0.1',r));const port=service.address().port;
 try{await assert.rejects(assertPortsFree([port]),/occupied/);assert.equal(service.listening,true);}finally{await new Promise(r=>service.close(r));}
 await assertPortsFree([port]);
});
test('directorio y archivo privados: rechaza permisos públicos y enlaces simbólicos',()=>{
 const root=mkdtempSync(join(tmpdir(),'phase-a-modes-'));const dir=join(root,'private'),file=join(dir,'.dev.vars');
 try{
  mkdirSync(dir,{mode:0o700});writeFileSync(file,'SYNTHETIC_ONLY=1',{mode:0o600});assertPrivateFiles(dir,file);
  chmodSync(dir,0o755);assert.throws(()=>assertPrivateFiles(dir,file));chmodSync(dir,0o700);chmodSync(file,0o644);assert.throws(()=>assertPrivateFiles(dir,file));chmodSync(file,0o600);
  const alias=join(dir,'alias');symlinkSync(file,alias);assert.throws(()=>assertPrivateFiles(dir,alias));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('preparar frontend piloto solo escribe perfil aislado 500 km, no arranca ni conecta',()=>{
 const root=mkdtempSync(join(tmpdir(),'phase-a-profile-'));
 try{
  mkdirSync(join(root,'scripts/lib'),{recursive:true});
  for(const file of ['config.json','scripts/lib/infrastructure-config.mjs','scripts/lib/infrastructure-policy.mjs'])writeFileSync(join(root,file),readFileSync(file));mkdirSync(join(root,'frontend/config'),{recursive:true});writeFileSync(join(root,'frontend/config/game.json'),JSON.stringify({game:{id:'public',title:'A y B',mode:'simulation',goalKm:100},rewards:{}}));
  const script=join(root,'scripts/prepare.mjs');writeFileSync(script,readFileSync('scripts/prepare-frontend-local.mjs'));
  assert.equal(spawnSync(process.execPath,[script,'--pilot']).status,0);
  const local=JSON.parse(readFileSync(join(root,'frontend/config/local.json')));assert.equal(local.game.goalKm,500);assert.equal(local.game.startDate,'2026-11-01');assert.equal(local.game.timeZone,'Europe/Madrid');assert.equal(local.game.mode,'real');assert.equal(local.game.id,'local-ddev-owner-pilot');assert.equal(local.api.allowFixtures,false);
  assert.equal(JSON.parse(readFileSync(join(root,'frontend/config/game.json'))).game.mode,'simulation');assert.notEqual(spawnSync(process.execPath,[script,'--pilot']).status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('ensayo fase A no admite flags de autorización real',()=>{
 const result=spawnSync(process.execPath,['scripts/check-pilot-browser.mjs','--authorize-owner-pilot']);assert.notEqual(result.status,0);
});
