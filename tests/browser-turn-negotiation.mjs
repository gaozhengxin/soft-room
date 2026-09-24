import {chromium,webkit} from 'playwright-core';
import {build} from 'vite';
import assert from 'node:assert/strict';
const result=await build({configFile:false,logLevel:'error',build:{write:false,minify:false,lib:{entry:'tests/mesh-harness.ts',formats:['es']}}});
const output=(Array.isArray(result)?result[0]:result).output;
console.log('SETUP: bundle ready');
const testOrigin=process.env.TURN_TEST_ORIGIN||'https://127.0.0.1:5173';
const browser=await(process.env.MESH_ENGINE!=='chromium'?webkit.launch({headless:true,timeout:30000}):chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||undefined,channel:process.env.CHROME_EXECUTABLE?undefined:'chrome',headless:true,timeout:30000,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']}));
try{
 console.log('SETUP: browser ready');
 const page=await browser.newPage({ignoreHTTPSErrors:true});
 page.on('console',m=>{if(m.text().startsWith('TRACE '))console.log(m.text());});
 page.on('pageerror',e=>console.log('PAGE_ERROR '+e.message));
 await page.route(testOrigin+'/turn-negotiation',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Independent TURN negotiation</title>'}));
 for(const file of output){const content=file.type==='chunk'?file.code:file.source;await page.route('**/'+file.fileName,r=>r.fulfill({contentType:'text/javascript',body:content}));}
 console.log('SETUP: routes ready');
 const main=output.find(x=>x.type==='chunk'&&x.isEntry).fileName;
 await page.goto(testOrigin+'/turn-negotiation');
 await page.evaluate(async({main,delay,tlsOnly,stagger,endpoint})=>{
  const {RoomMesh,makeIdentity,makeRoom,roomId,seal,open,createIceProvider}=await import('/'+main);
  const room=makeRoom('TURN timing',false),ids=[makeIdentity(),makeIdentity()].sort((a,b)=>a.publicKey.localeCompare(b.publicKey)),meshes=[],pcs=[[],[]],start=Date.now(),events=[];
  const log=(i,event,data={})=>{const item={ms:Date.now()-start,i,event,...data};events.push(item);console.log('TRACE '+JSON.stringify(item));};
  const broadcast=(i,m)=>meshes[1-i].receive(m);
  const announce=i=>{if(meshes.length===2)broadcast(i,open(room,seal(room,ids[i],0,'','',undefined,'heartbeat',meshes[i].membership).payload));};
  ids.forEach((identity,i)=>{
   let waited=false,lastStatus='',readyLogged=false;
   const provider=createIceProvider(endpoint,async(...args)=>{
    const r=await fetch(...args);log(i,'http',{path:new URL(String(args[0])).pathname,status:r.status});return r;
   },Date.now,()=>identity,()=>{if(provider.state.status!==lastStatus){lastStatus=provider.state.status;log(i,'turn',{status:lastStatus});}});
   const mesh=new RoomMesh({room:roomId(room),identity,announce:()=>announce(i),changed:()=>{},
    iceProvider:async()=>{if(i===1&&!waited){waited=true;await new Promise(r=>setTimeout(r,delay));}const config=await provider();if(stagger&&i===1&&!window.fixture.staggered){window.fixture.staggered=true;const until=Date.now()+20000;while(!pcs[0].slice(1).some(p=>p.remoteDescription)&&Date.now()<until)await new Promise(r=>setTimeout(r,100));await new Promise(r=>setTimeout(r,1500));}if(!readyLogged){readyLogged=true;log(i,'configurationReady');}if(tlsOnly)config.iceServers=config.iceServers?.flatMap(s=>{const urls=(Array.isArray(s.urls)?s.urls:[s.urls]).filter(u=>u==='turns:turn.cloudflare.com:443?transport=tcp');return urls.length?[{...s,urls}]:[];});return config;},
    cancelIce:()=>provider.cancel(),iceExpires:()=>provider.expires(),turnState:provider.state,
    peerConnection:config=>{const pc=new RTCPeerConnection({...config,iceTransportPolicy:'relay'}),index=pcs[i].length;pcs[i].push(pc);log(i,'create',{index,urls:config.iceServers?.flatMap(s=>s.urls)});
     pc.addEventListener('icecandidate',e=>{if(e.candidate)log(i,'candidate',{index,type:e.candidate.type,protocol:e.candidate.protocol,relayProtocol:e.candidate.relayProtocol});});
     pc.addEventListener('icecandidateerror',e=>log(i,'iceError',{index,code:e.errorCode,url:e.url}));
     pc.addEventListener('connectionstatechange',()=>log(i,'connection',{index,state:pc.connectionState}));
     return pc;
    },send:async s=>{log(i,'signal',{type:s.type,id:s.connection.slice(0,6),bytes:s.sdp?.length,candidates:(s.sdp?.match(/a=candidate:/g)||[]).length});await new Promise(r=>setTimeout(r,400));broadcast(i,open(room,seal(room,identity,0,JSON.stringify(s),'',undefined,'mesh').payload));}
   });meshes.push(mesh);
  });
  window.fixture={meshes,pcs,events};setInterval(()=>meshes.forEach(m=>m.tick()),250);setInterval(()=>ids.forEach((_,i)=>announce(i)),1000);
  meshes[0].create('Relay timing','video');meshes[1].join(meshes[0].membership.network);
 },{main,delay:Number(process.env.TURN_RESPONDER_DELAY||0),tlsOnly:process.env.TURN_TLS_ONLY==='1',stagger:process.env.TURN_STAGGER!=='0',endpoint:process.env.TURN_TEST_URL||'https://turn.wakukusmartrecipe.uk/ice'});
 try{await page.waitForFunction(()=>new Set(window.fixture.events.filter(e=>e.event==='configurationReady').map(e=>e.i)).size===2,null,{timeout:90000});await page.waitForFunction(()=>window.fixture.meshes.every(m=>m.peerViews().some(p=>p.state==='connected')),null,{timeout:15000});
  const routes=await page.evaluate(async()=>{const routes=[];for(const group of window.fixture.pcs)for(const pc of group)if(pc.connectionState==='connected'){const stats=await pc.getStats();for(const row of stats.values())if(row.type==='transport'&&row.selectedCandidatePairId){const pair=stats.get(row.selectedCandidatePairId),c=stats.get(pair.localCandidateId);routes.push({type:c.candidateType,relayProtocol:c.relayProtocol});}}return routes;});
  assert.equal(routes.length,2);assert.ok(routes.every(r=>r.type==='relay'));
  await page.evaluate(()=>window.fixture.meshes[0].sendText('TURN independent credentials'));
  await page.waitForFunction(()=>window.fixture.meshes[1].messages.some(m=>m.body==='TURN independent credentials'),null,{timeout:10000});console.log('PASS '+JSON.stringify(routes));
 }finally{console.log('FINAL '+JSON.stringify(await page.evaluate(()=>window.fixture.meshes.map((m,i)=>({i,views:m.peerViews(),turn:m.relayWork,pcs:window.fixture.pcs[i].map(p=>({state:p.connectionState,ice:p.iceConnectionState,signaling:p.signalingState,local:p.localDescription?.sdp.length,remote:p.remoteDescription?.sdp.length}))})))));await page.evaluate(()=>window.fixture.meshes.forEach(m=>m.stop()));}
}finally{await browser.close();}
