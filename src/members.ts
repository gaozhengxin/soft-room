import type {Message} from './protocol.ts';
import type {ChatEntry} from './names.ts';
export const HEARTBEAT_INTERVAL=5000;
export const OFFLINE_AFTER=30000;
export type Member={publicKey:string;name?:string;nameTime:number;heartbeatTime?:number};
export function online(member:Member,now=Date.now()){return member.heartbeatTime!==undefined&&now-member.heartbeatTime<OFFLINE_AFTER;}
// Input must have passed signature, room, epoch/PoW checks and packet deduplication.
export function observeMember(members:Map<string,Member>,message:Message,now=Date.now()):ChatEntry {
 const old=members.get(message.sender),entry:ChatEntry={...message};
 const member:Member=old?{...old}:{publicKey:message.sender,name:message.nickname,nameTime:message.time};
 if(old&&message.time>=old.nameTime){
  if(old.name!==message.nickname)entry.nameChange={from:old.name,to:message.nickname};
  member.name=message.nickname;member.nameTime=message.time;
 }
 if(message.kind==='heartbeat'&&now-message.time<OFFLINE_AFTER&&message.time-now<=5000){
  member.heartbeatTime=Math.max(member.heartbeatTime??-Infinity,Math.min(message.time,now));
 }
 members.set(message.sender,member);return entry;
}
