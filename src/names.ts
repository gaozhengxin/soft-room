import type {Message} from './protocol.ts';
export type ChatEntry=Message & {nameChange?:{from?:string;to?:string}};
export function effectiveName(globalName?:string,roomNickname?:string){return roomNickname||globalName||undefined;}
// Call only after decrypting, authenticating and deduplicating the message.
export function trackName(history:ChatEntry[],message:Message):ChatEntry {
 const previous=history.filter(item=>item.sender===message.sender).reduce<ChatEntry|undefined>((latest,item)=>!latest||item.time>=latest.time?item:latest,undefined);
 const entry:ChatEntry={...message};
 if(previous&&message.time>=previous.time&&previous.nickname!==message.nickname)entry.nameChange={from:previous.nickname,to:message.nickname};
 return entry;
}
