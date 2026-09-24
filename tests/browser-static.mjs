import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {continueTemporary} from './browser-identity.mjs';
const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'}),headless:true});
const ca=await browser.newContext({ignoreHTTPSErrors:true}),cb=await browser.newContext({ignoreHTTPSErrors:true});
const a=await ca.newPage(),b=await cb.newPage();let failures=[],sockets=[];
for(const p of [a,b]){p.on('pageerror',e=>failures.push(e.message));p.on('websocket',s=>sockets.push(s.url()));p.on('request',r=>{if(/\/(waku-api|access\/check)(\?|$)/.test(r.url()))failures.push('local API requested '+r.url());});}
async function name(p,value){await p.locator('#sidebar-toggle').click().catch(()=>{});if(!await p.locator('#my-identity').isVisible())await p.locator('#sidebar-toggle').click();await p.locator('#my-identity').click();await p.locator('#global-name').fill(value);await p.locator('#global-name-form button').click();await p.locator('#identity-dialog').waitFor({state:'hidden'});}
async function waitReady(p){await p.waitForFunction(()=>!document.getElementById('send')?.disabled,{},{timeout:120000});}
async function send(p,value){await p.locator('#message').fill(value);await p.locator('#send').click();}
try{
 await a.goto(origin);await continueTemporary(a);await name(a,'Alice');await a.locator('#new-room').click();await a.locator('#room-name').fill('Pure static E2E');await a.locator('#create-button').click();await waitReady(a);console.log('A_READY: read and daily write PoW completed in browser');
 await a.locator('#room-menu').click();await a.locator('#copy').click();const link=await a.locator('#share-link').inputValue();const invitation=JSON.parse(Buffer.from(link.split('#sr2.')[1],'base64url').toString());assert.equal(invitation.key,undefined);await a.locator('#share-dialog .sheet-head button').click();
 await b.goto(link);await continueTemporary(b);await b.locator('#join-button').click();await waitReady(b);await name(b,'Bob');console.log('B_READY: joined using seed-only invitation');
 await send(a,'Static A to B');await b.getByText('Static A to B',{exact:true}).waitFor({timeout:30000});await send(b,'Static B to A');await a.getByText('Static B to A',{exact:true}).waitFor({timeout:30000});console.log('MESSAGES: bidirectional direct Waku delivery');
 await name(a,'Alice renamed');await b.locator('.name-change').filter({hasText:'Alice renamed'}).first().waitFor({timeout:30000});await b.locator('#room-members').click();await b.locator('.member-card').filter({hasText:'Alice renamed'}).waitFor({timeout:15000});console.log('HEARTBEAT: name change and members verified');
 await ca.setOffline(true);await b.waitForFunction(()=>{const row=[...document.querySelectorAll('.member-card')].find(e=>e.textContent.includes('Alice renamed'));return row&&!row.querySelector('.member-status.online');},{},{timeout:45000});console.log('OFFLINE: remote member expired');
 await ca.setOffline(false);await waitReady(a);await b.waitForFunction(()=>{const row=[...document.querySelectorAll('.member-card')].find(e=>e.textContent.includes('Alice renamed'));return row?.querySelector('.member-status.online');},{},{timeout:90000});await b.locator('#members-dialog .sheet-head button').click();await send(a,'Recovered after offline');await b.getByText('Recovered after offline',{exact:true}).waitFor({timeout:30000});console.log('RECOVERY: automatic reconnect and room subscription recovered');
 assert.equal(failures.length,0,failures.join('\n'));assert.ok(sockets.length>0);assert.ok(sockets.every(s=>!s.includes('127.0.0.1')&&!s.includes('localhost')));console.log('PASS static browser E2E',sockets.length,'public WSS connections; zero local APIs');
}catch(e){console.log('FAIL',e.message);console.log('A',await a.locator('#status').textContent().catch(()=>''),'B',await b.locator('#status').textContent().catch(()=>''));console.log('ERRORS',failures);process.exitCode=1;}finally{await browser.close();}
