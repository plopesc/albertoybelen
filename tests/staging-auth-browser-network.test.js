import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request} from 'node:http';
import {browserMockNetwork} from '../scripts/lib/staging-auth-browser-network.mjs';

test('proxy del navegador rechaza destinos externos, puertos alternativos y HTTP sin resolver ni reenviar',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'staging-network-'));let network;
  try {
    let calls=0;network=await browserMockNetwork({directory:dir,worker:{dispatchFetch(){calls++;throw Error('Must not reach worker');}},athlete:()=>101});
    for(const destination of ['evil.invalid:443','www.strava.com:80','albertoybelen-api-staging.autumn-dream-2a39.workers.dev:444','127.0.0.1:443']) {
      const code=await new Promise((resolve,reject)=>{
        const req=request(network.proxy,{method:'CONNECT',path:destination});req.on('connect',(res,socket)=>{socket.destroy();resolve(res.statusCode);});req.on('error',reject);req.end();
      });assert.equal(code,403);
    }
    const code=await new Promise((resolve,reject)=>{const req=request(network.proxy,{path:'http://external.invalid/'} ,res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(code,403);assert.equal(calls,0);
  } finally {await network?.close();await rm(dir,{recursive:true,force:true});}
});
