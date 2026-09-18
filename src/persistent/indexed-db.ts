import type {AtpSessionData} from '@atproto/api';
import {decryptState,encryptState,type EncryptedRecord,type RecordStore,type StoredRecord} from './portable-state.ts';
import type {RecoveryRecord} from './recovery.ts';

const DB='soft-room-private-v1',VERSION=1,KEYS='keys',RECORDS='records';
const ACCOUNT_SESSION_COLLECTION='uk.wakukusmartrecipe.soft.account-session';
const request=<T>(value:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error||Error('IndexedDB request failed'));});
export async function openPrivateDatabase():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(KEYS))db.createObjectStore(KEYS);if(!db.objectStoreNames.contains(RECORDS))db.createObjectStore(RECORDS);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Private storage unavailable'));});}
const done=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('Private storage failed'));tx.onabort=()=>reject(tx.error||Error('Private storage aborted'));});
export class IndexedDbMasterKeys {
 constructor(private db:IDBDatabase){}
 async get(profileId:string){return request(this.db.transaction(KEYS).objectStore(KEYS).get(profileId)) as Promise<CryptoKey|undefined>;}
 async put(profileId:string,key:CryptoKey){const tx=this.db.transaction(KEYS,'readwrite');tx.objectStore(KEYS).put(key,profileId);await done(tx);}
 async getRecoveryCode(profileId:string){return request(this.db.transaction(KEYS).objectStore(KEYS).get(`recovery-code:${profileId}`)) as Promise<string|undefined>;}
 async getRecoveryRecord(profileId:string){return request(this.db.transaction(KEYS).objectStore(KEYS).get(`recovery-record:${profileId}`)) as Promise<RecoveryRecord|undefined>;}
 async putRecovery(profileId:string,code:string,record:RecoveryRecord){const tx=this.db.transaction(KEYS,'readwrite'),store=tx.objectStore(KEYS);store.put(code,`recovery-code:${profileId}`);store.put(record,`recovery-record:${profileId}`);await done(tx);}
 async getAccountSession(profileId:string,key:CryptoKey){const record=await request(this.db.transaction(KEYS).objectStore(KEYS).get(`account-session:${profileId}`)) as EncryptedRecord|undefined;if(!record)return;const value=await decryptState<AtpSessionData>(key,ACCOUNT_SESSION_COLLECTION,profileId,record);if(value.did!==profileId||typeof value.handle!=='string'||typeof value.accessJwt!=='string'||typeof value.refreshJwt!=='string')throw Error('Invalid account session');return value;}
 async putAccountSession(profileId:string,key:CryptoKey,value:AtpSessionData){if(value.did!==profileId)throw Error('Invalid account session');const record=await encryptState(key,ACCOUNT_SESSION_COLLECTION,profileId,value),tx=this.db.transaction(KEYS,'readwrite');tx.objectStore(KEYS).put(record,`account-session:${profileId}`);await done(tx);}
 async deleteAccountSession(profileId:string){const tx=this.db.transaction(KEYS,'readwrite');tx.objectStore(KEYS).delete(`account-session:${profileId}`);await done(tx);}
}
export class IndexedDbRecordStore implements RecordStore {
 constructor(private db:IDBDatabase,private profileId:string){}
 private key(collection:string,rkey:string){return `${this.profileId}:${collection}:${rkey}`;}
 async get(collection:string,rkey:string){const value=await request(this.db.transaction(RECORDS).objectStore(RECORDS).get(this.key(collection,rkey))) as StoredRecord|undefined;return value?.value;}
 async list(collection:string){const all=await request(this.db.transaction(RECORDS).objectStore(RECORDS).getAll()) as StoredRecord[];return all.filter(item=>item.collection===collection&&(item as StoredRecord&{profileId?:string}).profileId===this.profileId).map(({collection,rkey,value})=>({collection,rkey,value}));}
 async put(record:StoredRecord){const tx=this.db.transaction(RECORDS,'readwrite');tx.objectStore(RECORDS).put({...record,profileId:this.profileId},this.key(record.collection,record.rkey));await done(tx);}
 async delete(collection:string,rkey:string){const tx=this.db.transaction(RECORDS,'readwrite');tx.objectStore(RECORDS).delete(this.key(collection,rkey));await done(tx);}
 async replace(records:StoredRecord[]){const tx=this.db.transaction(RECORDS,'readwrite'),store=tx.objectStore(RECORDS),keys=store.getAllKeys();keys.onsuccess=()=>{for(const key of keys.result)if(typeof key==='string'&&key.startsWith(`${this.profileId}:`))store.delete(key);for(const record of records)store.put({...record,profileId:this.profileId},this.key(record.collection,record.rkey));};await done(tx);}
}
