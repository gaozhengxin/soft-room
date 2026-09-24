import {sdpCandidates,candidateKey,sdpIceCredentials} from './ice-sdp.ts';
import type {TurnAccessState} from './ice.ts';
import {defaultIceServers} from './ice.ts';
import {channelEnabled,setNetworkEnabled,validNetwork,createNetwork,randomId,parseSignal,validMembership,channelMode,type ChannelMode,type Membership,type Network,type MeshSignal} from './mesh-wire.ts';
import type {Identity,Message} from './protocol.ts';
type Seen={claim:Membership|null;time:number;seenAt:number};
type Peer={key:string;instance:string;id:string;pc:RTCPeerConnection;channel?:RTCDataChannel;created:number;lastSend:number;lastData:number;lastPing:number;rtt?:number;outgoing?:MeshSignal;sending:boolean;busy:boolean;remoteOfferTime:number;candidates:Set<string>;candidateTail:Promise<void>;managedRelay:boolean;usingRelay?:boolean;stream?:MediaStream;media?:{audio:boolean;video:boolean};};
export type ChannelText={id:string;sender:string;name:string;time:number;body:string};
export type MeshPeerView={key:string;state:'connected'|'connecting'|'retrying'|'failed';rtt?:number;audio?:boolean;video?:boolean};
export type MeshOptions={catalog?:Map<string,Network>;room:string;identity:Identity;send:(signal:MeshSignal)=>Promise<void>;announce:()=>void;changed:()=>void;rtcConfiguration?:RTCConfiguration;iceProvider?:()=>Promise<RTCConfiguration>;cancelIce?:()=>void;iceExpires?:()=>number;turnState?:TurnAccessState;peerConnection?:(configuration:RTCConfiguration)=>RTCPeerConnection;now?:()=>number};
// Web APIs only. The owner supplies room transport and lifecycle events; no DOM or Node runtime.
export class RoomMesh {
 private catalog:Map<string,Network>;
 private announcementIndex=0;
 private pendingAnnouncements=new Set<string>();
 private customTurns=new Map<string,RTCIceServer>();
 private iceVersion=0;
 private iceCheckAt=0;
 private iceFlight:Promise<void>|undefined;
 private iceConfiguration:RTCConfiguration|undefined;
 private attempts=new Map<string,number>();
 private seen=new Map<string,Seen>();
 private peers=new Map<string,Peer>();
 private selected:Membership|null=null;
 private stopped=false;
 private tracks:{audio?:MediaStreamTrack;video?:MediaStreamTrack}={};
 private textLog:ChannelText[]=[];
 private textIds=new Set<string>();
 private now:()=>number;
 private options:MeshOptions;
 constructor(options:MeshOptions){this.options=options;this.catalog=options.catalog||new Map();this.now=options.now||Date.now;}
 get customTurn(){return this.selected?this.customTurns.get(this.selected.network.id):undefined;}
 get relayWork(){return this.customTurn?undefined:this.options.turnState;}
 setCustomTurn(server?:RTCIceServer){
  if(!this.selected)return;
  if(server)this.customTurns.set(this.selected.network.id,server);else this.customTurns.delete(this.selected.network.id);
  this.options.cancelIce?.();this.iceVersion++;this.iceFlight=undefined;this.iceConfiguration=undefined;this.iceCheckAt=0;this.closePeers();this.attempts.clear();this.tick();this.options.changed();
 }
 get messages(){return this.textLog;}
 get localTracks(){return this.tracks;}
 remoteStream(key:string){return this.peers.get(key)?.stream;}
 get membership(){return this.selected;}
 get supported(){return !!this.options.peerConnection||typeof globalThis.RTCPeerConnection==='function';}
 private self(){return this.options.identity.publicKey;}
 private alive(key:string,seen:Seen){const p=this.peers.get(key);return this.now()-seen.seenAt<30000||!!p&&p.channel?.readyState==='open'&&this.now()-p.lastData<30000;}
 getNetwork(id:string){return this.catalog.get(id);}
 private remember(network:Network){
  if(!validNetwork(network,this.options.room))return;
  const old=this.catalog.get(network.id);
  if(old){
   if(old.creator!==network.creator||old.name!==network.name||channelMode(old)!==channelMode(network)||(old.revision??-1)>=(network.revision??-1))return;
  }else if(this.catalog.size>=64)return;
  this.catalog.set(network.id,network);
  if(this.selected?.network.id===network.id){
   if(!channelEnabled(network))this.leave();else this.selected={...this.selected,network};
  }
 }
 announcements(){
  const result:Network[]=[];
  for(const id of this.pendingAnnouncements){const n=this.catalog.get(id);if(n)result.push(n);this.pendingAnnouncements.delete(id);if(result.length===4)return result;}
  const entries=[...this.catalog.values()];
  for(let i=0;i<entries.length&&result.length<4;i++){const n=entries[this.announcementIndex++%entries.length];if(!result.some(r=>r.id===n.id))result.push(n);}
  return result;
 }
 setEnabled(id:string,enabled:boolean){
  const network=this.catalog.get(id);if(!network)throw Error('Unknown channel');
  const next=setNetworkEnabled(network,this.options.identity,enabled);this.pendingAnnouncements.add(id);this.remember(next);this.options.announce();this.options.changed();
 }
 networks(){
  const groups=new Map([...this.catalog].map(([id,network])=>[id,{network,people:[] as string[]}]));
  const add=(key:string,m:Membership)=>{const g=groups.get(m.network.id);if(g&&channelEnabled(g.network))g.people.push(key);};
  if(this.selected)add(this.self(),this.selected);
  for(const [key,s] of this.seen)if(s.claim&&this.alive(key,s))add(key,s.claim);
  return [...groups.values()].sort((a,b)=>a.network.id.localeCompare(b.network.id));
 }
 peerViews():MeshPeerView[]{
  if(!this.selected)return [];
  return [...this.seen].filter(([key,s])=>s.claim?.network.id===this.selected!.network.id&&this.alive(key,s)).map(([key])=>{const p=this.peers.get(key);return {key,state:p?.channel?.readyState==='open'&&this.now()-p.lastData<15000?'connected':(this.attempts.get(key)??this.now())<this.now()-45000?'failed':p&&this.now()-p.created<20000?'connecting':'retrying',...(p?.rtt!==undefined?{rtt:p.rtt}:{}),audio:p?.media?.audio||false,video:p?.media?.video||false};});
 }
 create(name:string,mode:ChannelMode='voice'){this.join(createNetwork(this.options.room,this.options.identity,name,mode));}
 join(network:Network){
  if(this.stopped||!this.supported)throw Error('WebRTC unavailable');
  this.remember(network);network=this.catalog.get(network.id)||network;
  if(!channelEnabled(network))throw Error('Channel is off');
  if(this.selected?.network.id===network.id)return;
  if(!this.catalog.has(network.id))throw Error('Channel memory is full');
  const claim={network,instance:randomId()};if(!validMembership(claim,this.options.room))throw Error('Invalid network');
  this.clearChannel();this.selected=claim;this.options.announce();this.tick();this.options.changed();
 }
 leave(){this.selected=null;this.clearChannel();if(!this.stopped)this.options.announce();this.options.changed();}
 stop(){this.stopped=true;this.selected=null;this.clearChannel();this.seen.clear();}
 private closePeer(key:string){const p=this.peers.get(key);if(!p)return;this.peers.delete(key);p.pc.ontrack=null;p.pc.ondatachannel=null;p.pc.onconnectionstatechange=null;if(p.channel){p.channel.onopen=null;p.channel.onclose=null;p.channel.onmessage=null;p.channel.onerror=null;p.channel.close();}p.pc.close();}
 private closePeers(){for(const key of this.peers.keys())this.closePeer(key);}
 private clearChannel(){this.options.cancelIce?.();this.iceVersion++;this.iceFlight=undefined;this.iceCheckAt=0;this.iceConfiguration=undefined;this.closePeers();this.attempts.clear();for(const track of Object.values(this.tracks))track?.stop();this.tracks={};this.textLog=[];this.textIds.clear();}
 async setTrack(kind:'audio'|'video',track?:MediaStreamTrack){
  if(!this.selected||(kind==='video'&&channelMode(this.selected.network)!=='video')){track?.stop();throw Error('Channel unavailable');}
  const old=this.tracks[kind];if(old!==track)old?.stop();this.tracks[kind]=track;
  await Promise.all([...this.peers.values()].map(p=>this.applyTracks(p)));
  this.broadcastMedia();this.options.changed();
 }
 private async applyTracks(p:Peer){
  if(!this.current(p))return;
  for(const transceiver of p.pc.getTransceivers()){
   const kind=transceiver.receiver.track.kind as 'audio'|'video';
   if(kind!=='audio'&&kind!=='video')continue;
   transceiver.direction='sendrecv';await transceiver.sender.replaceTrack(this.tracks[kind]||null);
  }
 }
 broadcastMedia(){const data=JSON.stringify({type:'media',audio:!!this.tracks.audio?.enabled,video:!!this.tracks.video?.enabled});for(const p of this.peers.values())if(p.channel?.readyState==='open'&&p.channel.bufferedAmount<65536)try{p.channel.send(data);}catch{}}
 sendText(body:string,name=''){
  body=body.trim();name=name.trim();if(!this.selected||!body||body.length>2000||name.length>24||/[\u0000-\u001f\u007f]/.test(name))throw Error('Invalid text');
  const peers=[...this.peers.values()].filter(p=>p.channel?.readyState==='open'&&p.channel.bufferedAmount<65536);
  if(!peers.length)throw Error('No connected participants');
  const frame={type:'text',id:randomId(),time:this.now(),body,name};let sent=0;
  for(const p of peers)try{p.channel!.send(JSON.stringify(frame));sent++;}catch{}
  if(!sent)throw Error('Send failed');this.rememberText({...frame,sender:this.self()});return sent;
 }
 private rememberText(message:ChannelText){if(this.textIds.has(message.id))return;this.textIds.add(message.id);if(this.textIds.size>600)this.textIds.delete(this.textIds.values().next().value!);this.textLog.push(message);if(this.textLog.length>300)this.textLog.shift();this.options.changed();}

 // Only authenticated, PoW-checked, deduplicated room packets enter this method.
 receive(message:Message){
  if(this.stopped||message.sender===this.self())return;
  if(message.kind==='heartbeat'){
   const old=this.seen.get(message.sender);if(old&&message.time<=old.time)return;
   if(!old&&this.seen.size>=256)return;
   for(const n of message.channels||[])this.remember(n);
   const claim=message.mesh??null;if(claim)this.remember(claim.network);
   this.seen.set(message.sender,{claim,time:message.time,seenAt:Math.min(message.time,this.now())});
   const p=this.peers.get(message.sender);
   if(p&&(!claim||claim.network.id!==this.selected?.network.id||claim.instance!==p.instance))this.closePeer(message.sender);
   this.tick();this.options.changed();
  }else if(message.kind==='mesh'){
   const signal=parseSignal(message.text);void this.signal(message.sender,signal,message.time).catch(()=>{});
  }
 }
 private current(p:Peer){return !this.stopped&&this.peers.get(p.key)===p;}
 private connectionConfiguration(){
  if(this.options.rtcConfiguration)return this.options.rtcConfiguration;
  if(this.customTurn)return {iceServers:[this.customTurn],bundlePolicy:'max-bundle',iceTransportPolicy:'relay'} as RTCConfiguration;
  if(this.iceConfiguration)return {...this.iceConfiguration,iceTransportPolicy:'relay'} as RTCConfiguration;
  return {iceServers:defaultIceServers,bundlePolicy:'max-bundle'} as RTCConfiguration;
 }
 private makePeer(key:string,instance:string,id:string):Peer{
  this.closePeer(key);if(!this.attempts.has(key))this.attempts.set(key,this.now());
  const configuration=this.connectionConfiguration();
  const pc=this.options.peerConnection?.(configuration)||new RTCPeerConnection(configuration);
  const p:Peer={key,instance,id,pc,created:this.now(),lastSend:0,lastData:this.now(),lastPing:0,sending:false,busy:false,remoteOfferTime:0,candidates:new Set(),candidateTail:Promise.resolve(),managedRelay:!!this.iceConfiguration&&!this.customTurn&&!this.options.rtcConfiguration};this.peers.set(key,p);
  if(this.self()<key){pc.addTransceiver('audio',{direction:'sendrecv'});if(this.selected&&channelMode(this.selected.network)==='video')pc.addTransceiver('video',{direction:'sendrecv'});}
  pc.ontrack=e=>{if(!this.current(p))return;if(!p.stream)p.stream=new MediaStream();p.stream.addTrack(e.track);this.options.changed();};
  pc.onconnectionstatechange=()=>{if(this.current(p))this.options.changed();};
  pc.ondatachannel=e=>{if(e.channel.label!=='soft-room/mesh/v1'||p.channel){e.channel.close();return;}this.bind(p,e.channel);};return p;
 }
 private bind(p:Peer,channel:RTCDataChannel){
  p.channel=channel;
  channel.onopen=()=>{if(this.current(p)){p.lastData=this.now();this.attempts.set(p.key,this.now());void this.inspectRoute(p);this.ping(p);this.broadcastMedia();this.options.changed();}};
  channel.onclose=()=>{if(this.current(p))this.options.changed();};channel.onerror=()=>{};
  channel.onmessage=e=>{if(!this.current(p)||typeof e.data!=='string'||e.data.length>14000)return;
   try{const v=JSON.parse(e.data);
    if(v.type==='text'){
     if(typeof v.id!=='string'||!/^[a-f0-9]{32}$/.test(v.id)||typeof v.body!=='string'||!v.body.trim()||v.body.length>2000||typeof v.name!=='string'||v.name.length>24||/[\u0000-\u001f\u007f]/.test(v.name)||!Number.isSafeInteger(v.time)||Math.abs(this.now()-v.time)>300000)return;
     p.lastData=this.now();this.rememberText({id:v.id,sender:p.key,time:v.time,body:v.body,name:v.name});return;
    }
    if(v.type==='media'){if(typeof v.audio!=='boolean'||typeof v.video!=='boolean')return;p.media={audio:v.audio,video:v.video&&!!this.selected&&channelMode(this.selected.network)==='video'};this.options.changed();return;}
    if(!['ping','pong'].includes(v.type)||!Number.isSafeInteger(v.time))return;p.lastData=this.now();
    if(v.type==='ping'&&channel.bufferedAmount<4096)channel.send(JSON.stringify({type:'pong',time:v.time}));
    if(v.type==='pong'&&v.time===p.lastPing)p.rtt=Math.max(0,this.now()-v.time);
   }catch{}
  };
 }
 private async inspectRoute(p:Peer){
  try{const stats=await p.pc.getStats();for(const row of stats.values())if(row.type==='transport'&&row.selectedCandidatePairId){const pair=stats.get(row.selectedCandidatePairId),candidate=pair&&stats.get(pair.localCandidateId);if(candidate&&this.current(p))p.usingRelay=candidate.candidateType==='relay';}}catch{}
 }
 private ping(p:Peer){if(p.managedRelay)void this.inspectRoute(p);if(p.channel?.readyState!=='open'||p.channel.bufferedAmount>4096)return;try{p.lastPing=this.now();p.channel.send(JSON.stringify({type:'ping',time:p.lastPing}));}catch{}}
 private async gather(p:Peer){
  if(p.pc.iceGatheringState==='complete')return;
  await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);p.pc.removeEventListener('icegatheringstatechange',check);p.pc.removeEventListener('connectionstatechange',check);resolve();};const check=()=>{if(p.pc.iceGatheringState==='complete'||p.pc.connectionState==='closed')finish();};const timer=setTimeout(finish,300);p.pc.addEventListener('icegatheringstatechange',check);p.pc.addEventListener('connectionstatechange',check);check();});
 }
 private async prepare(p:Peer,type:'offer'|'answer'){
  if(p.busy)return;p.busy=true;
  try{
   await this.applyTracks(p);
   await p.pc.setLocalDescription(type==='offer'?await p.pc.createOffer():await p.pc.createAnswer());await this.gather(p);
   if(!this.current(p)||!this.selected)return;
   const sdp=p.pc.localDescription?.sdp;if(!sdp||sdp.length>10000)throw Error('SDP too large');
   p.outgoing={network:this.selected.network.id,to:p.key,fromInstance:this.selected.instance,toInstance:p.instance,connection:p.id,type,sdp};
  }catch{if(this.current(p)){p.created=this.now()-45000;this.options.changed();}}finally{p.busy=false;}
  await this.transmit(p);
 }
 private async transmit(p:Peer){
  if(!p.outgoing||p.sending||!this.current(p))return;
  // Keep the complete latest snapshot: candidates discovered after the initial send must travel too.
  const sdp=p.pc.localDescription?.sdp;if(sdp&&sdp.length<=10000)p.outgoing={...p.outgoing,sdp};
  p.sending=true;p.lastSend=this.now();try{await this.options.send(p.outgoing);}catch{/* Retry fresh signed signaling on the next tick. */}finally{p.sending=false;}
 }
 private async addCandidates(p:Peer,sdp:string){
  const candidates=sdpCandidates(sdp);
  p.candidateTail=p.candidateTail.then(async()=>{
   for(const candidate of candidates){
    if(!this.current(p)||!p.pc.remoteDescription)return;
    const key=candidateKey(candidate);if(p.candidates.has(key)||p.candidates.size>=128)continue;
    try{await p.pc.addIceCandidate(candidate);p.candidates.add(key);}catch{ /* Retry with the next authenticated snapshot. */ }
   }
  }).catch(()=>{});
  await p.candidateTail;
 }
 private async signal(key:string,s:MeshSignal,time:number){
  const local=this.selected,remote=this.seen.get(key);
  if(!local||s.to!==this.self()||s.network!==local.network.id||s.toInstance!==local.instance||remote?.claim?.network.id!==local.network.id||s.fromInstance!==remote.claim.instance||!this.alive(key,remote))return;
  if(this.options.iceProvider&&!this.options.rtcConfiguration&&!this.customTurn&&!this.iceConfiguration){await this.refreshIce();if(!this.iceConfiguration)return;}
  let p=this.peers.get(key);
  if(s.type==='offer'){
   if(key>this.self())return;
   if(p?.id===s.connection){await this.addCandidates(p,s.sdp);if(p.outgoing?.type==='answer'&&this.now()-p.lastSend>1000)await this.transmit(p);return;}
   if(p&&time<=p.remoteOfferTime)return;
   // A connected pair ignores unsolicited renegotiation until its data path stops responding.
   if(p?.channel?.readyState==='open'&&this.now()-p.lastData<15000)return;
   p=this.makePeer(key,s.fromInstance,s.connection);p.remoteOfferTime=time;
   await p.pc.setRemoteDescription({type:'offer',sdp:s.sdp});if(this.current(p))await this.prepare(p,'answer');
  }else{
   if(key<this.self()||!p||p.id!==s.connection)return;
   if(p.pc.remoteDescription){
    // The answerer may rebuild with TURN while our original offer is still being retried.
    // New ICE credentials require a fresh offer, not addIceCandidate against the old answer.
    if(sdpIceCredentials(p.pc.remoteDescription.sdp)!==sdpIceCredentials(s.sdp)){this.closePeer(key);this.tick();return;}
    await this.addCandidates(p,s.sdp);return;
   }
   if(p.pc.signalingState!=='have-local-offer'||p.busy)return;
   p.busy=true;try{await p.pc.setRemoteDescription({type:'answer',sdp:s.sdp});}finally{p.busy=false;}
  }
 }
 private refreshIce():Promise<void>{
  if(!this.options.iceProvider||this.options.rtcConfiguration||this.customTurn||!this.selected)return Promise.resolve();
  if(this.iceConfiguration&&this.options.iceExpires&&this.options.iceExpires()<=this.now()){for(const [key,p] of this.peers)if(p.managedRelay&&p.usingRelay!==false)this.closePeer(key);this.iceConfiguration=undefined;}
  if(this.iceFlight)return this.iceFlight;
  if(this.now()-this.iceCheckAt<1000)return Promise.resolve();this.iceCheckAt=this.now();
  const version=this.iceVersion;
  this.iceFlight=this.options.iceProvider().then(configuration=>{
   if(this.stopped||!this.selected||version!==this.iceVersion)return;
   const hasRelay=configuration.iceServers?.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/.test(url)));
   if(!hasRelay)return;
   const changed=JSON.stringify(configuration)!==JSON.stringify(this.iceConfiguration),hadRelay=!!this.iceConfiguration;
   this.iceConfiguration=configuration;
   if(changed)for(const [key,peer] of this.peers)if((hadRelay&&peer.managedRelay&&peer.usingRelay!==false)||peer.channel?.readyState!=='open')this.closePeer(key);
  }).catch(()=>{}).finally(()=>{if(version===this.iceVersion)this.iceFlight=undefined;});return this.iceFlight;
 }
 tick(){
  if(this.stopped)return;
  for(const [key,s] of this.seen)if(this.now()-s.time>300000&&!this.alive(key,s)){this.closePeer(key);this.seen.delete(key);}
  if(!this.selected)return;
  void this.refreshIce();
  for(const [key,s] of this.seen){
   if(!s.claim||s.claim.network.id!==this.selected.network.id)continue;
   if(!this.attempts.has(key))this.attempts.set(key,this.now());
   if(this.options.iceProvider&&!this.options.rtcConfiguration&&!this.customTurn&&!this.iceConfiguration)continue;
   let p=this.peers.get(key);
   if(!this.alive(key,s)){if(p)this.closePeer(key);continue;}
   if(p?.channel?.readyState==='open'&&this.now()-p.lastData<30000){if(this.now()-p.lastPing>=5000)this.ping(p);continue;}
   if(this.self()<key){
    if(!p||(!p.busy&&this.now()-p.created>=45000)){
     try{p=this.makePeer(key,s.claim.instance,randomId());this.bind(p,p.pc.createDataChannel('soft-room/mesh/v1'));void this.prepare(p,'offer');}catch{this.closePeer(key);}
    }else if(p.outgoing&&this.now()-p.lastSend>=3000)void this.transmit(p);
   }else if(p?.outgoing&&this.now()-p.lastSend>=3000&&this.now()-p.created<45000)void this.transmit(p);
  }
 }
}
