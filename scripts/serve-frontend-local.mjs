import {fileURLToPath}from'node:url';import{frontendServer}from'./lib/frontend-server.mjs';
if(process.argv.length!==2)throw Error('No extra arguments');
frontendServer({root:fileURLToPath(new URL('../frontend/',import.meta.url))}).listen(8791,'127.0.0.1',()=>console.log('Frontend preview on loopback 8791. Enable the optional DDEV preview proxy, then open /frontend/?local-api=1.'));
