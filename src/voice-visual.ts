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
 private context:AudioContext|undefined;
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
   this.context=context;
  }catch{this.source=undefined;this.analyser=undefined;}
 }
 get ready(){return !!this.analyser;}
 // Vocal-band peak amplitude mapped to 0..1, driving the name backlight.
 readLevel():number|undefined{
  const analyser=this.analyser,context=this.context;if(!analyser||!context)return undefined;
  const bins=analyser.frequencyBinCount;if(!bins)return undefined;
  if(!this.samples||this.samples.length!==bins)this.samples=new Uint8Array(bins);
  analyser.getByteFrequencyData(this.samples);
  const nyquist=context.sampleRate/2,binsPerHz=bins/nyquist;
  const from=Math.max(0,Math.floor(120*binsPerHz)),to=Math.min(bins-1,Math.ceil(3400*binsPerHz));
  let peak=0,sum=0;for(let i=from;i<=to;i++){const value=this.samples[i]||0;if(value>peak)peak=value;sum+=value;}
  const average=sum/(to-from+1);
  // 峰值响应快，均值托底：一开口就亮，轻声说话也不会掉到全黑
  return Math.min(1,(Math.max(peak,average*1.5))/255);
 }
 release(){this.setStream(undefined);this.samples=undefined;}
}
