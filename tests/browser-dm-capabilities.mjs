import {makeIdentity} from '../src/protocol.ts';
import {encodeSession} from '../src/session.ts';
import {readFileSync} from 'node:fs';
import {loadEnv} from 'vite';
import {chromium,webkit,devices} from 'playwright-core';
import assert from 'node:assert/strict';
import {continueTemporary} from './browser-identity.mjs';
const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true,args:[...(process.env.DM_DIRECT_NETWORK?['--no-proxy-server']:[]),'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const safari=process.env.CHANNEL_CROSS_BROWSER?await webkit.launch({headless:true}):undefined;
const contexts=await Promise.all([safari||browser,browser].map((engine,index)=>engine.newContext({...(index===0?devices['Pixel 7']:{}),ignoreHTTPSErrors:true,locale:'en-US',permissions:['microphone','camera']})));
const identities=[makeIdentity(),makeIdentity()],privateMode=process.env.DM_PRIVATE==='1',env=loadEnv('production',process.cwd(),'VITE_');
for(let i=0;i<2;i++)await contexts[i].addInitScript(({raw,digest})=>{if(!sessionStorage.getItem('soft-room/session/v1'))sessionStorage.setItem('soft-room/session/v1',raw);if(digest)sessionStorage.setItem('soft-room-region-bypass-v1',digest);},{raw:encodeSession({identity:identities[i],name:i?'Bob':'Alice',contacts:[{publicKey:identities[1-i].publicKey,name:i?'Alice':'Bob'}],rooms:[],language:'en'}),digest:privateMode?env.VITE_REGION_BYPASS_SHA256:''});
if(process.env.DM_MOCK_STORAGE){
 const objects=new Map();let sequence=0;
 for(const context of contexts)await context.route('**/api/storage/v1/data**',async route=>{
  const request=route.request();if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
  const headers={'access-control-allow-origin':'*'};
  if(request.method()==='POST'){assert.equal(request.headers()['x-soft-room-id'],identities[1].publicKey);const body=request.postDataBuffer(),id='testattachment'+String(++sequence).padStart(20,'0');assert(body&&body[0]===1);assert(!body.includes(Buffer.from('Hello Bob')));objects.set(id,body);return route.fulfill({status:200,headers,body:id});}
  const id=new URL(request.url()).pathname.split('/')[5],body=objects.get(id);return route.fulfill({status:body?200:404,headers,body:body||'Not found'});
 });
}
const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));const failures=[];let timer;
for(const p of [a,b]){p.setDefaultTimeout(20000);p.setDefaultNavigationTimeout(45000);p.on('pageerror',e=>failures.push(e.message));p.on('response',r=>{if(r.url().includes('/api/storage/')&&r.status()>=400)console.log('STORAGE_HTTP',r.status(),new URL(r.url()).hostname);});p.on('requestfailed',r=>{if(r.url().includes('/api/storage/'))console.log('STORAGE_NETWORK',r.failure()?.errorText,new URL(r.url()).hostname);});await p.addInitScript(()=>{window.testPCs=[];window.testTracks=[];window.testSockets=[];const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){super(url,protocols);window.testSockets.push(String(url));}};const Native=window.RTCPeerConnection;window.RTCPeerConnection=class extends Native{constructor(c){super(c);window.testPCs.push(this);}};const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await capture(c);window.testTracks.push(...s.getTracks());return s;};});}
const ready=p=>p.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:90000});
const connected=p=>p.waitForFunction(()=>window.testPCs.some(pc=>pc.connectionState==='connected'&&pc.sctp?.state==='connected'),null,{timeout:240000});
async function run(){
 await a.setViewportSize({width:390,height:844});
 for(const p of [a,b]){await p.goto(origin,{waitUntil:'domcontentloaded'});await continueTemporary(p);if(!await p.locator('#room-sidebar').isVisible())await p.locator('#sidebar-toggle').click();await p.locator('.dm-room .room-choice').first().click();await ready(p);}
 await a.locator('#message').focus();await a.evaluate(()=>{window.inputBlurs=0;document.querySelector('#message').addEventListener('blur',()=>window.inputBlurs++);});
 await a.keyboard.type('Keyboard remains focused');await a.setViewportSize({width:390,height:480});await a.waitForTimeout(6500);await a.setViewportSize({width:390,height:844});
 assert.equal(await a.evaluate(()=>document.activeElement.id),'message');assert.equal(await a.evaluate(()=>window.inputBlurs),0);await a.locator('#send').click();await b.getByText('Keyboard remains focused',{exact:true}).waitFor({timeout:45000});console.log('DM_KEYBOARD_FOCUS_PASS');
 const files=[{name:'dm-note.md',mimeType:'text/markdown',buffer:Buffer.from('# Private attachment\n\nHello Bob')},{name:'dm-image.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}];
 for(const file of process.env.DM_SKIP_FILES?[]:files){
  await a.locator('#attach').click();await a.locator('#file-input').setInputFiles(file);if(file.mimeType==='image/png')await a.locator('#file-quality').selectOption('compact');await a.locator('#file-submit').click();await a.waitForFunction(()=>!document.querySelector('#file-dialog').open||document.querySelector('#file-feedback').textContent,null,{timeout:190000});assert.equal(await a.locator('#file-feedback').textContent(),'','file upload feedback');console.log('DM_UPLOADED',file.name);
  const card=b.locator('.attachment-card').filter({hasText:file.name});await card.waitFor({timeout:45000});
  if(file.mimeType==='image/png')await card.locator('img').waitFor();else{await card.getByRole('button',{name:'Open',exact:true}).click();await card.locator('.markdown-preview').waitFor();}
  const download=b.waitForEvent('download');await card.getByRole('button',{name:'Download original',exact:true}).click();const item=await download;assert.deepEqual(readFileSync(await item.path()),file.buffer);
 }
 if(!process.env.DM_SKIP_FILES)console.log(process.env.DM_MOCK_STORAGE?'DM_FILES_AND_IMAGES_MOCK_STORAGE_PASS':'DM_FILES_AND_IMAGES_PASS');if(process.env.DM_FILES_ONLY)return;
 for(const mode of ['voice','video','walkie']){
  await a.locator('#room-network').click();assert.equal(await a.locator('#mesh-dialog form').count(),0);await a.locator('#channel-new').click();await a.locator('#channel-name').fill(mode+' channel');await a.locator('.channel-mode').filter({has:a.locator(`input[value="${mode}"]`)}).click();await a.locator('#channel-create button').click();
  await a.waitForFunction(m=>document.querySelector('#channel-page').dataset.mode===m,mode);
  await b.locator('#room-network').click();await b.locator('.channel-card').filter({hasText:mode+' channel'}).waitFor({timeout:60000});assert.equal(await b.locator('.mesh-join,.mesh-leave').count(),0);await b.locator('.channel-card').filter({hasText:mode+' channel'}).click();await Promise.all([connected(a),connected(b)]);
  if(mode==='voice'){
   assert(await a.evaluate(()=>window.testPCs.some(pc=>pc.getConfiguration().iceTransportPolicy==='relay'&&pc.getConfiguration().iceServers.some(s=>[].concat(s.urls).some(u=>u.startsWith('turn'))))));
   await b.waitForFunction(async()=>{for(const pc of window.testPCs){for(const pair of (await pc.getStats()).values())if(pair.type==='candidate-pair'&&pair.state==='succeeded'&&pair.nominated){const stats=await pc.getStats();if(stats.get(pair.localCandidateId)?.candidateType==='relay')return true;}}return false;},null,{timeout:30000});console.log('DM_MANAGED_TURN_RELAY_PASS');
  }
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
  if(mode==='walkie'){
   await a.locator('#channel-advanced').evaluate(el=>el.open=true);await a.locator('#channel-custom-turn').check();await a.locator('#channel-turn-urls').fill('turn:127.0.0.1:9');await a.locator('#channel-turn-user').fill('local-test');await a.locator('#channel-turn-password').fill('local-test-secret');await a.locator('#channel-turn-form button').click();
   await a.waitForFunction(()=>window.testPCs.some(pc=>pc.getConfiguration().iceServers.some(s=>[].concat(s.urls).includes('turn:127.0.0.1:9'))));
   assert.equal(await a.evaluate(()=>JSON.stringify(sessionStorage).includes('local-test-secret')),false);
   await a.locator('#channel-advanced').evaluate(el=>el.open=true);await a.locator('#channel-custom-turn').uncheck();await a.locator('#channel-turn-form button').click();await Promise.all([connected(a),connected(b)]);console.log('DM_CUSTOM_TURN_AND_RESTORE_PASS');
  }
  await a.locator('#channel-leave').click();await a.locator('#channel-page').waitFor({state:'hidden'});
  assert.ok(await a.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')));assert.ok(await a.evaluate(()=>window.testPCs.every(pc=>pc.connectionState==='closed')));
  await b.locator('#channel-leave').click();await b.locator('#channel-page').waitFor({state:'hidden'});await b.waitForTimeout(350);
 }
 for(const p of [a,b]){const sockets=await p.evaluate(()=>window.testSockets);assert(sockets.length);assert(privateMode?sockets.every(url=>new URL(url).hostname==='waku.wakukusmartrecipe.uk'):sockets.every(url=>new URL(url).hostname!=='waku.wakukusmartrecipe.uk'));}console.log('DM_GATEWAYS_'+(privateMode?'HIDDEN':'NORMAL')+'_PASS');
 assert.deepEqual(failures,[]);console.log(process.env.CHANNEL_CROSS_BROWSER?'PASS: WebKit/Chrome over real Waku, three channel modes, text and navigation':'PASS: separate creation page, whole-card entry, WebRTC-only text, voice/video RTP, push-to-talk release, browser back and capture cleanup');
}
try{await Promise.race([run(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Channel E2E timed out')),720000))]);}finally{clearTimeout(timer);await browser.close();await safari?.close();}
