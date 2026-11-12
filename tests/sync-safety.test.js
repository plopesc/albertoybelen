import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
import entry from '../backend/oauth-entry.js';
test('CLI sync rechaza remoto, despliegue y argumentos extra antes de abrir D1',()=>{
 for(const args of [['deploy'],['sync','--remote'],['seed','--remote'],['scheduled','--remote'],['sync','base','--remote']])assert.notEqual(spawnSync(process.execPath,['scripts/sync-local.mjs',...args]).status,0);
});
test('scheduled real permanece bloqueado y no hay triggers Cron ni DB remota',()=>{
 assert.throws(()=>entry.scheduled({}, {OAUTH_MODE:'real'},{}),/activity_transport_disabled/);
 const config=JSON.parse(readFileSync('wrangler.oauth.local.jsonc','utf8'));assert.equal(config.triggers,undefined);assert.equal(config.d1_databases[0].remote,false);assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
});
