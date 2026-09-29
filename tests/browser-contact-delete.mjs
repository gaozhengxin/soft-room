import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {makeIdentity} from '../src/protocol.ts';
import {encodeSession,decodeSession} from '../src/session.ts';
import {continueTemporary} from './browser-identity.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,locale:'en-US'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const contact={publicKey:makeIdentity().publicKey,name:'Alice'},raw=encodeSession({identity:makeIdentity(),contacts:[contact],rooms:[],language:'en'});
await context.addInitScript(value=>{if(!sessionStorage.getItem('soft-room/session/v1'))sessionStorage.setItem('soft-room/session/v1',value);},raw);
try{
 await page.goto('https://127.0.0.1:5173');await continueTemporary(page);await page.locator('.room-profile').click();await page.locator('#profile-delete').click();await page.waitForFunction(()=>!document.querySelector('#profile-save').disabled);assert.equal(await page.locator('.dm-room').count(),0);assert.deepEqual(decodeSession(await page.evaluate(()=>sessionStorage.getItem('soft-room/session/v1'))).contacts||[],[]);
 await page.locator('#profile-save').click();await page.locator('#profile-delete').waitFor({state:'visible'});assert.equal(await page.locator('.dm-room').count(),1);await page.locator('#profile-delete').click();await page.waitForFunction(()=>!document.querySelector('#profile-save').disabled);await page.reload();await continueTemporary(page);assert.equal(await page.locator('.dm-room').count(),0);assert.deepEqual(errors,[]);console.log('PASS contact delete, re-add, encrypted session update and refresh');
}finally{await browser.close();}
