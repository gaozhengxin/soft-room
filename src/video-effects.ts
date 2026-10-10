import type {ImageSegmenter} from '@mediapipe/tasks-vision';
type VisionModule={FilesetResolver:{forVisionTasks:(path:string)=>Promise<{wasmLoaderPath:string;wasmBinaryPath:string}>;isSimdSupported:(loaded?:boolean)=>Promise<boolean>};ImageSegmenter:{createFromOptions:(fileset:unknown,options:unknown)=>Promise<ImageSegmenter>}};
let visionPromise:Promise<VisionModule|undefined>|undefined;
const vision=()=>{if(!visionPromise)visionPromise=import('@mediapipe/tasks-vision').then(m=>m as unknown as VisionModule,()=>undefined as VisionModule|undefined);return visionPromise;};
let segmenterPromise:Promise<ImageSegmenter|undefined>|undefined;
function segmenter(){if(!segmenterPromise)segmenterPromise=(async()=>{const mod=await vision();if(!mod||!location.protocol.startsWith('http'))return undefined;const base=new URL('/mediapipe/',location.href).href;for(const delegate of ['GPU','CPU'] as const){try{const fileset=await mod.FilesetResolver.forVisionTasks(base+'wasm/');return await mod.ImageSegmenter.createFromOptions(fileset,{baseOptions:{modelAssetPath:base+'selfie_segmenter.tflite',delegate},runningMode:'VIDEO' as const,outputCategoryMask:false,outputConfidenceMasks:true,numThreads:2});}catch{}}return undefined;})();return segmenterPromise;}
export function warmBackgroundBlur(){return segmenter();}
export class BackgroundBlur {
 private canvas=document.createElement('canvas');
 private foreground=document.createElement('canvas');
 private maskCanvas=document.createElement('canvas');
 private maskBuffer=document.createElement('canvas');
 private video=document.createElement('video');
 private stream:MediaStream|undefined;
 private frame=0;
 private stopped=false;
 private source:MediaStreamTrack;
 private seg:ImageSegmenter|undefined;
 private person=1;
 private degraded=false;
 constructor(source:MediaStreamTrack){this.source=source;}
 get isDegraded(){return this.degraded;}
 get track(){if(!this.stream?.getVideoTracks().length)throw Error('Background blur unavailable');return this.stream.getVideoTracks()[0];}
 start(){
  if(this.stream)return this.track;
  if(typeof HTMLCanvasElement.prototype.captureStream!=='function')throw Error('Background blur unavailable');
  this.stopped=false;this.degraded=false;
  const settings=this.source.getSettings(),width=Math.max(320,Math.min(960,settings.width||640)),height=Math.max(240,Math.min(720,settings.height||360));
  this.canvas.width=Math.floor(width/2)*2;this.canvas.height=Math.floor(height/2)*2;
  this.video.srcObject=new MediaStream([this.source]);this.video.muted=true;this.video.playsInline=true;this.video.setAttribute('playsinline','');
  void this.video.play().catch(()=>{});
  const stream=this.canvas.captureStream(15);this.stream=stream;
  const draw=()=>{if(this.stopped)return;this.paint();this.frame=requestAnimationFrame(draw);};
  draw();void this.warm();
  return this.track;
 }
 async warm():Promise<boolean>{
  const seg=await segmenter().catch(()=>undefined);
  if(this.stopped)return !!seg;
  this.seg=seg;
  if(!seg){this.degraded=true;return false;}
  try{const labels=seg.getLabels();const index=labels.findIndex(label=>/person|selfie|人/i.test(label));this.person=index>=0?index:labels.length===1?0:labels.length-1;}catch{this.person=0;}
  return true;
 }
 private paint(){
  const context=this.canvas.getContext('2d');if(!context||!this.canvas.width)return;
  const {width,height}=this.canvas;
  const radius=Math.max(8,Math.round(Math.min(width,height)*.03));
  context.filter=`blur(${radius}px)`;context.drawImage(this.video,-radius,-radius,width+radius*2,height+radius*2);
  context.filter='none';
  this.paintMask(context,width,height);
 }
 private paintMask(context:CanvasRenderingContext2D,width:number,height:number){
  if(!this.seg)return;
  let result;
  try{result=this.seg.segmentForVideo(this.video,performance.now());}catch{return;}
  const masks=result?.confidenceMasks;if(!masks?.length)return;
  const mask=masks[Math.min(this.person,masks.length-1)];if(!mask)return;
  const data=mask.getAsFloat32Array(),mw=mask.width,mh=mask.height;
  if(data.length<mw*mh)return;
  const buffer=this.maskBuffer;buffer.width=mw;buffer.height=mh;
  const bufferContext=buffer.getContext('2d');if(!bufferContext)return;
  const image=bufferContext.createImageData(mw,mh),pixels=image.data;
  for(let i=0;i<mw*mh;i++){const a=Math.max(0,Math.min(1,(data[i]-.3)/.5));pixels[i*4]=255;pixels[i*4+1]=255;pixels[i*4+2]=255;pixels[i*4+3]=Math.round(a*255);}
  bufferContext.putImageData(image,0,0);
  const maskContext=this.maskCanvas.getContext('2d');if(!maskContext)return;
  if(this.maskCanvas.width!==width){this.maskCanvas.width=width;this.maskCanvas.height=height;}
  maskContext.clearRect(0,0,width,height);maskContext.filter='blur(2px)';maskContext.drawImage(buffer,0,0,width,height);maskContext.filter='none';
  const fg=this.foreground,fgContext=fg.getContext('2d');if(!fgContext)return;
  if(fg.width!==width){fg.width=width;fg.height=height;}
  fgContext.clearRect(0,0,width,height);fgContext.drawImage(this.video,0,0,width,height);
  fgContext.globalCompositeOperation='destination-in';fgContext.drawImage(this.maskCanvas,0,0);fgContext.globalCompositeOperation='source-over';
  context.drawImage(fg,0,0);
  masks.forEach(item=>item.close());
 }
 stop(){this.stopped=true;cancelAnimationFrame(this.frame);this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;this.video.pause();this.video.srcObject=null;this.seg?.close();this.seg=undefined;}
}
