import {chromium} from 'playwright-core';
import {build} from 'vite';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const host=process.env.GATEWAY_HOST||'node-01.do-ams3.waku.sandbox.status.im';
const result=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:fileURLToPath(new URL('./gateway-harness.ts',import.meta.url)),formats:['es'],fileName:'gateway-harness'}}});
const code=(Array.isArray(result)?result[0]:result).output.find(x=>x.type==='chunk').code;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 const pages=[];let blocked=0;
 for(let i=0;i<2;i++){
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  await context.routeWebSocket('**/*',socket=>{if(new URL(socket.url()).hostname===host)socket.connectToServer();else{blocked++;socket.close();}});
  const page=await context.newPage();await page.route('**/gateway-test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Gateway test</title>'}));await page.route('**/gateway-harness.js',r=>r.fulfill({contentType:'text/javascript',body:code}));
  await page.goto('https://127.0.0.1:5173/gateway-test');pages.push(page);
 }
 const room=await pages[0].evaluate(async()=>{const lib=await import('/gateway-harness.js');return lib.makeRoom('Single gateway test',false);});
 await Promise.all(pages.map(page=>page.evaluate(async room=>{const lib=await import('/gateway-harness.js');window.received=[];window.transport=await lib.connect(room,payload=>window.received.push(new TextDecoder().decode(payload)));},room)));
 assert.ok(blocked>0);console.log('ONLY_ONE_GATEWAY_AVAILABLE',host);
 for(let i=0;i<2;i++){await pages[i].evaluate(async i=>window.transport.send(new TextEncoder().encode('message-'+i)),i);await pages[1-i].waitForFunction(i=>window.received.includes('message-'+i),i,{timeout:30000});}
 assert.ok(await pages[0].evaluate(()=>window.transport.connected()));
 await Promise.all(pages.map(p=>p.evaluate(()=>window.transport.stop())));console.log('PASS: other gateways blocked; one gateway provides bidirectional room messages');
}finally{await browser.close();}
