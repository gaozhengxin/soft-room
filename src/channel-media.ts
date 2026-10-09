import {channelMode} from './mesh-wire.ts';
import type {RoomMesh} from './mesh.ts';
import {BackgroundBlur} from './video-effects.ts';
// Capture is user initiated. Generation checks stop late permission results after leaving a page.
export class ChannelMedia {
 private generation=0;private pressed=false;private pending=new Set<string>();
 private videoStream:MediaStream|undefined;private blur:BackgroundBlur|undefined;private screenStream:MediaStream|undefined;
 private getMesh:()=>RoomMesh|undefined;private changed:()=>void;
 constructor(getMesh:()=>RoomMesh|undefined,changed:()=>void){this.getMesh=getMesh;this.changed=changed;}
 async toggle(kind:'audio'|'video'){
  const mesh=this.getMesh(),membership=mesh?.membership;if(!mesh||!membership||this.pending.has(kind))return;
  if(kind==='video'&&this.screenStream){await this.toggleScreen();return;}
  const old=mesh.localTracks[kind];if(old){
   await mesh.setTrack(kind);
   if(kind==='video'){this.blur?.stop();this.blur=undefined;this.videoStream?.getTracks().forEach(track=>track.stop());this.videoStream=undefined;}
   this.changed();return;
  }
  await this.acquire(kind,false);
 }
 private async acquire(kind:'audio'|'video',hold:boolean){
  const mesh=this.getMesh(),membership=mesh?.membership,version=this.generation;if(!mesh||!membership||this.pending.has(kind))return;
  this.pending.add(kind);
  try{
   const stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:{echoCancellation:true,noiseSuppression:true},video:false}:{audio:false,video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:15,max:24},facingMode:'user'}});
   if(version!==this.generation||mesh!==this.getMesh()||mesh.membership?.instance!==membership.instance){stream.getTracks().forEach(t=>t.stop());return;}
   const track=stream.getTracks()[0];if(!track)throw Error('Capture unavailable');
   if(kind==='video')this.videoStream=stream;
   track.enabled=!hold||this.pressed;track.onended=()=>{if(mesh.localTracks[kind]===track)void mesh.setTrack(kind).catch(()=>{});this.changed();};
   try{await mesh.setTrack(kind,track);}catch(error){track.stop();if(mesh.localTracks[kind]===track)await mesh.setTrack(kind).catch(()=>{});throw error;}this.changed();
  }finally{this.pending.delete(kind);}
 }
 async startVideo(){
  const mesh=this.getMesh();if(!mesh?.membership||channelMode(mesh.membership.network)!=='video')return;
  await Promise.allSettled([this.acquire('audio',false),this.acquire('video',false)]);
 }
 get blurEnabled(){return !!this.blur;}
 get screenSharing(){return !!this.screenStream;}
 async toggleBlur(){
  const mesh=this.getMesh();if(!mesh?.membership||this.pending.has('video'))return;this.pending.add('video');
  try{
   const source=this.videoStream?.getVideoTracks()[0];if(!source)throw Error('Camera unavailable');
   if(this.blur){const previous=this.blur.track;this.blur.stop();this.blur=undefined;await mesh.setTrack('video',source);return;}
   const blur=new BackgroundBlur(source);await blur.start();this.blur=blur;await mesh.setTrack('video',blur.track);
  }finally{this.pending.delete('video');}
 }
 async toggleScreen(){
  const mesh=this.getMesh();if(!mesh?.membership||this.pending.has('video'))return;this.pending.add('video');
  try{
   if(this.screenStream){this.screenStream.getTracks().forEach(track=>track.stop());this.screenStream=undefined;await this.restoreVideo(mesh);return;}
   if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing unavailable');
   this.blur?.stop();this.blur=undefined;
   const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:30}},audio:false});this.screenStream=stream;
   const track=stream.getVideoTracks()[0];if(!track)throw Error('Screen capture unavailable');
   track.onended=()=>{void this.toggleScreen().catch(()=>{});};
   await mesh.setTrack('video',track);
  }finally{this.pending.delete('video');}
 }
 private async restoreVideo(mesh:RoomMesh){
  const active=this.blur?.track||this.videoStream?.getVideoTracks()[0];
  if(active)await mesh.setTrack('video',active);else await mesh.setTrack('video');
 }
 async hold(){
  const mesh=this.getMesh();if(!mesh?.membership||channelMode(mesh.membership.network)!=='walkie')return;
  this.pressed=true;const track=mesh.localTracks.audio;
  if(track){track.enabled=true;mesh.broadcastMedia();this.changed();}else await this.acquire('audio',true);
 }
 release(){this.pressed=false;const mesh=this.getMesh();if(mesh?.membership&&channelMode(mesh.membership.network)==='walkie'&&mesh.localTracks.audio){mesh.localTracks.audio.enabled=false;mesh.broadcastMedia();this.changed();}}
 stop(){this.generation++;this.release();this.screenStream?.getTracks().forEach(track=>track.stop());this.screenStream=undefined;this.blur?.stop();this.blur=undefined;this.videoStream?.getTracks().forEach(track=>track.stop());this.videoStream=undefined;}
}
