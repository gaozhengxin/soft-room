import {createLightNode,Protocols} from '@waku/sdk';
import {topic,type Room} from './protocol.ts';
export async function connect(room:Room,receive:(payload:Uint8Array)=>void,signal?:AbortSignal){
 const lifetime=new AbortController();let stopped=false,ready=false;
 const abortError=()=>new DOMException('Cancelled','AbortError');
 const pause=(ms:number)=>new Promise<void>((resolve,reject)=>{
  if(lifetime.signal.aborted){reject(abortError());return;}
  const abort=()=>{clearTimeout(timer);reject(abortError());};
  const timer=setTimeout(()=>{lifetime.signal.removeEventListener('abort',abort);resolve();},ms);
  lifetime.signal.addEventListener('abort',abort,{once:true});
 });
 let node:Awaited<ReturnType<typeof createLightNode>>|undefined;
 let stopPromise:Promise<void>|undefined;
 const stop=()=>{if(stopPromise)return stopPromise;stopped=true;ready=false;lifetime.abort();signal?.removeEventListener('abort',onAbort);window.removeEventListener('online',onOnline);return stopPromise=node?.stop().catch(()=>{})||Promise.resolve();};
 const onAbort=()=>{void stop();};
 const onOnline=()=>{ready=false;};
 if(signal?.aborted)throw abortError();signal?.addEventListener('abort',onAbort,{once:true});
 try{
  node=await createLightNode({defaultBootstrap:true,numPeersToUse:2,filter:{keepAliveIntervalMs:15000},libp2p:{hideWebSocketInfo:true}});
  if(stopped){await node.stop();throw abortError();}
  const current=node,decoder=current.createDecoder({contentTopic:topic(room)}),encoder=current.createEncoder({contentTopic:topic(room),ephemeral:true});
  const callback=(message:{payload?:Uint8Array})=>{if(!stopped&&message.payload&&message.payload.length<=16000)receive(message.payload);};
  current.libp2p.addEventListener('peer:disconnect',()=>{ready=false;});
  window.addEventListener('online',onOnline);
  async function subscribe(){
   await current.waitForPeers([Protocols.Filter,Protocols.LightPush],15000);if(stopped)throw abortError();
   return current.filter.subscribe(decoder,callback);
  }
  const deadline=Date.now()+55000;
  while(!stopped&&!ready&&Date.now()<deadline){try{ready=await subscribe();}catch{if(stopped)throw abortError();}if(!ready)await pause(1000);}
  if(!ready)throw Error('Waku connection failed');
  void(async()=>{while(!stopped){await pause(5000);if(!current.libp2p.getConnections().some(c=>c.status==='open'))ready=false;if(!ready)try{ready=await subscribe();}catch{ready=false;}}})().catch(()=>{});
  return {
   async send(payload:Uint8Array){
    if(stopped||!ready)throw Error('Not connected');
    const result=await current.lightPush.send(encoder,{payload},{autoRetry:false});
    if(!result.successes?.length)throw Error('Message not acknowledged');
   },
   connected:()=>!stopped&&ready&&current.libp2p.getConnections().some(c=>c.status==='open'),stop
  };
 }catch(error){await stop();throw error;}
}
