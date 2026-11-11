import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
test('wrangler local solo DB ficticia sin cron, rutas remotas ni credenciales',()=>{
 const config=JSON.parse(readFileSync('wrangler.local.jsonc','utf8'));
 assert.equal(config.vars.APP_ENV,'local-fixtures');assert.equal(config.send_metrics,false);
 assert.equal(config.d1_databases[0].remote,false);assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000023');
 assert.equal(config.workers_dev,false);assert.equal(config.triggers,undefined);assert.equal(config.env,undefined);assert.equal(config.account_id,undefined);
});
test('comandos locales rechazan operaciones remotas, despliegue y reset accidental',()=>{
 for(const args of [['deploy'],['migrate','--remote'],['dev','--remote'],['reset']]) assert.notEqual(spawnSync(process.execPath,['scripts/d1-local.mjs',...args]).status,0);
 for(const args of [[],['production'],['local-fixtures','extra']]) assert.notEqual(spawnSync(process.execPath,['scripts/reset-d1-local.mjs',...args]).status,0);
});
