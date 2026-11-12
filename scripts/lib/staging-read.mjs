import {createServer} from 'node:http';
import {validatePublicProgress} from '../../frontend/js/http-progress.js';
import {loadInfrastructureConfig} from './infrastructure-config.mjs';
const infrastructure = loadInfrastructureConfig();
export const STAGING_READ_URL = infrastructure.cloudflare.staging.apiOrigin + infrastructure.public.progressPath;
export const STAGING_READ_PORT = infrastructure.local.ddev.stagingRead.port;
export function stagingViewConfig(base) {
  const {id, goalKm, startDate, timeZone, apiPath, allowFixtures} = infrastructure.local.profiles.staging;
  return {...base,game:{...base.game,id,title:`${base.game.title} · Staging ficticio`,mode:'real',goalKm,startDate,timeZone},api:{url:apiPath,allowFixtures}};
}

/** Fixed public GET; no incoming URL/header/body is forwarded. No request until called. */
export async function readStaging({fetchUpstream=globalThis.fetch,signal,timeoutMs=6000}={}) {
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('staging_unavailable');
  const controller=new AbortController();
  const aborted=()=>controller.abort();signal?.addEventListener('abort',aborted,{once:true});
  if(signal?.aborted)controller.abort();
  let timer;
  const stopped=new Promise((resolve,reject)=>{
    controller.signal.addEventListener('abort',()=>reject(Error('staging_unavailable')),{once:true});
    if(controller.signal.aborted)reject(Error('staging_unavailable'));
    timer=setTimeout(()=>controller.abort(),timeoutMs);
  });
  try {
    return await Promise.race([(async()=>{
      const response=await fetchUpstream(STAGING_READ_URL,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
      if(response.status!==200||response.redirected)throw Error('staging_unavailable');
      const reader=response.body?.getReader();if(!reader)throw Error('staging_unavailable');
      const chunks=[];let length=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536)throw Error('staging_unavailable');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      return validatePublicProgress(JSON.parse(new TextDecoder().decode(bytes)),{allowFixtures:true,expectedSource:'fixture'});
    })(),stopped]);
  } catch {throw Error('staging_unavailable');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',aborted);}
}
export function stagingReadServer(options={}) {
  return createServer(async(request,response)=>{
    const send=(value,status)=>{if(response.destroyed)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));};
    if(request.url!=='/api/progress'){send({error:'not_found'},404);return;}
    if(request.method!=='GET'){response.setHeader('Allow','GET');send({error:'method_not_allowed'},405);return;}
    if(request.headers['transfer-encoding']||Number(request.headers['content-length'])>0){send({error:'invalid_request'},400);return;}
    const controller=new AbortController();
    response.once('close',()=>{if(!response.writableFinished)controller.abort();});
    try{send(await readStaging({...options,signal:controller.signal}),200);}
    catch{send({error:'staging_unavailable'},502);}
  });
}
