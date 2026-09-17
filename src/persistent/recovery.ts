import {sha256} from '@noble/hashes/sha2.js';
import {concatBytes,randomBytes} from '@noble/hashes/utils.js';

export const RECOVERY_COLLECTION='uk.wakukusmartrecipe.soft.recovery';
export const RECOVERY_RKEY='self';
const PREFIX='SRK1.';
const utf8=new TextEncoder();

export type RecoveryRecord={$type:typeof RECOVERY_COLLECTION;version:1;alg:'A256GCM';iv:string;wrappedKey:string;updatedAt:string};
export type RecoveryFile={type:'soft-room-recovery';version:1;account:string;recoveryCode:string;createdAt:string};

const b64=(value:Uint8Array)=>{let output='';for(let offset=0;offset<value.length;offset+=8192)output+=String.fromCharCode(...value.subarray(offset,offset+8192));return btoa(output).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
const unb64=(value:string)=>{if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid recovery code');const raw=value.replaceAll('-','+').replaceAll('_','/'),padded=raw+'='.repeat((4-raw.length%4)%4);return Uint8Array.from(atob(padded),character=>character.charCodeAt(0));};
const checksum=(secret:Uint8Array)=>sha256(concatBytes(utf8.encode('soft-room/recovery-code/v1:'),secret)).slice(0,4);
const recoveryAad=(did:string)=>utf8.encode(`soft-room/recovery/v1:${did}`);
const owned=(value:Uint8Array)=>new Uint8Array(value);
const recoveryKey=(secret:Uint8Array)=>crypto.subtle.importKey('raw',owned(secret),{name:'AES-GCM'},false,['encrypt','decrypt']);

export function encodeRecoveryCode(secret:Uint8Array){if(secret.length!==32)throw Error('Invalid recovery secret');return PREFIX+b64(concatBytes(secret,checksum(secret)));}
export function decodeRecoveryCode(value:string){const compact=value.trim().replaceAll(/\s/g,'');if(!compact.toUpperCase().startsWith(PREFIX))throw Error('Invalid recovery code');const decoded=unb64(compact.slice(PREFIX.length));if(decoded.length!==36)throw Error('Invalid recovery code');const secret=decoded.slice(0,32),check=decoded.slice(32),expected=checksum(secret);let mismatch=0;for(let i=0;i<check.length;i++)mismatch|=check[i]^expected[i];if(mismatch)throw Error('Invalid recovery code');return secret;}
export function recoveryFile(did:string,code:string){decodeRecoveryCode(code);return JSON.stringify({type:'soft-room-recovery',version:1,account:did,recoveryCode:code,createdAt:new Date().toISOString()} satisfies RecoveryFile,null,2)+'\n';}
export function parseRecoveryFile(raw:string,did:string){if(raw.length>4096)throw Error('Invalid recovery file');let value:RecoveryFile;try{value=JSON.parse(raw) as RecoveryFile;}catch{throw Error('Invalid recovery file');}if(value?.type!=='soft-room-recovery'||value.version!==1||typeof value.account!=='string'||typeof value.recoveryCode!=='string'||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))throw Error('Invalid recovery file');if(value.account!==did)throw Error('Recovery file account mismatch');decodeRecoveryCode(value.recoveryCode);return value;}
export async function importMasterKey(raw:Uint8Array){if(raw.length!==32)throw Error('Invalid master key');return crypto.subtle.importKey('raw',owned(raw),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function createRecoveryBundle(did:string){
 const masterRaw=randomBytes(32),secret=randomBytes(32),iv=randomBytes(12),wrapper=await recoveryKey(secret);
 const wrapped=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:recoveryAad(did),tagLength:128},wrapper,masterRaw);
 const record:RecoveryRecord={$type:RECOVERY_COLLECTION,version:1,alg:'A256GCM',iv:b64(iv),wrappedKey:b64(new Uint8Array(wrapped)),updatedAt:new Date().toISOString()};return {key:await importMasterKey(masterRaw),code:encodeRecoveryCode(secret),record};
}
export async function recoverMasterKey(did:string,code:string,value:unknown){
 const record=value as RecoveryRecord;if(!record||record.$type!==RECOVERY_COLLECTION||record.version!==1||record.alg!=='A256GCM'||typeof record.iv!=='string'||record.iv.length>32||typeof record.wrappedKey!=='string'||record.wrappedKey.length>128)throw Error('Invalid recovery record');
 const secret=decodeRecoveryCode(code),wrapper=await recoveryKey(secret);let raw:ArrayBuffer;
 try{raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(record.iv),additionalData:recoveryAad(did),tagLength:128},wrapper,unb64(record.wrappedKey));}catch{throw Error('Invalid recovery code');}
 return importMasterKey(new Uint8Array(raw));
}
