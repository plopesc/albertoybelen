import { newSecret } from '../auth/invitation-machine.js';
const COOKIE='__Host-strava-attempt';
const FLASH='__Host-strava-result';
const cookie=(name,value,maxAge=600)=>`${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
function readCookie(request,name) {
 const values=(request.headers.get('Cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(`${name}=`));
 return values.length===1?values[0].slice(name.length+1):undefined;
}
const script=`const token=location.hash.slice(1);history.replaceState(null,'','/invite');if(token){fetch('/invite/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async response=>{if(!response.ok)throw Error();const result=await response.json();location.replace(result.authorizeUrl)}).catch(()=>{document.getElementById('message').textContent='No se pudo iniciar. Vuelve a abrir tu enlace privado.'})}else{document.getElementById('message').textContent='Abre el enlace privado que has recibido.'}`;
async function limitedBody(request,limit) {
 if(Number(request.headers.get('Content-Length'))>limit)throw Error();
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let length=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error();}chunks.push(value);}}
 finally {reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder().decode(bytes);
}
export function createOAuthRouter({service,publicWorker,provider,mock=false,origin='https://albertoybelen.ddev.site'}) {
 const headers={'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
 function page(message,content='',javascript='') {
  const nonce=newSecret();const h={...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`};
  return new Response(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conexión privada</title><style nonce="${nonce}">body{font:18px/1.6 system-ui;background:#24342c;color:#f5efdc;margin:0;padding:24px}main{max-width:600px;margin:10vh auto}button{font:inherit;min-height:48px;padding:10px 18px;margin:8px;background:#e2bc81;color:#24342c;border:0;border-radius:5px}:focus-visible{outline:3px solid white;outline-offset:4px}</style><main><h1>Conexión privada</h1><p id="message" role="status">${message}</p>${content}</main>${javascript?`<script nonce="${nonce}">${javascript}</script>`:''}</html>`,{headers:h});
 }
 function redirect(location,result) {const h=new Headers(headers);h.set('Location',location);if(result)h.append('Set-Cookie',cookie(FLASH,result,60));return new Response(null,{status:303,headers:h});}
 return {
  async fetch(request) {
   const url=new URL(request.url);
   if(url.pathname==='/api/progress')return publicWorker.fetch(request);
   if(url.hostname!==new URL(origin).hostname || (url.protocol!=='https:'&&request.headers.get('X-Forwarded-Proto')!=='https'))return new Response('Invalid local origin',{status:400,headers});
   const post=request.method==='POST';
   if(post&&request.headers.get('Origin')!==origin)return new Response('Request rejected',{status:403,headers});
   try {
    if(url.pathname==='/invite'&&request.method==='GET') {
      let session;try{session=await service.session(readCookie(request,COOKIE));}catch{session=await service.session();}
      const response=page('Preparando autorización…','',''+script);response.headers.append('Set-Cookie',cookie(COOKIE,session));return response;
    }
    if(url.pathname==='/invite/start'&&post) {
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();
      const body=await limitedBody(request,2048);const input=JSON.parse(body);
      if(Object.keys(input).some(k=>k!=='token'))throw Error();
      const authorizeUrl=await service.start({token:input.token,session:readCookie(request,COOKIE)});
      return Response.json({authorizeUrl},{headers});
    }
    if(url.pathname==='/oauth/callback'&&request.method==='GET') {
      let success=false;
      try {
        if([...url.searchParams.keys()].some(k=>!['state','code','scope','error'].includes(k)||url.searchParams.getAll(k).length!==1))throw Error();
        success=await service.callback({state:url.searchParams.get('state'),session:readCookie(request,COOKIE),code:url.searchParams.get('code'),scope:url.searchParams.get('scope'),error:url.searchParams.get('error')});
      } catch {success=false;}
      return redirect('/oauth/result',success?'success':'error');
    }
    if(url.pathname==='/oauth/result'&&request.method==='GET') {
      const response=page(readCookie(request,FLASH)==='success'?'Autorización guardada de forma segura. Puedes cerrar esta página.':'No se ha completado la autorización. Puedes volver a abrir tu enlace privado.');
      response.headers.append('Set-Cookie',cookie(FLASH,'',0));return response;
    }
    if(mock&&url.pathname==='/oauth/mock/authorize') {
      if(request.method==='GET') {
        const state=url.searchParams.get('state');if(!/^[\w-]{43}$/.test(state??''))throw Error();
        const response=page('Proveedor simulado: no se contacta con Strava.',`<form method="post"><input type="hidden" name="state" value="${state}"><button name="account" value="101">Autorizar cuenta ficticia A</button><button name="account" value="202">Autorizar cuenta ficticia B</button><button name="account" value="deny">Cancelar</button></form>`);
        // Native POST navigation needs Origin. Strip the query while retaining its origin.
        response.headers.set('Referrer-Policy','origin');return response;
      }
      if(post) {
        const raw=await limitedBody(request,1024);const form=new URLSearchParams(raw);const state=form.get('state'),account=form.get('account');if(!/^[\w-]{43}$/.test(state??'')||!['101','202','deny'].includes(account))throw Error();
        const query=new URLSearchParams({state,scope:'activity:read_all'});
        if(account==='deny')query.set('error','access_denied');else query.set('code',provider.issueCode({athleteId:Number(account)}));
        return redirect(`/oauth/callback?${query}`);
      }
    }
    return new Response('Not found',{status:404,headers});
   } catch {return new Response('No se pudo completar la solicitud.',{status:400,headers});}
  },
 };
}
