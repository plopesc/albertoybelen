import {readFileSync,mkdirSync,existsSync,writeFileSync,readdirSync,lstatSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {stagingCommand,stagingEnvironment,STAGING_WORKER,STAGING_DATABASE,STAGING_DATABASE_ID} from './lib/staging-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const config=JSON.parse(readFileSync(`${root}wrangler.staging.jsonc`,'utf8'));
  const args=stagingCommand(config,process.argv.slice(2),process.env);
  console.log(`Staging target: ${STAGING_WORKER}; DB=${STAGING_DATABASE}; ID=${STAGING_DATABASE_ID}; binding=DB; Cron=none.`);
  if(args){
    const isolated=`${root}.local/staging-cli`;
    mkdirSync(isolated,{recursive:true,mode:0o700});
    if(!lstatSync(isolated).isDirectory()||(lstatSync(isolated).mode&0o077))throw Error('Private isolated directory required');
    // Do not read/copy the project's .dev.vars, OAuth/pilot secrets or .env files.
    for(const file of readdirSync(isolated))if(file.startsWith('.env')||(file.startsWith('.dev.vars')&&file!=='.dev.vars'))throw Error('Unexpected environment file in isolated staging directory');
    const emptyVars=`${isolated}/.dev.vars`;
    if(existsSync(emptyVars)&&(!lstatSync(emptyVars).isFile()||readFileSync(emptyVars).length!==0))throw Error('Isolated staging .dev.vars must be empty');
    if(!existsSync(emptyVars))writeFileSync(emptyVars,'',{mode:0o600});
    const generated={...config,main:`${root}${config.main}`,d1_databases:config.d1_databases.map(db=>({...db,migrations_dir:`${root}${db.migrations_dir}`}))};
    const path=`${isolated}/wrangler.json`;
    if(existsSync(path)&&!lstatSync(path).isFile())throw Error('Generated config cannot be a link');
    writeFileSync(path,JSON.stringify(generated,null,2)+'\n',{mode:0o600});
    const remote=process.argv[2]!=='dry-run';
    const log=`${isolated}/wrangler-command.log`;
    if(existsSync(log))throw Error('Unexpected log file; inspect and remove it manually');
    writeFileSync(log,'',{mode:0o600});
    try {
      const result=spawnSync(process.execPath,[`${root}node_modules/wrangler/bin/wrangler.js`,...args,'--config',path],{cwd:isolated,env:stagingEnvironment(process.env,remote,log),stdio:'inherit'});
      process.exitCode=result.status??1;
    } finally {unlinkSync(log);}
  }
} catch {console.error('Staging operation rejected or failed. Check config.json, the independent infrastructure allowlist, Wrangler target, explicit confirmation, selected account and isolated configuration; no fallback to another environment.');process.exitCode=1;}
