import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true,proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 const pages=[];
 for(let i=0;i<2;i++){
  const context=await browser.newContext({ignoreHTTPSErrors:true,locale:'en-US',permissions:['microphone','camera']});const p=await context.newPage();p.setDefaultTimeout(30000);
  await p.addInitScript(()=>{window.pcs=[];const Original=RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(c){super(c);window.pcs.push(this);}};});pages.push(p);
 }
 const [a,b]=pages,ready=p=>p.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:90000});
 const connected=p=>p.waitForFunction(()=>window.pcs.some(pc=>pc.connectionState==='connected'),null,{timeout:90000});
 await a.goto(origin);await a.locator('#new-room').click();await a.locator('#room-name').fill('Lifecycle '+Date.now());await a.locator('.toggle').click();await a.locator('#create-button').click();await ready(a);
 await a.locator('#room-menu').click();await a.locator('#copy').click();const invitation=await a.locator('#share-link').inputValue();await a.locator('#share-dialog .sheet-head button').click();
 await b.goto(invitation);await b.locator('#join-button').click();await ready(b);
 async function create(p,name){await p.locator('#room-network').click();await p.locator('#channel-new').click();await p.locator('#channel-name').fill(name);await p.locator('#channel-create button').click();}
 async function enter(p,name){await p.locator('#room-network').click();await p.locator('.channel-card').filter({hasText:name}).click();}
 await create(a,'First');await enter(b,'First');await Promise.all([connected(a),connected(b)]);
 assert.ok(await a.locator('#channel-power').isVisible());assert.ok(await b.locator('#channel-power').isHidden());
 await a.locator('#channel-mic').click();await a.waitForFunction(()=>window.pcs.some(pc=>pc.getSenders().some(s=>s.track?.kind==='audio'&&s.track.readyState==='live')));
 const count=await a.evaluate(()=>window.pcs.length);await a.locator('#channel-back').click();await a.locator('#channel-page').waitFor({state:'hidden'});
 assert.ok(await a.evaluate(()=>window.pcs.some(pc=>pc.connectionState==='connected'&&pc.getSenders().some(s=>s.track?.readyState==='live'))));
 await b.locator('#channel-text').fill('While in room');await b.locator('#channel-composer button').click();await enter(a,'First');await a.locator('.channel-message').filter({hasText:'While in room'}).waitFor();assert.equal(await a.evaluate(()=>window.pcs.length),count);
 console.log('RETURN_KEEPS_CONNECTION_MEDIA_AND_MESSAGES');
 await a.locator('#channel-power').click();await b.locator('#channel-state').filter({hasText:'OFF'}).waitFor();await b.waitForFunction(()=>window.pcs.every(pc=>pc.connectionState==='closed'));
 await b.locator('#channel-back').click();await b.locator('#room-network').click();const off=b.locator('.channel-card').filter({hasText:'First'});assert.ok(await off.isDisabled());assert.ok((await off.textContent()).includes('OFF'));await b.locator('#mesh-dialog .sheet-head button').click();
 await a.locator('#channel-back').click();await enter(a,'First');await a.locator('#channel-power').click();await enter(b,'First');await Promise.all([connected(a),connected(b)]);console.log('CREATOR_OFF_MEMORY_AND_REOPEN');
 await a.goBack();await a.locator('#channel-page').waitFor({state:'hidden'});assert.ok(await a.evaluate(()=>window.pcs.some(pc=>pc.connectionState==='connected')));
 await create(a,'Second');assert.ok(await a.evaluate(()=>window.pcs.every(pc=>pc.connectionState==='closed')));await a.locator('#channel-leave').click();await a.locator('#channel-page').waitFor({state:'hidden'});console.log('JOIN_OTHER_AND_EXPLICIT_LEAVE');
 await enter(a,'First');await Promise.all([connected(a),connected(b)]);await a.locator('#channel-back').click();await a.locator('#room-menu').click();await a.locator('#leave').click();await a.waitForFunction(()=>window.pcs.every(pc=>pc.connectionState==='closed'));console.log('LEAVING_ROOM_CLOSES_BACKGROUND_CHANNEL');
 await b.locator('#channel-leave').click();
 console.log('PASS: channel lifecycle over real Waku and WebRTC');
}finally{await browser.close();}
