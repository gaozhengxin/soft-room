const clean=(value:string|undefined)=>value?.replace(/\/+$/,'')||'';
export const storageBase=clean(import.meta.env.VITE_STORAGE_URL);
const jsonHeaders={'Content-Type':'application/json'};
const bytesToBase64=(bytes:Uint8Array)=>{let result='';for(let i=0;i<bytes.length;i+=0x8000)result+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(result);};
const base64ToBytes=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function checked(input:string,init?:RequestInit){const response=await fetch(input,init);if(!response.ok)throw Error(`Storage ${response.status}`);return response;}
export async function backupMessage(roomId:string,payload:Uint8Array){if(storageBase)await checked(storageBase+'/v1/messages',{method:'POST',headers:jsonHeaders,body:JSON.stringify({roomId,payload:bytesToBase64(payload)})});}
export async function storageHistory(roomId:string,receive:(payloads:Uint8Array[])=>void,signal?:AbortSignal){
 if(!storageBase)throw Error('Storage unavailable');let before:string|undefined;
 for(let page=0;page<10;page++){const query=new URLSearchParams({limit:'100'});if(before)query.set('before',before);const response=await checked(`${storageBase}/v1/rooms/${roomId}/messages?${query}`,{signal});const value=await response.json() as {messages?:{payload:string}[];nextBefore?:number};const payloads=(value.messages||[]).map(item=>base64ToBytes(item.payload));if(payloads.length)receive(payloads);if(!value.nextBefore)break;before=String(value.nextBefore);}
}
export type UploadProgress={phase:'processing'|'encrypting'|'uploading'|'opening';loaded:number;total:number};
export type StoredObject={id:string;size:number};
export async function uploadObject(roomId:string,data:Uint8Array,progress?:(value:UploadProgress)=>void):Promise<StoredObject>{
 if(!storageBase)throw Error('Storage unavailable');const stable=data.slice().buffer;const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',stable));const id=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');const config=await (await checked(storageBase+'/v1/config')).json() as {fileChunkBytes:number;maxFileBytes:number};if(data.length>config.maxFileBytes)throw Error('File too large');const chunks=Math.ceil(data.length/config.fileChunkBytes);const begin=await checked(storageBase+'/v1/files',{method:'POST',headers:jsonHeaders,body:JSON.stringify({roomId,fileId:id,size:data.length,chunks})});const state=await begin.json() as {complete?:boolean};if(!state.complete)for(let index=0;index<chunks;index++){const start=index*config.fileChunkBytes,end=Math.min(data.length,start+config.fileChunkBytes);await checked(`${storageBase}/v1/files/${roomId}/${id}/chunks/${index}`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:data.slice(start,end)});progress?.({phase:'uploading',loaded:end,total:data.length});}await checked(`${storageBase}/v1/files/${roomId}/${id}/complete`,{method:'POST'});return{id,size:data.length};
}
export async function downloadObject(roomId:string,id:string,progress?:(value:UploadProgress)=>void){
 if(!storageBase)throw Error('Storage unavailable');const response=await checked(`${storageBase}/v1/files/${roomId}/${id}`);const total=Number(response.headers.get('Content-Length'))||0;if(!response.body)return new Uint8Array(await response.arrayBuffer());const reader=response.body.getReader(),parts:Uint8Array[]=[];let loaded=0;for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);loaded+=value.length;progress?.({phase:'opening',loaded,total});}const output=new Uint8Array(loaded);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;
}
