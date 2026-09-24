import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {continueTemporary} from './browser-identity.mjs';

const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
const page=await context.newPage();
const failures=[];page.on('pageerror',error=>failures.push(error.message));
try{
 let uploadObserved=false;
 await page.route('https://storage.wakukusmartrecipe.uk/api/storage/v1/data',async route=>{uploadObserved=true;await new Promise(resolve=>setTimeout(resolve,600));await route.continue();});
 await page.goto(origin);await continueTemporary(page);
 await page.locator('#new-room').click();
 await page.locator('#room-name').fill('File check '+Date.now());
 await page.locator('#pow').uncheck();
 await page.locator('#create-button').click();
 await page.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:120000});
 await page.locator('#attach').click();
 const source='# Attachment check\n\n- encrypted original\n- inline markdown\n';
 await page.locator('#file-input').setInputFiles({name:'room-note.md',mimeType:'text/markdown',buffer:Buffer.from(source)});
 assert.equal(await page.locator('#file-quality-row').isVisible(),false);
 await page.locator('#file-submit').click();
 await page.locator('#file-wait').waitFor({state:'visible'});assert.ok(await page.locator('#file-wait-title').innerText());
 const card=page.locator('.attachment-card').filter({hasText:'room-note.md'});await card.waitFor({timeout:60000});
 await page.locator('#file-wait').waitFor({state:'hidden'});
 assert.ok(uploadObserved);assert.deepEqual(failures,[]);console.log('PASS encrypted Markdown upload with visible wait state');
}finally{await browser.close();}
