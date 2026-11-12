import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';
import{localOAuth}from'../backend/oauth-entry.js';
test('config OAuth únicamente local, opt-in real explícito y plantilla sin valores de secretos',()=>{
 const config=JSON.parse(readFileSync('wrangler.oauth.local.jsonc','utf8'));assert.equal(config.vars.OAUTH_MODE,'mock');assert.equal(config.d1_databases[0].remote,false);assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000025');assert.equal(config.send_metrics,false);assert.equal(config.triggers,undefined);assert.equal(config.account_id,undefined);
 assert.throws(()=>localOAuth({APP_ENV:'local-fixtures',DB:{},OAUTH_MODE:'real'}),/real_oauth_disabled/);
 const template=readFileSync('.dev.vars.example','utf8');assert.match(template,/^STRAVA_CLIENT_SECRET=$/m);assert.match(template,/^TOKEN_ENCRYPTION_KEY=$/m);
});
test('CLI local rechaza flags remotos y despliegue sin invocar Wrangler',()=>{
 for(const args of [['deploy'],['dev','--remote'],['migrate','--remote']])assert.notEqual(spawnSync(process.execPath,['scripts/oauth-local.mjs',...args]).status,0);
});
test('rotación mal configurada no reemplaza silenciosamente la clave activa',()=>{
 assert.throws(()=>localOAuth({APP_ENV:'local-fixtures',DB:{},OAUTH_MODE:'mock',TOKEN_ENCRYPTION_KEY_VERSION:'v1',TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION:'v1'}),/vault_unavailable/);
});
