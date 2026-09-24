import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ScreenAwake} from '../src/awake.ts';
import {ChannelMedia} from '../src/channel-media.ts';
import {createNetwork,validMembership,randomId} from '../src/mesh-wire.ts';
import {makeIdentity,makeRoom,roomId} from '../src/protocol.ts';
const identity=makeIdentity(),room=makeRoom('Channel',false);
test('channel mode is signed and cannot be changed by another participant',()=>{
 for(const mode of ['voice','video','walkie'] as const){const n=createNetwork(roomId(room),identity,'Channel',mode);assert.ok(validMembership({network:n,instance:randomId()},roomId(room)));assert.equal(validMembership({network:{...n,mode:mode==='video'?'voice':'video'},instance:randomId()},roomId(room)),false);}
});
test('screen wake lock releases after hide and reacquires on return',async()=>{
 let acquired=0,released=0;const controller=new ScreenAwake(async()=>{acquired++;return {release:async()=>{released++;}};});
 await controller.visible(true);await controller.visible(true);assert.equal(acquired,1);await controller.visible(false);assert.equal(released,1);await controller.visible(true);assert.equal(acquired,2);await controller.visible(false);
});
test('late screen wake-lock permission does not keep a hidden page awake',async()=>{
 let complete:(value:{release:()=>Promise<void>})=>void=()=>{},released=0;const controller=new ScreenAwake(()=>new Promise(resolve=>complete=resolve));const acquiring=controller.visible(true);await controller.visible(false);complete({release:async()=>{released++;}});await acquiring;assert.equal(released,1);
});
test('OS wake-lock release permits reacquisition, denial is handled',async()=>{
 let release=()=>{},attempts=0;const controller=new ScreenAwake(async()=>{attempts++;if(attempts===3)throw Error('Denied');return {release:async()=>{},addEventListener:(_type,listener)=>{release=listener;}};});await controller.visible(true);release();await controller.visible(true);assert.equal(attempts,2);await controller.visible(false);await assert.doesNotReject(controller.visible(true));
});
test('walkie-talkie permission resolving after release starts muted, and leaving stops late capture',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'mediaDevices');let resolve:(v:unknown)=>void=()=>{};
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise(r=>resolve=r)}});
 try{
  const track={enabled:true,stop(){this.stopped=true;},stopped:false};const mesh={membership:{network:createNetwork(roomId(room),identity,'Walkie','walkie'),instance:randomId()},localTracks:{} as Record<string,unknown>,async setTrack(kind:string,t:unknown){this.localTracks[kind]=t;},broadcastMedia(){}};
  const media=new ChannelMedia(()=>mesh as never,()=>{});const holding=media.hold();media.release();resolve({getTracks:()=>[track]});await holding;assert.equal(track.enabled,false);assert.equal(mesh.localTracks.audio,track);
  delete mesh.localTracks.audio;const pending=media.toggle('audio');media.stop();resolve({getTracks:()=>[track]});await pending;assert.equal(track.stopped,true);assert.equal(mesh.localTracks.audio,undefined);
 }finally{if(descriptor)Object.defineProperty(navigator,'mediaDevices',descriptor);else Reflect.deleteProperty(navigator,'mediaDevices');}
});
