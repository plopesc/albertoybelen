import {atStage} from './staging-diagnostics.mjs';
import {writeFileSync,renameSync,lstatSync,openSync,closeSync,unlinkSync,mkdirSync,fsyncSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateStagingConfig,requireStagingAccount,STAGING_WORKER,STAGING_DATABASE,STAGING_DATABASE_ID} from './staging-config.mjs';
import {privateDirectory,privateFile} from './staging-private-files.mjs';
import {migrationPreflight,parseRemoteState,inspectSql,sha256} from './staging-d1-preflight.mjs';
import {MIGRATION_PINS,BACKUP_ID,MAX_BACKUP_BYTES,STAGING_D1_READ_QUERY} from './staging-d1-policy.mjs';
const target=()=>({worker:STAGING_WORKER,databaseName:STAGING_DATABASE,databaseId:STAGING_DATABASE_ID,binding:'DB'});
const readArgs=['d1','execute','DB','--remote','--json','--command',STAGING_D1_READ_QUERY];
const directory=(root,id)=>{if(!BACKUP_ID.test(id??''))throw Error('Backup ID required');return privateDirectory(root,['.local','staging-backups',id]);};
function exactKeys(value,names){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==names.split(' ').sort().join(','))throw Error('Backup evidence rejected');}
export function inspectBackup(root,id,migrations,{account,now=Date.now()}={}) {
  try {
    const dir=directory(root,id),manifest=JSON.parse(privateFile(join(dir,'manifest.json'),65536));
    exactKeys(manifest,'schemaVersion provenance target accountSha256 createdAt format sql migrations snapshot');exactKeys(manifest.sql,'file bytes sha256');
    if(manifest.schemaVersion!==1||manifest.provenance!=='guarded-wrangler-export'||!isDeepStrictEqual(manifest.target,target())||manifest.format!=='d1-sql'||!/^[a-f0-9]{64}$/.test(manifest.accountSha256)||manifest.sql.file!=='backup.sql'||!isDeepStrictEqual(manifest.migrations,MIGRATION_PINS))throw Error();
    if(typeof manifest.createdAt!=='string'||!Number.isFinite(Date.parse(manifest.createdAt))||new Date(manifest.createdAt).toISOString()!==manifest.createdAt||Date.parse(manifest.createdAt)>now+30000)throw Error();
    if(account&&(manifest.accountSha256!==sha256(account.toLowerCase())||!Number.isFinite(Date.parse(manifest.createdAt))||Date.parse(manifest.createdAt)>now+30000||now-Date.parse(manifest.createdAt)>86400000))throw Error();
    const bytes=privateFile(join(dir,'backup.sql'),MAX_BACKUP_BYTES);
    if(bytes.length!==manifest.sql.bytes||sha256(bytes)!==manifest.sql.sha256)throw Error();
    const snapshot=inspectSql(bytes,migrations);if(!isDeepStrictEqual(snapshot,manifest.snapshot))throw Error();
    return{manifest,snapshot};
  }catch{throw Error('Backup evidence rejected: private complete SQL, checksum, target/account and local restore required');}
}
export function stagingD1Plan(config,migrations) {
  validateStagingConfig(config);
  return{scope:'local-only-plan',target:target(),migrations:migrations.map(({name,sha256})=>({name,sha256})),expectedPending:['0003_staging_auth_test.sql'],remoteState:'not-checked',actionsRequiringSeparateApproval:['list (fixed read-only inventory)','backup --confirm-staging (export plus consistency reads)','inspect-backup <id> (local only)','migrate <id> --confirm-staging (fresh inventory, only 0003, postcheck)','fixture GET (explicit owner action, never automatic)'],restoreRemote:'not-supported',oauth:'closed',cron:false};
}
export function runStagingD1({root,config,argv,env,runWrangler,clock=Date.now,createId=()=>randomBytes(12).toString('hex')}) {
  const [op,arg,confirmation]=argv;
  if(['d1-check','d1-plan'].includes(op)?argv.length!==1:op==='inspect-backup'?argv.length!==2||!BACKUP_ID.test(arg??''):op==='migrate'?argv.length!==3||!BACKUP_ID.test(arg??'')||confirmation!=='--confirm-staging':!['list','backup'].includes(op)||argv.length!==2||arg!=='--confirm-staging')throw Error('Fixed staging D1 operation/confirmation required');
  const migrations=atStage('LOCAL_PREFLIGHT',()=>migrationPreflight(root,config));
  if(op==='d1-check'||op==='d1-plan')return stagingD1Plan(config,migrations);
  if(op==='inspect-backup'){const {manifest}=inspectBackup(root,arg,migrations);return{status:'verified-locally',backupId:arg,target:manifest.target,bytes:manifest.sql.bytes,sha256:manifest.sql.sha256,createdAt:manifest.createdAt,freshForMigration:clock()-Date.parse(manifest.createdAt)<=86400000,accountCheck:'deferred-to-migrate',remoteChecked:false};}
  atStage('ACCOUNT_SELECTION',()=>requireStagingAccount(env));const account=env.CLOUDFLARE_ACCOUNT_ID;
  const read=options=>parseRemoteState(runWrangler(readArgs,{capture:true}),options);
  if(op==='list'){const output=runWrangler(readArgs,{capture:true});let state;try{state=parseRemoteState(output);}catch{state=parseRemoteState(output,{after:true});}return{target:target(),applied:state.applied,pending:state.applied.length===3?[]:[migrations[2].name],kind:'remote-read-only'};}
  // Validate all backup evidence BEFORE any remote call or write preparation.
  const evidence=op==='migrate'?inspectBackup(root,arg,migrations,{account,now:clock()}):undefined;
  const base=privateDirectory(root,['.local','staging-backups'],{create:true}),lock=join(base,'.operation-lock');
  const descriptor=openSync(lock,'wx',0o600);writeFileSync(descriptor,JSON.stringify({pid:process.pid,startedAt:new Date(clock()).toISOString()}));closeSync(descriptor);
  try {
    const before=read();
    if(op==='migrate') {
      if(!isDeepStrictEqual(before,evidence.snapshot))throw Error('Remote inventory changed since backup; stop');
      // Only the reviewed 0003 file is frozen into the subprocess config. No future SQL can slip in.
      runWrangler(['d1','migrations','apply','DB','--remote'],{capture:true,migration:migrations[2],backupId:arg});
      const after=read({after:true});if(!isDeepStrictEqual(after.counts,before.counts))throw Error('Post-migration fixture counters differ; stop');
      return{status:'migration-0003-applied',backupId:arg,target:target(),fixtureVerification:'explicit-GET-still-required',remoteRestore:false};
    }
    const id=createId();if(!BACKUP_ID.test(id))throw Error('Invalid generated backup ID');
    const dir=join(base,id); // Exclusive mkdir, no reuse/collision.
    mkdirSync(dir,{mode:0o700});privateDirectory(root,['.local','staging-backups',id]);
    const partial=join(dir,'backup.sql.partial');writeFileSync(partial,'',{mode:0o600,flag:'wx'});const original=lstatSync(partial);
    let manifestCreated=false;
    try {
      const output=runWrangler(['d1','export','DB','--remote','--output',partial,'--compatibility','d1','--skip-confirmation'],{capture:true});
      if(!output.includes(`Executing on remote database DB (${STAGING_DATABASE_ID}):`)||!output.includes(`Downloaded to ${partial} successfully!`))throw Error();
      const stat=lstatSync(partial);if(stat.ino!==original.ino||stat.dev!==original.dev)throw Error();
      const bytes=privateFile(partial,MAX_BACKUP_BYTES),snapshot=inspectSql(bytes,migrations),after=read();
      if(!isDeepStrictEqual(snapshot,before)||!isDeepStrictEqual(after,before))throw Error();
      const manifest={schemaVersion:1,provenance:'guarded-wrangler-export',target:target(),accountSha256:sha256(account.toLowerCase()),createdAt:new Date(clock()).toISOString(),format:'d1-sql',sql:{file:'backup.sql',bytes:bytes.length,sha256:sha256(bytes)},migrations:MIGRATION_PINS,snapshot};
      const sqlFd=openSync(partial,'r+');try{fsyncSync(sqlFd);}finally{closeSync(sqlFd);}
      renameSync(partial,join(dir,'backup.sql'));
      const manifestFd=openSync(join(dir,'manifest.json'),'wx',0o600);manifestCreated=true;
      try{writeFileSync(manifestFd,JSON.stringify(manifest,null,2)+'\n');fsyncSync(manifestFd);}finally{closeSync(manifestFd);}
      const dirFd=openSync(dir,'r');try{fsyncSync(dirFd);}finally{closeSync(dirFd);}
      inspectBackup(root,id,migrations,{account,now:clock()});
      return{status:'backup-verified',backupId:id,target:target(),bytes:bytes.length,sha256:manifest.sql.sha256};
    }catch{if(manifestCreated){try{unlinkSync(join(dir,'manifest.json'));}catch{}}throw Object.assign(Error('Backup incomplete or inconsistent; private partial files retained, no valid evidence published'),{backupId:id});}
  }finally{unlinkSync(lock);}
}
