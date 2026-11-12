import {loadInfrastructureConfig,validateLocalTarget} from './infrastructure-config.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { assertPrivateFiles } from './private-permissions.mjs';
import { fileURLToPath } from 'node:url';
import { createPilot, PILOT_ENABLE } from '../../backend/pilot.js';
export const pilotRoot = fileURLToPath(new URL('../../',import.meta.url));
export const privateDirectory = `${pilotRoot}.local/pilot-config`;
export function pilotConfig() {
  const config=JSON.parse(readFileSync(`${pilotRoot}wrangler.pilot.local.jsonc`,'utf8'));
  if(config.main!=='backend/pilot-entry.js'||config.vars.APP_ENV!=='local-owner-pilot'||config.vars.PILOT_ENABLED!=='disabled'||config.d1_databases.length!==1||config.d1_databases[0].remote!==false||config.d1_databases[0].database_id!=='00000000-0000-0000-0000-000000000029'||config.triggers||config.routes||config.account_id)throw Error('Invalid local pilot config');
  validateLocalTarget(config,'ownerPilot');
  return config;
}
export function pilotVariables(authorized=false) {
  const vars={...pilotConfig().vars};const path=`${privateDirectory}/.dev.vars`;
  if(existsSync(path)) {
    assertPrivateFiles(privateDirectory,path);
    for(const line of readFileSync(path,'utf8').split('\n')){
      const match=/^([A-Z_]+)=(.*)$/.exec(line.trim());if(!match)continue;
      const allowed=['STRAVA_CLIENT_ID','STRAVA_CLIENT_SECRET','PILOT_OWNER_ATHLETE_ID','TOKEN_ENCRYPTION_KEY','TOKEN_ENCRYPTION_KEY_VERSION','TOKEN_PREVIOUS_ENCRYPTION_KEY','TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION'];
      if(!allowed.includes(match[1]))throw Error('Unexpected private variable');
      vars[match[1]]=match[2].replace(/^"|"$/g,'');
    }
  }
  vars.PILOT_ENABLED=authorized?PILOT_ENABLE:'disabled';return vars;
}
export async function openPilotLocal({authorized=false,fetchProvider}={}) {
  const vars=pilotVariables(authorized),config=pilotConfig();
  const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');
  const mf=new Miniflare({...convertV4MiniflareOptions({name:config.name,modules:true,script:'export default {fetch(){return new Response("Private local CLI",{status:404})}}',compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:{DB:config.d1_databases[0].database_id},outboundService:()=>{throw Error('Network forbidden');}}),resourcePersistencePath:`${pilotRoot}${loadInfrastructureConfig().local.ddev.ownerPilot.persistence}/v3`,telemetry:{enabled:false},logRequests:false});
  try{return {...createPilot({...vars,DB:await mf.getD1Database('DB')},{fetchProvider}),close:()=>mf.dispose()};}
  catch(error){await mf.dispose();throw error;}
}
