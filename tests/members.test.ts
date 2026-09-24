import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeRoom,makeIdentity,seal,open,type Message} from '../src/protocol.ts';
import {observeMember,online,HEARTBEAT_INTERVAL,OFFLINE_AFTER,type Member} from '../src/members.ts';
const room=makeRoom('presence',false),identity=makeIdentity();
function packet(name='Alice',kind?:'heartbeat'){return seal(room,identity,0,kind?'':'hello',name,undefined,kind);}
test('heartbeats are encrypted authenticated packets with no chat text and short freshness',()=>{
 const p=packet('Alice','heartbeat');const m=open(room,p.payload);assert.equal(m.kind,'heartbeat');assert.equal(m.text,'');assert.equal(m.nickname,'Alice');
 assert.throws(()=>open(room,p.payload,m.time+30000));assert.throws(()=>open(room,p.payload,m.time-5001));
 const tampered=p.payload.slice();tampered[30]^=1;assert.throws(()=>open(room,tampered));assert.throws(()=>open(makeRoom('other',false),p.payload));
 assert.equal(open(room,packet().payload).kind,undefined);
});
test('online expires exactly after 30 seconds; delayed heartbeat cannot extend freshness',()=>{
 assert.equal(HEARTBEAT_INTERVAL,5000);assert.equal(OFFLINE_AFTER,30000);
 const members=new Map<string,Member>(),m={...packet('Alice','heartbeat').message,time:100000};
 observeMember(members,m,100000);assert.ok(online(members.get(m.sender)!,129999));assert.equal(online(members.get(m.sender)!,130000),false);
 observeMember(members,{...m,time:105000},129000);assert.ok(online(members.get(m.sender)!,134999));assert.equal(online(members.get(m.sender)!,135000),false);
 observeMember(members,m,136000);assert.equal(online(members.get(m.sender)!,136000),false);
});
test('names learned from either heartbeat or chat share one change tracker',()=>{
 const members=new Map<string,Member>();const base=packet().message;
 const first=observeMember(members,{...base,time:1},1);assert.equal(first.nameChange,undefined);assert.equal(online(members.get(base.sender)!,1),false);
 const heartbeat={...base,kind:'heartbeat' as const,text:'',time:2,nickname:'Bob'};
 assert.deepEqual(observeMember(members,heartbeat,2).nameChange,{from:'Alice',to:'Bob'});
 assert.equal(observeMember(members,{...base,time:3,nickname:'Bob'},3).nameChange,undefined);
 assert.deepEqual(observeMember(members,{...base,time:4,nickname:'Carol'},4).nameChange,{from:'Bob',to:'Carol'});
 assert.equal(observeMember(members,heartbeat,5).nameChange,undefined);assert.equal(members.get(base.sender)!.name,'Carol');
 assert.equal(observeMember(new Map(),heartbeat,2).nameChange,undefined);
});
