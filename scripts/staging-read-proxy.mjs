import{assertDdevProject,assertPortsFree}from'./lib/ddev-preflight.mjs';import{stagingReadServer,STAGING_READ_PORT}from'./lib/staging-read.mjs';
if(process.argv.length!==2)throw Error('No extra arguments or upstream overrides');
assertDdevProject();await assertPortsFree([STAGING_READ_PORT]);
const server=stagingReadServer();server.on('error',()=>{console.error('Staging read proxy could not bind its own port; no other service touched.');process.exitCode=1;});
server.listen(STAGING_READ_PORT,'127.0.0.1',()=>console.log(`Read-only staging proxy listening on loopback ${STAGING_READ_PORT}. No Cloudflare HTTP request until a GET is received. Stop with Ctrl+C.`));
