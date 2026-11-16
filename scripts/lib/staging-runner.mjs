import {mkdtempSync,writeFileSync,lstatSync,unlinkSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadInfrastructureConfig} from './infrastructure-config.mjs';
import {validateStagingConfig,stagingEnvironment,requireStagingAccount} from './staging-config.mjs';
import {isDeepStrictEqual} from 'node:util';
import {MIGRATION_PINS,STAGING_D1_READ_QUERY,BACKUP_ID} from './staging-d1-policy.mjs';
import {migrationPreflight,sha256} from './staging-d1-preflight.mjs';
import {inspectBackup} from './staging-d1.mjs';
import {privateDirectory,privateFile} from './staging-private-files.mjs';

/** The only Wrangler subprocess boundary for guarded staging commands. */
export function createStagingRunner(root,config,originalEnv,{spawn=spawnSync}={}) {
  return (args,{capture=false,migration,backupId}={})=>{
    capture=capture||args[0]==='d1';
    validateStagingConfig(config,loadInfrastructureConfig(join(root,'config.json')));
    const apply=isDeepStrictEqual(args,['d1','migrations','apply','DB','--remote']);
    const exportSql=args.length===9&&isDeepStrictEqual(args.slice(0,5),['d1','export','DB','--remote','--output'])&&isDeepStrictEqual(args.slice(6),['--compatibility','d1','--skip-confirmation']);
    const allowed=apply||exportSql||isDeepStrictEqual(args,['deploy'])||isDeepStrictEqual(args,['deploy','--dry-run','--outdir','dist'])||isDeepStrictEqual(args,['d1','execute','DB','--remote','--json','--command',STAGING_D1_READ_QUERY]);
    if(!allowed||(migration&&!apply))throw Error('Unsupported staging subprocess');
    if(exportSql){const id=basename(dirname(args[5]));if(!BACKUP_ID.test(id)||args[5]!==join(root,'.local/staging-backups',id,'backup.sql.partial'))throw Error('Fixed private output required');privateDirectory(root,['.local','staging-backups',id]);const s=lstatSync(args[5]);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o777)!==0o600)throw Error('Private output file required');}
    const remote=args.includes('--remote')||(args[0]==='deploy'&&!args.includes('--dry-run'));
    if(remote)requireStagingAccount(originalEnv);
    if(apply){if(!migration||migration.name!==MIGRATION_PINS[2].name||sha256(migration.sql)!==MIGRATION_PINS[2].sha256)throw Error('Only pinned 0003 permitted');inspectBackup(root,backupId,migrationPreflight(root,config),{account:originalEnv.CLOUDFLARE_ACCOUNT_ID});}
    const base=privateDirectory(root,['.local','staging-cli'],{create:true}),directory=mkdtempSync(join(base,'run-'));
    writeFileSync(join(directory,'.dev.vars'),'',{mode:0o600,flag:'wx'});
    let migrationsDir=join(root,'backend/d1/migrations');
    if(migration) {
      migrationsDir=privateDirectory(directory,['migrations'],{create:true});
      writeFileSync(join(migrationsDir,migration.name),migration.sql,{mode:0o600,flag:'wx'});
    }
    const generated={...config,main:join(root,config.main),d1_databases:config.d1_databases.map(db=>({...db,migrations_dir:migrationsDir}))};
    const file=join(directory,'wrangler.json');writeFileSync(file,JSON.stringify(generated),{mode:0o600,flag:'wx'});
    const log=join(directory,'command.log');writeFileSync(log,'',{mode:0o600,flag:'wx'});
    try {
      const result=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',file],{cwd:directory,env:{...stagingEnvironment(originalEnv,remote,log),...(capture?{CI:'true',NO_COLOR:'1'}:{})},stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:'utf8',maxBuffer:2*1024*1024,timeout:15*60*1000});
      if(result.error||result.status!==0)throw Error('Guarded staging subprocess failed; output suppressed');
      return result.stdout??'';
    }finally {
      // Diagnostics may contain signed URLs. Never print them or leave them as evidence.
      if(lstatSync(log).isFile())unlinkSync(log);
      if(privateFile(join(directory,'.dev.vars'),1,{allowEmpty:true}).length)throw Error('Isolated environment changed');
    }
  };
}
