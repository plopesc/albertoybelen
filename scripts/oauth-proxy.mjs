import {readFileSync,existsSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const action=process.argv[2];if(process.argv.length!==3||!['enable','disable'].includes(action))throw new Error('Use enable or disable');
if(!existsSync('/mnt/ddev_config/config.yaml'))throw new Error('Run only inside the existing DDEV container');
const source=readFileSync(new URL('../.ddev/nginx/oauth-local.conf',import.meta.url),'utf8');
const destination='/mnt/ddev_config/nginx/oauth-local.conf';
if(existsSync(destination)&&readFileSync(destination,'utf8')!==source)throw new Error('Existing proxy differs; no changes made');
let created=false;
if(action==='enable'&&!existsSync(destination)){mkdirSync('/mnt/ddev_config/nginx',{recursive:true});writeFileSync(destination,source);created=true;}
if(action==='disable'&&existsSync(destination))unlinkSync(destination);
const checked=spawnSync('sudo',['nginx','-t'],{stdio:'inherit'});
if(checked.status!==0){if(created)unlinkSync(destination);throw new Error('Nginx validation failed; no reload');}
const result=spawnSync('sudo',['nginx','-s','reload'],{stdio:'inherit'});if(result.status!==0)throw new Error('Nginx reload failed');
console.log(action==='enable'?'Local DDEV OAuth proxy enabled.':'Local DDEV OAuth proxy disabled.');
