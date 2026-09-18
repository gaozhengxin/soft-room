import {Capacitor,registerPlugin} from '@capacitor/core';

type NativeFilesPlugin={
 beginSave(options:{name:string;mime:string}):Promise<{cancelled?:boolean;token?:string}>;
 writeSaveChunk(options:{token:string;data:string;final:boolean}):Promise<void>;
 openTextFile():Promise<{cancelled?:boolean;text?:string}>;
};

const NativeFiles=registerPlugin<NativeFilesPlugin>('NativeFiles');
const CHUNK_BYTES=256*1024;

function base64(bytes:Uint8Array){
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}

export async function saveNativeFileDetailed(blob:Blob,name:string):Promise<'unsupported'|'cancelled'|'saved'>{
 if(Capacitor.getPlatform()!=='android')return 'unsupported';
 const selected=await NativeFiles.beginSave({name,mime:blob.type||'application/octet-stream'});
 if(selected.cancelled)return 'cancelled';
 if(!selected.token)throw Error('No output file selected');
 if(!blob.size){await NativeFiles.writeSaveChunk({token:selected.token,data:'',final:true});return 'saved';}
 for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){
  const end=Math.min(blob.size,offset+CHUNK_BYTES),data=base64(new Uint8Array(await blob.slice(offset,end).arrayBuffer()));
  await NativeFiles.writeSaveChunk({token:selected.token,data,final:end===blob.size});
 }
 return 'saved';
}
export async function saveNativeFile(blob:Blob,name:string){return (await saveNativeFileDetailed(blob,name))!=='unsupported';}
export function nativeAndroidFiles(){return Capacitor.getPlatform()==='android';}
export async function openNativeTextFile():Promise<{status:'unsupported'|'cancelled'|'selected';text?:string}>{
 if(!nativeAndroidFiles())return {status:'unsupported'};
 const result=await NativeFiles.openTextFile();
 if(result.cancelled)return {status:'cancelled'};
 if(typeof result.text!=='string')throw Error('Unable to read file');
 return {status:'selected',text:result.text};
}
