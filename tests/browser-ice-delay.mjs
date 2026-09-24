import {chromium} from 'playwright-core';
import {build} from 'vite';
import assert from 'node:assert/strict';
const result=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:'tests/mesh-harness.ts',formats:['es']}}});
const code=(Array.isArray(result)?result[0]:result).output.find(x=>x.type==='chunk').code;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling']});
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true});
 await page.route('**/ice-delay',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Delayed ICE regression</title>'}));
 await page.route('**/mesh-harness.js',r=>r.fulfill({contentType:'text/javascript',body:code}));
 await page.goto('https://127.0.0.1:5173/ice-delay');
 await page.evaluate(async()=>{
 const {RoomMesh,makeRoom,makeIdentity,roomId,seal,open}=await import('/mesh-harness.js');
 const room=makeRoom('Delayed ICE',false),ids=[makeIdentity(),makeIdentity()],meshes=[],pcs=[],sent=[];
 const broadcast=(i,m)=>meshes.forEach((mesh,j)=>{if(j!==i)mesh.receive(m);});
 const heartbeat=i=>broadcast(i,open(room,seal(room,ids[i],0,'','',undefined,'heartbeat',meshes[i].membership).payload));
 const localGetter=Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype,'localDescription').get;
 const start=Date.now();
 ids.forEach((identity,i)=>meshes.push(new RoomMesh({room:roomId(room),identity,announce:()=>heartbeat(i),changed:()=>{},rtcConfiguration:{iceServers:[]},
 peerConnection:config=>{const pc=new RTCPeerConnection(config),created=Date.now();pcs.push(pc);
 // Model a host/STUN candidate discovered after the old 12-second snapshot deadline.
 Object.defineProperty(pc,'iceGatheringState',{get:()=>Date.now()-created<16000?'gathering':'complete'});
 Object.defineProperty(pc,'localDescription',{get:()=>{const d=localGetter.call(pc);return d?{type:d.type,sdp:Date.now()-created<16000?d.sdp.replace(/^a=(candidate:.*|end-of-candidates)\r?\n/gm,''):d.sdp}:null;}});
 return pc;},
 send:async s=>{sent.push({elapsed:Date.now()-start,candidates:(s.sdp.match(/a=candidate:/g)||[]).length});broadcast(i,open(room,seal(room,identity,0,JSON.stringify(s),'',undefined,'mesh').payload));await new Promise(resolve=>setTimeout(resolve,5000));}
 })));
 window.fixture={meshes,pcs,sent};setInterval(()=>meshes.forEach(m=>m.tick()),250);setInterval(()=>ids.forEach((_,i)=>heartbeat(i)),1000);
 meshes[0].create('Delayed');meshes[1].join(meshes[0].membership.network);
 });
 await page.waitForFunction(()=>window.fixture.pcs.length===2&&window.fixture.pcs.every(pc=>pc.remoteDescription),null,{timeout:2500});
 console.log('ANSWER_APPLIED_BEFORE_WAKU_SEND_ACK');
 await page.waitForFunction(()=>window.fixture.meshes.every(m=>m.peerViews().some(p=>p.state==='connected')),null,{timeout:40000});
 const data=await page.evaluate(()=>window.fixture.sent);assert.ok(data[0].elapsed<2000,'STUN gathering must not hold the initial offer');assert.ok(data.some(s=>s.candidates>0),'late candidates must be sent');
 await page.evaluate(()=>window.fixture.meshes[0].sendText('late ICE works'));await page.waitForFunction(()=>window.fixture.meshes[1].messages.some(m=>m.body==='late ICE works'));
 console.log('PASS: initial signaling proceeds immediately; candidates arriving after 16 seconds connect and carry text');
 await page.evaluate(()=>window.fixture.meshes.forEach(m=>m.stop()));
}finally{await browser.close();}
