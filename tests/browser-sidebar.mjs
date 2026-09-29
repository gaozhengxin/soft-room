import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {makeIdentity,makeRoom} from '../src/protocol.ts';
import {encodeSession} from '../src/session.ts';
import {continueTemporary} from './browser-identity.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({ignoreHTTPSErrors:true,locale:'zh-CN'}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const session={identity:makeIdentity(),rooms:[{room:makeRoom('房间 A',false),created:true},{room:makeRoom('房间 B',false),created:true}],contacts:[{publicKey:makeIdentity().publicKey,name:'联系人 C'}],language:'zh'};
await context.addInitScript(raw=>{if(!sessionStorage.getItem('soft-room/session/v1'))sessionStorage.setItem('soft-room/session/v1',raw);},encodeSession(session));
const names=()=>page.locator('#room-list .room-choice').allTextContents();
try{
 await page.goto('https://127.0.0.1:5173');await continueTemporary(page);
 assert.deepEqual(await names(),['房间 A','房间 B','联系人 C']);assert.equal(await page.locator('.room-manager h3,.room-manager p,#dm-add,#room-count').count(),0);
 const handle=await page.locator('.room-drag').nth(2).boundingBox(),target=await page.locator('.saved-room').first().boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(target.x+12,target.y+2,{steps:8});await page.mouse.up();assert.deepEqual(await names(),['联系人 C','房间 A','房间 B']);
 await page.reload();await continueTemporary(page);assert.deepEqual(await names(),['联系人 C','房间 A','房间 B']);await page.locator('.room-drag').first().focus();await page.keyboard.press('ArrowDown');assert.deepEqual(await names(),['房间 A','联系人 C','房间 B']);
 await page.setViewportSize({width:390,height:844});await page.locator('#sidebar-toggle').click();const cdp=await context.newCDPSession(page),touchHandle=await page.locator('.room-drag').nth(2).boundingBox(),top=await page.locator('.saved-room').first().boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchHandle.x+10,y:touchHandle.y+18}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchHandle.x+10,y:top.y+1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.deepEqual(await names(),['房间 B','房间 A','联系人 C']);
 await page.screenshot({path:'/tmp/soft-room-sidebar-mobile.png'});assert.deepEqual(errors,[]);console.log('PASS one unlabelled list; mouse/touch/keyboard reorder; order survives refresh');
}catch(error){console.error(error);console.error(errors);process.exitCode=1;}finally{await browser.close();}
