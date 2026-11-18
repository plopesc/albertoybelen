import {lstatSync,realpathSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {privateFile} from './staging-private-files.mjs';
export function mvpPrivateDirectory(root,{create=false}={}) {
  const base=resolve(root),stat=lstatSync(base);
  if(!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o002)||realpathSync(base)!==base)throw Error('Private checkout required');
  let path=base;
  for(const part of ['.local','staging-mvp']) {
    path=join(path,part);
    if(create)try{mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
    const s=lstatSync(path);if(!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||realpathSync(path)!==path)throw Error('Private directory required');
  }
  return path;
}
export function readMvpPrivate(root,name) {
  if(!['admin-token','aes-key','strava-client-id','strava-client-secret','invitation-request.json'].includes(name))throw Error('Fixed private input required');
  return privateFile(join(mvpPrivateDirectory(root),name),4096).toString('utf8').trim();
}
export function prepareMvpPrivate(root) {
  const directory=mvpPrivateDirectory(root,{create:true});
  // Exclusive files: a second prepare must never rotate an encryption key silently.
  writeFileSync(join(directory,'admin-token'),randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});
  writeFileSync(join(directory,'aes-key'),randomBytes(32).toString('base64')+'\n',{flag:'wx',mode:0o600});
  for(const [name,text]of [['strava-client-id','\n'],['strava-client-secret','\n'],['invitation-request.json',JSON.stringify({type:'issue',slot:'slot-a',expectedAthleteId:null},null,2)+'\n']])writeFileSync(join(directory,name),text,{flag:'wx',mode:0o600});
}

export function rotateMvpAdmin(root) {
  const directory=mvpPrivateDirectory(root);readMvpPrivate(root,'admin-token');
  const next=join(directory,'admin-token.next');
  writeFileSync(next,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});
  renameSync(next,join(directory,'admin-token'));
}
