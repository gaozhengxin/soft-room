import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {continueTemporary} from './browser-identity.mjs';
const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true});
const contexts=await Promise.all([browser.newContext({ignoreHTTPSErrors:true,locale:'en-US'}),browser.newContext({ignoreHTTPSErrors:true,locale:'en-US'})]);
const [a,b]=await Promise.all(contexts.map(c=>c.newPage())),errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
const ready=p=>p.waitForFunction(()=>document.querySelector('#inbox-status')?.textContent==='Inbox listening',{},{timeout:120000});
const send=async(p,body)=>{await p.locator('#message').fill(body);await p.locator('#send').click();};
try{
 for(const p of [a,b]){await p.goto(origin);await continueTemporary(p);}
 await Promise.all([ready(a),ready(b)]);console.log('Both independent inboxes subscribed');
 await a.locator('#my-identity').click();const alice=await a.locator('#identity-key').textContent();await a.locator('#global-name').fill('Alice');await a.locator('#global-name-form button').click();await a.locator('#identity-dialog').waitFor({state:'hidden'});
 await b.locator('#my-identity').click();const bob=await b.locator('#identity-key').textContent();await b.locator('#global-name').fill('Bob');await b.locator('#global-name-form button').click();await b.locator('#identity-dialog').waitFor({state:'hidden'});
 await a.locator('#dm-add').click();await a.locator('#dm-address').fill('inbox1.'+bob);await a.locator('#dm-add-form button').click();await send(a,'First encrypted direct message');
 await b.locator('#dm-list .room-choice').filter({hasText:'Alice'}).waitFor({timeout:45000});await b.locator('#dm-list .room-choice').first().click();await b.getByText('First encrypted direct message',{exact:true}).waitFor();await send(b,'Reply to Alice inbox');await a.getByText('Reply to Alice inbox',{exact:true}).waitFor({timeout:45000});console.log('Bidirectional Waku DM and unknown sender grouping passed');
 await b.locator('.sender-profile').filter({hasText:'Alice'}).first().click();await b.locator('#profile-save').click();await b.locator('#profile-dialog .sheet-head button').click();const raw=await b.evaluate(()=>sessionStorage.getItem('soft-room/session/v1'));assert.ok(!raw.includes(alice));assert.ok(!raw.includes('Alice'));console.log('Saved contact encrypted in browser session');
 await b.locator('#new-room').click();await b.locator('#room-name').fill('Inbox switch test');await b.locator('#pow').uncheck();await b.locator('#create-button').click();await b.locator('#new-dialog').waitFor({state:'hidden'});await send(a,'Inbox while in another room');await b.waitForFunction(()=>document.querySelector('#dm-list .room-choice small')?.textContent?.includes('1'),{},{timeout:45000});await b.locator('#dm-list .room-choice').first().click();await b.getByText('Inbox while in another room',{exact:true}).waitFor();console.log('Inbox remains active while switching ordinary rooms');
 const before=await a.locator('#room-sidebar').boundingBox();await a.locator('#sidebar-resize').focus();await a.keyboard.press('ArrowRight');const after=await a.locator('#room-sidebar').boundingBox();assert.ok(after.width>before.width);const downloads=await a.locator('.desktop-download').all();const boxes=await Promise.all(downloads.map(x=>x.boundingBox()));assert.equal(boxes[0].y,boxes[1].y);
 await b.reload();await continueTemporary(b);await b.locator('#dm-list .room-choice').filter({hasText:'Alice'}).waitFor();console.log('Contact survives refresh');
 await a.setViewportSize({width:390,height:844});await a.locator('#sidebar-toggle').click();assert.equal(await a.locator('.desktop-download:visible').count(),2);await a.screenshot({path:'/tmp/soft-room-dm-mobile.png'});await a.setViewportSize({width:1280,height:900});await a.screenshot({path:'/tmp/soft-room-dm-desktop.png'});assert.deepEqual(errors,[]);console.log('PASS browser DM, inbox continuity, encrypted contacts and responsive sidebar');
}catch(error){console.error(error);console.log('INBOX',await a.locator('#inbox-status').textContent().catch(()=>''),await b.locator('#inbox-status').textContent({timeout:1000}).catch(()=>''));console.log('ERRORS',errors);process.exitCode=1;}finally{await browser.close();}
