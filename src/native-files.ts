import {Capacitor,registerPlugin} from '@capacitor/core';

type NativeFilesPlugin={
 beginSave(options:{name:string;mime:string}):Promise<{cancelled?:boolean;token?:string}>;
 writeSaveChunk(options:{token:string;data:string;final:boolean}):Promise<void>;
};

const NativeFiles=registerPlugin<NativeFilesPlugin>('NativeFiles');
const CHUNK_BYTES=256*1024;

function base64(bytes:Uint8Array){
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}

export async function saveNativeFile(blob:Blob,name:string){
 if(Capacitor.getPlatform()!=='android')return false;
 const selected=await NativeFiles.beginSave({name,mime:blob.type||'application/octet-stream'});
 if(selected.cancelled)return true;
 if(!selected.token)throw Error('No output file selected');
 if(!blob.size){await NativeFiles.writeSaveChunk({token:selected.token,data:'',final:true});return true;}
 for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){
  const end=Math.min(blob.size,offset+CHUNK_BYTES),data=base64(new Uint8Array(await blob.slice(offset,end).arrayBuffer()));
  await NativeFiles.writeSaveChunk({token:selected.token,data,final:end===blob.size});
 }
 return true;
}
