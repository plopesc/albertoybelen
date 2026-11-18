import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {requireStagingAccount,stagingEnvironment} from './staging-config.mjs';
import {validateMvpConfiguration,mvpConfiguration} from './staging-mvp-config.mjs';
import {readMvpPrivate} from './staging-mvp-private.mjs';
const names={STAGING_ADMIN_TOKEN:'admin-token',TOKEN_ENCRYPTION_KEY:'aes-key',STRAVA_CLIENT_ID:'strava-client-id',STRAVA_CLIENT_SECRET:'strava-client-secret',TOKEN_ENCRYPTION_KEY_VERSION:null};
export function runMvpWrangler({root,config,fixture,env,argv,spawn=spawnSync}) {
  validateMvpConfiguration(config,fixture);requireStagingAccount(env);
  const [action,name,confirmation]=argv;let args,input;
  if(action==='deploy'&&argv.length===2&&name==='--confirm-staging-oauth')args=['deploy'];
  else if(['secret','secret-delete'].includes(action)&&argv.length===3&&confirmation==='--confirm-staging-secret'&&Object.hasOwn(names,name)) {
    if(action==='secret-delete'&&name!=='STAGING_ADMIN_TOKEN')throw Error('Only admin credential revocation supported');
    args=['secret',action==='secret'?'put':'delete',name];
    if(action==='secret') {
      input=name==='TOKEN_ENCRYPTION_KEY_VERSION'?'v1':readMvpPrivate(root,names[name]);
      if(!input||input.includes('\n')||input.length>2048)throw Error('Invalid secret');
      if(name==='STAGING_ADMIN_TOKEN'&&!/^[\w-]{43}$/.test(input))throw Error('Invalid secret');
      if(name==='TOKEN_ENCRYPTION_KEY'&&(!/^[\w+/]{43}=$/.test(input)||Buffer.from(input,'base64').length!==32))throw Error('Invalid secret');
      if(name==='STRAVA_CLIENT_ID'&&!/^[1-9]\d*$/.test(input))throw Error('Invalid secret');
      input+='\n';
    }
  } else throw Error('Explicit fixed staging operation required');
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'albertoybelen-mvp-'));
  try {
    const enabled=mvpConfiguration({enabled:true});enabled.main=join(root,enabled.main);enabled.d1_databases=enabled.d1_databases.map(db=>({...db,migrations_dir:join(root,db.migrations_dir)}));
    const path=join(directory,'wrangler.json');writeFileSync(path,JSON.stringify(enabled),{mode:0o600,flag:'wx'});writeFileSync(join(directory,'.dev.vars'),'',{mode:0o600,flag:'wx'});
    const result=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',path],{cwd:directory,input,env:{...stagingEnvironment(env,true,join(directory,'private.log')),CI:'true',NO_COLOR:'1'},stdio:['pipe','pipe','pipe'],encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
    if(result.error||result.status!==0)throw Error('Staging operation failed');
    return{status:'completed',operation:action};
  }finally{rmSync(directory,{recursive:true,force:true});}
}
