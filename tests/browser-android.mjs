import {chromium,devices} from 'playwright-core';
import {readFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import assert from 'node:assert/strict';

const root=new URL('../dist/',import.meta.url).pathname;
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({...devices['Pixel 7'],permissions:['clipboard-read','clipboard-write']});
await context.addInitScript(()=>{
 for(const [owner,key] of [[Promise,'withResolvers'],[Promise,'any'],[Promise,'try'],[AbortSignal,'timeout'],[AbortSignal,'any'],[Object,'hasOwn'],[Array.prototype,'at'],[Uint8Array,'fromBase64'],[URL,'parse'],[crypto,'randomUUID']])Object.defineProperty(owner,key,{value:undefined,writable:true,configurable:true});
});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
await page.route('https://soft-room.test/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/cdn-cgi/trace'){await route.fulfill({body:'ip=203.0.113.8\nloc=US\n',contentType:'text/plain'});return;}
 const file=path==='/'?'index.html':path.slice(1);
 try{await route.fulfill({body:readFileSync(join(root,file)),contentType:mime[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'not found'});}
});
async function openSidebar(){if(!await page.locator('#room-sidebar').isVisible())await page.locator('#sidebar-toggle').click();await page.locator('#room-sidebar').waitFor();}
async function physicalClick(selector){
 const box=await page.locator(selector).boundingBox();assert.ok(box,`${selector} has no hit box`);
 const point={x:box.x+box.width/2,y:box.y+box.height/2};
 const hit=await page.evaluate(({selector,point})=>document.elementFromPoint(point.x,point.y)?.closest(selector)?.matches(selector)??false,{selector,point});
 assert.ok(hit,`${selector} is covered at its center`);await page.mouse.click(point.x,point.y);
}
async function create(name){
 await openSidebar();await page.locator('#new-room').click();await page.locator('#room-name').fill(name);await page.locator('#pow').uncheck();await page.locator('#create-button').click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Connected')||document.querySelector('#status')?.textContent?.includes('已连接'),null,{timeout:90000});
 await page.locator('#room-menu').click();await page.locator('#copy').click();const link=await page.locator('#share-link').inputValue();await page.locator('#share-dialog .sheet-head button').click();return link;
}
try{
 await page.goto('https://soft-room.test/');
 const shell=await page.locator('.shell').boundingBox(),viewport=await page.evaluate(()=>visualViewport?.height||innerHeight);assert.ok(shell&&Math.abs(shell.height-viewport)<2,`shell ${shell?.height}, viewport ${viewport}`);
 const first=await create('Android first'),second=await create('Android second'),decode=link=>JSON.parse(Buffer.from(link.split('#sr1.')[1],'base64url').toString());
 assert.notEqual(first,second);assert.equal(decode(first).name,'Android first');assert.equal(decode(second).name,'Android second');assert.notEqual(decode(first).key,decode(second).key);
 await openSidebar();
 const sidebarBox=await page.locator('#room-sidebar').boundingBox(),backdropBox=await page.locator('#sidebar-backdrop').boundingBox();
 assert.ok(sidebarBox&&backdropBox&&backdropBox.x>=sidebarBox.x+sidebarBox.width-1,'sidebar backdrop overlaps the navigation hit area');
 await physicalClick('#my-identity');await page.locator('#identity-dialog').waitFor();
 assert.deepEqual(errors,[]);console.log('PASS Android viewport, sidebar touch, unique invitations and Waku connection with legacy WebView APIs');
}finally{await browser.close();}
