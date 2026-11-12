import {fileURLToPath}from'node:url';import{frontendServer}from'./lib/frontend-server.mjs';
if(process.argv.length!==2)throw Error('No extra arguments');
import {loadInfrastructureConfig} from './lib/infrastructure-config.mjs';
const {frontend,host}=loadInfrastructureConfig().local.ddev;
frontendServer({root:fileURLToPath(new URL('../frontend/',import.meta.url))}).listen(frontend.port,host,()=>console.log(`Frontend preview on loopback ${frontend.port}. Enable the optional DDEV preview proxy, then open /frontend/?local-api=1.`));
