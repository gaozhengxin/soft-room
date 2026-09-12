import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes,randomBytes} from '@noble/hashes/utils.js';
export type ChannelMode='voice'|'video'|'walkie';
export type Network={v:1|2|3;enabled?:boolean;revision?:number;mode?:ChannelMode;id:string;room:string;creator:string;name:string;signature:string};
export type Membership={network:Network;instance:string};
export type MeshSignal={network:string;to:string;fromInstance:string;toInstance:string;connection:string;type:'offer'|'answer';sdp:string};
const key=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
export const randomId=()=>bytesToHex(randomBytes(16));
export const channelMode=(n:Network):ChannelMode=>n.mode||'voice';
const commitment=(n:Network)=>new TextEncoder().encode(JSON.stringify(n.v===1?['soft-room/mesh/v1',n.id,n.room,n.creator,n.name]:n.v===2?['soft-room/channel/v2',n.id,n.room,n.creator,n.name,n.mode]:['soft-room/channel/v3',n.id,n.room,n.creator,n.name,n.mode,n.enabled,n.revision]));
export function createNetwork(room:string,identity:{secret:Uint8Array;publicKey:string},name:string,mode:ChannelMode='voice'):Network{
 name=name.trim();if(!name||name.length>32||/[\u0000-\u001f\u007f]/.test(name))throw Error('Invalid network name');
 if(!['voice','video','walkie'].includes(mode))throw Error('Invalid channel mode');
 const n:Network={v:3,enabled:true,revision:0,mode,id:randomId(),room,creator:identity.publicKey,name,signature:''};n.signature=bytesToHex(ed25519.sign(commitment(n),identity.secret));return n;
}
export const channelEnabled=(n:Network)=>n.v!==3||n.enabled===true;
export function setNetworkEnabled(n:Network,identity:{secret:Uint8Array;publicKey:string},enabled:boolean):Network{
 if(n.creator!==identity.publicKey)throw Error('Only the creator can change channel status');
 const next:Network={...n,v:3,mode:channelMode(n),enabled,revision:(n.revision??0)+1};
 next.signature=bytesToHex(ed25519.sign(commitment(next),identity.secret));return next;
}
export function validNetwork(value:unknown,room:string):value is Network{
 try{const n=value as Network;return (n.v===1?n.mode===undefined:(n.v===2||n.v===3)&&['voice','video','walkie'].includes(n.mode!))&&(n.v===3?(typeof n.enabled==='boolean'&&Number.isSafeInteger(n.revision)&&n.revision!>=0):(n.enabled===undefined&&n.revision===undefined))&&id(n.id)&&n.room===room&&key(n.creator)&&typeof n.name==='string'&&n.name.length>0&&n.name.length<=32&&n.name.trim()===n.name&&!/[\u0000-\u001f\u007f]/.test(n.name)&&/^[a-f0-9]{128}$/.test(n.signature)&&ed25519.verify(hexToBytes(n.signature),commitment(n),hexToBytes(n.creator));}catch{return false;}
}
export function validMembership(value:unknown,room:string):value is Membership{
 try{const m=value as Membership;return id(m.instance)&&validNetwork(m.network,room);}catch{return false;}
}
export function parseSignal(text:string):MeshSignal{
 const s=JSON.parse(text) as MeshSignal;
 if(!s||!id(s.network)||!key(s.to)||!id(s.fromInstance)||!id(s.toInstance)||!id(s.connection)||!['offer','answer'].includes(s.type)||typeof s.sdp!=='string'||s.sdp.length>10000||!s.sdp.startsWith('v=0\r\n')||!s.sdp.includes('a=fingerprint:sha-256 '))throw Error('Invalid mesh signal');return s;
}
