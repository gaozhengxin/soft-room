import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {validWork} from '../src/protocol.ts';
const assets=new URL('../dist/assets/',import.meta.url);
const file=existsSync(assets)?readdirSync(assets).find(f=>f.startsWith('pow.worker-')&&f.endsWith('.js')):undefined;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/strong.json',import.meta.url),'utf8'));
function worker(){
 const source=readFileSync(new URL('../dist/assets/'+file,import.meta.url),'utf8');
 return new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:v=>parentPort.postMessage(v)};${source}\nself.onmessage({data:${JSON.stringify({room:fixture.room,sender:fixture.publicKey})}});`,{eval:true});
}
test('production Worker mines the real strong proof and emits measured progress', {skip:!file,timeout:120000}, async()=>{
 const w=worker();let samples=0,last=0;
 try{await new Promise<void>((resolve,reject)=>{w.on('error',reject);w.on('message',m=>{try{if(m.type==='progress'){assert.ok(m.attempts>last);last=m.attempts;samples++;assert.ok(m.elapsed>0);}if(m.type==='done'){assert.ok(samples>0);assert.equal(m.nonce,fixture.nonce);assert.ok(validWork(fixture.room,fixture.publicKey,m.nonce));resolve();}}catch(e){reject(e);}});});}finally{await w.terminate();}
});
test('Worker termination cancels computation before the strong proof completes',{skip:!file,timeout:10000},async()=>{
 const w=worker();try{await new Promise<void>((resolve,reject)=>{w.on('error',reject);w.once('message',m=>{assert.equal(m.type,'progress');resolve();});});}finally{await w.terminate();}
 assert.equal(w.threadId,-1);
});
