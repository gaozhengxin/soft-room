import {freshSession,type Session} from '../session.ts';
import {normalizeNickname} from '../protocol.ts';
import type {AtpSessionData} from '@atproto/api';
import {resumeAccount,signInAccount,type AccountLogin,type SignedInAccount} from './atproto-account.ts';
import {IndexedDbMasterKeys,IndexedDbRecordStore,openPrivateDatabase} from './indexed-db.ts';
import {IDENTITY_COLLECTION,IDENTITY_RKEY,PortableStateRepository,ROOM_COLLECTION,type RecordStore,type StoredRecord} from './portable-state.ts';
import {createRecoveryBundle,parseRecoveryFile,recoveryFile,recoverMasterKey} from './recovery.ts';

export type PersistentProfile={id:string;label:string;pds:string};
export type PersistentLoginResult={session:Session;recoveryFile?:string;temporary?:boolean};
export type PersistentAccountLogin=AccountLogin&{recoveryFile?:string};
const PROFILES='soft-room/persistent-identities/v1',ACTIVE='soft-room/persistent-active/v1',RECOVERY_PENDING='soft-room/persistent-recovery-pending/v1';
let current:{profile:PersistentProfile;repository:PortableStateRepository;account?:SignedInAccount}|undefined;
const profileId=(did:string)=>did;
export function profiles():PersistentProfile[]{try{const value=JSON.parse(localStorage.getItem(PROFILES)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item.id==='string'&&typeof item.label==='string'&&typeof item.pds==='string').slice(0,10):[];}catch{return [];}}
function saveProfiles(value:PersistentProfile[]){localStorage.setItem(PROFILES,JSON.stringify(value));}
export function activeProfile(){return current?.profile;}
export function activeProfileId(){try{return sessionStorage.getItem(ACTIVE)||undefined;}catch{return;}}
export function chooseTemporary(){current=undefined;try{sessionStorage.removeItem(ACTIVE);sessionStorage.removeItem(RECOVERY_PENDING);}catch{}}
export function recoveryPending(){try{return sessionStorage.getItem(RECOVERY_PENDING)==='1';}catch{return false;}}
function temporaryLogin(session:Session,handle:string):PersistentLoginResult{chooseTemporary();session.name ||= defaultUsername(handle);try{sessionStorage.setItem(RECOVERY_PENDING,'1');}catch{}return {session,temporary:true};}
function defaultUsername(handle:string){try{return normalizeNickname(handle.trim().slice(0,24));}catch{return '';}}
async function accountSession(repository:PortableStateRepository,session:Session,handle:string){if(session.name)return session;session.name=defaultUsername(handle);if(session.name)await repository.saveIdentity(session.identity,session.name);return session;}
async function localRepository(profile:PersistentProfile){const db=await openPrivateDatabase(),keys=new IndexedDbMasterKeys(db),local=new IndexedDbRecordStore(db,profile.id),key=await keys.get(profile.id);return {keys,local,key};}
function sessionWriter(keys:IndexedDbMasterKeys,id:string,key:CryptoKey){let flight=Promise.resolve();return (value:AtpSessionData|undefined)=>{flight=flight.then(()=>value?keys.putAccountSession(id,key,value):keys.deleteAccountSession(id)).catch(()=>{});return flight;};}

class StagingStore implements RecordStore {
 records=new Map<string,StoredRecord>();
 private id(collection:string,rkey:string){return `${collection}/${rkey}`;}
 async get(collection:string,rkey:string){return this.records.get(this.id(collection,rkey))?.value;}
 async list(collection:string){return [...this.records.values()].filter(record=>record.collection===collection);}
 async put(record:StoredRecord){this.records.set(this.id(record.collection,record.rkey),structuredClone(record));}
 async delete(collection:string,rkey:string){this.records.delete(this.id(collection,rkey));}
}
async function stageSession(key:CryptoKey,session:Session){const store=new StagingStore(),repository=new PortableStateRepository(key,store);await repository.saveIdentity(session.identity,session.name);for(const room of session.rooms)await repository.saveRoom(room);return [...store.records.values()];}
async function replaceRemote(account:SignedInAccount,records:StoredRecord[]){
 const oldRooms=await account.records.list(ROOM_COLLECTION),identity=records.find(record=>record.collection===IDENTITY_COLLECTION&&record.rkey===IDENTITY_RKEY),rooms=records.filter(record=>record.collection===ROOM_COLLECTION);if(!identity)throw Error('Persistent identity unavailable');
 await account.records.put(identity);for(const room of rooms)await account.records.put(room);const keep=new Set(rooms.map(room=>room.rkey));for(const old of oldRooms)if(!keep.has(old.rkey))await account.records.delete(ROOM_COLLECTION,old.rkey);
}
async function installRecovery(account:SignedInAccount,session:Session,keys:IndexedDbMasterKeys,local:IndexedDbRecordStore,id:string){
 const bundle=await createRecoveryBundle(account.did),records=await stageSession(bundle.key,session);await replaceRemote(account,records);await local.replace(records);await keys.put(id,bundle.key);await keys.putRecovery(id,bundle.code,bundle.record);await account.recovery.put(bundle.record);return {repository:new PortableStateRepository(bundle.key,local,account.records),code:bundle.code};
}
function activate(profile:PersistentProfile,repository:PortableStateRepository,account?:SignedInAccount){const known=profiles().filter(item=>item.id!==profile.id);known.unshift(profile);saveProfiles(known);current={profile,repository,account};try{sessionStorage.setItem(ACTIVE,profile.id);sessionStorage.removeItem(RECOVERY_PENDING);}catch{}}

export async function continuePersistent(profile:PersistentProfile,language:'zh'|'en'){
 const {keys,local,key}=await localRepository(profile);if(!key)throw Error('Recovery key required');const repository=new PortableStateRepository(key,local),savedAccount=await keys.getAccountSession(profile.id,key);if(!savedAccount)throw Error('Account sign-in required');
 let resolvedProfile=profile,resumedAccount:SignedInAccount|undefined;if(savedAccount)try{const write=sessionWriter(keys,profile.id,key),account=await resumeAccount(profile.pds,savedAccount,write);repository.setRemote(account.records);if(account.session.session)await write(account.session.session);await repository.pull();resolvedProfile={...profile,label:account.handle};resumedAccount=account;}catch{repository.setRemote(undefined);}
 const restored=await repository.restore(language);if(!restored)throw Error('Persistent identity unavailable');activate(resolvedProfile,repository,resumedAccount);return restored;
}

export async function loginPersistent(input:PersistentAccountLogin,language:'zh'|'en',create:boolean,initial?:Session):Promise<PersistentLoginResult>{
 let writeAccount:((value:AtpSessionData|undefined)=>Promise<void>)|undefined;const account=await signInAccount(input,value=>void writeAccount?.(value)),id=profileId(account.did),profile={id,label:account.handle,pds:account.pds};
 const {keys,local,key:storedKey}=await localRepository(profile),remoteIdentity=await account.records.get(IDENTITY_COLLECTION,IDENTITY_RKEY);let remoteRecovery=await account.recovery.get();
 const activateAccount=async(key:CryptoKey,repository:PortableStateRepository)=>{writeAccount=sessionWriter(keys,id,key);if(account.session.session)await writeAccount(account.session.session);activate(profile,repository,account);};
 if(create&&remoteIdentity)throw Error('Persistent identity already exists');

 if(!storedKey){
  if(remoteIdentity){
   if(!input.recoveryFile?.trim())return temporaryLogin(initial||freshSession(language),account.handle);
   if(!remoteRecovery)throw Error('Recovery not enabled');
   const recovered=parseRecoveryFile(input.recoveryFile,account.did),key=await recoverMasterKey(account.did,recovered.recoveryCode,remoteRecovery),repository=new PortableStateRepository(key,local,account.records);await repository.pull();let restored=await repository.restore(language);if(!restored)throw Error('Persistent identity unavailable');await keys.put(id,key);await keys.putRecovery(id,recovered.recoveryCode,remoteRecovery);restored=await accountSession(repository,restored,account.handle);await activateAccount(key,repository);return {session:restored};
  }
  if(!create)throw Error('No persistent identity exists for this account');
  const session=initial||freshSession(language);session.name ||= defaultUsername(account.handle);const installed=await installRecovery(account,session,keys,local,id),key=await keys.get(id);if(!key)throw Error('Persistent identity unavailable');await activateAccount(key,installed.repository);return {session,recoveryFile:recoveryFile(account.did,installed.code)};
 }

 let repository=new PortableStateRepository(storedKey,local,account.records);
 if(!remoteIdentity){
  if(!create)throw Error('No persistent identity exists for this account');
  const session=await repository.restore(language)||initial||freshSession(language);session.name ||= defaultUsername(account.handle);const installed=await installRecovery(account,session,keys,local,id),key=await keys.get(id);if(!key)throw Error('Persistent identity unavailable');await activateAccount(key,installed.repository);return {session,recoveryFile:recoveryFile(account.did,installed.code)};
 }

 if(!remoteRecovery){
  const savedRecord=await keys.getRecoveryRecord(id),savedCode=await keys.getRecoveryCode(id);
  if(savedRecord&&savedCode){await account.recovery.put(savedRecord);remoteRecovery=savedRecord;await repository.pull();let restored=await repository.restore(language);if(!restored)throw Error('Persistent identity unavailable');restored=await accountSession(repository,restored,account.handle);await activateAccount(storedKey,repository);return {session:restored,recoveryFile:recoveryFile(account.did,savedCode)};}
  let restored=await repository.restore(language);if(!restored){await repository.pull();restored=await repository.restore(language);}if(!restored)throw Error('Persistent identity unavailable');restored.name ||= defaultUsername(account.handle);const installed=await installRecovery(account,restored,keys,local,id),key=await keys.get(id);if(!key)throw Error('Persistent identity unavailable');await activateAccount(key,installed.repository);return {session:restored,recoveryFile:recoveryFile(account.did,installed.code)};
 }

 await repository.pull();let restored=await repository.restore(language);if(!restored)throw Error('Persistent identity unavailable');restored=await accountSession(repository,restored,account.handle);await activateAccount(storedKey,repository);return {session:restored};
}
export async function persistSessionState(session:Session){if(!current)return;await current.repository.saveIdentity(session.identity,session.name);for(const saved of session.rooms)await current.repository.saveRoom(saved);}
export async function refreshPersistentState(language:'zh'|'en'){if(!current)return;await current.repository.pull();return current.repository.restore(language);}
export async function deleteSavedRoom(id:string){await current?.repository.deleteRoom(id);}
export async function exportRecoveryFile(){if(!current)return;const db=await openPrivateDatabase(),keys=new IndexedDbMasterKeys(db),code=await keys.getRecoveryCode(current.profile.id);return code?recoveryFile(current.profile.id,code):undefined;}
export async function logoutPersistent(){const id=current?.profile.id||activeProfileId(),account=current?.account;chooseTemporary();if(id){try{await account?.session.logout();}catch{}try{const db=await openPrivateDatabase();await new IndexedDbMasterKeys(db).deleteAccountSession(id);db.close();}catch{}}}
export async function clearDeviceData(){const id=current?.profile.id||activeProfileId(),account=current?.account;chooseTemporary();if(!id)return;try{await account?.session.logout();}catch{}try{saveProfiles(profiles().filter(profile=>profile.id!==id));}catch{}try{const db=await openPrivateDatabase();await new IndexedDbMasterKeys(db).deleteProfile(id);await new IndexedDbRecordStore(db,id).deleteAll();db.close();}catch{}}
export function isPersistent(){return !!current;}
