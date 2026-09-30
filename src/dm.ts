import {validMembership,validNetwork,parseSignal} from './mesh-wire.ts';
import {ed25519,x25519} from '@noble/curves/ed25519.js';
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,randomBytes,concatBytes} from '@noble/hashes/utils.js';
import {normalizeNickname,HISTORY_WINDOW,validAttachment,roomId,type Identity,type Room,type Message} from './protocol.ts';
const utf8=new TextEncoder(),text=new TextDecoder('utf-8',{fatal:true});
export type Contact={publicKey:string;name?:string};
export type DirectMessage=Message&{recipient:string;dm:1};
export function validatePublicKey(key:string){if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid public key');const point=ed25519.Point.fromBytes(hexToBytes(key));if(point.isSmallOrder()||!point.isTorsionFree())throw Error('Invalid public key');return key;}
export const inboxId=(key:string)=>'inbox1.'+validatePublicKey(key);
export function parseInbox(value:string){return validatePublicKey(value.trim().replace(/^inbox1\./,''));}
// The wire room uses the full signing public key, preserving the Store's 64-hex routing format.
export const inboxRoom=(key:string):Room=>({v:1,key:'',name:'Inbox',pow:0,inbox:validatePublicKey(key)});
export function validateContact(value:Contact):Contact{const publicKey=validatePublicKey(value.publicKey),name=value.name===undefined?'':normalizeNickname(value.name);return {publicKey,...(name?{name}:{})};}
const context=(recipient:string,ephemeral:Uint8Array)=>concatBytes(utf8.encode('soft-room/inbox/v1:'),hexToBytes(recipient),ephemeral);
function encryptionKey(shared:Uint8Array,aad:Uint8Array){return hkdf(sha256,shared,undefined,aad,32);}
// Both identities derive the same private file/mesh context without a handshake.
export function directRoom(identity:Identity,peer:string):Room{
 validatePublicKey(peer);if(peer===identity.publicKey)throw Error('Invalid peer');
 const secret=ed25519.utils.toMontgomerySecret(identity.secret),shared=x25519.getSharedSecret(secret,ed25519.utils.toMontgomery(hexToBytes(peer)));
 try{const context=utf8.encode('soft-room/dm-room/v1:'+ [identity.publicKey,peer].sort().join(':'));return {v:1,key:bytesToHex(hkdf(sha256,shared,undefined,context,32)),name:'DM',pow:0};}finally{secret.fill(0);shared.fill(0);}
}
export type DirectContent=Pick<Message,'kind'|'file'|'mesh'|'channels'>;
function validateContent(m:DirectMessage,pair:()=>string,now:number){
 if(![undefined,'file','heartbeat','mesh'].includes(m.kind)||typeof m.text!=='string'||m.text.length>(m.kind==='mesh'?12000:2000))throw Error('Invalid direct content');
 if(m.kind==='file'||m.kind==='heartbeat'){if(m.text!=='')throw Error('Invalid direct content');}else if(!m.text.trim())throw Error('Invalid direct content');
 if(m.kind==='file'?!validAttachment(m.file):m.file!==undefined)throw Error('Invalid file');
 if(m.kind==='heartbeat'||m.kind==='mesh'){if(now-m.time>=30000||m.time-now>5000)throw Error('Expired direct signaling');}
 const validCreator=(n:{creator:string})=>n.creator===m.sender||n.creator===m.recipient;
 if(m.mesh!==undefined&&(m.kind!=='heartbeat'||m.mesh!==null&&(!validMembership(m.mesh,pair())||!validCreator(m.mesh.network))))throw Error('Invalid membership');
 if(m.channels!==undefined&&(m.kind!=='heartbeat'||!Array.isArray(m.channels)||m.channels.length>4||m.channels.some(n=>!validNetwork(n,pair())||!validCreator(n))))throw Error('Invalid channels');
 if(m.kind==='mesh'&&parseSignal(m.text).to!==m.recipient)throw Error('Invalid signal recipient');
}
export function sealDirect(identity:Identity,recipient:string,body:string,nickname='',content:DirectContent={}){
 validatePublicKey(recipient);
 const message:DirectMessage={v:1,dm:1,recipient,room:recipient,id:bytesToHex(randomBytes(16)),sender:identity.publicKey,nonce:0,time:Date.now(),text:body.trim(),...(nickname?{nickname:normalizeNickname(nickname)}:{}),...content};
 validateContent(message,()=>roomId(directRoom(identity,recipient)),message.time);
 const signed=JSON.stringify(message),plain=utf8.encode(JSON.stringify({body:signed,signature:bytesToHex(ed25519.sign(utf8.encode(signed),identity.secret))}));
 const secret=randomBytes(32),ephemeral=x25519.getPublicKey(secret),aad=context(recipient,ephemeral),shared=x25519.getSharedSecret(secret,ed25519.utils.toMontgomery(hexToBytes(recipient))),key=encryptionKey(shared,aad),iv=randomBytes(24);
 try{const payload=concatBytes(new Uint8Array([1]),ephemeral,iv,xchacha20poly1305(key,iv,aad).encrypt(plain));if(payload.length>16000)throw Error('Payload too large');return {message,payload};}finally{secret.fill(0);shared.fill(0);key.fill(0);}
}
export function openDirect(identity:Identity,payload:Uint8Array,now=Date.now()):DirectMessage{
 if(payload.length<74||payload.length>16000||payload[0]!==1)throw Error('Invalid inbox payload');
 const ephemeral=payload.slice(1,33),aad=context(identity.publicKey,ephemeral),secret=ed25519.utils.toMontgomerySecret(identity.secret);
 let plain:Uint8Array;try{const shared=x25519.getSharedSecret(secret,ephemeral),key=encryptionKey(shared,aad);try{plain=xchacha20poly1305(key,payload.slice(33,57),aad).decrypt(payload.slice(57));}finally{shared.fill(0);key.fill(0);}}finally{secret.fill(0);}
 const envelope=JSON.parse(text.decode(plain));if(typeof envelope.body!=='string'||typeof envelope.signature!=='string'||!/^[a-f0-9]{128}$/.test(envelope.signature))throw Error('Invalid signature');
 const m=JSON.parse(envelope.body) as DirectMessage;
 if(m.v!==1||m.dm!==1||m.recipient!==identity.publicKey||m.room!==identity.publicKey||m.nonce!==0||typeof m.id!=='string'||!/^[a-f0-9]{32}$/.test(m.id)||!Number.isSafeInteger(m.time)||now-m.time>HISTORY_WINDOW||m.time-now>5000)throw Error('Invalid direct message');
 validatePublicKey(m.sender);if(m.nickname!==undefined&&(typeof m.nickname!=='string'||normalizeNickname(m.nickname)!==m.nickname))throw Error('Invalid nickname');
 if(!ed25519.verify(hexToBytes(envelope.signature),utf8.encode(envelope.body),hexToBytes(m.sender)))throw Error('Invalid signature');validateContent(m,()=>roomId(directRoom(identity,m.sender)),now);return m;
}
// Contact lists are encrypted even in temporary session storage. The identity secret stays in the existing identity store.
export function sealContacts(identity:Identity,contacts:Contact[]){const iv=randomBytes(24),key=hkdf(sha256,identity.secret,undefined,utf8.encode('soft-room/contacts/v1'),32);try{return bytesToHex(concatBytes(iv,xchacha20poly1305(key,iv).encrypt(utf8.encode(JSON.stringify(contacts.map(validateContact))))));}finally{key.fill(0);}}
export function openContacts(identity:Identity,value:string):Contact[]{if(value.length>200000)throw Error('Invalid contacts');const bytes=hexToBytes(value),key=hkdf(sha256,identity.secret,undefined,utf8.encode('soft-room/contacts/v1'),32);try{const contacts=JSON.parse(text.decode(xchacha20poly1305(key,bytes.slice(0,24)).decrypt(bytes.slice(24))));if(!Array.isArray(contacts)||contacts.length>100)throw Error('Invalid contacts');return contacts.map(validateContact);}finally{key.fill(0);}}
