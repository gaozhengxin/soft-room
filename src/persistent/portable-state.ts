import {validateConversation,mergeConversation,type ConversationState} from '../conversation-state.ts';
import {validateContact,type Contact} from '../dm.ts';
import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes,randomBytes} from '@noble/hashes/utils.js';
import {invite,normalizeNickname,parseInvite,roomId,type Identity,type Room} from '../protocol.ts';
import type {SavedRoom,Session} from '../session.ts';

export const CONVERSATION_COLLECTION='uk.wakukusmartrecipe.soft.conversation';
export const CONTACT_COLLECTION='uk.wakukusmartrecipe.soft.contact';
export const IDENTITY_COLLECTION='uk.wakukusmartrecipe.soft.identity';
export const ROOM_COLLECTION='uk.wakukusmartrecipe.soft.room';
export const IDENTITY_RKEY='self';
const utf8=new TextEncoder(),text=new TextDecoder('utf-8',{fatal:true});

export type EncryptedRecord={$type:string;version:1;alg:'A256GCM';iv:string;ciphertext:string;updatedAt:string};
export type PortableIdentityState={version:1;wakuPrivateKey:string;username?:string};
export type PortableRoomState={version:1;roomId:string;room:Room;created:boolean;nickname?:string;nonce?:number;epoch?:number};
export type StoredRecord={collection:string;rkey:string;value:EncryptedRecord};
export interface RecordStore {get(collection:string,rkey:string):Promise<EncryptedRecord|undefined>;list(collection:string):Promise<StoredRecord[]>;put(record:StoredRecord):Promise<void>;delete(collection:string,rkey:string):Promise<void>}

const b64=(value:Uint8Array)=>{let s='';for(let i=0;i<value.length;i+=0x8000)s+=String.fromCharCode(...value.subarray(i,i+0x8000));return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
const unb64=(value:string)=>{if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid encrypted state');const raw=value.replaceAll('-','+').replaceAll('_','/'),padded=raw+'='.repeat((4-raw.length%4)%4);return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));};
const aad=(collection:string,rkey:string)=>utf8.encode(`soft-room/portable-state/v1:${collection}:${rkey}`);
function assertRecord(value:unknown):asserts value is EncryptedRecord {const r=value as EncryptedRecord;if(!r||r.version!==1||r.alg!=='A256GCM')throw Error('Unsupported encrypted state version');if(typeof r.$type!=='string'||typeof r.iv!=='string'||r.iv.length>32||typeof r.ciphertext!=='string'||!r.ciphertext.length||r.ciphertext.length>128000||typeof r.updatedAt!=='string'||r.updatedAt.length>64||!Number.isFinite(Date.parse(r.updatedAt)))throw Error('Invalid encrypted state');}

export async function encryptState(key:CryptoKey,collection:string,rkey:string,value:unknown):Promise<EncryptedRecord>{
 const iv=randomBytes(12),plain=utf8.encode(JSON.stringify(value));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(collection,rkey),tagLength:128},key,plain);
 return {$type:collection,version:1,alg:'A256GCM',iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted)),updatedAt:new Date().toISOString()};
}
export async function decryptState<T>(key:CryptoKey,collection:string,rkey:string,value:unknown):Promise<T>{
 assertRecord(value);if(value.$type!==collection)throw Error('Invalid encrypted state type');
 let plain:ArrayBuffer;try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(value.iv),additionalData:aad(collection,rkey),tagLength:128},key,unb64(value.ciphertext));}catch{throw Error('Encrypted state could not be authenticated');}
 try{return JSON.parse(text.decode(plain)) as T;}catch{throw Error('Invalid encrypted state');}
}
export async function generateMasterKey(){return crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);}

function identityState(identity:Identity,username?:string):PortableIdentityState{const name=username===undefined?'':normalizeNickname(username);return {version:1,wakuPrivateKey:bytesToHex(identity.secret),...(name?{username:name}:{})};}
function restoreIdentityState(value:PortableIdentityState){if(value.version!==1)throw Error('Unsupported identity state version');if(!/^[a-f0-9]{64}$/.test(value.wakuPrivateKey))throw Error('Invalid identity state');const secret=hexToBytes(value.wakuPrivateKey),identity={secret,publicKey:bytesToHex(ed25519.getPublicKey(secret))};const username=value.username===undefined?'':normalizeNickname(value.username);return {identity,...(username?{username}:{})};}
function restoreIdentity(value:PortableIdentityState):Identity{return restoreIdentityState(value).identity;}
function roomState(saved:SavedRoom):PortableRoomState{return {version:1,roomId:roomId(saved.room),room:{...saved.room},created:saved.created,...(saved.nickname?{nickname:saved.nickname}:{}),...(saved.nonce!==undefined?{nonce:saved.nonce}:{}),...(saved.epoch!==undefined?{epoch:saved.epoch}:{})};}
function restoreRoom(value:PortableRoomState):SavedRoom {if(value.version!==1)throw Error('Unsupported room state version');const room=parseInvite(invite(value.room));if(room.v===2&&typeof value.room.key==='string'&&/^[a-f0-9]{64}$/.test(value.room.key))room.key=value.room.key;if(roomId(room)!==value.roomId)throw Error('Invalid room state');return {room,created:value.created===true,...(typeof value.nickname==='string'?{nickname:value.nickname}:{}),...(Number.isSafeInteger(value.nonce)?{nonce:value.nonce}:{}),...(Number.isSafeInteger(value.epoch)?{epoch:value.epoch}:{})};}
type ContactState=Contact&{deleted?:true;changedAt?:number};
function contactState(value:ContactState):ContactState{const contact=validateContact(value);if(value.deleted!==undefined&&value.deleted!==true||value.changedAt!==undefined&&(!Number.isSafeInteger(value.changedAt)||value.changedAt<0))throw Error('Invalid contact state');return {...contact,...(value.deleted?{deleted:true as const}:{}),...(value.changedAt!==undefined?{changedAt:value.changedAt}:{})};}
const contactTime=(state:ContactState,_record:StoredRecord)=>state.changedAt??0;
const randomRkey=()=>bytesToHex(randomBytes(16));

export class PortableStateRepository {
 private key:CryptoKey;private local:RecordStore;private remote?:RecordStore;
 constructor(key:CryptoKey,local:RecordStore,remote?:RecordStore){this.key=key;this.local=local;this.remote=remote;}
 setRemote(remote:RecordStore|undefined){this.remote=remote;}
 async pull(){if(!this.remote)return;for(const collection of [IDENTITY_COLLECTION,ROOM_COLLECTION])for(const record of await this.remote.list(collection)){if(collection===IDENTITY_COLLECTION)restoreIdentity(await decryptState<PortableIdentityState>(this.key,collection,record.rkey,record.value));else restoreRoom(await decryptState<PortableRoomState>(this.key,collection,record.rkey,record.value));await this.local.put(record);}await this.syncContacts();await this.syncConversations();}
 private async contactRecords(store:RecordStore=this.local){const result=[];for(const record of await store.list(CONTACT_COLLECTION)){const state=contactState(await decryptState<ContactState>(this.key,CONTACT_COLLECTION,record.rkey,record.value));result.push({record,state,time:contactTime(state,record)});}return result;}
 private async syncContacts(){if(!this.remote)return;const local=await this.contactRecords(),remote=await this.contactRecords(this.remote),known=new Map(local.map(item=>[item.record.rkey,item]));for(const item of remote){const old=known.get(item.record.rkey);if(!old||item.time>old.time||item.time===old.time&&item.state.deleted){await this.local.put(item.record);}else if(old.time>item.time||old.time===item.time&&old.state.deleted&&!item.state.deleted)await this.remote.put(old.record);known.delete(item.record.rkey);}for(const item of known.values())await this.remote.put(item.record);}
 private async latestContacts(){const items=await this.contactRecords();items.sort((a,b)=>b.time-a.time||Number(!!b.state.deleted)-Number(!!a.state.deleted));const latest=new Map<string,typeof items[number]>();for(const item of items)if(!latest.has(item.state.publicKey))latest.set(item.state.publicKey,item);return latest;}
 async saveIdentity(identity:Identity,username?:string){const record={collection:IDENTITY_COLLECTION,rkey:IDENTITY_RKEY,value:await encryptState(this.key,IDENTITY_COLLECTION,IDENTITY_RKEY,identityState(identity,username))};await this.local.put(record);await this.remote?.put(record);}
 async loadIdentity():Promise<Identity|undefined>{const value=await this.local.get(IDENTITY_COLLECTION,IDENTITY_RKEY);return value?restoreIdentity(await decryptState<PortableIdentityState>(this.key,IDENTITY_COLLECTION,IDENTITY_RKEY,value)):undefined;}
 async loadIdentityState(){const value=await this.local.get(IDENTITY_COLLECTION,IDENTITY_RKEY);return value?restoreIdentityState(await decryptState<PortableIdentityState>(this.key,IDENTITY_COLLECTION,IDENTITY_RKEY,value)):undefined;}
 private async roomRecords(){const output:Array<{record:StoredRecord;state:PortableRoomState}>=[];for(const record of await this.local.list(ROOM_COLLECTION))output.push({record,state:await decryptState<PortableRoomState>(this.key,ROOM_COLLECTION,record.rkey,record.value)});return output;}
 async saveRoom(saved:SavedRoom){const id=roomId(saved.room),existing=(await this.roomRecords()).find(item=>item.state.roomId===id),rkey=existing?.record.rkey||randomRkey();const record={collection:ROOM_COLLECTION,rkey,value:await encryptState(this.key,ROOM_COLLECTION,rkey,roomState(saved))};await this.local.put(record);await this.remote?.put(record);}
 async loadRooms(){const rooms:SavedRoom[]=[],seen=new Set<string>();for(const {state} of await this.roomRecords()){if(seen.has(state.roomId))continue;seen.add(state.roomId);rooms.push(restoreRoom(state));}return rooms;}
 async deleteRoom(id:string){for(const {record,state} of await this.roomRecords())if(state.roomId===id){await this.local.delete(ROOM_COLLECTION,record.rkey);await this.remote?.delete(ROOM_COLLECTION,record.rkey);}}
 async loadContacts(){return [...(await this.latestContacts()).values()].filter(item=>!item.state.deleted).slice(0,100).map(item=>validateContact(item.state));}
 async deletedContacts(){return [...(await this.latestContacts()).values()].filter(item=>item.state.deleted).map(item=>item.state.publicKey);}
 // Ordinary session snapshots cannot resurrect a deleted contact. Only an explicit save can.
 async saveContacts(contacts:Contact[]){const known=await this.latestContacts();for(const value of contacts.slice(0,100)){const contact=validateContact(value);if(!known.has(contact.publicKey))await this.saveContact(contact);}}
 async saveContact(contact:Contact){await this.writeContact(validateContact(contact));}
 async deleteContact(publicKey:string){await this.writeContact({...validateContact({publicKey}),deleted:true});}
 private async writeContact(state:ContactState){const matches=(await this.contactRecords()).filter(item=>item.state.publicKey===state.publicKey),changedAt=Math.max(Date.now(),...matches.map(item=>item.time+1)),rkeys=matches.length?matches.map(item=>item.record.rkey):[randomRkey()];const records:StoredRecord[]=[];for(const rkey of rkeys){const record={collection:CONTACT_COLLECTION,rkey,value:await encryptState(this.key,CONTACT_COLLECTION,rkey,{...state,changedAt})};await this.local.put(record);records.push(record);}for(const record of records)await this.remote?.put(record);}
 private async conversationRecords(store:RecordStore=this.local){const output=[];for(const record of await store.list(CONVERSATION_COLLECTION)){const state=validateConversation(await decryptState<ConversationState>(this.key,CONVERSATION_COLLECTION,record.rkey,record.value));output.push({record,state});}return output;}
 async loadConversations(){const out=new Map<string,ConversationState>();for(const {state} of await this.conversationRecords())out.set(state.id,out.has(state.id)?mergeConversation(out.get(state.id)!,state):state);return [...out.values()];}
 private conversationFlight:Promise<unknown>=Promise.resolve();
 private conversationTask<T>(run:()=>Promise<T>):Promise<T>{const next=this.conversationFlight.then(run);this.conversationFlight=next.catch(()=>{});return next;}
 saveConversations(states:ConversationState[]){return this.conversationTask(()=>this.writeConversations(states));}
 saveConversation(state:ConversationState){return this.conversationTask(()=>this.writeConversation(state));}
 private syncConversations(){return this.conversationTask(()=>this.mergeStoredConversations());}
 private async writeConversations(states:ConversationState[]){try{await this.mergeStoredConversations();}catch{/* Preserve local edits while offline; pull retries publication. */}for(const state of states)await this.writeConversation(state);}
 private async writeConversation(value:ConversationState){const state=validateConversation(value),old=(await this.conversationRecords()).filter(x=>x.state.id===state.id);let merged=state;for(const item of old)merged=mergeConversation(merged,item.state);if(old.length===1&&JSON.stringify(old[0].state)===JSON.stringify(merged))return;const rkey=old[0]?.record.rkey||randomRkey(),record={collection:CONVERSATION_COLLECTION,rkey,value:await encryptState(this.key,CONVERSATION_COLLECTION,rkey,merged)};await this.local.put(record);await this.remote?.put(record);}
 private async mergeStoredConversations(){if(!this.remote)return;const all=[...await this.conversationRecords(),...await this.conversationRecords(this.remote)],groups=new Map<string,typeof all>();for(const item of all){const group=groups.get(item.state.id)||[];group.push(item);groups.set(item.state.id,group);}for(const group of groups.values()){let merged=group[0].state;for(const item of group)merged=mergeConversation(merged,item.state);const rkeys=new Set(group.map(x=>x.record.rkey));for(const rkey of rkeys){const candidates=group.filter(x=>x.record.rkey===rkey),same=candidates.find(x=>JSON.stringify(x.state)===JSON.stringify(merged));const record=same?.record||{collection:CONVERSATION_COLLECTION,rkey,value:await encryptState(this.key,CONVERSATION_COLLECTION,rkey,merged)};if(candidates.length<2||!candidates.every(x=>JSON.stringify(x.state)===JSON.stringify(merged))){await this.local.put(record);await this.remote.put(record);}}}}
 async restore(language:'zh'|'en'):Promise<Session|undefined>{const saved=await this.loadIdentityState();if(!saved)return;return {identity:saved.identity,...(saved.username?{name:saved.username}:{}),states:await this.loadConversations(),contacts:await this.loadContacts(),rooms:await this.loadRooms(),language};}
}
