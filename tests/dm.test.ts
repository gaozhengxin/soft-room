import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeIdentity,roomId} from '../src/protocol.ts';
import {inboxId,inboxRoom,parseInbox,sealDirect,openDirect,sealContacts,openContacts} from '../src/dm.ts';
import {encodeSession,decodeSession} from '../src/session.ts';
import {PortableStateRepository,generateMasterKey,CONTACT_COLLECTION,encryptState,type RecordStore,type StoredRecord} from '../src/persistent/portable-state.ts';
test('inbox is derivable from a room signing identity; replies go to the sender',()=>{const alice=makeIdentity(),bob=makeIdentity(),mallory=makeIdentity();assert.equal(parseInbox(inboxId(bob.publicKey)),bob.publicKey);assert.equal(roomId(inboxRoom(bob.publicKey)),bob.publicKey);const packet=sealDirect(alice,bob.publicKey,'hello','Alice');assert.deepEqual(openDirect(bob,packet.payload),packet.message);assert.throws(()=>openDirect(mallory,packet.payload));assert.throws(()=>openDirect(alice,packet.payload));const reply=sealDirect(bob,openDirect(bob,packet.payload).sender,'hi');assert.equal(openDirect(alice,reply.payload).text,'hi');assert.notDeepEqual(packet.payload,sealDirect(alice,bob.publicKey,'hello','Alice').payload);});
test('tampering, malformed keys, wrong recipient and expired inbox packets fail closed',()=>{const a=makeIdentity(),b=makeIdentity(),packet=sealDirect(a,b.publicKey,'private');for(const i of [0,1,32,33,56,57,packet.payload.length-1]){const changed=packet.payload.slice();changed[i]^=1;assert.throws(()=>openDirect(b,changed));}assert.throws(()=>parseInbox('inbox1.'+'0'.repeat(64)));assert.throws(()=>openDirect(b,packet.payload,packet.message.time+8*86400000));assert.throws(()=>openDirect(b,packet.payload,packet.message.time-6000));assert.throws(()=>sealDirect(a,b.publicKey,' '));});
test('saved contacts are encrypted in session storage and bound to the identity',()=>{const a=makeIdentity(),b=makeIdentity(),contacts=[{publicKey:b.publicKey,name:'Bob'}];const encrypted=sealContacts(a,contacts);assert.deepEqual(openContacts(a,encrypted),contacts);assert.throws(()=>openContacts(b,encrypted));const raw=encodeSession({identity:a,rooms:[],contacts,language:'en'});assert.ok(!raw.includes(b.publicKey));assert.ok(!raw.includes('Bob'));assert.deepEqual(decodeSession(raw).contacts,contacts);});
class MemoryRecords implements RecordStore{records=new Map<string,StoredRecord>();async get(c:string,k:string){return this.records.get(c+'/'+k)?.value;}async list(c:string){return [...this.records.values()].filter(r=>r.collection===c);}async put(r:StoredRecord){this.records.set(r.collection+'/'+r.rkey,structuredClone(r));}async delete(c:string,k:string){this.records.delete(c+'/'+k);}}
test('archive restores encrypted contacts on a second device without exposing public keys in record IDs',async()=>{const key=await generateMasterKey(),local=new MemoryRecords(),remote=new MemoryRecords(),repo=new PortableStateRepository(key,local,remote),alice=makeIdentity(),bob=makeIdentity();await repo.saveIdentity(alice);await repo.saveContacts([{publicKey:bob.publicKey,name:'Bob'}]);const serialized=JSON.stringify(await remote.list(CONTACT_COLLECTION));assert.ok(!serialized.includes(bob.publicKey));assert.ok(!serialized.includes('Bob'));const restored=new PortableStateRepository(key,new MemoryRecords(),remote);await restored.pull();assert.deepEqual((await restored.restore('en'))?.contacts,[{publicKey:bob.publicKey,name:'Bob'}]);await repo.saveContact({publicKey:bob.publicKey,name:'Robert'});assert.equal((await repo.loadContacts())[0].name,'Robert');assert.equal((await remote.list(CONTACT_COLLECTION)).length,1);});

test('a sender cannot claim another signing identity',()=>{const a=makeIdentity(),b=makeIdentity(),victim=makeIdentity();const forged=sealDirect({...a,publicKey:victim.publicKey},b.publicKey,'forged');assert.throws(()=>openDirect(b,forged.payload));});

test('a damaged local contact list does not rotate the identity',()=>{const identity=makeIdentity(),raw=JSON.parse(encodeSession({identity,rooms:[],language:'en'}));raw.contacts='00';assert.equal(decodeSession(JSON.stringify(raw)).identity.publicKey,identity.publicKey);});

test('contact deletion syncs across devices and stale snapshots cannot resurrect it; explicit re-add works',async()=>{
 const key=await generateMasterKey(),remote=new MemoryRecords(),a=new PortableStateRepository(key,new MemoryRecords(),remote),b=new PortableStateRepository(key,new MemoryRecords(),remote),contact={publicKey:makeIdentity().publicKey,name:'Delete me'};
 await a.saveContacts([contact]);await b.pull();await a.deleteContact(contact.publicKey);await b.saveContacts([contact]);await b.pull();assert.deepEqual(await a.loadContacts(),[]);assert.deepEqual(await b.loadContacts(),[]);assert.deepEqual(await b.deletedContacts(),[contact.publicKey]);assert.ok(!JSON.stringify(await remote.list(CONTACT_COLLECTION)).includes(contact.publicKey));
 await b.saveContacts([contact]);await b.pull();assert.deepEqual(await b.loadContacts(),[]);await b.saveContact(contact);await a.pull();assert.deepEqual(await a.loadContacts(),[contact]);
});
test('offline deletion persists locally, retries after reload, and preserves other contacts',async()=>{
 class OfflineRecords extends MemoryRecords{offline=false;override async put(record:StoredRecord){if(this.offline)throw Error('Offline');await super.put(record);}}
 const key=await generateMasterKey(),remote=new OfflineRecords(),local=new MemoryRecords(),repo=new PortableStateRepository(key,local,remote),a={publicKey:makeIdentity().publicKey,name:'A'},b={publicKey:makeIdentity().publicKey,name:'B'};
 await repo.saveContacts([a,b]);remote.offline=true;await assert.rejects(repo.deleteContact(a.publicKey),/Offline/);assert.deepEqual(await repo.loadContacts(),[b]);remote.offline=false;const reopened=new PortableStateRepository(key,local,remote);await reopened.pull();const fresh=new PortableStateRepository(key,new MemoryRecords(),remote);await fresh.pull();assert.deepEqual(await fresh.loadContacts(),[b]);assert.deepEqual(await fresh.deletedContacts(),[a.publicKey]);
});

test('legacy contact timestamps cannot override an authenticated deletion',async()=>{const key=await generateMasterKey(),local=new MemoryRecords(),remote=new MemoryRecords(),repo=new PortableStateRepository(key,local,remote),contact={publicKey:makeIdentity().publicKey,name:'Legacy'},rkey='legacy';const value=await encryptState(key,CONTACT_COLLECTION,rkey,contact);await remote.put({collection:CONTACT_COLLECTION,rkey,value});await repo.pull();await repo.deleteContact(contact.publicKey);await remote.put({collection:CONTACT_COLLECTION,rkey,value:{...value,updatedAt:'9999-01-01T00:00:00.000Z'}});await repo.pull();assert.deepEqual(await repo.loadContacts(),[]);});

test('DM file keys and mesh context are shared by exactly the two identities',async()=>{
 const {directRoom}=await import('../src/dm.ts'),{seal,open}=await import('../src/protocol.ts');
 const a=makeIdentity(),b=makeIdentity(),c=makeIdentity(),ab=directRoom(a,b.publicKey),ba=directRoom(b,a.publicKey);
 assert.deepEqual(ab,ba);assert.notEqual(ab.key,directRoom(a,c.publicKey).key);assert.notEqual(ab.key,directRoom(c,b.publicKey).key);
 const packet=seal(ab,a,0,'shared attachment context');assert.equal(open(ba,packet.payload).text,'shared attachment context');assert.throws(()=>open(directRoom(c,b.publicKey),packet.payload));
});
test('DM supports authenticated file references, presence and two-person channel signaling',async()=>{
 const {directRoom}=await import('../src/dm.ts'),{createNetwork,randomId}=await import('../src/mesh-wire.ts');
 const a=makeIdentity(),b=makeIdentity(),outsider=makeIdentity(),pair=roomId(directRoom(a,b.publicKey));
 const file={v:1 as const,name:'photo.png',mime:'image/png',bytes:8,media:'image' as const,quality:'original' as const,original:{id:'a'.repeat(24),size:49,storage:'logos' as const,cipherSha256:'b'.repeat(64)}};
 const attachment=sealDirect(a,b.publicKey,'','Alice',{kind:'file',file});assert.deepEqual(openDirect(b,attachment.payload).file,file);
 assert.throws(()=>sealDirect(a,b.publicKey,'text','',{kind:'file',file}));assert.throws(()=>sealDirect(a,b.publicKey,'text','',{file}));
 for(const mode of ['voice','video','walkie'] as const){
  const network=createNetwork(pair,a,'Two people',mode),membership={network,instance:randomId()};
  const presence=sealDirect(a,b.publicKey,'','Alice',{kind:'heartbeat',mesh:membership,channels:[network]});assert.deepEqual(openDirect(b,presence.payload).mesh,membership);assert.throws(()=>openDirect(b,presence.payload,presence.message.time+30000));
  const signal={network:network.id,to:b.publicKey,fromInstance:membership.instance,toInstance:randomId(),connection:randomId(),type:'offer' as const,sdp:'v=0\r\na=fingerprint:sha-256 test\r\n'};
  const packet=sealDirect(a,b.publicKey,JSON.stringify(signal),'',{kind:'mesh'});assert.equal(openDirect(b,packet.payload).kind,'mesh');assert.throws(()=>openDirect(b,packet.payload,packet.message.time+30000));
  assert.throws(()=>sealDirect(a,b.publicKey,JSON.stringify({...signal,to:outsider.publicKey}),'',{kind:'mesh'}));
 }
 assert.throws(()=>sealDirect(a,b.publicKey,'','',{kind:'heartbeat',channels:[createNetwork(pair,outsider,'Impostor')]}));
 assert.throws(()=>sealDirect(a,b.publicKey,'','',{kind:'heartbeat',channels:[createNetwork('0'.repeat(64),a,'Wrong pair')]}));
});
