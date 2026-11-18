import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {stagingEnvironment} from './staging-auth-fixture.js';
import {MVP_ENABLE,MVP_READY,MVP_AUTO_SYNC_CRON,MVP_ORIGIN,MVP_ADMIN_PATH} from '../../backend/staging-mvp-policy.js';
import {STAGING_NETWORK_ENABLE} from '../../backend/staging-auth-settings.js';
import {mvpCommand} from '../../scripts/lib/staging-mvp-client.mjs';
export async function mvpRuntime({closed=false,migration=true}={}) {
  const directory=await mkdtemp(join(tmpdir(),'staging-mvp-test-'));let mf;
  try {
    const env={...stagingEnvironment(),STAGING_MVP_ENABLED:MVP_ENABLE,STAGING_MVP_READY:MVP_READY,STAGING_NETWORK_ENABLED:STAGING_NETWORK_ENABLE,STAGING_ADMIN_TOKEN:randomBytes(32).toString('base64url')};
    if(closed)env.STAGING_MVP_ENABLED='disabled';
    const bundle=async entry=>(await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:workers']})).outputFiles[0].text;
    const api={name:'synthetic-mvp',modules:true,script:await bundle('backend/staging-mvp-entry.js'),compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000050'},outboundService:{name:'synthetic-mvp-provider'}};
    const provider={name:'synthetic-mvp-provider',modules:true,script:await bundle('tests/helpers/staging-strava-worker.js'),compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],outboundService:()=>{throw Error('External outbound forbidden');}};
    const options={...convertV4MiniflareOptions({workers:[api,provider]}),resourcePersistencePath:join(directory,'persist'),telemetry:{enabled:false},logRequests:false};
    mf=new Miniflare(options);let db=await mf.getD1Database('DB','synthetic-mvp');
    await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)').run();
    const path=new URL('../../backend/d1/migrations/',import.meta.url);
    for(const file of(await readdir(path)).sort()) {
      if(!migration&&file.startsWith('0003'))continue;
      for(const sql of(await readFile(new URL(file,path),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
      await db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(file).run();
    }
    const request=(path,options={})=>mf.dispatchFetch(new URL(path,MVP_ORIGIN).href,{redirect:'manual',...options});
    return{directory,env,get mf(){return mf;},get db(){return db;},request,async send(command){return request(MVP_ADMIN_PATH,{method:'POST',headers:{Authorization:`Bearer ${env.STAGING_ADMIN_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command)});},async execute(operation){return(await this.send(mvpCommand(operation))).json();},async requestCount(){return(await mf.getWorker('synthetic-mvp-provider')).count();},async scheduled(cron=MVP_AUTO_SYNC_CRON){return(await mf.getWorker('synthetic-mvp')).scheduled({cron,scheduledTime:Date.now()});},async restart(){await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB','synthetic-mvp');},async close(){await mf?.dispose();await rm(directory,{recursive:true,force:true});}};
  }catch(e){await mf?.dispose();await rm(directory,{recursive:true,force:true});throw e;}
}
