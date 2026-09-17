import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {makeIdentity,makeRoom,roomId,type Room} from '../src/protocol.ts';
import type {SavedRoom} from '../src/session.ts';
import {decryptState,encryptState,generateMasterKey,IDENTITY_COLLECTION,IDENTITY_RKEY,PortableStateRepository,ROOM_COLLECTION,type EncryptedRecord,type RecordStore,type StoredRecord} from '../src/persistent/portable-state.ts';

if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
class MemoryStore implements RecordStore {
 records=new Map<string,StoredRecord>();
 key(collection:string,rkey:string){return `${collection}/${rkey}`;}
 async get(collection:string,rkey:string){return this.records.get(this.key(collection,rkey))?.value;}
 async list(collection:string){return [...this.records.values()].filter(item=>item.collection===collection);}
 async put(record:StoredRecord){this.records.set(this.key(record.collection,record.rkey),structuredClone(record));}
 async delete(collection:string,rkey:string){this.records.delete(this.key(collection,rkey));}
}
class FailingRemote extends MemoryStore {override async put(_record:StoredRecord):Promise<void>{throw Error('PDS unavailable');}}
const saved=(name:string,keyByte:string):SavedRoom=>({room:{...makeRoom(name,false),key:keyByte.repeat(64)} as Room,created:false,nickname:name});

test('persistent identity restores the same Waku public key and temporary generation remains independent',async()=>{
 const key=await generateMasterKey(),store=new MemoryStore(),repo=new PortableStateRepository(key,store),identity=makeIdentity();await repo.saveIdentity(identity);
 assert.equal((await repo.loadIdentity())?.publicKey,identity.publicKey);assert.notEqual(makeIdentity().publicKey,identity.publicKey);await assert.rejects(crypto.subtle.exportKey('raw',key));
});
test('serialized PDS records never contain Waku private keys, room keys or invite capabilities in plaintext',async()=>{
 const key=await generateMasterKey(),store=new MemoryStore(),repo=new PortableStateRepository(key,store),identity=makeIdentity(),room=saved('secret room','a');await repo.saveIdentity(identity);await repo.saveRoom(room);
 const serialized=JSON.stringify([...store.records.values()]);assert.equal(serialized.includes(Buffer.from(identity.secret).toString('hex')),false);assert.equal(serialized.includes(room.room.key),false);assert.equal(serialized.includes(roomId(room.room)),false);
});
test('independent and concurrent room updates preserve both records',async()=>{
 const key=await generateMasterKey(),remote=new MemoryStore(),a=new PortableStateRepository(key,new MemoryStore(),remote),b=new PortableStateRepository(key,new MemoryStore(),remote),roomA=saved('A','a'),roomB=saved('B','b');await Promise.all([a.saveRoom(roomA),b.saveRoom(roomB)]);
 const restored=new PortableStateRepository(key,new MemoryStore(),remote);await restored.pull();assert.deepEqual(new Set((await restored.loadRooms()).map(item=>item.room.name)),new Set(['A','B']));assert.equal((await remote.list(ROOM_COLLECTION)).length,2);
});
test('deleting one persisted room leaves unrelated rooms intact',async()=>{
 const key=await generateMasterKey(),store=new MemoryStore(),repo=new PortableStateRepository(key,store),roomA=saved('A','a'),roomB=saved('B','b');await repo.saveRoom(roomA);await repo.saveRoom(roomB);await repo.deleteRoom(roomId(roomA.room));
 assert.deepEqual((await repo.loadRooms()).map(item=>item.room.name),['B']);
});
test('tampered ciphertext and unsupported envelope versions fail clearly',async()=>{
 const key=await generateMasterKey(),record=await encryptState(key,IDENTITY_COLLECTION,IDENTITY_RKEY,{version:1,wakuPrivateKey:'1'.repeat(64)}),tampered={...record,ciphertext:record.ciphertext.slice(0,-1)+(record.ciphertext.endsWith('A')?'B':'A')};
 await assert.rejects(decryptState(key,IDENTITY_COLLECTION,IDENTITY_RKEY,tampered),/authenticated/);
 await assert.rejects(decryptState(key,IDENTITY_COLLECTION,IDENTITY_RKEY,{...record,version:2} as unknown as EncryptedRecord),/Unsupported/);
});
test('unsupported decrypted state versions fail clearly',async()=>{
 const key=await generateMasterKey(),store=new MemoryStore(),value=await encryptState(key,IDENTITY_COLLECTION,IDENTITY_RKEY,{version:2,wakuPrivateKey:'1'.repeat(64)});await store.put({collection:IDENTITY_COLLECTION,rkey:IDENTITY_RKEY,value});await assert.rejects(new PortableStateRepository(key,store).loadIdentity(),/Unsupported identity state version/);
});
test('PDS failure cannot corrupt the local Waku identity',async()=>{
 const key=await generateMasterKey(),local=new MemoryStore(),repo=new PortableStateRepository(key,local,new FailingRemote()),identity=makeIdentity();await assert.rejects(repo.saveIdentity(identity),/PDS unavailable/);
 assert.equal((await repo.loadIdentity())?.publicKey,identity.publicKey);
});
test('tampered remote state is rejected before it can replace a valid local identity',async()=>{
 const key=await generateMasterKey(),local=new MemoryStore(),remote=new MemoryStore(),identity=makeIdentity(),repo=new PortableStateRepository(key,local);await repo.saveIdentity(identity);const valid=await local.get(IDENTITY_COLLECTION,IDENTITY_RKEY);assert.ok(valid);await remote.put({collection:IDENTITY_COLLECTION,rkey:IDENTITY_RKEY,value:{...valid,ciphertext:valid.ciphertext.slice(0,-1)+(valid.ciphertext.endsWith('A')?'B':'A')}});repo.setRemote(remote);await assert.rejects(repo.pull(),/authenticated/);assert.equal((await repo.loadIdentity())?.publicKey,identity.publicKey);
});
test('detaching an expired account session never deletes local cryptographic state',async()=>{
 const key=await generateMasterKey(),local=new MemoryStore(),remote=new MemoryStore(),repo=new PortableStateRepository(key,local,remote),identity=makeIdentity();await repo.saveIdentity(identity);repo.setRemote(undefined);
 assert.equal((await repo.loadIdentity())?.publicKey,identity.publicKey);assert.ok(await local.get(IDENTITY_COLLECTION,IDENTITY_RKEY));
});
