import {channelMode} from './mesh-wire.ts';
import type {RoomMesh} from './mesh.ts';
// Capture is user initiated. Generation checks stop late permission results after leaving a page.
export class ChannelMedia {
 private generation=0;private pressed=false;private pending=new Set<string>();
 private getMesh:()=>RoomMesh|undefined;private changed:()=>void;
 constructor(getMesh:()=>RoomMesh|undefined,changed:()=>void){this.getMesh=getMesh;this.changed=changed;}
 async toggle(kind:'audio'|'video'){
  const mesh=this.getMesh(),membership=mesh?.membership;if(!mesh||!membership||this.pending.has(kind))return;
  const old=mesh.localTracks[kind];if(old){await mesh.setTrack(kind);this.changed();return;}
  await this.acquire(kind,false);
 }
 private async acquire(kind:'audio'|'video',hold:boolean){
  const mesh=this.getMesh(),membership=mesh?.membership,version=this.generation;if(!mesh||!membership||this.pending.has(kind))return;
  this.pending.add(kind);
  try{
   const stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:{echoCancellation:true,noiseSuppression:true},video:false}:{audio:false,video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:15,max:24},facingMode:'user'}});
   if(version!==this.generation||mesh!==this.getMesh()||mesh.membership?.instance!==membership.instance){stream.getTracks().forEach(t=>t.stop());return;}
   const track=stream.getTracks()[0];if(!track)throw Error('Capture unavailable');
   track.enabled=!hold||this.pressed;track.onended=()=>{if(mesh.localTracks[kind]===track)void mesh.setTrack(kind).catch(()=>{});this.changed();};
   try{await mesh.setTrack(kind,track);}catch(error){track.stop();if(mesh.localTracks[kind]===track)await mesh.setTrack(kind).catch(()=>{});throw error;}this.changed();
  }finally{this.pending.delete(kind);}
 }
 async hold(){
  const mesh=this.getMesh();if(!mesh?.membership||channelMode(mesh.membership.network)!=='walkie')return;
  this.pressed=true;const track=mesh.localTracks.audio;
  if(track){track.enabled=true;mesh.broadcastMedia();this.changed();}else await this.acquire('audio',true);
 }
 release(){this.pressed=false;const mesh=this.getMesh();if(mesh?.membership&&channelMode(mesh.membership.network)==='walkie'&&mesh.localTracks.audio){mesh.localTracks.audio.enabled=false;mesh.broadcastMedia();this.changed();}}
 stop(){this.generation++;this.release();}
}
