import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {connect} from 'node:net';
import {execFileSync} from 'node:child_process';
import {readFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {STAGING_AUTH_ORIGIN as origin} from '../../backend/staging-auth-settings.js';

/** Local TLS terminator + CONNECT proxy. No destination is ever resolved or forwarded. */
export async function browserMockNetwork({directory,worker,athlete}) {
  const hostname=new URL(origin).hostname,hosts=new Set([hostname,'www.strava.com']);
  const key=join(directory,'synthetic-tls.key'),certificate=join(directory,'synthetic-tls.crt');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',certificate,'-days','1','-subj','/CN=synthetic-staging.local'],{stdio:'ignore'});chmodSync(key,0o600);
  const sockets=new Set();let intercepted=0;
  const tls=httpsServer({key:readFileSync(key),cert:readFileSync(certificate)},async(request,response)=>{
    try {
      const url=new URL(request.url,`https://${request.headers.host}`);intercepted++;
      if(!hosts.has(url.hostname)||url.port||url.protocol!=='https:')throw Error('Unknown mock host');
      if(url.origin===origin) {
        const chunks=[];let length=0;for await(const chunk of request){length+=chunk.length;if(length>65536)throw Error('Body limit');chunks.push(chunk);}
        const result=await worker.dispatchFetch(url.href,{method:request.method,headers:request.headers,body:chunks.length?Buffer.concat(chunks):undefined,redirect:'manual'});
        const headers=Object.fromEntries(result.headers);if(result.headers.getSetCookie)headers['set-cookie']=result.headers.getSetCookie();
        response.writeHead(result.status,headers).end(Buffer.from(await result.arrayBuffer()));return;
      }
      if(url.origin==='https://www.strava.com'&&url.pathname==='/oauth/authorize'&&request.method==='GET') {
        if(url.searchParams.get('redirect_uri')!==`${origin}/oauth/callback`||url.searchParams.get('scope')!=='activity:read_all'||!/^[\w-]{43}$/.test(url.searchParams.get('state')??''))throw Error('Invalid synthetic authorize');
        const callback=`${origin}/oauth/callback?${new URLSearchParams({state:url.searchParams.get('state'),scope:'activity:read_all',code:`synthetic-code-${athlete()}`})}`;
        response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).end(`<!doctype html><h1>Proveedor simulado</h1><p>Sin conexión a Strava.</p><a id="consent" href="${callback.replaceAll('&','&amp;')}">Autorizar prueba</a>`);return;
      }
      throw Error('Unknown mock path');
    } catch {response.writeHead(502,{'Content-Type':'text/plain'}).end('Mock request rejected');}
  });
  const track=socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));};tls.on('connection',track);
  const proxy=httpServer((request,response)=>response.writeHead(403).end());proxy.on('connection',track);
  proxy.on('connect',(request,client,head)=>{
    // Fixed allowlist, fixed loopback connect. Never connect(request.url) or DNS.
    if(![`${hostname}:443`,'www.strava.com:443'].includes(request.url)){client.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    const upstream=connect(tls.address().port,'127.0.0.1');track(upstream);
    upstream.on('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
    client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>upstream.destroy());
  });
  const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {await listen(tls);await listen(proxy);}
  catch(error){for(const socket of sockets)socket.destroy();tls.close();proxy.close();throw error;}
  return {proxy:`http://127.0.0.1:${proxy.address().port}`,get intercepted(){return intercepted;},async close(){for(const socket of sockets)socket.destroy();await Promise.all([tls,proxy].map(server=>new Promise(resolve=>server.close(resolve))));}};
}
