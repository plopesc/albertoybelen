import{existsSync,readFileSync,writeFileSync,unlinkSync}from'node:fs';import{spawnSync}from'node:child_process';
const action=process.argv[2];if(process.argv.length!==3||!['enable','disable'].includes(action))throw Error('Use enable/disable only');
const project='/var/www/html/.ddev';
if(!existsSync('/mnt/ddev_config/config.yaml')||!existsSync(`${project}/config.yaml`)||!readFileSync(`${project}/config.yaml`).equals(readFileSync('/mnt/ddev_config/config.yaml')))throw Error('Existing DDEV project required');
const source=readFileSync(new URL('../.ddev/nginx/frontend-local.conf.example',import.meta.url),'utf8'),destination=`${project}/nginx/frontend-local.conf`;
if(existsSync(destination)&&readFileSync(destination,'utf8')!==source)throw Error('Existing preview proxy differs; not changed');
let created=false;
if(action==='enable'&&!existsSync(destination)){writeFileSync(destination,source);created=true;}
if(action==='disable'&&existsSync(destination))unlinkSync(destination);
if(spawnSync('sudo',['nginx','-t'],{stdio:'inherit'}).status!==0){if(created)unlinkSync(destination);throw Error('Validation failed; no reload');}
if(spawnSync('sudo',['nginx','-s','reload'],{stdio:'inherit'}).status!==0)throw Error('Reload failed');
console.log(`Local frontend preview proxy ${action}d.`);
