import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeIdentity,roomId,type Room } from '../src/protocol.ts';
import { freshSession,encodeSession,decodeSession,loadSession,saveSession,SESSION_KEY,type Session } from '../src/session.ts';
import {zh,en,translate} from '../src/i18n.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/strong.json',import.meta.url),'utf8'));
function sample():Session{return {identity:{secret:new Uint8Array(32).fill(34),publicKey:fixture.publicKey},rooms:[{room:fixture.room as Room,created:true,nonce:fixture.nonce}],activeId:roomId(fixture.room),language:'en'};}
test('refresh restores the exact identity, room, cached proof, active room and language',()=>{
 const original=sample();const restored=decodeSession(encodeSession(original));assert.deepEqual(restored,original);
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 assert.equal(saveSession(storage,original),true);assert.deepEqual(loadSession(storage,'zh').session,original);
 data.delete(SESSION_KEY);const cleared=loadSession(storage,'zh').session;assert.notEqual(cleared.identity.publicKey,original.identity.publicKey);assert.equal(cleared.rooms.length,0);
});
test('cached proof is rejected after identity change; removing room drops its key and active selection',()=>{
 const s=sample();s.identity=makeIdentity();assert.equal(decodeSession(encodeSession(s)).rooms[0].nonce,undefined);
 s.rooms=[];const encoded=encodeSession(s);assert.ok(!encoded.includes(fixture.room.key));assert.equal(decodeSession(encoded).activeId,undefined);
});
test('unavailable/corrupt session storage falls back safely without crashing',()=>{
 const blocked={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('quota');}};
 assert.equal(loadSession(blocked,'en').failed,true);assert.equal(saveSession(blocked,freshSession()),false);
 assert.equal(loadSession({getItem:()=>'{bad json'},'en').session.language,'en');assert.equal(saveSession(undefined,freshSession()),false);
});
test('both locales cover all UI messages and interpolate equivalent fields',()=>{
 assert.deepEqual(Object.keys(zh).sort(),Object.keys(en).sort());
 for(const key of Object.keys(zh) as Array<keyof typeof zh>){assert.ok(en[key].trim());assert.deepEqual(zh[key].match(/\{\w+\}/g),en[key].match(/\{\w+\}/g));}
 assert.equal(translate('en','visitor',{id:'abc'}),'Traveler abc');assert.equal(translate('zh','visitor',{id:'abc'}),'旅人 abc');
});

test('nicknames persist per room and do not change the identity or work proof',()=>{
 const s=sample();s.rooms[0].nickname='Alice';s.rooms.push({...s.rooms[0],room:{...s.rooms[0].room,name:'another room'},nickname:'Bob'});
 const restored=decodeSession(encodeSession(s));assert.equal(restored.rooms[0].nickname,'Alice');assert.equal(restored.rooms[1].nickname,'Bob');assert.deepEqual(restored.identity,s.identity);assert.equal(restored.rooms[0].nonce,fixture.nonce);
});
