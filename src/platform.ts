import {Capacitor,CapacitorHttp} from '@capacitor/core';
export const nativeApp=()=>Capacitor.isNativePlatform();
export async function readLocation(native:boolean,configured:string|undefined){
 const url=locationEndpoint(native,configured);
 if(native){
  const result=await CapacitorHttp.get({url,connectTimeout:8000,readTimeout:8000,responseType:'text',disableRedirects:true});
  if(result.status!==200||typeof result.data!=='string')throw Error('Lookup unavailable');return result.data;
 }
 const result=await fetch(url,{signal:AbortSignal.timeout(8000),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
 if(!result.ok)throw Error('Lookup unavailable');return result.text();
}
export function publicSite(configured:string|undefined):string|undefined{
 if(!configured)return;try{const url=new URL(configured);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return;return url.origin;}catch{return;}
}
export function locationEndpoint(native:boolean,configured:string|undefined){if(!native)return '/cdn-cgi/trace';const site=publicSite(configured);if(!site)throw Error('Public origin required');return site+'/cdn-cgi/trace';}
export function invitationLink(code:string,native:boolean,configured:string|undefined,current:string){
 if(native){const site=publicSite(configured);return site?`${site}/#${code}`:code;}
 const url=new URL(current);url.search='';url.hash=code;return url.href;
}
