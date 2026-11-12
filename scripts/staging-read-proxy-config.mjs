import{existsSync,readFileSync,writeFileSync,unlinkSync}from'node:fs';import{spawnSync}from'node:child_process';import{assertDdevProject}from'./lib/ddev-preflight.mjs';
const action=process.argv[2];if(process.argv.length!==3||!['enable','disable'].includes(action))throw Error('Use enable/disable only');assertDdevProject();
const source=readFileSync(new URL('../.ddev/nginx/staging-read-local.conf.example',import.meta.url),'utf8'),destination='/var/www/html/.ddev/nginx/staging-read-local.conf';
if(existsSync(destination)&&readFileSync(destination,'utf8')!==source)throw Error('Existing staging proxy snippet differs; not changed');
let created=false;
if(action==='enable'&&!existsSync(destination)){writeFileSync(destination,source,{flag:'wx'});created=true;}
if(action==='disable'&&existsSync(destination))unlinkSync(destination);
if(spawnSync('sudo',['nginx','-t'],{stdio:'inherit'}).status!==0){if(created)unlinkSync(destination);throw Error('Nginx validation failed; no reload');}
if(spawnSync('sudo',['nginx','-s','reload'],{stdio:'inherit'}).status!==0)throw Error('Nginx reload failed');
console.log('Staging read route configured locally. Activation itself sends no Cloudflare HTTP request.');
