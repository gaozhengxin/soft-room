import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyConversation,validateConversation,mergeConversation,nearestMessage,compareMessages,searchMessages,sealConversations,openConversations,BackgroundQueue} from '../src/conversation-state.ts';
import {makeIdentity,makeRoom,seal,type Message} from '../src/protocol.ts';
import {sealDirect,openDirect} from '../src/dm.ts';
const id='room:'+'a'.repeat(64),sender='b'.repeat(64),mid=(n:number)=>n.toString(16).padStart(32,'0');
const message=(n:number,time=n)=>({id:mid(n),sender,time,text:'message '+n} as Message);
test('reading anchors survive unordered pages and fall back to a stable neighboring tuple',()=>{
 const items=[message(3,10),message(1,10),message(2,10)].sort(compareMessages),position={...items[1],offset:-12,updatedAt:100};
 assert.equal(nearestMessage(items,position)?.id,mid(2));assert.equal(nearestMessage([items[0],items[2]],position)?.id,mid(3));assert.equal(nearestMessage([items[0]],position)?.id,mid(1));
});
test('rules and reading progress merge independently across devices and encrypted local state is identity bound',()=>{
 const a={...emptyConversation(id),rulesAt:20,blocked:[sender]},b={...emptyConversation(id),readAt:30,seen:[mid(1)],position:{...message(1),offset:4,updatedAt:30}};
 const merged=mergeConversation(a,b);assert.deepEqual(merged.blocked,[sender]);assert.deepEqual(merged.seen,[mid(1)]);assert.equal(merged.position?.offset,4);
 const identity=makeIdentity(),raw=sealConversations(identity,[merged]);assert(!raw.includes(id));assert.deepEqual(openConversations(identity,raw),[merged]);assert.throws(()=>openConversations(makeIdentity(),raw));assert.throws(()=>validateConversation({...a,hidden:['bad']}));
});
test('search covers text and filenames, and all queries respect time and moderation rules',()=>{
 const state=emptyConversation(id),messages=[message(1),{...message(2),text:'',file:{name:'Report.pdf'}} as Message,message(3)];
 assert.equal(searchMessages(messages,[],'REPORT',state).messages[0]?.id,mid(2));state.hidden=[mid(2)];assert.equal(searchMessages(messages,[],'report',state).messages.length,0);state.since=3;assert.deepEqual(searchMessages(messages,[],'message',state).messages.map(m=>m.id),[mid(3)]);state.blocked=[sender];assert.equal(searchMessages(messages,[],'',state).messages.length,0);
});
test('background queue rotates unopened rooms, coalesces Inbox, and defers the opened conversation',()=>{
 const q=new BackgroundQueue();q.reconcile(['a','b','inbox']);assert.equal(q.next('a'),'b');q.defer('a');assert.equal(q.next(),'inbox');assert.equal(q.next(),'b');q.reconcile(['a','inbox']);assert.equal(q.next('a'),'inbox');
});
test('DM Store history accepts authenticated old messages without relaxing live freshness',()=>{
 const a=makeIdentity(),b=makeIdentity(),p=sealDirect(a,b.publicKey,'old'),now=p.message.time+365*86400000;assert.throws(()=>openDirect(b,p.payload,now));assert.equal(openDirect(b,p.payload,now,true).text,'old');assert.throws(()=>openDirect(makeIdentity(),p.payload,now,true));
});
