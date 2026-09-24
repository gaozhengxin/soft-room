import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {readFileSync,readdirSync} from 'node:fs';
import {ed25519} from '@noble/curves/ed25519.js';
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {bytesToHex,hexToBytes,randomBytes} from '@noble/hashes/utils.js';
import {makeRoom,makeIdentity,deriveReadKey,READ_ROUNDS,WRITE_TARGET,dayEpoch,workChecker,validWork,invite,parseInvite,seal,open,topic,type Room} from '../src/protocol.ts';
import {freshSession,encodeSession,decodeSession} from '../src/session.ts';
const room=makeRoom('daily test',true);room.seed='12'.repeat(32);
const identity=makeIdentity(),epoch=dayEpoch();
function mine(r:Room,e:number){const check=workChecker(r,identity.publicKey,e);for(let n=0;;n++)if(check(n))return n;}
let nonce:number;
test('read key is exactly one million sequential SHA256 operations; invitation omits derived key',()=>{
 room.key=deriveReadKey(room.seed!);
 let reference:Uint8Array=hexToBytes(room.seed!);for(let n=0;n<READ_ROUNDS;n++)reference=createHash('sha256').update(reference).digest();
 assert.equal(room.key,bytesToHex(reference));
 const code=invite(room),wire=JSON.parse(Buffer.from(code.slice(4),'base64url').toString());
 assert.equal(wire.seed,room.seed);assert.equal('key' in wire,false);assert.ok(!JSON.stringify(wire).includes(room.key));
 assert.equal(parseInvite(code).key,'');assert.equal(deriveReadKey(parseInvite(code).seed!),room.key);
});
test('daily proof is identity/room/epoch bound with one million expected attempts',()=>{
 assert.ok(Math.abs(2**48/WRITE_TARGET-1_000_000)<0.01);
 nonce=mine(room,epoch);assert.ok(validWork(room,identity.publicKey,nonce,epoch));
 assert.equal(validWork(room,identity.publicKey,nonce,epoch+1),false);
 assert.equal(validWork(room,makeIdentity().publicKey,nonce,epoch),false);
 assert.equal(validWork({...room,name:'another'},identity.publicKey,nonce,epoch),false);
 const packet=seal(room,identity,nonce,'today','Alice',epoch);assert.equal(open(room,packet.payload).text,'today');
 assert.throws(()=>open(room,packet.payload,(epoch+1)*86_400_000));
 assert.throws(()=>seal(room,identity,nonce,'old','',epoch-1));
});
// Bypass the honest sender to test the actual receiver trust boundary.
function malicious(fields:Record<string,unknown>){
 const message={...seal(room,identity,nonce,'hello','',epoch).message,...fields};
 const body=JSON.stringify(message),plain=new TextEncoder().encode(JSON.stringify({body,signature:bytesToHex(ed25519.sign(new TextEncoder().encode(body),identity.secret))}));
 const iv=randomBytes(24),encrypted=xchacha20poly1305(hexToBytes(room.key),iv,new TextEncoder().encode(topic(room))).encrypt(plain);
 return new Uint8Array([...iv,...encrypted]);
}
test('receiver rejects missing, stale, forged work even with valid encryption and signature',()=>{
 let invalid=nonce+1;while(validWork(room,identity.publicKey,invalid,epoch))invalid++;
 for(const fields of [{epoch:undefined},{epoch:epoch-1},{epoch:epoch+1},{nonce:invalid},{nonce:undefined}])assert.throws(()=>open(room,malicious(fields)));
 const midnight=(epoch+1)*86_400_000;
 assert.throws(()=>open(room,malicious({time:midnight-1}),midnight));
 assert.equal(dayEpoch(midnight-1),epoch);assert.equal(dayEpoch(midnight),epoch+1);
});
test('session keeps the read key and only restores a current-day write proof',()=>{
 const s=freshSession();s.identity=identity;s.rooms=[{room,created:true,nonce,epoch}];
 let restored=decodeSession(encodeSession(s));assert.equal(restored.rooms[0].room.key,room.key);assert.equal(restored.rooms[0].nonce,nonce);
 s.rooms[0].epoch=epoch-1;restored=decodeSession(encodeSession(s));assert.equal(restored.rooms[0].nonce,undefined);assert.equal(restored.rooms[0].room.key,room.key);
});
function runWorker(data:unknown){
 const file=readdirSync(new URL('../dist/assets/',import.meta.url)).find(f=>f.startsWith('pow.worker-')&&f.endsWith('.js'))!;
 const source=readFileSync(new URL('../dist/assets/'+file,import.meta.url),'utf8');
 const w=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:v=>parentPort.postMessage(v)};${source}\nself.onmessage({data:${JSON.stringify(data)}});`,{eval:true});return w;
}
test('production worker derives read key, reports progress, and computes an explicit daily epoch',{timeout:60000},async()=>{
 for(const data of [{type:'read',seed:room.seed},{room,sender:identity.publicKey,epoch}]){
  const w=runWorker(data);try{await new Promise<void>((resolve,reject)=>{w.on('error',reject);w.on('message',m=>{if(m.type==='error')reject(Error('worker error'));if(m.type==='done')try{if('type' in data){assert.equal(m.key,room.key);assert.equal(m.attempts,1_000_000);}else assert.ok(validWork(room,identity.publicKey,m.nonce,epoch));resolve();}catch(e){reject(e);}});});}finally{await w.terminate();}
 }
});
test('read worker can be cancelled during the hash chain',{timeout:10000},async()=>{
 const w=runWorker({type:'read',seed:room.seed});try{await new Promise<void>((resolve,reject)=>{w.on('error',reject);w.once('message',m=>{try{assert.equal(m.type,'progress');resolve();}catch(e){reject(e);}});});}finally{await w.terminate();}assert.equal(w.threadId,-1);
});
