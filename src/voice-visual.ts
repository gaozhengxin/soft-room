// Real-time audio level metering for the channel voice visualization.
let sharedContext:AudioContext|undefined;
function voiceContext():AudioContext|undefined{
 if(!sharedContext){
  const Ctor=globalThis.AudioContext||(globalThis as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Ctor)return undefined;
  sharedContext=new Ctor();
 }
 return sharedContext;
}
export function resumeVoiceContext(){
 const context=sharedContext;
 if(context&&context.state==='suspended')void context.resume().catch(()=>{});
}
export class VoiceMeter{
 private analyser:AnalyserNode|undefined;
 private source:MediaStreamAudioSourceNode|undefined;
 private stream:MediaStream|undefined;
 private samples:Uint8Array<ArrayBuffer>|undefined;
 setStream(stream:MediaStream|undefined){
  if(this.stream===stream)return;
  this.stream=stream;
  if(this.source&&this.analyser)try{this.source.disconnect(this.analyser);}catch{}
  this.source=undefined;this.analyser=undefined;
  if(!stream||!stream.getAudioTracks().length)return;
  const context=voiceContext();if(!context)return;
  try{
   const source=context.createMediaStreamSource(stream);
   const analyser=context.createAnalyser();
   analyser.fftSize=128;analyser.smoothingTimeConstant=.72;
   source.connect(analyser);
   this.source=source;this.analyser=analyser;
  }catch{this.source=undefined;this.analyser=undefined;}
 }
 get ready(){return !!this.analyser;}
 read():Uint8Array<ArrayBuffer>|undefined{
  const analyser=this.analyser;if(!analyser)return undefined;
  if(!this.samples||this.samples.length!==analyser.frequencyBinCount)this.samples=new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(this.samples);
  return this.samples;
 }
 release(){this.setStream(undefined);this.samples=undefined;}
}
