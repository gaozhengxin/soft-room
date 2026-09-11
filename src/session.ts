import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { dayEpoch, normalizeNickname, makeIdentity, parseInvite, invite, roomId, validWork, type Identity, type Room } from './protocol.ts';
export type SavedRoom={room:Room;created:boolean;nonce?:number;epoch?:number;nickname?:string};
export type Session={identity:Identity;name?:string;rooms:SavedRoom[];activeId?:string;language:'zh'|'en';theme?:'soft'|'sssp'|'kabutack'};
export const SESSION_KEY='soft-room/session/v1';
export function freshSession(language:'zh'|'en'='zh'):Session{return {identity:makeIdentity(),rooms:[],language};}
export function encodeSession(s:Session):string{return JSON.stringify({v:1,name:s.name,secret:bytesToHex(s.identity.secret),rooms:s.rooms,activeId:s.activeId,language:s.language,theme:s.theme});}
export function decodeSession(raw:string):Session {
 if(raw.length>300000)throw Error('Invalid session');
 const value=JSON.parse(raw);
 if(value.v!==1||typeof value.secret!=='string'||!/^[a-f0-9]{64}$/.test(value.secret)||!Array.isArray(value.rooms)||value.rooms.length>100)throw Error('Invalid session');
 const secret=hexToBytes(value.secret),publicKey=bytesToHex(ed25519.getPublicKey(secret));
 const rooms:SavedRoom[]=[],seen=new Set<string>();
 for(const item of value.rooms){
  try{
   const room=parseInvite(invite(item.room));const id=roomId(room);if(seen.has(id))continue;seen.add(id);
   let nickname='';try{if(typeof item.nickname==='string')nickname=normalizeNickname(item.nickname);}catch{}
   if(room.v===2 && typeof item.room.key==='string' && /^[a-f0-9]{64}$/.test(item.room.key))room.key=item.room.key;
   rooms.push({room,...(room.v===2?{epoch:item.epoch}:{}),...(nickname?{nickname}:{}),created:item.created===true,nonce:(room.v!==2 || item.epoch===dayEpoch()) && validWork(room,publicKey,item.nonce,item.epoch)?item.nonce:undefined});
  }catch{ /* Ignore a corrupt room without discarding the entire identity. */ }
 }
 let name='';try{if(typeof value.name==='string')name=normalizeNickname(value.name);}catch{}
 return {identity:{secret,publicKey},...(name?{name}:{}),rooms,...(value.theme==='soft'||value.theme==='sssp'||value.theme==='kabutack'?{theme:value.theme}:{}),language:value.language==='en'?'en':'zh',activeId:rooms.some(x=>roomId(x.room)===value.activeId)?value.activeId:undefined};
}
export function loadSession(storage:Pick<Storage,'getItem'>|undefined,language:'zh'|'en'):{session:Session;failed:boolean}{
 try{const raw=storage?.getItem(SESSION_KEY);return {session:raw?decodeSession(raw):freshSession(language),failed:!storage};}
 catch{return {session:freshSession(language),failed:true};}
}
export function saveSession(storage:Pick<Storage,'setItem'>|undefined,session:Session):boolean{
 try{if(!storage)return false;storage.setItem(SESSION_KEY,encodeSession(session));return true;}catch{return false;}
}
