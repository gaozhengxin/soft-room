import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeRoom,makeIdentity,invite,parseInvite,seal,open,openHistory,solveWork,validWork,roomId,STRONG_TARGET,expectedAttempts,meetsTarget,workChecker,type Attachment,type Room } from '../src/protocol.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/strong.json',import.meta.url),'utf8'));
const room=fixture.room as Room;
const identity={secret:new Uint8Array(32).fill(34),publicKey:fixture.publicKey};
test('invitations round trip both languages and reject unsupported difficulty',()=>{
 const r=makeRoom('今晚吃什么 🍜',true);assert.equal(r.pow,20);assert.deepEqual(parseInvite(invite(r)),r);
 assert.deepEqual(parseInvite('https://localhost/#'+invite(r)),r);
 for(const bad of ['abc','sr1.','sr1.e30',invite({...r,pow:99} as unknown as Room)])assert.throws(()=>parseInvite(bad));
});
test('room members decrypt; outsiders, tampering and expired packets fail',()=>{
 const r=makeRoom('test',false),i=makeIdentity();const {message,payload}=seal(r,i,0,'你好 <script>alert(1)</script>');
 assert.deepEqual(open(r,payload),message);assert.throws(()=>open(makeRoom('other',false),payload));
 const changed=payload.slice();changed[30]^=1;assert.throws(()=>open(r,changed));assert.throws(()=>open(r,payload,message.time+300001));
});
test('strong target is 1000x legacy with only integer rounding; checks full 48-bit boundary',()=>{
 const factor=expectedAttempts(1000)/expectedAttempts(16);assert.ok(factor>=1000&&factor<1000.001);
 const hash=(value:number)=>{const b=new Uint8Array(32);for(let i=5;i>=0;i--){b[i]=value%256;value=Math.floor(value/256);}return b;};
 assert.equal(meetsTarget(hash(STRONG_TARGET-1),1000),true);assert.equal(meetsTarget(hash(STRONG_TARGET),1000),false);
 assert.equal(meetsTarget(hash(STRONG_TARGET),16),true);
});
test('actually mined strong proof verifies; forgery, other identity and downgrade fail',()=>{
 assert.ok(validWork(room,identity.publicKey,fixture.nonce));assert.ok(workChecker(room,identity.publicKey)(fixture.nonce));
 const packet=seal(room,identity,fixture.nonce,'strong proof works');assert.equal(open(room,packet.payload).text,'strong proof works');
 assert.equal(validWork(room,identity.publicKey,fixture.nonce+1),false);
 assert.throws(()=>open(room,seal(room,identity,fixture.nonce+1,'forged proof').payload));
 assert.equal(validWork(room,makeIdentity().publicKey,fixture.nonce),false);
 for(const pow of [0,16] as const){assert.notEqual(roomId(room),roomId({...room,pow}));assert.throws(()=>open({...room,pow},packet.payload));}
 assert.equal(validWork(room,identity.publicKey,-1),false);
});
test('legacy invitations and proofs remain compatible; cancellation and text limits hold',async()=>{
 const r:Room={...makeRoom('legacy',false),pow:16},i=makeIdentity();
 assert.equal(parseInvite(invite(r)).pow,16);const nonce=await solveWork(r,i.publicKey);assert.equal(open(r,seal(r,i,nonce,'old room').payload).text,'old room');
 assert.throws(()=>seal(r,i,nonce,' '));assert.throws(()=>seal(r,i,nonce,'x'.repeat(2001)));
 const c=new AbortController();c.abort();await assert.rejects(solveWork(room,i.publicKey,c.signal));
});

test('current PoW needs exactly 50x less expected work than previous rooms',()=>{
 assert.equal(expectedAttempts(1000)/expectedAttempts(20),50);
 assert.equal(parseInvite(invite({...room,pow:20})).pow,20);
});
test('room nickname is signed and encrypted; missing nickname stays compatible',()=>{
 const r=makeRoom('nicknames',false),i=makeIdentity();
 const m=open(r,seal(r,i,0,'hello','  小明 Alice  ').payload);assert.equal(m.nickname,'小明 Alice');assert.equal(m.sender,i.publicKey);
 assert.equal(open(r,seal(r,i,0,'old message').payload).nickname,undefined);
 assert.throws(()=>seal(r,i,0,'hi','x'.repeat(25)));assert.throws(()=>seal(r,i,0,'hi','a\nb'));
});
test('file references are encrypted, signed, bounded and available in history',()=>{
 const r=makeRoom('files',false),i=makeIdentity(),file:Attachment={v:1,name:'报告.pdf',mime:'application/pdf',bytes:1234,media:'pdf',quality:'original',original:{id:'a'.repeat(64),size:1275}};
 const packet=seal(r,i,0,'','',undefined,'file',undefined,undefined,file);
 assert.deepEqual(open(r,packet.payload).file,file);assert.deepEqual(openHistory(r,packet.payload,packet.message.time+1000).file,file);
 const logos:Attachment={...file,original:{id:'z'.repeat(40),size:1275,storage:'logos',cipherSha256:'b'.repeat(64)}};
 assert.deepEqual(open(r,seal(r,i,0,'','',undefined,'file',undefined,undefined,logos).payload).file,logos);
 assert.throws(()=>seal(r,i,0,'','',undefined,'file',undefined,undefined,{...logos,original:{...logos.original,cipherSha256:undefined}}));
 assert.throws(()=>seal(r,i,0,'caption','',undefined,'file',undefined,undefined,file));
 assert.throws(()=>seal(r,i,0,'','',undefined,'file',undefined,undefined,{...file,name:'bad\nname'}));
});
