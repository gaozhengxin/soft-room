export class BackgroundBlur {
 private canvas=document.createElement('canvas');
 private video=document.createElement('video');
 private stream:MediaStream|undefined;
 private frame=0;
 private stopped=false;
 private source:MediaStreamTrack;
 constructor(source:MediaStreamTrack){this.source=source;}
 get track(){if(!this.stream?.getVideoTracks().length)throw Error('Background blur unavailable');return this.stream.getVideoTracks()[0];}
 async start(){
  if(this.stream)return this.track;
  if(typeof HTMLCanvasElement.prototype.captureStream!=='function')throw Error('Background blur unavailable');
  this.stopped=false;
  const settings=this.source.getSettings(),width=Math.max(320,Math.min(960,settings.width||640)),height=Math.max(240,Math.min(720,settings.height||360));
  this.canvas.width=Math.floor(width/2)*2;this.canvas.height=Math.floor(height/2)*2;
  this.video.srcObject=new MediaStream([this.source]);this.video.muted=true;this.video.playsInline=true;this.video.setAttribute('playsinline','');
  await this.video.play().catch(()=>{});
  const stream=this.canvas.captureStream(15);this.stream=stream;
  const draw=()=>{
   if(this.stopped)return;this.paint();this.frame=requestAnimationFrame(draw);
  };
  draw();return this.track;
 }
 private paint(){
  const context=this.canvas.getContext('2d');if(!context)return;
  const {width,height}=this.canvas;
  context.filter='blur(18px)';context.drawImage(this.video,-18,-18,width+36,height+36);
  context.filter='none';context.save();context.beginPath();
  context.ellipse(width/2,height*.52,width*.34,height*.48,0,0,Math.PI*2);context.clip();
  context.drawImage(this.video,0,0,width,height);context.restore();
 }
 stop(){this.stopped=true;cancelAnimationFrame(this.frame);this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;this.video.pause();this.video.srcObject=null;}
}
