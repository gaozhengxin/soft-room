import {makeIdentity} from '../src/protocol.ts';
import {encodeSession} from '../src/session.ts';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {continueTemporary} from './browser-identity.mjs';
const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true});
const contexts=await Promise.all([browser.newContext({ignoreHTTPSErrors:true,locale:'en-US'}),browser.newContext({ignoreHTTPSErrors:true,locale:'en-US'})]);
const identities=[makeIdentity(),makeIdentity()];for(let i=0;i<2;i++)await contexts[i].addInitScript(raw=>{if(!sessionStorage.getItem('soft-room/session/v1'))sessionStorage.setItem('soft-room/session/v1',raw);},encodeSession({identity:identities[i],contacts:i===0?[{publicKey:identities[1].publicKey,name:'Bob'}]:[],rooms:[],language:'en'}));
const [a,b]=await Promise.all(contexts.map(c=>c.newPage())),errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
const ready=p=>p.waitForFunction(()=>document.querySelector('#send')?.disabled===false,{},{timeout:120000});
const send=async(p,body)=>{await p.locator('#message').fill(body);await p.locator('#send').click();};
try{
 for(const p of [a,b]){await p.goto(origin);await continueTemporary(p);}

 await a.locator('#my-identity').click();const alice=await a.locator('#identity-key').textContent();await a.locator('#global-name').fill('Alice');await a.locator('#global-name-form button').click();await a.locator('#identity-dialog').waitFor({state:'hidden'});
 await b.locator('#my-identity').click();const bob=await b.locator('#identity-key').textContent();await b.locator('#global-name').fill('Bob');await b.locator('#global-name-form button').click();await b.locator('#identity-dialog').waitFor({state:'hidden'});
 await a.locator('.dm-room .room-choice').first().click();await ready(a);await send(a,'First encrypted direct message');
 await b.locator('.dm-room .room-choice').filter({hasText:'Alice'}).waitFor({timeout:45000});await b.locator('.dm-room .room-choice').first().click();await b.getByText('First encrypted direct message',{exact:true}).waitFor();await ready(b);await send(b,'Reply to Alice inbox');await a.getByText('Reply to Alice inbox',{exact:true}).waitFor({timeout:45000});console.log('Bidirectional Waku DM and unknown sender grouping passed');
 await b.locator('.sender-profile').filter({hasText:'Alice'}).first().click();await b.locator('#profile-save').click();await b.locator('#profile-dialog .sheet-head button').click();const raw=await b.evaluate(()=>sessionStorage.getItem('soft-room/session/v1'));assert.ok(!raw.includes(alice));assert.ok(!raw.includes('Alice'));console.log('Saved contact encrypted in browser session');
 await b.locator('#new-room').click();await b.locator('#room-name').fill('Inbox switch test');await b.locator('#pow').uncheck();await b.locator('#create-button').click();await b.locator('#new-dialog').waitFor({state:'hidden'});await send(a,'Inbox while in another room');await b.waitForFunction(()=>document.querySelector('.dm-room .unread-count')?.textContent==='1',{},{timeout:45000});await b.locator('.dm-room .room-choice').first().click();await b.getByText('Inbox while in another room',{exact:true}).waitFor();console.log('Inbox remains active while switching ordinary rooms');
 const before=await a.locator('#room-sidebar').boundingBox();await a.locator('#sidebar-resize').focus();await a.keyboard.press('ArrowRight');const after=await a.locator('#room-sidebar').boundingBox();assert.ok(after.width>before.width);const downloads=await a.locator('.desktop-download').all();const boxes=await Promise.all(downloads.map(x=>x.boundingBox()));assert.equal(boxes[0].y,boxes[1].y);
 await b.reload();await continueTemporary(b);await b.locator('.dm-room .room-choice').filter({hasText:'Alice'}).waitFor();console.log('Contact survives refresh');
 await b.locator('.room-profile').first().click();await b.locator('#profile-delete').click();await b.waitForFunction(()=>!document.querySelector('#profile-save').disabled);assert.equal(await b.locator('.dm-room').count(),0);await b.locator('#profile-dialog .sheet-head button').click();await send(a,'A new message after contact deletion');await b.locator('.dm-room .room-choice').first().waitFor({timeout:45000});await b.locator('.room-profile').first().click();assert.equal(await b.locator('#profile-save').isEnabled(),true);await b.locator('#profile-dialog .sheet-head button').click();console.log('Deleted contact can send a new message without becoming saved again');
 await a.setViewportSize({width:390,height:844});await a.locator('#sidebar-toggle').click();assert.equal(await a.locator('.desktop-download:visible').count(),2);await a.screenshot({path:'/tmp/soft-room-dm-mobile.png'});await a.setViewportSize({width:1280,height:900});await a.screenshot({path:'/tmp/soft-room-dm-desktop.png'});assert.deepEqual(errors,[]);console.log('PASS browser DM, inbox continuity, encrypted contacts and responsive sidebar');
}catch(error){console.error(error);console.log('ERRORS',errors);process.exitCode=1;}finally{await browser.close();}
