import {webkit} from 'playwright-core';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {continueTemporary} from './browser-identity.mjs';
const origin='https://127.0.0.1:5173',browser=await webkit.launch({headless:true,timeout:30000});
try{
 const pages=[];
 for(let i=0;i<2;i++){
  const context=await browser.newContext({ignoreHTTPSErrors:true,locale:'en-US'}),page=await context.newPage();page.setDefaultTimeout(30000);
  await page.route(origin+'/**',async r=>{const path=new URL(r.request().url()).pathname;try{const data=await readFile(new URL('../dist'+(path==='/'?'/index.html':path),import.meta.url));await r.fulfill({body:data,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html'});}catch{await r.abort();}});
  await page.addInitScript(()=>{window.pcs=[];const Original=RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(c){super({...c,iceTransportPolicy:'relay'});window.pcs.push(this);}};});
  page.on('response',r=>{if(r.url().includes('turn.wakukusmartrecipe.uk/'))console.log('TURN_HTTP '+i+' '+new URL(r.url()).pathname+' '+r.status());});pages.push(page);
 }
 const [a,b]=pages,ready=p=>p.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:90000});
 await a.goto(origin,{waitUntil:'domcontentloaded'});await continueTemporary(a);await a.locator('#new-room').click();await a.locator('#room-name').fill('Relay verification '+Date.now());await a.locator('.toggle').click();await a.locator('#create-button').click();await ready(a);
 await a.locator('#room-menu').click();await a.locator('#copy').click();const invite=await a.locator('#share-link').inputValue();await a.locator('#share-dialog .sheet-head button').click();
 await b.goto(invite,{waitUntil:'domcontentloaded'});await continueTemporary(b);await b.locator('#join-button').click();await ready(b);console.log('WAKU_ROOMS_READY');
 await a.locator('#room-network').click();await a.locator('#channel-new').click();await a.locator('#channel-name').fill('Relay channel');await a.locator('#channel-create button').click();
 await b.locator('#room-network').click();await b.locator('.channel-card').filter({hasText:'Relay channel'}).click();
 await Promise.all(pages.map(p=>p.waitForFunction(()=>window.pcs.some(pc=>pc.connectionState==='connected'&&pc.sctp?.state==='connected'),null,{timeout:100000})));
 for(const p of pages){assert.ok(await p.evaluate(async()=>{for(const pc of window.pcs)if(pc.connectionState==='connected'){const stats=await pc.getStats();for(const s of stats.values())if(s.type==='transport'&&s.selectedCandidatePairId){const pair=stats.get(s.selectedCandidatePairId);if(stats.get(pair.localCandidateId)?.candidateType==='relay')return true;}}return false;}));}
 for(const [from,to,text] of [[a,b,'Wi-Fi to mobile relay test'],[b,a,'Mobile to Wi-Fi relay test']]){await from.locator('#channel-text').fill(text);await from.locator('#channel-composer button').click();await to.locator('.channel-message p').filter({hasText:text}).waitFor();}
 console.log('PASS: WebKit UI, real Waku signaling, independent PoW credentials, selected TURN relay pairs, bidirectional channel text');
 for(const p of pages)await p.locator('#channel-leave').click();
}finally{await browser.close();}
