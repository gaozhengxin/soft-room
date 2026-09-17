import {freshSession,type Session} from '../session.ts';
import {signInAccount,type AccountLogin} from './atproto-account.ts';
import {IndexedDbMasterKeys,IndexedDbRecordStore,openPrivateDatabase} from './indexed-db.ts';
import {generateMasterKey,IDENTITY_COLLECTION,IDENTITY_RKEY,PortableStateRepository} from './portable-state.ts';

export type PersistentProfile={id:string;label:string;pds:string};
const PROFILES='soft-room/persistent-identities/v1',ACTIVE='soft-room/persistent-active/v1';
let current:{profile:PersistentProfile;repository:PortableStateRepository}|undefined;
const profileId=(did:string)=>did;
export function profiles():PersistentProfile[]{try{const value=JSON.parse(localStorage.getItem(PROFILES)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item.id==='string'&&typeof item.label==='string'&&typeof item.pds==='string').slice(0,10):[];}catch{return [];}}
function saveProfiles(value:PersistentProfile[]){localStorage.setItem(PROFILES,JSON.stringify(value));}
export function activeProfile(){return current?.profile;}
export function activeProfileId(){try{return sessionStorage.getItem(ACTIVE)||undefined;}catch{return;}}
export function chooseTemporary(){current=undefined;try{sessionStorage.removeItem(ACTIVE);}catch{}}
async function localRepository(profile:PersistentProfile){const db=await openPrivateDatabase(),keys=new IndexedDbMasterKeys(db),local=new IndexedDbRecordStore(db,profile.id),key=await keys.get(profile.id);return {keys,local,key};}
export async function continuePersistent(profile:PersistentProfile,language:'zh'|'en'){const {local,key}=await localRepository(profile);if(!key)throw Error('Recovery key required');const repository=new PortableStateRepository(key,local);const restored=await repository.restore(language);if(!restored)throw Error('Persistent identity unavailable');current={profile,repository};try{sessionStorage.setItem(ACTIVE,profile.id);}catch{}return restored;}
export async function loginPersistent(input:AccountLogin,language:'zh'|'en',create:boolean,initial?:Session){
 const account=await signInAccount(input),id=profileId(account.did),profile={id,label:account.handle,pds:account.pds};
 const {keys,local,key:storedKey}=await localRepository(profile);let key=storedKey;
 if(!key){const remoteIdentity=await account.records.get(IDENTITY_COLLECTION,IDENTITY_RKEY);if(remoteIdentity)throw Error('Recovery key required');if(!create)throw Error('No persistent identity exists for this account');key=await generateMasterKey();await keys.put(id,key);}
 const repository=new PortableStateRepository(key,local,account.records);await repository.pull();let restored=await repository.restore(language);
 if(!restored){if(!create)throw Error('No persistent identity exists for this account');restored=initial||freshSession(language);await repository.saveIdentity(restored.identity);for(const room of restored.rooms)await repository.saveRoom(room);}
 else {await repository.saveIdentity(restored.identity);for(const room of restored.rooms)await repository.saveRoom(room);}
 const known=profiles().filter(item=>item.id!==id);known.unshift(profile);saveProfiles(known);current={profile,repository};try{sessionStorage.setItem(ACTIVE,id);}catch{}return restored;
}
export async function persistSessionState(session:Session){if(!current)return;await current.repository.saveIdentity(session.identity);for(const saved of session.rooms)await current.repository.saveRoom(saved);}
export async function deleteSavedRoom(id:string){await current?.repository.deleteRoom(id);}
export function logoutPersistent(){chooseTemporary();}
export function isPersistent(){return !!current;}
