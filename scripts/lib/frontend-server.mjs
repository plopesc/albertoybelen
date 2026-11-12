import {createServer}from'node:http';import{readFile}from'node:fs/promises';import{resolve,extname,sep}from'node:path';

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.jpeg':'image/jpeg','.jpg':'image/jpeg'};
export function frontendServer({root,handle,prefix='/frontend/'}={}) { return createServer(async(request,response)=>{
 try{
  if(handle && await handle(request,response))return;
  const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
  if(!['GET','HEAD'].includes(request.method)||!pathname.startsWith(prefix))throw Error();
  const path=resolve(root,pathname.slice(prefix.length)||'index.html');
  if(!path.startsWith(resolve(root)+sep)||!mime[extname(path)]||pathname.split('/').some(part=>part.startsWith('.')))throw Error();
  const bytes=await readFile(path);response.writeHead(200,{'Content-Type':mime[extname(path)],'Cache-Control':'no-store'}).end(request.method==='HEAD'?undefined:bytes);
 }catch{response.writeHead(404).end();}
});
}
