import { createLightNode, Protocols } from '@waku/sdk';
import { webSockets } from '@libp2p/websockets';
import { multiaddr } from '@multiformats/multiaddr';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {makeRoom,makeIdentity,seal,open,topic} from '../src/protocol.ts';
const r=makeRoom('network-smoke',false),i=makeIdentity();
const peers= (process.env.VITE_WAKU_PEERS||'').split(',').filter(Boolean);
const options={defaultBootstrap:!peers.length,networkConfig:{clusterId:Number(process.env.VITE_WAKU_CLUSTER_ID||1),numShardsInCluster:8},numPeersToUse:1,libp2p:{transports:[webSockets({filter:addresses=>addresses.filter(address=>address.protoNames().includes('wss')),websocket:{agent:process.env.https_proxy ? new HttpsProxyAgent(process.env.https_proxy) : undefined}})]}};
const nodes:Awaited<ReturnType<typeof createLightNode>>[]=[];
let timer:ReturnType<typeof setTimeout>|undefined;
try {
 for(let j=0;j<2;j++)nodes.push(await createLightNode(options));
 if(peers.length) { const dials=await Promise.allSettled(nodes.flatMap(n=>peers.map(async p=>{const conn=await n.libp2p.dial(multiaddr(p),{signal:AbortSignal.timeout(12000)});await n.libp2p.services.identify.identify(conn,{signal:AbortSignal.timeout(12000)});}))); for(const result of dials) console.log(result.status==='fulfilled'?'DIAL_OK':`DIAL_FAIL: ${result.reason?.message}`); }
 await Promise.all(nodes.map(n=>n.waitForPeers([Protocols.LightPush,Protocols.Filter],30000)));
 const [sender,receiver]=nodes;
 let deliver:(value:unknown)=>void=()=>{};
 const received=new Promise(resolve=>{deliver=resolve;});
 for(const node of nodes) {
  let subscribed=false;
  for(let attempt=0;attempt<20&&!subscribed;attempt++){
   subscribed=await node.filter.subscribe(node.createDecoder({contentTopic:topic(r)}),m=>{try{if(node===receiver&&m.payload&&open(r,m.payload).text==='two-client-check')deliver(true);}catch{}});
   if(!subscribed)await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!subscribed)throw Error('Subscription failed');
 }
 const result=await sender.lightPush.send(sender.createEncoder({contentTopic:topic(r),ephemeral:true}),{payload:seal(r,i,0,'two-client-check').payload});
 if(!result.successes?.length)throw Error('LightPush rejected: '+JSON.stringify(result.failures));
 await Promise.race([received,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Receive timeout')),20000);})]);
 console.log('PASS: two independent Waku clients, encrypted message delivered and verified');
} catch(e){console.error('FAIL:',(e as Error).message);process.exitCode=1;}
finally{clearTimeout(timer);await Promise.allSettled(nodes.map(n=>n.stop()));}
process.exit(process.exitCode||0);
