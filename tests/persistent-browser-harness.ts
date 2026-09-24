import {makeIdentity,makeRoom} from '../src/protocol.ts';
import {IndexedDbMasterKeys,IndexedDbRecordStore,openPrivateDatabase} from '../src/persistent/indexed-db.ts';
import {generateMasterKey,PortableStateRepository} from '../src/persistent/portable-state.ts';

declare global {var persistentStorageCheck:()=>Promise<{sameIdentity:boolean;roomKey:string;extractable:boolean;accountSessionRoundTrip:boolean;profileCleared:boolean}>;}
globalThis.persistentStorageCheck=async()=>{
 const db=await openPrivateDatabase(),profile=`browser-${crypto.randomUUID()}`,keys=new IndexedDbMasterKeys(db),key=await generateMasterKey();await keys.put(profile,key);const restoredKey=await keys.get(profile);if(!restoredKey)throw Error('MasterKey missing');
 const repository=new PortableStateRepository(restoredKey,new IndexedDbRecordStore(db,profile)),identity=makeIdentity(),room=makeRoom('browser storage',false);await repository.saveIdentity(identity);await repository.saveRoom({room,created:true});
 const accountSession={did:profile,handle:'alice.test',accessJwt:'private-access-token',refreshJwt:'private-refresh-token',active:true};await keys.putAccountSession(profile,restoredKey,accountSession);const restoredSession=await keys.getAccountSession(profile,restoredKey);
 let extractable=true;try{await crypto.subtle.exportKey('raw',restoredKey);}catch{extractable=false;}
 const sameIdentity=(await repository.loadIdentity())?.publicKey===identity.publicKey,roomKey=(await repository.loadRooms())[0].room.key,accountSessionRoundTrip=restoredSession?.refreshJwt===accountSession.refreshJwt,records=new IndexedDbRecordStore(db,profile);await keys.deleteProfile(profile);await records.deleteAll();const profileCleared=!await keys.get(profile)&&!await keys.getAccountSession(profile,restoredKey)&&(await records.list('uk.wakukusmartrecipe.soft.identity')).length===0&&(await records.list('uk.wakukusmartrecipe.soft.room')).length===0;
 return {sameIdentity,roomKey,extractable,accountSessionRoundTrip,profileCleared};
};
