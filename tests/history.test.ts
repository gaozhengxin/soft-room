import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeRoom,makeIdentity,seal,open,openHistory,HISTORY_WINDOW,dayEpoch,workChecker} from '../src/protocol.ts';
import {observeMember,online} from '../src/members.ts';
test('archive accepts old authenticated text, not live replay, heartbeat, wrong room, corruption or out-of-window text',()=>{
 const room=makeRoom('archive',false),id=makeIdentity(),packet=seal(room,id,0,'yesterday');const now=packet.message.time+86400000;
 assert.equal(openHistory(room,packet.payload,now).text,'yesterday');assert.throws(()=>open(room,packet.payload,now));
 assert.throws(()=>openHistory(room,seal(room,id,0,'','',undefined,'heartbeat').payload));
 assert.throws(()=>openHistory(makeRoom('other',false),packet.payload,now));
 const bad=packet.payload.slice();bad[40]^=1;assert.throws(()=>openHistory(room,bad,now));
 assert.throws(()=>openHistory(room,packet.payload,packet.message.time+HISTORY_WINDOW+1));
 assert.throws(()=>openHistory(room,packet.payload,packet.message.time-6000));
 const members=new Map();observeMember(members,{...packet.message,nickname:'new',time:now});observeMember(members,{...packet.message,nickname:'old'},now);
 assert.equal(members.get(id.publicKey).name,'new');assert.equal(online(members.get(id.publicKey),now),false);
});
test('archive verifies PoW against signed message day without weakening the live epoch',()=>{
 const room={...makeRoom('daily history',true),key:'11'.repeat(32)},id=makeIdentity(),epoch=dayEpoch(),check=workChecker(room,id.publicKey,epoch);let nonce=0;while(!check(nonce))nonce++;
 const packet=seal(room,id,nonce,'daily',undefined,epoch),tomorrow=packet.message.time+86400000;
 assert.equal(openHistory(room,packet.payload,tomorrow).epoch,epoch);assert.throws(()=>open(room,packet.payload,tomorrow));
});
