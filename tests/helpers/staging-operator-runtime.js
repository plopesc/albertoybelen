import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stagingEnvironment} from './staging-auth-fixture.js';
import {operatorIdentity} from './staging-operator-fixture.js';
import {OPERATOR_ENABLE,OPERATOR_READINESS} from '../../backend/staging-operator-policy.js';
import {STAGING_NETWORK_ENABLE,STAGING_AUTH_ORIGIN} from '../../backend/staging-auth-settings.js';
import {signOperatorCommand} from '../../scripts/lib/staging-operator-client.mjs';

/** Real service-binding RPC, fake outbound, temporary D1; no remote ingress. */
export async function operatorRuntime({closed=false}={}) {
  const directory=await mkdtemp(join(tmpdir(),'staging-operator-runtime-'));let mf;
  try {
    const identity=await operatorIdentity();
    const env={...stagingEnvironment(),...OPERATOR_READINESS,STAGING_OPERATOR_ENABLED:OPERATOR_ENABLE,STAGING_OPERATOR_KEYS:JSON.stringify([identity.policy]),STAGING_NETWORK_ENABLED:STAGING_NETWORK_ENABLE};
    if(closed)Object.assign(env,JSON.parse(await readFile('wrangler.staging-oauth.jsonc','utf8')).vars);
    const bundle=async entry=>(await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*','cloudflare:workers']})).outputFiles[0].text;
    const [apiScript,operatorScript,mockScript]=await Promise.all([bundle('backend/staging-release-entry.js'),bundle('backend/staging-operator-entry.js'),bundle('tests/helpers/staging-strava-worker.js')]);
    const api={name:'synthetic-staging-api',modules:true,script:apiScript,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:env,d1Databases:{DB:'00000000-0000-0000-0000-000000000042'},outboundService:{name:'synthetic-strava-provider'}};
    // Test-only route simulates accidental public exposure; release Wrangler has no routes.
    const operator={name:'synthetic-private-operator',routes:['private.invalid/*'],modules:true,script:operatorScript,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],bindings:{APP_ENV:'staging-operator-private',STAGING_OPERATOR_ENABLED:closed?'disabled':OPERATOR_ENABLE},serviceBindings:{STAGING_AUTH_TARGET:{name:'synthetic-staging-api',entrypoint:'StagingOperatorTarget'}},outboundService:()=>{throw Error('Operator outbound forbidden');}};
    const provider={name:'synthetic-strava-provider',modules:true,script:mockScript,compatibilityDate:'2026-11-01',compatibilityFlags:['nodejs_compat'],outboundService:()=>{throw Error('Provider outbound forbidden');}};
    const options={...convertV4MiniflareOptions({workers:[api,operator,provider]}),resourcePersistencePath:join(directory,'persist'),telemetry:{enabled:false},logRequests:false};
    mf=new Miniflare(options);let db=await mf.getD1Database('DB','synthetic-staging-api');
    const migrations=new URL('../../backend/d1/migrations/',import.meta.url);for(const file of(await readdir(migrations)).sort())for(const sql of(await readFile(new URL(file,migrations),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
    return {directory,env,identity,async requestCount(){return(await mf.getWorker('synthetic-strava-provider')).count();},get mf(){return mf;},get db(){return db;},async execute(operation){const envelope=await signOperatorCommand({privateKey:identity.privateKey,keyId:identity.policy.id,subject:identity.policy.subject,operation});return(await mf.getWorker('synthetic-private-operator')).execute(envelope);},async send(envelope){return(await mf.getWorker('synthetic-private-operator')).execute(envelope);},async publicFetch(path,options={}){return mf.dispatchFetch(new URL(path,STAGING_AUTH_ORIGIN).href,{redirect:'manual',...options});},async operatorFetch(path='/',options={}){return mf.dispatchFetch(new URL(path,'https://private.invalid').href,{redirect:'manual',...options});},async restart(){await mf.dispose();mf=new Miniflare(options);db=await mf.getD1Database('DB','synthetic-staging-api');},async close(){await mf?.dispose();await rm(directory,{recursive:true,force:true});}};
  } catch(error){await mf?.dispose();await rm(directory,{recursive:true,force:true});throw error;}
}
