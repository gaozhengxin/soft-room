import {validChallenge,signTurnProof,turnEpoch,type TurnProof} from './turn-proof.ts';
import type {Identity} from './protocol.ts';
import {mineTurn} from './turn-mine.ts';
import {defaultIceServers,turnConfiguration} from './ice-config.ts';
export {defaultIceServers,turnConfiguration} from './ice-config.ts';
export function customTurnServer(urls:string,username:string,credential:string):RTCIceServer{
 const list=urls.trim().split(/\s+/);if(!list.length||list.length>6||list.some(url=>!/^turns?:[a-z0-9.\[\]:-]+(?::[0-9]+)?(?:\?transport=(?:udp|tcp))?$/i.test(url))||!username.trim()||!credential||username.length>512||credential.length>1024)throw Error('Invalid TURN configuration');
 return {urls:list,username:username.trim(),credential};
}
export type TurnAccessState={status:'idle'|'mining'|'ready'|'error';elapsed:number};
export function createIceProvider(endpoint?:string,request:typeof fetch=fetch,now=Date.now,identity?:()=>Identity,notify:()=>void=()=>{},storage?:Storage,mine:typeof mineTurn=mineTurn){
 let loaded=false;
 let cached:ReturnType<typeof turnConfiguration>|undefined,proof:TurnProof|undefined,flight:Promise<RTCConfiguration>|undefined,retryAfter=0,controller:AbortController|undefined,generation=0;
 const state:TurnAccessState={status:'idle',elapsed:0};
 const update=(status:TurnAccessState['status'],elapsed=0)=>{state.status=status;state.elapsed=elapsed;notify();};
 const current=():RTCConfiguration=>cached&&cached.expiresAt>now()?cached.configuration:{iceServers:defaultIceServers,bundlePolicy:'max-bundle'};
 const provider=async():Promise<RTCConfiguration>=>{
  if(!endpoint||!identity)return current();
  const user=identity();if(!loaded){loaded=true;try{const saved=JSON.parse(storage?.getItem('soft-room/turn-proof')||'null') as TurnProof;if(saved&&validChallenge(saved.challenge)&&saved.challenge.publicKey===user.publicKey&&saved.challenge.epoch===turnEpoch(now()))proof=saved;}catch{}}
  if(proof&&proof.challenge.publicKey!==user.publicKey){cached=undefined;proof=undefined;}
  if(cached&&cached.expiresAt>now())return current();
  if(now()<retryAfter)return current();if(flight)return flight;
  controller=new AbortController();const signal=controller.signal,version=generation;
  flight=(async()=>{
   try{
    const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Invalid TURN endpoint');
    while(!signal.aborted){
     if(!proof||proof.challenge.epoch!==turnEpoch(now())){
      const challengeURL=new URL(url);challengeURL.pathname='/challenge';challengeURL.search='';challengeURL.searchParams.set('publicKey',user.publicKey);
      const response=await request(challengeURL.href,{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),credentials:'omit',cache:'no-store',redirect:'error'});
      if(!response.ok)throw Error('Challenge unavailable');const challenge=await response.json();
      if(!validChallenge(challenge)||challenge.publicKey!==user.publicKey||challenge.epoch!==turnEpoch(now()))throw Error('Invalid challenge');
      update('mining');
      const epochAbort=new AbortController(),timeout=setTimeout(()=>epochAbort.abort(),Math.max(1,challenge.expiresAt-now()));
      try{const nonce=await mine(challenge,AbortSignal.any([signal,epochAbort.signal]),elapsed=>update('mining',elapsed));proof=signTurnProof(challenge,nonce,user.secret);try{storage?.setItem('soft-room/turn-proof',JSON.stringify(proof));}catch{}}catch(error){if(epochAbort.signal.aborted&&!signal.aborted)continue;throw error;}finally{clearTimeout(timeout);}
     }
     if(signal.aborted)throw Error('Cancelled');
     const response=await request(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof),signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error'});
     if(!response.ok){if(response.status===403){proof=undefined;try{storage?.removeItem('soft-room/turn-proof');}catch{}throw Error('Proof rejected');}if(proof!.challenge.epoch!==turnEpoch(now())){proof=undefined;continue;}throw Error('TURN unavailable');}
     const value=turnConfiguration(await response.json(),now());if(signal.aborted||version!==generation)return current();cached=value;retryAfter=0;update('ready');return current();
    }
   }catch{if(version===generation&&!signal.aborted){retryAfter=now()+30000;update('error');}}
   return current();
  })().finally(()=>{if(version===generation){flight=undefined;controller=undefined;}});return flight;
 };
 return Object.assign(provider,{state,cancel:()=>{generation++;controller?.abort();controller=undefined;flight=undefined;update('idle');},expires:()=>cached?.expiresAt??0});
}
