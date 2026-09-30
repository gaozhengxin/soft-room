import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import type {Identity} from './protocol.ts';

const prefix='profile=';
const utf8=new TextEncoder();
function profileBody(publicKey:string,name:string){return JSON.stringify({type:'soft-room-profile',version:1,publicKey,name});}
function validName(name:unknown):name is string{return typeof name==='string'&&name.trim().length>0&&name.length<=100&&!/[\u0000-\u001f\u007f]/.test(name);}
export function encodePublicProfile(identity:Identity,name:string){
 if(!validName(name))throw Error('Invalid profile name');
 const signature=bytesToHex(ed25519.sign(utf8.encode(profileBody(identity.publicKey,name)),identity.secret));
 return prefix+encodeURIComponent(JSON.stringify({publicKey:identity.publicKey,name,signature}));
}
export function parsePublicProfile(hash:string):{publicKey:string;name:string}{
 const code=hash.startsWith('#')?hash.slice(1):hash;
 if(!code.startsWith(prefix)||code.length>2500)throw Error('Invalid profile');
 const value=JSON.parse(decodeURIComponent(code.slice(prefix.length)));
 if(!value||!validName(value.name)||typeof value.publicKey!=='string'||!/^[a-f0-9]{64}$/.test(value.publicKey)||typeof value.signature!=='string'||!/^[a-f0-9]{128}$/.test(value.signature))throw Error('Invalid profile');
 if(!ed25519.verify(hexToBytes(value.signature),utf8.encode(profileBody(value.publicKey,value.name)),hexToBytes(value.publicKey)))throw Error('Invalid profile signature');
 return {publicKey:value.publicKey,name:value.name};
}
export function showPublicProfile(host:HTMLElement,hash:string,language:'zh'|'en'){
 const page=document.createElement('main');page.className='public-profile';
 const name=document.createElement('h1');
 try{name.textContent=parsePublicProfile(hash).name;}catch{name.textContent=language==='zh'?'链接无效':'Invalid link';}
 page.append(name);host.replaceChildren(page);
}
