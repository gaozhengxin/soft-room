import {chromium} from 'playwright-core';
import {readFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import assert from 'node:assert/strict';
import {continueTemporary} from './browser-identity.mjs';

const root=new URL('../dist/',import.meta.url).pathname,browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({locale:'en-US'});await context.addInitScript(()=>{sessionStorage.setItem('soft-room/persistent-active/v1','did:plc:test');sessionStorage.setItem('soft-room/session/v1',JSON.stringify({v:1,secret:'11'.repeat(32),rooms:[],language:'en'}));});
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
await page.route('https://identity.soft-room.test/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/cdn-cgi/trace'){await route.fulfill({body:'ip=203.0.113.8\nloc=US\n',contentType:'text/plain'});return;}const file=path==='/'?'index.html':path.slice(1);try{await route.fulfill({body:readFileSync(join(root,file)),contentType:mime[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'not found'});}});
try{
 await page.goto('https://identity.soft-room.test/');
 await page.getByRole('button',{name:'Continue with temporary identity'}).waitFor();
 await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 await page.getByRole('button',{name:'Create persistent identity'}).waitFor();
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByLabel('App Password').waitFor();await page.getByRole('button',{name:/Back/}).click();
 await continueTemporary(page);
 const stored=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.notEqual(stored.secret,'11'.repeat(32));assert.equal(await page.evaluate(()=>sessionStorage.getItem('soft-room/persistent-active/v1')),null);assert.deepEqual(errors,[]);
 console.log('PASS startup choices and temporary identity isolation');
}finally{await browser.close();}
