import type {ImageSegmenter} from '@mediapipe/tasks-vision';
type VisionModule={FilesetResolver:{forVisionTasks:(path:string)=>Promise<{wasmLoaderPath:string;wasmBinaryPath:string}>;isSimdSupported:(loaded?:boolean)=>Promise<boolean>};ImageSegmenter:{createFromOptions:(fileset:unknown,options:unknown)=>Promise<ImageSegmenter>}};
let visionPromise:Promise<VisionModule|undefined>|undefined;
const vision=()=>{if(!visionPromise)visionPromise=import('@mediapipe/tasks-vision').then(m=>m as unknown as VisionModule,()=>undefined as VisionModule|undefined);return visionPromise;};
let segmenterPromise:Promise<ImageSegmenter|undefined>|undefined;
function segmenter(){if(!segmenterPromise)segmenterPromise=(async()=>{const mod=await vision();if(!mod||!location.protocol.startsWith('http'))return undefined;const base=new URL('/mediapipe/',location.href).href;for(const delegate of ['GPU','CPU'] as const){try{const fileset=await mod.FilesetResolver.forVisionTasks(base+'wasm/');return await mod.ImageSegmenter.createFromOptions(fileset,{baseOptions:{modelAssetPath:base+'selfie_segmenter.tflite',delegate},runningMode:'VIDEO' as const,outputCategoryMask:false,outputConfidenceMasks:true,numThreads:2});}catch{}}return undefined;})();return segmenterPromise;}
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
  this.seg=await segmenter().catch(()=>undefined);
  const stream=this.canvas.captureStream(15);this.stream=stream;
  const draw=()=>{if(this.stopped)return;this.paint();this.frame=requestAnimationFrame(draw);};
  draw();return this.track;
 }
 private paint(){
  const context=this.canvas.getContext('2d');if(!context)return;
  const {width,height}=this.canvas;
  context.filter='blur(18px)';context.drawImage(this.video,-18,-18,width+36,height+36);
  context.filter='none';
  if(this.seg&&this.paintMask(context,width,height))return;
  context.save();context.beginPath();
  context.ellipse(width/2,height*.52,width*.34,height*.48,0,0,Math.PI*2);context.clip();
  context.drawImage(this.video,0,0,width,height);context.restore();
 }
 private paintMask(context:CanvasRenderingContext2D,width:number,height:number){
  let result;
  try{result=this.seg!.segmentForVideo(this.video,performance.now());}catch{return false;}
  const masks=result?.confidenceMasks;if(!masks?.length)return false;
  const mask=masks[Math.min(this.person,masks.length-1)];if(!mask)return false;
  const data=mask.getAsFloat32Array(),mw=mask.width,mh=mask.height;
  if(data.length<mw*mh)return false;
  const buffer=this.maskBuffer;buffer.width=mw;buffer.height=mh;
  const bufferContext=buffer.getContext('2d');if(!bufferContext)return false;
  const image=bufferContext.createImageData(mw,mh),pixels=image.data;
  for(let i=0;i<mw*mh;i++){const v=data[i];pixels[i*4]=255;pixels[i*4+1]=255;pixels[i*4+2]=255;pixels[i*4+3]=v>.5?255:0;}
  bufferContext.putImageData(image,0,0);masks.forEach(item=>item.close());
  const maskContext=this.maskCanvas.getContext('2d');if(!maskContext)return false;
  if(this.maskCanvas.width!==width){this.maskCanvas.width=width;this.maskCanvas.height=height;}
  const fg=this.foreground,fgContext=fg.getContext('2d');if(!fgContext)return false;
  if(fg.width!==width){fg.width=width;fg.height=height;}
  maskContext.clearRect(0,0,width,height);maskContext.drawImage(buffer,0,0,width,height);
  fgContext.clearRect(0,0,width,height);fgContext.drawImage(this.video,0,0,width,height);
  fgContext.globalCompositeOperation='destination-in';fgContext.drawImage(this.maskCanvas,0,0);fgContext.globalCompositeOperation='source-over';
  context.drawImage(fg,0,0);
  return true;
 }
 stop(){this.stopped=true;cancelAnimationFrame(this.frame);this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;this.video.pause();this.video.srcObject=null;this.seg?.close();this.seg=undefined;segmenterPromise=undefined;}
}
