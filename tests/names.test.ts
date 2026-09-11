import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectiveName,trackName,type ChatEntry} from '../src/names.ts';
import {makeIdentity,makeRoom,seal,open} from '../src/protocol.ts';
import {freshSession,encodeSession,decodeSession} from '../src/session.ts';
const room=makeRoom('names',false),identity=makeIdentity();
function receive(name?:string,time=Date.now()){const m=open(room,seal(room,identity,0,'hello',name).payload);m.time=time;return m;}
test('room nickname overrides global name; clearing it follows global name',()=>{
 assert.equal(effectiveName('Alice','Room Alice'),'Room Alice');assert.equal(effectiveName('Alice',''),'Alice');assert.equal(effectiveName('',''),undefined);
});
test('first observation is silent; later signed name claims create one change line',()=>{
 const h:ChatEntry[]=[];h.push(trackName(h,receive('Alice',1)));assert.equal(h[0].nameChange,undefined);
 h.push(trackName(h,receive('Alice',2)));assert.equal(h[1].nameChange,undefined);
 h.push(trackName(h,receive('Bob',3)));assert.deepEqual(h[2].nameChange,{from:'Alice',to:'Bob'});
 h.push(trackName(h,receive(undefined,4)));assert.deepEqual(h[3].nameChange,{from:'Bob',to:undefined});
 assert.equal(trackName([],receive('Bob')).nameChange,undefined);
});
test('different public keys, other rooms and late messages do not manufacture renames',()=>{
 const h=[trackName([],receive('Alice',10)),receive('Bob',20)];
 assert.equal(trackName(h,receive('Old name',5)).nameChange,undefined);
 const stranger=open(room,seal(room,makeIdentity(),0,'hi','Another').payload);assert.equal(trackName(h,stranger).nameChange,undefined);
 assert.equal(trackName([],receive('Room name',30)).nameChange,undefined);
 assert.deepEqual(trackName(h,receive('Carol',30)).nameChange,{from:'Bob',to:'Carol'});
});
test('global name persists without replacing identity or room nickname',()=>{
 const session=freshSession();session.name='Alice';session.rooms=[{room,created:true,nickname:'Room Alice'}];const restored=decodeSession(encodeSession(session));
 assert.equal(restored.name,'Alice');assert.equal(restored.rooms[0].nickname,'Room Alice');assert.deepEqual(restored.identity,session.identity);
});
