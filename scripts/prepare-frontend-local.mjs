import {readFileSync,writeFileSync,existsSync}from'node:fs';
const pilot=process.argv[2]==='--pilot';
if(process.argv.length!==(pilot?3:2))throw Error('Only optional --pilot is supported');
const path=new URL('../frontend/config/local.json',import.meta.url);if(existsSync(path))throw Error('Refusing to overwrite existing local frontend configuration');
const base=JSON.parse(readFileSync(new URL('../frontend/config/game.json',import.meta.url),'utf8'));
const config={...base,game:{...base.game,id:pilot?'local-ddev-owner-pilot':'local-ddev-api-fixtures',goalKm:pilot?500:100,startDate:'2026-11-01',timeZone:'Europe/Madrid',mode:'real'},api:{url:'/api/progress',allowFixtures:!pilot}};
writeFileSync(path,JSON.stringify(config,null,2)+'\n');console.log('Local frontend configuration written (gitignored). No backend started or external request sent. Open DDEV /frontend/?local-api=1 only with its matching backend; the owner pilot remains subject to separate authorization.');
