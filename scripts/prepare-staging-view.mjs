import{readFileSync,writeFileSync,existsSync,lstatSync}from'node:fs';
import{stagingViewConfig,stagingStravaViewConfig}from'./lib/staging-read.mjs';
const strava=process.argv[2]==='--strava';if(process.argv.length!==(strava?3:2))throw Error('Only optional --strava is supported');
const path=new URL(strava?'../frontend/config/staging-strava.local.json':'../frontend/config/staging.local.json',import.meta.url),base=JSON.parse(readFileSync(new URL('../frontend/config/game.json',import.meta.url),'utf8'));
const config=(strava?stagingStravaViewConfig:stagingViewConfig)(base);
const text=JSON.stringify(config,null,2)+'\n';
if(existsSync(path)){if(!lstatSync(path).isFile()||readFileSync(path,'utf8')!==text)throw Error('Existing staging profile differs; no file was overwritten');}
else writeFileSync(path,text,{flag:'wx'});
console.log('Staging profile prepared (gitignored). local.json and public config untouched. No HTTP request sent. Open DDEV /frontend/?staging-api=1 (fixtures) or staging-api=strava (Strava) only when ready to read staging.');
