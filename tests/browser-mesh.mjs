import {chromium,webkit} from 'playwright-core';
import assert from 'node:assert/strict';
const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const engine=process.env.MESH_ENGINE||'chromium';
const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']}));
const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({ignoreHTTPSErrors:true,locale:'en-US'})));
const [a,b,c]=await Promise.all(contexts.map(x=>x.newPage()));const errors=[];
for(const p of [a,b,c]){p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(15000);p.setDefaultNavigationTimeout(45000);}
const ready=p=>p.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:90000});
async function panel(p){if(!await p.locator('#mesh-dialog').isVisible())await p.locator('#room-network').click();}
async function joined(p,count){await p.waitForFunction(n=>document.querySelectorAll('#channel-people .channel-person[data-state="connected"]').length===n,count,{timeout:90000});}
async function create(p,name){await panel(p);await p.locator('#channel-new').click();await p.locator('#channel-name').fill(name);await p.locator('#channel-create button').click();}
async function join(p,name){await panel(p);await p.locator('.channel-card').filter({hasText:name}).waitFor({timeout:30000});await p.locator('.channel-card').filter({hasText:name}).click();}
async function leave(p){await p.locator('#channel-leave').click();await p.locator('#channel-page').waitFor({state:'hidden'});await p.waitForTimeout(200);}
async function run(){
 await a.goto(origin,{waitUntil:'domcontentloaded'});await a.locator('#new-room').click();await a.locator('#room-name').fill('WebRTC mesh E2E');await a.locator('.toggle').click();await a.locator('#create-button').click();await ready(a);
 await a.locator('#room-menu').click();await a.locator('#copy').click();const link=await a.locator('#share-link').inputValue();await a.locator('#share-dialog .sheet-head button').click();console.log('ROOM_READY');
 await b.goto(link,{waitUntil:'domcontentloaded'});await b.locator('#join-button').click();await ready(b);
 await create(a,'Friends mesh');
 await join(b,'Friends mesh');await Promise.all([joined(a,1),joined(b,1)]);console.log('TWO_PEERS_CONNECTED');
 await c.goto(link,{waitUntil:'domcontentloaded'});await c.locator('#join-button').click();await ready(c);await join(c,'Friends mesh');
 await Promise.all([joined(a,2),joined(b,2),joined(c,2)]);console.log('THREE_PEER_FULL_MESH_AND_DATA_PINGS');
 for(const p of [a,b,c])assert.equal(await p.locator('.message-row').count(),0,'signaling must stay out of chat');
 await leave(a);await Promise.all([joined(b,1),joined(c,1)]);console.log('CREATOR_LEFT_OTHERS_STAY_CONNECTED');
 await join(a,'Friends mesh');await Promise.all([joined(a,2),joined(b,2),joined(c,2)]);console.log('REJOIN_CONNECTED');
 // Creating another network explicitly leaves the current one.
 await leave(a);await create(a,'Second mesh');await Promise.all([joined(b,1),joined(c,1)]);
 assert.equal(await a.locator('#channel-people .channel-person:not([data-key=self])').count(),0);console.log('NETWORK_ISOLATION');
 await b.reload({waitUntil:'domcontentloaded'});await ready(b);assert.equal(await b.locator('#channel-page').isVisible(),false);await join(b,'Friends mesh');await Promise.all([joined(b,1),joined(c,1)]);console.log('REFRESH_REJOIN');
 assert.deepEqual(errors,[]);console.log('PASS: actual Waku signaling, three browser WebRTC data channels, late discovery, creator leave, rejoin, network isolation, refresh');
}
let timer;try{await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Mesh E2E timeout')),360000);})]);}finally{clearTimeout(timer);await browser.close();}
