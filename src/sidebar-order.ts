import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,randomBytes,concatBytes} from '@noble/hashes/utils.js';
import type {Identity} from './protocol.ts';
const utf8=new TextEncoder(),text=new TextDecoder();
const storageKey=(identity:Identity)=>'soft-room/sidebar-order/v1/'+identity.publicKey;
const key=(identity:Identity)=>hkdf(sha256,identity.secret,undefined,utf8.encode('soft-room/sidebar-order/v1'),32);
function validOrder(value:unknown):value is string[]{return Array.isArray(value)&&value.length<=500&&value.every(id=>typeof id==='string'&&/^(room|dm):[a-f0-9]{64}$/.test(id));}
export function loadSidebarOrder(identity:Identity):string[]{try{const raw=localStorage.getItem(storageKey(identity));if(!raw||raw.length>100000)return [];const data=hexToBytes(raw),value=JSON.parse(text.decode(xchacha20poly1305(key(identity),data.slice(0,24)).decrypt(data.slice(24))));return validOrder(value)?[...new Set(value)]:[];}catch{return [];}}
export function saveSidebarOrder(identity:Identity,order:string[]){try{if(!validOrder(order))return;const iv=randomBytes(24),cipher=xchacha20poly1305(key(identity),iv).encrypt(utf8.encode(JSON.stringify(order)));localStorage.setItem(storageKey(identity),bytesToHex(concatBytes(iv,cipher)));}catch{ /* Ordering stays usable in memory when local storage is unavailable. */ }}
export function orderSidebarIds(ids:string[],saved:string[]){const current=new Set(ids);return [...new Set([...saved.filter(id=>current.has(id)),...ids])];}

// Pointer events cover mouse, touch and pen without taking over scrolling on the row itself.
export function sortableSidebar(list:HTMLElement,changed:(ids:string[])=>void,finished:()=>void){
 let dragging:HTMLElement|undefined,original:Element[]=[];
 const ids=()=>Array.from(list.children).map(row=>(row as HTMLElement).dataset.sidebarId!);
 const finish=(cancel=false)=>{if(!dragging)return;dragging.classList.remove('dragging');dragging=undefined;if(cancel)list.append(...original);else changed(ids());finished();};
 list.addEventListener('pointerdown',event=>{const handle=(event.target as Element).closest('.room-drag');if(!handle||event.button!==0)return;dragging=handle.closest<HTMLElement>('[data-sidebar-id]')!;original=Array.from(list.children);dragging.classList.add('dragging');list.setPointerCapture(event.pointerId);event.preventDefault();});
 list.addEventListener('pointermove',event=>{if(!dragging)return;event.preventDefault();const scroll=list.parentElement!,bounds=scroll.getBoundingClientRect();if(event.clientY<bounds.top+36)scroll.scrollTop-=12;else if(event.clientY>bounds.bottom-36)scroll.scrollTop+=12;const next=Array.from(list.children).find(row=>row!==dragging&&event.clientY<row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);list.insertBefore(dragging,next||null);});
 list.addEventListener('pointerup',event=>{finish();if(list.hasPointerCapture(event.pointerId))list.releasePointerCapture(event.pointerId);});
 list.addEventListener('pointercancel',()=>finish(true));list.addEventListener('lostpointercapture',()=>finish(true));
 list.addEventListener('keydown',event=>{const handle=(event.target as Element).closest<HTMLElement>('.room-drag');if(!handle||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const row=handle.closest<HTMLElement>('[data-sidebar-id]')!,next=event.key==='ArrowUp'?row.previousElementSibling:row.nextElementSibling;if(!next)return;if(event.key==='ArrowUp')list.insertBefore(row,next);else list.insertBefore(next,row);changed(ids());handle.focus();});
 return ()=>!!dragging;
}
