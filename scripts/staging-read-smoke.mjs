import{readStaging}from'./lib/staging-read.mjs';
if(process.argv.length!==3||process.argv[2]!=='--read-staging')throw Error('Read-only remote smoke requires explicit --read-staging; no request sent');
try{await readStaging();console.log('Confirmed staging fixture schema with a single public GET. No OAuth, sync or infrastructure operation.');}catch{console.error('Staging read smoke failed; upstream details omitted.');process.exitCode=1;}
