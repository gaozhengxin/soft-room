import {chromium} from 'playwright-core';
import {readFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import assert from 'node:assert/strict';
const origin='https://profile.soft-room.test',root=new URL('../dist/',import.meta.url).pathname;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const owner=await browser.newContext({locale:'en-US'});
 async function routes(context){await context.route(origin+'/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/cdn-cgi/trace')return route.fulfill({body:'ip=203.0.113.8\nloc=US\n',contentType:'text/plain'});const file=path==='/'?'index.html':path.slice(1);try{await route.fulfill({body:readFileSync(join(root,file)),contentType:mime[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404});}});}
 await routes(owner);const page=await owner.newPage();await page.goto(origin);
 await page.getByRole('button',{name:'Continue with temporary identity'}).click();
 await page.locator('#my-identity').click();await page.locator('#global-name').fill('小明 <img src=x>');await page.getByRole('button',{name:'Save username',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#identity-dialog').open);
 await page.locator('#my-identity').click();await page.getByRole('button',{name:'Create profile link',exact:true}).click();
 const link=await page.locator('#public-profile-link').inputValue();assert(link.startsWith(origin+'/#profile='));
 const visitor=await browser.newContext({locale:'en-US',viewport:{width:390,height:844}});await routes(visitor);const guest=await visitor.newPage();await guest.goto(link);
 await guest.locator('.public-profile h1').waitFor();assert.equal(await guest.locator('#app').innerText(),'小明 <img src=x>');assert.equal(await guest.locator('#app img').count(),0);assert.equal(await guest.locator('.identity-startup').count(),0);assert.equal(await guest.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')),null);assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await guest.reload();assert.equal(await guest.locator('.public-profile h1').innerText(),'小明 <img src=x>');
 await guest.goto(origin+'/#profile=%');await guest.getByRole('heading',{name:'Invalid link',exact:true}).waitFor();
 console.log('PASS shared profile opens without login, renders only escaped name, survives reload, and rejects invalid links');
}finally{await browser.close();}
