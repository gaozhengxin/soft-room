import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNetwork,validMembership,randomId,parseSignal} from '../src/mesh-wire.ts';
import {makeRoom,makeIdentity,roomId,seal,open,dayEpoch,workChecker} from '../src/protocol.ts';
import {RoomMesh} from '../src/mesh.ts';
import {locationEndpoint,invitationLink} from '../src/platform.ts';
const a=makeIdentity(),b=makeIdentity(),room=makeRoom('Mesh',false),network=createNetwork(roomId(room),a,'Friends');
const membership={network,instance:randomId()};
const signal={network:network.id,to:b.publicKey,fromInstance:membership.instance,toInstance:randomId(),connection:randomId(),type:'offer' as const,sdp:'v=0\r\na=fingerprint:sha-256 AA:BB\r\n'};
test('network descriptor is creator signed and bound to its room, id and name',()=>{
 assert.ok(validMembership(membership,roomId(room)));
 for(const field of ['creator','room','name','id'] as const)assert.equal(validMembership({...membership,network:{...network,[field]:'bad'}},roomId(room)),false);
 assert.equal(validMembership(membership,roomId(makeRoom('Other',false))),false);
 assert.equal(validMembership({...membership,instance:'bad'},roomId(room)),false);
});
test('mesh signaling and memberships use encrypted signed envelopes and short expiry',()=>{
 const heartbeat=seal(room,a,0,'','Alice',undefined,'heartbeat',membership);
 assert.deepEqual(open(room,heartbeat.payload).mesh,membership);
 const packet=seal(room,a,0,JSON.stringify(signal),'Alice',undefined,'mesh');
 assert.deepEqual(parseSignal(open(room,packet.payload).text),signal);
 assert.throws(()=>open(room,packet.payload,packet.message.time+30000));
 assert.throws(()=>open(room,packet.payload,packet.message.time-5001));
 const tampered=packet.payload.slice();tampered[50]^=1;assert.throws(()=>open(room,tampered));
 assert.throws(()=>seal(room,a,0,'x'.repeat(2001)));
 assert.throws(()=>parseSignal(JSON.stringify({...signal,to:'anyone'})));
});
test('mesh packets require the same daily identity proof as chat',()=>{
 const r=makeRoom('Daily',true);r.key='11'.repeat(32);const epoch=dayEpoch(),check=workChecker(r,a.publicKey,epoch);let nonce=0;while(!check(nonce))nonce++;
 const n=createNetwork(roomId(r),a,'Daily'),m={network:n,instance:randomId()};
 assert.ok(open(r,seal(r,a,nonce,'','',epoch,'heartbeat',m).payload));
 assert.ok(open(r,seal(r,a,nonce,JSON.stringify({...signal,network:n.id}),'',epoch,'mesh').payload));
 let invalid=nonce+1;while(check(invalid))invalid++;assert.throws(()=>seal(r,a,invalid,JSON.stringify(signal),'',epoch,'mesh'));
 assert.throws(()=>seal(r,a,nonce,JSON.stringify(signal),'',epoch-1,'mesh'));
});
test('late discovery, explicit leave, stale heartbeats and network expiry',()=>{
 let now=Date.now();const mesh=new RoomMesh({room:roomId(room),identity:b,send:async()=>{},announce:()=>{},changed:()=>{},now:()=>now});
 const packet=seal(room,a,0,'','',undefined,'heartbeat',membership).message;
 mesh.receive(packet);assert.equal(mesh.networks().length,1);
 now=packet.time+30000;assert.equal(mesh.networks().length,0);
 mesh.receive({...packet,time:now,mesh:membership});assert.equal(mesh.networks().length,1);
 mesh.receive({...packet,time:now+1,mesh:null});assert.equal(mesh.networks().length,0);
 mesh.receive({...packet,time:now,mesh:membership});assert.equal(mesh.networks().length,0);
 mesh.stop();mesh.receive({...packet,time:now+2});assert.equal(mesh.networks().length,0);
});
test('native entry uses an explicit public origin, never localhost exemptions or capacitor invite URLs',()=>{
 assert.equal(locationEndpoint(false,undefined),'/cdn-cgi/trace');
 assert.throws(()=>locationEndpoint(true,undefined));
 assert.equal(locationEndpoint(true,'https://room.example'),'https://room.example/cdn-cgi/trace');
 assert.equal(invitationLink('sr2.code',true,undefined,'capacitor://localhost'),'sr2.code');
 assert.equal(invitationLink('sr2.code',true,'https://room.example','capacitor://localhost'),'https://room.example/#sr2.code');
 assert.equal(invitationLink('sr2.code',false,undefined,'https://localhost:5173/?q=x'),'https://localhost:5173/#sr2.code');
});
test('public STUN is supplied and repeated connection failures remain visible',()=>{
 let now=Date.now(),configuration:RTCConfiguration|undefined;
 const [local,remote]=[a,b].sort((x,y)=>x.publicKey.localeCompare(y.publicKey));
 const mesh=new RoomMesh({room:roomId(room),identity:local,send:async()=>{},announce:()=>{},changed:()=>{},now:()=>now,peerConnection:config=>{configuration=config;throw Error('Connection unavailable');}});
 mesh.join(network);
 const heartbeat=()=>mesh.receive({...seal(room,remote,0,'','',undefined,'heartbeat',membership).message,time:now});
 heartbeat();assert.equal(configuration?.iceServers?.[0]?.urls,'stun:stun.cloudflare.com:3478');assert.equal(configuration?.bundlePolicy,'max-bundle');
 now+=46000;heartbeat();assert.equal(mesh.peerViews()[0]?.state,'failed');mesh.leave();assert.deepEqual(mesh.peerViews(),[]);
});
test('custom TURN remains local and bypasses the built-in provider even when direct connection fails',async()=>{
 let now=Date.now(),calls=0,config:RTCConfiguration|undefined;
 const [local,remote]=[a,b].sort((x,y)=>x.publicKey.localeCompare(y.publicKey));
 const mesh=new RoomMesh({room:roomId(room),identity:local,send:async()=>{},announce:()=>{},changed:()=>{},now:()=>now,iceProvider:async()=>{calls++;return {};},peerConnection:value=>{config=value;throw Error('Offline');}});
 mesh.join(network);mesh.setCustomTurn({urls:'turns:relay.example:443',username:'private-user',credential:'private-password'});
 const heartbeat=()=>mesh.receive({...seal(room,remote,0,'','',undefined,'heartbeat',membership).message,time:now});heartbeat();now+=27000;heartbeat();await Promise.resolve();
 assert.equal(calls,0);assert.ok(config?.iceServers?.some(s=>s.urls==='turns:relay.example:443'));assert.ok(!JSON.stringify(mesh.membership).includes('private-password'));assert.ok(!JSON.stringify(mesh.membership).includes('relay.example'));mesh.stop();
});
