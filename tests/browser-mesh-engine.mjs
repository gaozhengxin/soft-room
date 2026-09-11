import {chromium,webkit} from 'playwright-core';
import {build} from 'vite';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const result=await build({configFile:false,logLevel:'error',build:{write:false,minify:false,lib:{entry:fileURLToPath(new URL('./mesh-harness.ts',import.meta.url)),formats:['es'],fileName:'mesh-harness'}}});
const code=(Array.isArray(result)?result[0]:result).output.find(x=>x.type==='chunk').code;
const engine=process.env.MESH_ENGINE||'chromium';
const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']}));
let timer;const errors=[];
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('TURN_TEST'))console.log(m.text());});
 await page.route('**/mesh-engine-test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Mesh transport test</title>'}));
 for(const output of (Array.isArray(result)?result[0]:result).output)if(output.type==='asset'&&output.fileName.endsWith('.js'))await page.route('**/'+output.fileName,r=>r.fulfill({contentType:'text/javascript',body:output.source}));
 await page.route('**/mesh-harness.js',r=>r.fulfill({contentType:'text/javascript',body:code}));
 await page.goto('https://127.0.0.1:5173/mesh-engine-test',{waitUntil:'domcontentloaded'});
 await page.evaluate(async turnEndpoint=>{
  const lib=await import('/mesh-harness.js');const {RoomMesh,makeIdentity,makeRoom,roomId,seal,open}=lib;
  const provider=turnEndpoint?lib.createIceProvider(turnEndpoint,fetch,Date.now,()=>ids[0],()=>{const state=provider.state;if(state.status!=='mining'||Math.floor(state.elapsed/1000)%10===0)console.log('TURN_TEST '+state.status+' '+Math.floor(state.elapsed/1000)+'s');}):undefined;
  const room=makeRoom('Engine test',false),ids=[makeIdentity(),makeIdentity(),makeIdentity()];
  const pcs=[[],[],[]],meshes=[];let dropped=0,dropFirst=true,signaling=true;
  const broadcast=(i,m)=>{for(let j=0;j<3;j++)if(i!==j)meshes[j].receive(m);};
  function announce(i){if(!signaling)return;const p=seal(room,ids[i],0,'','',undefined,'heartbeat',meshes[i].membership);broadcast(i,open(room,p.payload));}
  ids.forEach((identity,i)=>meshes.push(new RoomMesh({room:roomId(room),identity,announce:()=>announce(i),changed:()=>{},
   iceProvider:provider?async()=>({...await provider(),iceTransportPolicy:'relay'}):undefined,
   peerConnection:config=>{const pc=new RTCPeerConnection(turnEndpoint?{...config,iceTransportPolicy:'relay'}:config);pcs[i].push(pc);return pc;},
   send:async s=>{if(!signaling)throw Error('Signaling unavailable');if(dropFirst&&s.type==='offer'&&dropped<2){dropped++;return;}
    const packet=seal(room,identity,0,JSON.stringify(s),'',undefined,'mesh');
    // Real room authentication, simulated Waku loss, duplicated/late delivery.
    broadcast(i,open(room,packet.payload));setTimeout(()=>{try{broadcast(i,open(room,packet.payload));}catch{}},300);
   }})));
  window.fixture={meshes,pcs,get dropped(){return dropped;},set signaling(value){signaling=value;},announce};
  setInterval(()=>meshes.forEach(m=>m.tick()),250);setInterval(()=>ids.forEach((_,i)=>announce(i)),1000);
  meshes[0].create('Engine mesh','video');const n=meshes[0].membership.network;meshes[1].join(n);meshes[2].join(n);
 },process.env.TURN_TEST_URL||'');
 const full=()=>page.waitForFunction(()=>window.fixture.meshes.every(m=>m.peerViews().length===2&&m.peerViews().every(p=>p.state==='connected'&&p.rtt!==undefined)),null,{timeout:process.env.TURN_TEST_URL?300000:90000});
 await full();
 if(process.env.TURN_TEST_URL){
  const relay=await page.evaluate(async()=>{let selected=0;for(const group of window.fixture.pcs)for(const pc of group){const stats=await pc.getStats();for(const row of stats.values())if(row.type==='transport'&&row.selectedCandidatePairId){const pair=stats.get(row.selectedCandidatePairId),local=stats.get(pair.localCandidateId);if(local?.candidateType!=='relay')return false;selected++;}}return selected>=6;});
  assert.ok(relay,'Every connected peer must use a TURN relay candidate');console.log('SELECTED_RELAY_PAIRS_VERIFIED');
 }
 await page.evaluate(async()=>{
  const context=new AudioContext();await context.resume();const osc=context.createOscillator(),destination=context.createMediaStreamDestination();osc.connect(destination);osc.start();
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');let frame=0;const paint=setInterval(()=>{ctx.fillStyle=frame++%2?'#336699':'#ee9933';ctx.fillRect(0,0,320,180);},100);const video=canvas.captureStream(10).getVideoTracks()[0],audio=destination.stream.getAudioTracks()[0];
  window.fixture.capture={context,osc,paint,video,audio};await window.fixture.meshes[0].setTrack('audio',audio);await window.fixture.meshes[0].setTrack('video',video);
 });
 await page.waitForFunction(async()=>{let audio=false,video=false;for(const pc of window.fixture.pcs[1]){for(const s of (await pc.getStats()).values())if(s.type==='inbound-rtp'){if(s.kind==='audio'&&s.packetsReceived>0)audio=true;if(s.kind==='video'&&s.framesDecoded>0)video=true;}}return audio&&video;},null,{timeout:30000});console.log('AUDIO_VIDEO_RTP_RECEIVED');
 assert.equal(await page.evaluate(()=>window.fixture.dropped),2);console.log('LOSS_DUPLICATION_RECOVERED');
 await page.evaluate(()=>{for(const pc of window.fixture.pcs[0])pc.close();});await full();
 // full() can initially see stale display states; wait for fresh round trips on rebuilt peers.
 await page.waitForFunction(()=>window.fixture.pcs[0].length>=4,null,{timeout:90000});await full();console.log('CLOSED_CONNECTIONS_REBUILT');
 await page.evaluate(()=>window.fixture.signaling=false);await page.waitForTimeout(32000);await full();console.log('DATA_CHANNELS_SURVIVE_WAKU_OUTAGE');
 await page.evaluate(()=>window.fixture.meshes[0].sendText('Only inside this channel','Alice'));
 await page.waitForFunction(()=>window.fixture.meshes.every(m=>m.messages.some(t=>t.body==='Only inside this channel')),null,{timeout:10000});console.log('CHANNEL_TEXT_WITHOUT_WAKU');
 await page.evaluate(()=>{window.fixture.signaling=true;window.fixture.meshes[0].leave();window.fixture.announce(0);});
 await page.waitForFunction(()=>window.fixture.meshes.slice(1).every(m=>m.peerViews().length===1&&m.peerViews()[0].state==='connected'),null,{timeout:20000});
 await page.evaluate(async()=>{window.fixture.meshes.forEach(m=>m.stop());clearInterval(window.fixture.capture.paint);window.fixture.capture.osc.stop();await window.fixture.capture.context.close();});
 assert.ok(await page.evaluate(()=>window.fixture.pcs.flat().every(pc=>pc.connectionState==='closed')));assert.deepEqual(errors,[]);
 console.log('PASS '+engine+': real WebRTC data channels; lossy/duplicated authenticated signaling; forced reconnect; signaling outage; cleanup');
}finally{clearTimeout(timer);await browser.close();}
