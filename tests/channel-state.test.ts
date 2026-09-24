import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNetwork,setNetworkEnabled,validNetwork,channelEnabled,type Network} from '../src/mesh-wire.ts';
import {makeIdentity,makeRoom,roomId,seal,open} from '../src/protocol.ts';
import {RoomMesh} from '../src/mesh.ts';
test('only creator-signed channel revisions change status; stale relays cannot reopen a closed channel',()=>{
 const owner=makeIdentity(),guest=makeIdentity(),room=makeRoom('switch',false),n=createNetwork(roomId(room),owner,'voice'),off=setNetworkEnabled(n,owner,false);
 assert.ok(validNetwork(off,roomId(room)));assert.equal(channelEnabled(off),false);assert.throws(()=>setNetworkEnabled(n,guest,false));assert.equal(validNetwork({...off,enabled:true},roomId(room)),false);assert.equal(validNetwork({...off,revision:20},roomId(room)),false);
 const catalog=new Map<string,Network>(),mesh=new RoomMesh({catalog,room:roomId(room),identity:guest,send:async()=>{},announce:()=>{},changed:()=>{},peerConnection:()=>{throw Error('No physical peer needed');}});
 mesh.join(n);assert.ok(mesh.membership);let time=Date.now();
 const receive=(network:Network)=>{const p=seal(room,owner,0,'','',undefined,'heartbeat',null,[network]);mesh.receive({...open(room,p.payload),time:++time});};
 receive(off);assert.equal(mesh.membership,null);assert.equal(mesh.networks().length,1);assert.equal(channelEnabled(mesh.networks()[0].network),false);assert.throws(()=>mesh.join(n));
 receive(n);assert.equal(channelEnabled(mesh.networks()[0].network),false);
 mesh.stop();const next=new RoomMesh({catalog,room:roomId(room),identity:guest,send:async()=>{},announce:()=>{},changed:()=>{},peerConnection:()=>{throw Error('Unused');}});assert.equal(channelEnabled(next.networks()[0].network),false);
 const on=setNetworkEnabled(off,owner,true);const packet=seal(room,owner,0,'','',undefined,'heartbeat',null,[on]);next.receive(open(room,packet.payload));assert.equal(channelEnabled(next.networks()[0].network),true);next.join(on);assert.ok(next.membership);next.leave();assert.equal(next.membership,null);assert.equal(next.networks().length,1);
});
test('heartbeat channel catalogs remain encrypted, authenticated and bounded',()=>{
 const identity=makeIdentity(),room=makeRoom('catalog',false),n=createNetwork(roomId(room),identity,'test');
 const packet=seal(room,identity,0,'','',undefined,'heartbeat',null,[n]);assert.deepEqual(open(room,packet.payload).channels,[n]);
 assert.throws(()=>seal(room,identity,0,'text','',undefined,undefined,undefined,[n]));assert.throws(()=>seal(room,identity,0,'','',undefined,'heartbeat',null,Array(5).fill(n)));assert.throws(()=>seal(room,identity,0,'','',undefined,'heartbeat',null,[{...n,enabled:false}]));
});
