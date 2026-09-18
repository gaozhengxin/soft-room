import {validNetwork,type Network,validMembership,parseSignal,type Membership} from './mesh-wire.ts';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
const utf8 = new TextEncoder();
const text = new TextDecoder('utf-8', { fatal: true });
export type Room = { v: 1 | 2; key: string; seed?: string; name: string; pow: 0 | 16 | 20 | 1000 };
export type Identity = { secret: Uint8Array; publicKey: string };
export type AttachmentRef={id:string;size:number;storage?:'logos';cipherSha256?:string};
export type Attachment={v:1;name:string;mime:string;bytes:number;media:'image'|'video'|'audio'|'pdf'|'markdown'|'file';quality:'original'|'balanced'|'compact';original:AttachmentRef;preview?:(AttachmentRef&{mime:string})};
export type Message = { v: 1; room: string; id: string; sender: string; nonce: number; kind?: 'heartbeat'|'mesh'|'file'; file?:Attachment;mesh?:Membership|null;channels?:Network[]; epoch?: number; time: number; text: string; nickname?: string };
export const makeIdentity = (): Identity => { const secret = randomBytes(32); return { secret, publicKey: bytesToHex(ed25519.getPublicKey(secret)) }; };
export const shortName = (key: string) => `旅人 ${key.slice(0, 8)}`;
export function makeRoom(name: string, pow: boolean): Room { return { v: pow ? 2 : 1, key: pow ? '' : bytesToHex(randomBytes(32)), ...(pow ? {seed:bytesToHex(randomBytes(32))} : {}), name: name.trim().slice(0, 32) || '随便聊聊', pow: pow ? 20 : 0 }; }
const base64 = (s: string) => btoa(String.fromCharCode(...utf8.encode(s))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export function invite(room: Room): string { return room.v===2 ? 'sr2.'+base64(JSON.stringify({v:2,seed:room.seed,name:room.name,pow:room.pow})) : 'sr1.' + base64(JSON.stringify(room)); }
export function parseInvite(value: string): Room {
  let code = value.trim();
  if (code.includes('#')) code = code.slice(code.indexOf('#') + 1);
  if ((!code.startsWith('sr1.') && !code.startsWith('sr2.')) || code.length > 1024) throw Error('邀请码格式不对，请粘贴完整的邀请码或邀请链接。');
  try {
    const raw = code.slice(4).replaceAll('-', '+').replaceAll('_', '/');
    const room = JSON.parse(text.decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0))));
    if(code.startsWith('sr2.')) {
      if(room.v!==2 || room.pow!==20 || !/^[a-f0-9]{64}$/.test(room.seed) || typeof room.name!=='string' || !room.name.trim() || room.name.length>32 || 'key' in room)throw Error();
      return {v:2,seed:room.seed,key:'',name:room.name,pow:20};
    }
    if (room.v !== 1 || !/^[a-f0-9]{64}$/.test(room.key) || typeof room.name !== 'string' || !room.name.trim() || room.name.length > 32 || ![0,16,20,1000].includes(room.pow)) throw Error();
    return {v:1, key:room.key, name:room.name, pow:room.pow};
  } catch { throw Error('邀请码无效或不完整。'); }
}
// Commitment binds the secret, room name and work requirement. Lowering PoW creates a different room.
export const roomId = (r: Room) => bytesToHex(sha256(utf8.encode(JSON.stringify(r.v===2?['soft-room/v2',r.seed,r.name,r.pow]:['soft-room/v1', r.key, r.name, r.pow]))));
export const topic = (r: Room) => `/soft-room/1/${roomId(r)}/json`;
// 48-bit target gives 1000.000069x the legacy 16-bit difficulty (integer rounding only).
export const STRONG_TARGET = Math.floor(2 ** 48 / (65536 * 1000));
export const ROOM_TARGET = STRONG_TARGET * 50; // Exactly 1/50 of the previous expected work.
export const expectedAttempts = (pow: Room['pow']) => pow === 20 ? 2 ** 48 / ROOM_TARGET : pow === 1000 ? 2 ** 48 / STRONG_TARGET : pow === 16 ? 65536 : 1;
export const READ_ROUNDS=1_000_000;
export const WRITE_TARGET=Math.floor(2**48/1_000_000);
export const dayEpoch=(now=Date.now())=>Math.floor(now/86_400_000);
export function deriveReadKey(seed:string,progress?:(attempts:number)=>void):string {
 if(!/^[a-f0-9]{64}$/.test(seed))throw Error('Invalid seed');
 let value=hexToBytes(seed);
 for(let n=1;n<=READ_ROUNDS;n++){value=sha256(value);if(n%4096===0)progress?.(n);}
 return bytesToHex(value);
}
export const workPrefix = (r: Room, sender: string, epoch=dayEpoch()) => r.v===2?`soft-room/write/v2:${roomId(r)}:${sender}:${epoch}:`:`soft-room/pow/v1:${roomId(r)}:${sender}:`;
function writeMeetsTarget(hash:Uint8Array,r:Room):boolean {
 if(r.v!==2)return meetsTarget(hash,r.pow);
 let value=0;for(let i=0;i<6;i++)value=value*256+hash[i];return value<WRITE_TARGET;
}
export function meetsTarget(hash: Uint8Array, pow: Room['pow']): boolean {
  if (pow === 0) return true;
  if (pow === 16) return hash[0] === 0 && hash[1] === 0;
  const value = hash[0] * 2 ** 40 + hash[1] * 2 ** 32 + hash[2] * 2 ** 24 + hash[3] * 2 ** 16 + hash[4] * 256 + hash[5];
  return value < (pow === 20 ? ROOM_TARGET : STRONG_TARGET);
}
export function validWork(r: Room, sender: string, nonce: number, epoch=dayEpoch()): boolean {
  if (!Number.isSafeInteger(nonce) || nonce < 0) return false;
  if (!r.pow) return nonce === 0;
  if(r.v===2 && (!Number.isSafeInteger(epoch)||epoch<0))return false;
  return writeMeetsTarget(sha256(utf8.encode(workPrefix(r, sender, epoch) + nonce)), r);
}
export function workChecker(r: Room, sender: string, epoch=dayEpoch()): (nonce: number) => boolean {
  // Pre-hash the invariant prefix; this is byte-for-byte the same hash as validWork.
  const prefix = sha256.create().update(utf8.encode(workPrefix(r, sender, epoch)));
  return nonce => writeMeetsTarget(prefix.clone().update(utf8.encode(String(nonce))).digest(), r);
}
export async function solveWork(r: Room, sender: string, signal?: AbortSignal): Promise<number> {
  const check = workChecker(r, sender);
  for (let nonce = 0; ; nonce++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!r.pow || check(nonce)) return nonce;
    if (nonce % 2000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
}
export function normalizeNickname(value:string):string {
  const name=value.trim();
  if(name.length>24 || /[\u0000-\u001f\u007f]/.test(name))throw Error('Invalid nickname');
  return name;
}
export function validAttachment(file:unknown):file is Attachment{const f=file as Attachment,ref=(value:unknown)=>{const r=value as AttachmentRef;if(!r||!Number.isSafeInteger(r.size)||r.size<=0)return false;const legacy=r.size<=200*1024*1024&&/^[a-f0-9]{64}$/.test(r.id)&&r.storage===undefined&&r.cipherSha256===undefined,logos=r.size<=64*1024*1024&&/^[A-Za-z0-9]{20,200}$/.test(r.id)&&r.storage==='logos'&&typeof r.cipherSha256==='string'&&/^[a-f0-9]{64}$/.test(r.cipherSha256);return legacy||logos;};return !!f&&f.v===1&&typeof f.name==='string'&&!!f.name&&f.name.length<=160&&!/[\u0000-\u001f\u007f]/.test(f.name)&&typeof f.mime==='string'&&f.mime.length<=100&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=190*1024*1024&&['image','video','audio','pdf','markdown','file'].includes(f.media)&&['original','balanced','compact'].includes(f.quality)&&ref(f.original)&&(!f.preview||(ref(f.preview)&&typeof f.preview.mime==='string'&&f.preview.mime.length<=100));}
export function seal(r: Room, identity: Identity, nonce: number, body: string, nickname = '', epoch=dayEpoch(),kind?:'heartbeat'|'mesh'|'file',mesh?:Membership|null,channels?:Network[],file?:Attachment): { message: Message; payload: Uint8Array } {
  if ((kind!=='heartbeat'&&kind!=='file'&&!body.trim()) || body.length > (kind==='mesh'?12000:2000)||kind==='file'&&(!validAttachment(file)||body!=='')) throw Error('消息内容无效。');
  const message: Message = {v:1,room:roomId(r),id:bytesToHex(randomBytes(16)),sender:identity.publicKey,nonce,time:Date.now(),text:kind==='heartbeat'?'':body.trim(),...(kind?{kind}:{})};
  if(r.v===2){if(epoch!==dayEpoch() || !validWork(r,identity.publicKey,nonce,epoch))throw Error('Invalid work');message.epoch=epoch;}
  if(mesh!==undefined){if(kind!=='heartbeat'||(mesh!==null&&!validMembership(mesh,roomId(r))))throw Error('Invalid membership');message.mesh=mesh;}
  if(channels!==undefined){if(kind!=='heartbeat'||channels.length>4||channels.some(n=>!validNetwork(n,roomId(r))))throw Error('Invalid channels');message.channels=channels;}
  if(kind==='mesh')parseSignal(body.trim());
  if(kind==='file')message.file=file;
  const name=normalizeNickname(nickname);if(name)message.nickname=name;
  const signed = JSON.stringify(message);
  const plaintext = utf8.encode(JSON.stringify({body:signed,signature:bytesToHex(ed25519.sign(utf8.encode(signed),identity.secret))}));
  const iv = randomBytes(24);
  const ciphertext = xchacha20poly1305(hexToBytes(r.key),iv,utf8.encode(topic(r))).encrypt(plaintext);
  const payload = new Uint8Array(iv.length+ciphertext.length); payload.set(iv); payload.set(ciphertext,24);
  if(payload.length>16000)throw Error('Payload too large');
  return {message,payload};
}
export const HISTORY_WINDOW=7*86_400_000;
export function openHistory(r:Room,payload:Uint8Array,now=Date.now()){return decodeMessage(r,payload,now,true);}
export function open(r:Room,payload:Uint8Array,now=Date.now()){return decodeMessage(r,payload,now,false);}
function decodeMessage(r: Room, payload: Uint8Array, now: number, historical:boolean): Message {
  if (payload.length < 40 || payload.length > 16000) throw Error('Invalid payload');
  const plain = xchacha20poly1305(hexToBytes(r.key),payload.slice(0,24),utf8.encode(topic(r))).decrypt(payload.slice(24));
  const envelope = JSON.parse(text.decode(plain));
  if (typeof envelope.body !== 'string' || !/^[a-f0-9]{128}$/.test(envelope.signature)) throw Error('Invalid envelope');
  const m = JSON.parse(envelope.body) as Message;
  if (m.v !== 1 || m.room !== roomId(r) || !/^[a-f0-9]{32}$/.test(m.id) || !/^[a-f0-9]{64}$/.test(m.sender) || typeof m.text !== 'string' || (m.kind!=='heartbeat'&&m.kind!=='file'&&!m.text.trim()) || m.text.length > (m.kind==='mesh'?12000:2000) || !Number.isSafeInteger(m.time) || (historical ? now-m.time>HISTORY_WINDOW || m.time-now>5000 || ![undefined,'file'].includes(m.kind) : Math.abs(now-m.time)>300000)) throw Error('Invalid message');
  if(m.kind!==undefined&&m.kind!=='heartbeat'&&m.kind!=='mesh'&&m.kind!=='file')throw Error('Invalid kind');
  if(m.kind==='file'&&(m.text!==''||!validAttachment(m.file)))throw Error('Invalid file');
  if(m.kind!=='file'&&m.file!==undefined)throw Error('Invalid file');
  if(m.kind==='heartbeat'&&(m.text!==''||now-m.time>=30000||m.time-now>5000))throw Error('Invalid heartbeat');
  if(m.mesh!==undefined&&(m.kind!=='heartbeat'||(m.mesh!==null&&!validMembership(m.mesh,m.room))))throw Error('Invalid membership');
  if(m.channels!==undefined&&(m.kind!=='heartbeat'||!Array.isArray(m.channels)||m.channels.length>4||m.channels.some(n=>!validNetwork(n,m.room))))throw Error('Invalid channels');
  if(m.kind==='mesh'){if(now-m.time>=30000||m.time-now>5000)throw Error('Expired mesh signal');parseSignal(m.text);}
  if(m.nickname!==undefined && (typeof m.nickname!=='string'||!m.nickname||normalizeNickname(m.nickname)!==m.nickname))throw Error('Invalid nickname');
  if (!ed25519.verify(hexToBytes(envelope.signature),utf8.encode(envelope.body),hexToBytes(m.sender))) throw Error('Invalid signature');
  if(r.v===2 && ((!historical && m.epoch!==dayEpoch(now)) || m.epoch!==dayEpoch(m.time)))throw Error('Expired epoch');
  if (!validWork(r,m.sender,m.nonce,m.epoch)) throw Error('Invalid work');
  return m;
}
