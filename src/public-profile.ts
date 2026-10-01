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
export function showPublicProfile(host:HTMLElement,hash:string,language:'zh'|'en',native=false,back?:()=>void){
 const page=document.createElement('main');page.className='public-profile';
 const name=document.createElement('h1');
 try{name.textContent=parsePublicProfile(hash).name;}catch{name.textContent=language==='zh'?'链接无效':'Invalid link';}
 page.append(name);if(!native){try{const link=document.createElement('a');link.id='profile-open-app';link.href=profileAppLink(hash);link.textContent=language==='zh'?'在 Soft Room App 中打开':'Open in Soft Room App';page.append(link);}catch{}}else if(back){const close=document.createElement('button');close.textContent=language==='zh'?'返回':'Back';close.onclick=back;page.append(close);}host.replaceChildren(page);
}

export function profileAppLink(hash:string){parsePublicProfile(hash);return 'softroom://profile/#'+hash.replace(/^#/,'');}
export function profileHashFromAppUrl(value:string){try{const url=new URL(value);if(url.protocol!=='softroom:'||url.hostname!=='profile'||url.username||url.password||url.port||url.search||!['','/'].includes(url.pathname))return;parsePublicProfile(url.hash);return url.hash;}catch{return;}}
export function showProfileDialog(hash:string,language:'zh'|'en'){
 document.getElementById('public-profile-dialog')?.remove();
 const dialog=document.createElement('dialog');dialog.id='public-profile-dialog';dialog.className='sheet';
 const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',language==='zh'?'关闭':'Close');close.onclick=()=>dialog.close();
 const content=document.createElement('div');content.className='profile-preview';const name=document.createElement('h1');try{name.textContent=parsePublicProfile(hash).name;}catch{name.textContent=language==='zh'?'链接无效':'Invalid link';}content.append(name);dialog.append(close,content);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;
}
