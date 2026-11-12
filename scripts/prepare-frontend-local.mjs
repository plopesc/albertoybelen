import {readFileSync,writeFileSync,existsSync}from'node:fs';
if(process.argv.length!==2)throw Error('No extra arguments');
const path=new URL('../frontend/config/local.json',import.meta.url);if(existsSync(path))throw Error('Refusing to overwrite existing local frontend configuration');
const base=JSON.parse(readFileSync(new URL('../frontend/config/game.json',import.meta.url),'utf8'));
const config={...base,game:{...base.game,id:'local-ddev-api-fixtures',goalKm:100,startDate:'2026-11-01',timeZone:'Europe/Madrid',mode:'real'},api:{url:'/api/progress',allowFixtures:true}};
writeFileSync(path,JSON.stringify(config,null,2)+'\n');console.log('Public test configuration written locally (gitignored). Open https://albertoybelen.ddev.site/frontend/?local-api=1 with the fixture backend running. No backend started or external request sent.');
