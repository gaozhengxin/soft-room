import {chromium,webkit} from 'playwright-core';
import assert from 'node:assert/strict';
const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const safari=process.env.CHANNEL_CROSS_BROWSER?await webkit.launch({headless:true}):undefined;
const contexts=await Promise.all([safari||browser,browser].map(engine=>engine.newContext({ignoreHTTPSErrors:true,locale:'en-US',permissions:['microphone','camera']})));
const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));const failures=[];let timer;
for(const p of [a,b]){p.setDefaultTimeout(20000);p.setDefaultNavigationTimeout(45000);p.on('pageerror',e=>failures.push(e.message));await p.addInitScript(()=>{window.testPCs=[];window.testTracks=[];const Native=window.RTCPeerConnection;window.RTCPeerConnection=class extends Native{constructor(c){super(c);window.testPCs.push(this);}};const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await capture(c);window.testTracks.push(...s.getTracks());return s;};});}
const ready=p=>p.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:90000});
const connected=p=>p.waitForFunction(()=>window.testPCs.some(pc=>pc.connectionState==='connected'&&pc.sctp?.state==='connected'),null,{timeout:90000});
async function run(){
 await a.goto(origin,{waitUntil:'domcontentloaded'});await a.locator('#new-room').click();await a.locator('#room-name').fill('Channel modes E2E');await a.locator('.toggle').click();await a.locator('#create-button').click();await ready(a);
 await a.locator('#room-menu').click();await a.locator('#copy').click();const link=await a.locator('#share-link').inputValue();await a.locator('#share-dialog .sheet-head button').click();
 await b.goto(link,{waitUntil:'domcontentloaded'});await b.locator('#join-button').click();await ready(b);console.log('ROOMS_CONNECTED');
 for(const mode of ['voice','video','walkie']){
  await a.locator('#room-network').click();assert.equal(await a.locator('#mesh-dialog form').count(),0);await a.locator('#channel-new').click();await a.locator('#channel-name').fill(mode+' channel');await a.locator('.channel-mode').filter({has:a.locator(`input[value="${mode}"]`)}).click();await a.locator('#channel-create button').click();
  await a.waitForFunction(m=>document.querySelector('#channel-page').dataset.mode===m,mode);
  await b.locator('#room-network').click();await b.locator('.channel-card').filter({hasText:mode+' channel'}).waitFor({timeout:30000});assert.equal(await b.locator('.mesh-join,.mesh-leave').count(),0);await b.locator('.channel-card').filter({hasText:mode+' channel'}).click();await Promise.all([connected(a),connected(b)]);
  assert.ok(await a.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')),'capture must not start when joining');
  await a.locator('#channel-text').fill('Channel-only '+mode);await a.locator('#channel-composer button').click();await b.locator('.channel-message p').filter({hasText:'Channel-only '+mode}).waitFor({timeout:20000});assert.equal(await b.locator('#messages').getByText('Channel-only '+mode,{exact:true}).count(),0);
  if(process.env.CHANNEL_CROSS_BROWSER){ /* Cross-engine negotiation and text; capture is covered in Chromium. */ }else if(mode==='walkie'){
   const box=await a.locator('#channel-hold').boundingBox();await a.mouse.move(box.x+box.width/2,box.y+box.height/2);await a.mouse.down();await a.waitForFunction(()=>window.testTracks.some(t=>t.kind==='audio'&&t.readyState==='live'&&t.enabled));await a.mouse.up();await a.waitForFunction(()=>window.testTracks.filter(t=>t.kind==='audio'&&t.readyState==='live').every(t=>!t.enabled));
  }else{
   await a.locator('#channel-mic').click();await a.waitForFunction(()=>window.testTracks.some(t=>t.kind==='audio'&&t.readyState==='live'&&t.enabled));
   await b.waitForFunction(async()=>{for(const pc of window.testPCs){const stats=await pc.getStats();for(const s of stats.values())if(s.type==='inbound-rtp'&&s.kind==='audio'&&s.packetsReceived>0)return true;}return false;},null,{timeout:30000});
   if(mode==='video'){await a.locator('#channel-camera').click();await b.waitForFunction(async()=>{for(const pc of window.testPCs){const stats=await pc.getStats();for(const s of stats.values())if(s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0)return true;}return false;},null,{timeout:30000});}
  }
  console.log(mode.toUpperCase()+(process.env.CHANNEL_CROSS_BROWSER?'_CROSS_BROWSER_TEXT_PASS':'_TEXT_AND_MEDIA_PASS'));
  if(mode==='video')await a.goBack({waitUntil:'domcontentloaded'});else await a.locator('#channel-back').click();await a.locator('#channel-page').waitFor({state:'hidden'});
  assert.ok(await a.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')));assert.ok(await a.evaluate(()=>window.testPCs.every(pc=>pc.connectionState==='closed')));
  await b.locator('#channel-back').click();await b.locator('#channel-page').waitFor({state:'hidden'});await b.waitForTimeout(350);
 }
 assert.deepEqual(failures,[]);console.log(process.env.CHANNEL_CROSS_BROWSER?'PASS: WebKit/Chrome over real Waku, three channel modes, text and navigation':'PASS: separate creation page, whole-card entry, WebRTC-only text, voice/video RTP, push-to-talk release, browser back and capture cleanup');
}
try{await Promise.race([run(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Channel E2E timed out')),360000))]);}finally{clearTimeout(timer);await browser.close();await safari?.close();}
