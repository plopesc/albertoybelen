import {lstatSync,realpathSync,mkdirSync,openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {resolve,join} from 'node:path';
const owner=stat=>process.getuid===undefined||stat.uid===process.getuid();
export function privateDirectory(root,parts,{create=false}={}) {
  let path=resolve(root);const rootStat=lstatSync(path);if(!rootStat.isDirectory()||!owner(rootStat)||(rootStat.mode&0o022)||realpathSync(path)!==path)throw Error('Private path required');
  for(const part of parts) {
    if(!/^[a-zA-Z0-9.-]+$/.test(part)||['.','..'].includes(part))throw Error('Private path required');
    path=join(path,part);
    try{if(create)mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=lstatSync(path);
    if(!stat.isDirectory()||stat.isSymbolicLink()||!owner(stat)||realpathSync(path)!==path||(part==='.local'?(stat.mode&0o022):(stat.mode&0o777)!==0o700))throw Error('Private directory required');
  }
  return path;
}
export function privateFile(path,maxBytes,{allowEmpty=false}={}) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=fstatSync(fd);if(!stat.isFile()||!owner(stat)||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size<(allowEmpty?0:1)||stat.size>maxBytes)throw Error('Private file required');
    const data=readFileSync(fd);const after=fstatSync(fd);
    if(data.length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('Private file changed');
    return data;
  }finally{closeSync(fd);}
}
