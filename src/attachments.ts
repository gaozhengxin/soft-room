import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {hexToBytes,randomBytes} from '@noble/hashes/utils.js';
import {roomId,type Attachment,type Room} from './protocol.ts';
import {uploadObject,downloadObject,type UploadProgress} from './storage.ts';
const utf8=new TextEncoder(),MAX_SOURCE=190*1024*1024;
export type MediaQuality='original'|'balanced'|'compact';
function safeName(value:string){const result=value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);return result||'file';}
function mediaKind(type:string,name:string):Attachment['media']{if(type.startsWith('image/'))return'image';if(type.startsWith('video/'))return'video';if(type.startsWith('audio/'))return'audio';if(type==='application/pdf'||name.toLowerCase().endsWith('.pdf'))return'pdf';if(['text/markdown','text/x-markdown'].includes(type)||/\.(md|markdown)$/i.test(name))return'markdown';return'file';}
async function imagePreview(file:File,quality:MediaQuality):Promise<Blob|undefined>{if(quality==='original'||!file.type.startsWith('image/')||file.type==='image/svg+xml')return;const bitmap=await createImageBitmap(file),max=quality==='compact'?960:1600,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise(resolve=>canvas.toBlob(blob=>resolve(blob||undefined),'image/webp',quality==='compact'?.64:.82));}
function recorderMime(video:boolean){const candidates=video?['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/mp4']:['audio/webm;codecs=opus','audio/mp4'];return candidates.find(value=>MediaRecorder.isTypeSupported(value));}
async function mediaPreview(file:File,quality:MediaQuality,progress?:(value:UploadProgress)=>void):Promise<Blob|undefined>{
 if(quality==='original'||(!file.type.startsWith('video/')&&!file.type.startsWith('audio/'))||typeof MediaRecorder==='undefined')return;
 const video=file.type.startsWith('video/'),mime=recorderMime(video);if(!mime)return;
 const element=document.createElement(video?'video':'audio') as HTMLMediaElement&{captureStream?:()=>MediaStream};
 const source=URL.createObjectURL(file);let stream:MediaStream|undefined,recorder:MediaRecorder|undefined;element.src=source;element.preload='auto';element.muted=true;
 try{
  await new Promise<void>((resolve,reject)=>{element.onloadedmetadata=()=>resolve();element.onerror=()=>reject(Error('Media unavailable'));});
  if(!Number.isFinite(element.duration)||element.duration<=0||element.duration>300||!element.captureStream)return;
  stream=element.captureStream();const chunks:BlobPart[]=[],activeRecorder=recorder=new MediaRecorder(stream,{mimeType:mime,...(video?{videoBitsPerSecond:quality==='compact'?600_000:1_500_000,audioBitsPerSecond:quality==='compact'?64_000:96_000}:{audioBitsPerSecond:quality==='compact'?64_000:96_000})});
  const result=new Promise<Blob>((resolve,reject)=>{activeRecorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};activeRecorder.onerror=()=>reject(Error('Media conversion failed'));activeRecorder.onstop=()=>resolve(new Blob(chunks,{type:activeRecorder.mimeType||mime}));});
  element.ontimeupdate=()=>progress?.({phase:'processing',loaded:element.currentTime,total:element.duration});
  activeRecorder.start(1000);await element.play();await new Promise<void>((resolve,reject)=>{element.onended=()=>resolve();element.onerror=()=>reject(Error('Media conversion failed'));});activeRecorder.stop();
  const blob=await result;return blob.size&&blob.size<file.size?blob:undefined;
 }catch{return;}finally{if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach(track=>track.stop());element.pause();element.removeAttribute('src');element.load();URL.revokeObjectURL(source);}
}
async function makePreview(file:File,quality:MediaQuality,progress?:(value:UploadProgress)=>void){if(file.type.startsWith('image/'))return imagePreview(file,quality);return mediaPreview(file,quality,progress);}
async function encrypt(room:Room,data:Uint8Array){const nonce=randomBytes(24),cipher=xchacha20poly1305(hexToBytes(room.key),nonce,utf8.encode(`soft-room/file/v1:${roomId(room)}`)).encrypt(data);const output=new Uint8Array(1+nonce.length+cipher.length);output[0]=1;output.set(nonce,1);output.set(cipher,25);return output;}
async function decrypt(room:Room,data:Uint8Array){if(data.length<42||data[0]!==1)throw Error('Invalid encrypted file');return xchacha20poly1305(hexToBytes(room.key),data.slice(1,25),utf8.encode(`soft-room/file/v1:${roomId(room)}`)).decrypt(data.slice(25));}
export async function shareFile(room:Room,file:File,quality:MediaQuality,progress?:(value:UploadProgress)=>void):Promise<Attachment>{if(!file.size||file.size>MAX_SOURCE)throw Error('File too large');const previewBlob=await makePreview(file,quality,progress);progress?.({phase:'encrypting',loaded:0,total:file.size});const original=await uploadObject(roomId(room),await encrypt(room,new Uint8Array(await file.arrayBuffer())),progress);let preview:Attachment['preview'];if(previewBlob)try{const stored=await uploadObject(roomId(room),await encrypt(room,new Uint8Array(await previewBlob.arrayBuffer())),progress);preview={...stored,mime:previewBlob.type};}catch{}return{v:1,name:safeName(file.name),mime:file.type.slice(0,100)||'application/octet-stream',bytes:file.size,media:mediaKind(file.type,file.name),quality:preview?quality:'original',original,...(preview?{preview}:{})};}
export async function openFile(room:Room,file:Attachment,preview=false,progress?:(value:UploadProgress)=>void){const selected=preview&&file.preview?file.preview:file.original;const encrypted=await downloadObject(roomId(room),selected.id,progress);const plain=await decrypt(room,encrypted);return new Blob([plain],{type:preview&&file.preview?file.preview.mime:file.mime});}
