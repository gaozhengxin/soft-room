import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uploadObject,downloadObject,storageRoutes} from '../src/storage.ts';

test('Logos Storage route uploads ciphertext with managed policy and verifies downloads',async()=>{
 const originalFetch=globalThis.fetch,data=new Uint8Array([1,2,3,4,5]),cid='z'.repeat(40),calls:{url:string;init?:RequestInit}[]=[];
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
 globalThis.fetch=async(input,init)=>{const url=String(input);calls.push({url,init});if(init?.method==='POST')return new Response(cid,{status:200});return new Response(data,{status:200,headers:{'Content-Length':String(data.length)}});};
 try{
  assert.equal(storageRoutes[0].priority,1000);assert.equal(storageRoutes[0].managedSoftRoom,true);
  const stored=await uploadObject('a'.repeat(64),data);assert.deepEqual(stored,{id:cid,size:5,storage:'logos',cipherSha256:digest});
  const headers=new Headers(calls[0].init?.headers);assert.equal(headers.get('X-Soft-Room-Id'),'a'.repeat(64));assert.equal(headers.get('Content-Type'),'application/octet-stream');assert.ok(calls[0].init?.body instanceof Blob);
  assert.deepEqual(await downloadObject('a'.repeat(64),cid,undefined,digest),data);assert.match(calls[1].url,/\/api\/storage\/v1\/data\/z+\/network\/stream$/);
  await assert.rejects(()=>downloadObject('a'.repeat(64),cid,undefined,'0'.repeat(64)),/hash mismatch/);
 }finally{globalThis.fetch=originalFetch;}
});
