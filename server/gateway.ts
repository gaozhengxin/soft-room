import { WebSocketServer, WebSocket } from 'ws';
import { createLightNode, Protocols } from '@waku/sdk';
import { webSockets } from '@libp2p/websockets';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
setGlobalDispatcher(new EnvHttpProxyAgent());
// One genuine Waku light client per browser. No room keys, local fan-out or message history.
export function wakuGateway(): Plugin {
 const attach=(server: ViteDevServer | PreviewServer)=>{
  const http=server.httpServer;if(!http)return;
  const wss=new WebSocketServer({noServer:true,maxPayload:24000});
  http.on('upgrade',(req,socket,head)=>{
   if(req.url?.split('?')[0]!=='/waku-api')return;
   try {if(!req.headers.origin || new URL(req.headers.origin).host!==req.headers.host){socket.destroy();return;}}catch{socket.destroy();return;}
   if(wss.clients.size>=12){socket.destroy();return;}
   wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
   let node:Awaited<ReturnType<typeof createLightNode>>|undefined;
   let encoder:ReturnType<Awaited<ReturnType<typeof createLightNode>>['createEncoder']>|undefined;
   let joining=false,sending=false,closed=false;
   const send=(value:unknown)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
   const timeout=setTimeout(()=>ws.close(1008,'Join timeout'),60000);
   ws.on('close',()=>{closed=true;clearTimeout(timeout);void node?.stop();});
   ws.on('error',()=>ws.close());
   ws.on('message',async data=>{
    let id:unknown;
    try{
     const request=JSON.parse(data.toString());id=request.id;
     if(request.type==='join'){
      if(joining||node)throw Error('Already joining');
      if(typeof request.topic!=='string'||!/^\/soft-room\/1\/[a-f0-9]{64}\/json$/.test(request.topic))throw Error('Invalid topic');
      joining=true;
      const proxy=process.env.https_proxy||process.env.HTTPS_PROXY;
      node=await createLightNode({defaultBootstrap:true,numPeersToUse:2,libp2p:{transports:[webSockets({websocket:{agent:proxy?new HttpsProxyAgent(proxy):undefined}})]}});
      if(closed){await node.stop();return;}
      await node.waitForPeers([Protocols.Filter,Protocols.LightPush],30000);
      const decoder=node.createDecoder({contentTopic:request.topic});
      encoder=node.createEncoder({contentTopic:request.topic,ephemeral:true});
      let subscribed=false;
      for(let attempt=0;attempt<20&&!subscribed&&!closed;attempt++){
       subscribed=await node.filter.subscribe(decoder,m=>{if(m.payload)send({type:'message',payload:Buffer.from(m.payload).toString('base64')});});
       if(!subscribed)await new Promise(resolve=>setTimeout(resolve,500));
      }
      if(!subscribed)throw Error('Waku subscription failed');
      clearTimeout(timeout);send({type:'ready'});
     }else if(request.type==='send'){
      if(!node||!encoder||sending)throw Error('Not ready or busy');
      if(typeof id!=='number'||!Number.isSafeInteger(id)||typeof request.payload!=='string'||request.payload.length>22000)throw Error('Invalid message');
      const payload=Buffer.from(request.payload,'base64');
      if(payload.length<40||payload.length>16000)throw Error('Invalid payload size');
      sending=true;
      try{
       const result=await node.lightPush.send(encoder,{payload},{autoRetry:false});
       if(!result.successes?.length)throw Error('Waku did not acknowledge message');
       send({type:'sent',id});
      }finally{sending=false;}
     }else throw Error('Unknown request');
    }catch(error){send({type:'error',id,message:error instanceof Error?error.message:'Network error'});if(!encoder)ws.close(1011,'Waku connection failed');}
   });
  });
  http.on('close',()=>{for(const client of wss.clients)client.close();wss.close();});
 };
 return {name:'soft-room-waku-gateway',configureServer:attach,configurePreviewServer:attach};
}
