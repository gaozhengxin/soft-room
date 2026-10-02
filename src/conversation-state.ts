import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,randomBytes,concatBytes} from '@noble/hashes/utils.js';
import type {Identity,Message} from './protocol.ts';
import {validNetwork,type Network} from './mesh-wire.ts';
export type ReadingPosition={id:string;sender:string;time:number;offset:number;updatedAt:number};
export type ConversationState={id:string;since:number|null;hidden:string[];blocked:string[];rulesAt:number;position?:ReadingPosition;seen:string[];readAt:number;channels:Network[]};
const hex64=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const hex32=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
export function emptyConversation(id:string):ConversationState{return {id,since:null,hidden:[],blocked:[],rulesAt:0,seen:[],readAt:0,channels:[]};}
export function validateConversation(value:ConversationState):ConversationState{
 if(!value||!/^((room|dm):)[a-f0-9]{64}$/.test(value.id)||value.since!==null&&(!Number.isSafeInteger(value.since)||value.since<0)||![value.rulesAt,value.readAt].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Invalid conversation state');
 for(const [list,max,test] of [[value.hidden,256,hex32],[value.blocked,64,hex64],[value.seen,512,hex32]] as const)if(!Array.isArray(list)||list.length>max||list.some(v=>!test(v)))throw Error('Invalid filters');
 const p=value.position;if(p&&(!hex32(p.id)||!hex64(p.sender)||!Number.isSafeInteger(p.time)||!Number.isSafeInteger(p.updatedAt)||!Number.isFinite(p.offset)||Math.abs(p.offset)>100000))throw Error('Invalid reading position');
 if(!Array.isArray(value.channels)||value.channels.length>64||value.channels.some(n=>!validNetwork(n,n.room)))throw Error('Invalid channel state');
 return structuredClone(value);
}
export function mergeConversation(a:ConversationState,b:ConversationState):ConversationState{
 if(a.id!==b.id)throw Error('Mismatched conversation');
 const rules=a.rulesAt>=b.rulesAt?a:b,read=a.readAt>=b.readAt?a:b,position=(a.position?.updatedAt??0)>=(b.position?.updatedAt??0)?a.position:b.position;
 const channels=new Map<string,Network>();for(const n of [...a.channels,...b.channels])if(!channels.has(n.id)||(channels.get(n.id)!.revision??0)<(n.revision??0))channels.set(n.id,n);
 return {...rules,position,readAt:read.readAt,seen:read.seen,channels:[...channels.values()].slice(-64)};
}
export function mergeConversations(a:ConversationState[],b:ConversationState[]){const out=new Map(a.map(s=>[s.id,s]));for(const state of b)out.set(state.id,out.has(state.id)?mergeConversation(out.get(state.id)!,state):state);return [...out.values()];}
export function visibleMessage(m:Message,s:ConversationState){return (s.since===null||m.time>=s.since)&&!s.hidden.includes(m.id)&&!s.blocked.includes(m.sender);}
export const compareMessages=(a:Pick<Message,'time'|'sender'|'id'>,b:Pick<Message,'time'|'sender'|'id'>)=>a.time-b.time||a.sender.localeCompare(b.sender)||a.id.localeCompare(b.id);
export function nearestMessage(messages:Message[],position:ReadingPosition){return messages.find(m=>m.id===position.id&&m.sender===position.sender)||messages.find(m=>compareMessages(m,position)>=0)||messages.at(-1);}
export function searchMessages(messages:Message[],channels:Network[],query:string,state:ConversationState){const q=query.trim().toLocaleLowerCase();return {messages:messages.filter(m=>visibleMessage(m,state)&&(!q||[m.text,m.file?.name].some(s=>s?.toLocaleLowerCase().includes(q)))),channels:channels.filter(n=>!state.blocked.includes(n.creator)&&n.name.toLocaleLowerCase().includes(q))};}
const domain=new TextEncoder().encode('soft-room/conversation-state/v1');
export function sealConversations(identity:Identity,states:ConversationState[]){const key=hkdf(sha256,identity.secret,undefined,domain,32),iv=randomBytes(24);try{return bytesToHex(concatBytes(iv,xchacha20poly1305(key,iv).encrypt(new TextEncoder().encode(JSON.stringify(states.map(validateConversation))))));}finally{key.fill(0);}}
export function openConversations(identity:Identity,raw:string):ConversationState[]{if(raw.length>16000000)throw Error('State too large');const key=hkdf(sha256,identity.secret,undefined,domain,32),bytes=hexToBytes(raw);try{const states=JSON.parse(new TextDecoder().decode(xchacha20poly1305(key,bytes.slice(0,24)).decrypt(bytes.slice(24))));if(!Array.isArray(states)||states.length>400)throw Error('Invalid states');return states.map(validateConversation);}finally{key.fill(0);}}
// One transport scan serves all logical DMs. Visible conversations move to the back.
export class BackgroundQueue{
 private pending:string[]=[];
 reconcile(ids:string[]){const wanted=new Set(ids);this.pending=this.pending.filter(id=>wanted.has(id));for(const id of ids)if(!this.pending.includes(id))this.pending.push(id);}
 defer(id:string){this.pending=this.pending.filter(x=>x!==id);this.pending.push(id);}
 next(active?:string){const id=this.pending.find(x=>x!==active);if(id)this.defer(id);return id;}
}

export function nextRulesTime(state:ConversationState,now=Date.now()){return Math.max(now,state.rulesAt+1);}
