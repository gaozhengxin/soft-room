// Composite the shared screen with a camera picture-in-picture into one video track.
export type OverlayLayout={x:number;y:number;visible:boolean};
export class ScreenComposite{
 private canvas=document.createElement('canvas');
 private context=this.canvas.getContext('2d');
 private screenVideo=document.createElement('video');
 private cameraVideo=document.createElement('video');
 private stream:MediaStream|undefined;
 private frame=0;
 private stopped=true;
 private camera:MediaStreamTrack|undefined;
 private overlay:OverlayLayout={x:1,y:1,visible:true};
 private screen:MediaStreamTrack;
 private onReady?:()=>void;
 constructor(screen:MediaStreamTrack,onReady?:()=>void){this.screen=screen;this.onReady=onReady;this.screenVideo.muted=true;this.screenVideo.playsInline=true;this.screenVideo.setAttribute('playsinline','');this.cameraVideo.muted=true;this.cameraVideo.playsInline=true;this.cameraVideo.setAttribute('playsinline','');}
 get track(){
  if(!this.stream?.getVideoTracks().length)throw Error('Screen composite unavailable');
  return this.stream.getVideoTracks()[0];
 }
 get cameraActive(){return !!this.camera&&!!this.cameraVideo.videoWidth;}
 get overlayLayout(){return {...this.overlay};}
 setOverlay(next:Partial<OverlayLayout>){this.overlay={...this.overlay,...next};}
 private pipSize(){const w=this.canvas.width,h=this.canvas.height;const video=this.cameraVideo;if(!w||!h||!video.videoWidth||!video.videoHeight)return {w:0,h:0};const pw=Math.max(120,Math.round(w*.24)),ph=Math.round(pw*video.videoHeight/video.videoWidth);return {w:pw,h:ph};}
 get overlayRect(){
  const {w,h}=this.pipSize();const W=this.canvas.width,H=this.canvas.height;if(!w||!h||!W||!H)return undefined;
  return {x:this.overlay.x*(W-w)/W,y:this.overlay.y*(H-h)/H,w:w/W,h:h/H};
 }
 start(){
  if(this.stream)return this.track;
  if(typeof HTMLCanvasElement.prototype.captureStream!=='function')throw Error('Screen composite unavailable');
  this.stopped=false;
  const settings=this.screen.getSettings(),width=Math.min(1920,Math.max(640,settings.width||1280)),height=Math.min(1080,Math.max(480,settings.height||720));
  this.canvas.width=Math.floor(width/2)*2;this.canvas.height=Math.floor(height/2)*2;
  this.screenVideo.srcObject=new MediaStream([this.screen]);
  this.stream=this.canvas.captureStream(30);
  const draw=()=>{if(this.stopped)return;this.paint();this.frame=requestAnimationFrame(draw);};
  void this.screenVideo.play().catch(()=>{});draw();
  return this.track;
 }
 setCamera(track:MediaStreamTrack|undefined){
  this.camera=track;
  this.cameraVideo.pause();this.cameraVideo.srcObject=null;
  if(track){this.cameraVideo.srcObject=new MediaStream([track]);this.cameraVideo.onloadedmetadata=()=>this.onReady?.();this.cameraVideo.onplaying=()=>this.onReady?.();void this.cameraVideo.play().catch(()=>{});}
 }
 private paint(){
  const context=this.context,canvas=this.canvas;
  if(!context||!canvas.width)return;
  const video=this.screenVideo;
  if(video.readyState<2||!video.videoWidth||!video.videoHeight)return;
  const {width,height}=canvas;
  context.clearRect(0,0,width,height);
  try{context.drawImage(video,0,0,width,height);}catch{return;}
  if(!this.overlay.visible)return;
  const camera=this.cameraVideo;
  if(camera.readyState<2||!camera.videoWidth||!camera.videoHeight)return;
  const {w:pw,h:ph}=this.pipSize();
  const x=Math.round(this.overlay.x*(width-pw)),y=Math.round(this.overlay.y*(height-ph));
  context.save();
  context.beginPath();
  const radius=12,px=x,py=y,pw2=Math.min(pw,width-1),ph2=Math.min(ph,height-1);
  if(typeof (context as unknown as {roundRect:(x:number,y:number,w:number,h:number,r:number)=>void}).roundRect==='function'){(context as unknown as {roundRect:(x:number,y:number,w:number,h:number,r:number)=>void}).roundRect(px,py,pw2,ph2,radius);}
  else context.rect(px,py,pw2,ph2);
  context.clip();
  context.drawImage(camera,px,py,pw2,ph2);
  context.restore();
  context.strokeStyle='rgba(255,255,255,.85)';context.lineWidth=2;
  if(typeof (context as unknown as {roundRect:(x:number,y:number,w:number,h:number,r:number)=>void}).roundRect==='function'){(context as unknown as {roundRect:(x:number,y:number,w:number,h:number,r:number)=>void}).roundRect(px,py,pw2,ph2,radius);context.stroke();}
 }
 stop(){this.stopped=true;cancelAnimationFrame(this.frame);this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;this.screenVideo.pause();this.screenVideo.srcObject=null;this.setCamera(undefined);}
}
