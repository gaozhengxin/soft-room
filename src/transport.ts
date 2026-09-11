import {createLightNode} from '@waku/sdk';
import {FilterCore,FilterCodecs,LightPushCore} from '@waku/core';
import {bootstrapPeers} from './gateways.ts';
import {GatewayHealth,firstAcknowledged} from './gateway-health.ts';
import {topic,type Room} from './protocol.ts';
export async function connect(room:Room,receive:(payload:Uint8Array)=>void,signal?:AbortSignal){
 const lifetime=new AbortController(),health=new GatewayHealth();let stopped=false;
 const abortError=()=>new DOMException('Cancelled','AbortError');
 const pause=(ms:number)=>new Promise<void>((resolve,reject)=>{
  if(lifetime.signal.aborted){reject(abortError());return;}
  const abort=()=>{clearTimeout(timer);reject(abortError());};
  const timer=setTimeout(()=>{lifetime.signal.removeEventListener('abort',abort);resolve();},ms);
  lifetime.signal.addEventListener('abort',abort,{once:true});
 });
 // Bound caller waits even when a gateway never finishes a protocol response.
 const bounded=async<T>(operation:Promise<T>,ms=10000)=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Gateway timeout')),ms);})]);}finally{clearTimeout(timer);}
 };
 let node:Awaited<ReturnType<typeof createLightNode>>|undefined,filter:FilterCore|undefined,timer:ReturnType<typeof setInterval>|undefined;
 let stopPromise:Promise<void>|undefined;
 const stop=()=>{if(stopPromise)return stopPromise;stopped=true;health.clear();clearInterval(timer);lifetime.abort();signal?.removeEventListener('abort',onAbort);window.removeEventListener('online',onOnline);return stopPromise=(async()=>{await filter?.stop();await node?.stop();})().catch(()=>{});};
 const onAbort=()=>{void stop();};
 const onOnline=()=>{health.clear();};
 if(signal?.aborted)throw abortError();signal?.addEventListener('abort',onAbort,{once:true});
 try{
  node=await createLightNode({defaultBootstrap:true,bootstrapPeers,numPeersToUse:1,connectionManager:{maxBootstrapPeers:6,maxConnections:10},libp2p:{hideWebSocketInfo:true}});
  if(stopped){await node.stop();throw abortError();}
  const current=node,decoder=current.createDecoder({contentTopic:topic(room)}),encoder=current.createEncoder({contentTopic:topic(room),ephemeral:true});
  // Own Filter acknowledgements explicitly; repeated SDK subscribe() can return a cached success.
  await current.filter.stop();if(stopped)throw abortError();
  filter=new FilterCore(async(pubsub,message)=>{
   if(stopped||pubsub!==decoder.pubsubTopic||message.contentTopic!==decoder.contentTopic)return;
   const decoded=await decoder.fromProtoObj(pubsub,{...message,version:message.version,timestamp:message.timestamp,meta:message.meta,ephemeral:message.ephemeral,rateLimitProof:message.rateLimitProof});
   if(!stopped&&decoded?.payload&&decoded.payload.length<=16000)receive(decoded.payload);
  },current.libp2p);
  await filter.start();if(stopped){await filter.stop();throw abortError();}const push=new LightPushCore(current.libp2p);
  const live=()=>new Map(current.libp2p.getConnections().filter(c=>c.status==='open').map(c=>[c.remotePeer.toString(),c.id]));
  const retire=(key:string,id:string)=>{health.drop(key,id);for(const connection of current.libp2p.getConnections())if(connection.id===id)connection.abort(Error('Gateway request timed out'));};
  const peers=new Map<string,{id:ReturnType<typeof current.libp2p.getPeers>[number];connection:string;lastAttempt:number;pending:boolean}>();
  let scanning=false;
  async function scan(){
   if(stopped||scanning)return;scanning=true;
   try{
    const connections=live();for(const key of peers.keys())if(!connections.has(key)){peers.delete(key);health.drop(key);}
    await Promise.all(current.libp2p.getConnections().filter(c=>c.status==='open').map(async connection=>{
     const key=connection.remotePeer.toString(),stored=await current.libp2p.peerStore.get(connection.remotePeer).catch(()=>undefined);
     if(stopped||!stored?.protocols.includes(FilterCodecs.SUBSCRIBE)||!stored.protocols.some(p=>push.multicodec.includes(p as typeof push.multicodec[number])))return;
     let entry=peers.get(key);if(!entry||entry.connection!==connection.id){entry={id:connection.remotePeer,connection:connection.id,lastAttempt:0,pending:false};peers.set(key,entry);health.drop(key);}
     if(entry.pending||Date.now()-entry.lastAttempt<15000)return;
     entry.pending=true;entry.lastAttempt=Date.now();const selected=entry;
     void bounded(filter!.subscribe(decoder.pubsubTopic,entry.id,[decoder.contentTopic])).then(result=>{
      if(stopped||peers.get(key)!==selected||live().get(key)!==selected.connection)return;
      if(result.success)health.acknowledge(key,selected.connection);else health.drop(key);
     }).catch(()=>{if(peers.get(key)===selected)retire(key,selected.connection);}).finally(()=>{selected.pending=false;});
    }));
   }finally{scanning=false;}
  }
  window.addEventListener('online',onOnline);timer=setInterval(()=>{void scan().catch(()=>{});},1000);
  const connected=()=>!stopped&&health.available(live()).length>0;
  const deadline=Date.now()+55000;
  while(!stopped&&!connected()&&Date.now()<deadline){await scan();await pause(250);}
  if(!connected())throw Error('Waku connection failed');
  let sendTail:Promise<unknown>=Promise.resolve(),queued=0;
  const sending=new Set<string>();
  return {
   async send(payload:Uint8Array){
    if(!connected()||queued>=64)throw Error('Not connected or send queue full');queued++;
    const send=sendTail.then(async()=>{
     if(stopped)throw abortError();
     const candidates=health.available(live()).filter(key=>!sending.has(key)).slice(0,4);
     await firstAcknowledged(candidates.map(async key=>{
      const peer=peers.get(key);if(!peer)throw Error('Gateway disconnected');sending.add(key);
      try{return await bounded(push.send(encoder,{payload},peer.id));}catch(error){if(error instanceof Error&&error.message==='Gateway timeout')retire(key,peer.connection);throw error;}finally{sending.delete(key);}
     }),result=>!!result.success);
    });
    sendTail=send.catch(()=>{});try{await send;}finally{queued--;}
   },connected,stop
  };
 }catch(error){await stop();throw error;}
}
