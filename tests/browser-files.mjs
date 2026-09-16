import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const origin=process.env.STATIC_ORIGIN||'https://127.0.0.1:5173';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
const page=await context.newPage();
const failures=[];page.on('pageerror',error=>failures.push(error.message));
try{
 await page.goto(origin);
 await page.locator('#new-room').click();
 await page.locator('#room-name').fill('File check '+Date.now());
 await page.locator('#pow').uncheck();
 await page.locator('#create-button').click();
 await page.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:120000});
 await page.locator('#attach').click();
 const source='# Attachment check\n\n- encrypted original\n- inline markdown\n';
 await page.locator('#file-input').setInputFiles({name:'room-note.md',mimeType:'text/markdown',buffer:Buffer.from(source)});
 await page.locator('#file-quality').selectOption('original');
 await page.locator('#file-submit').click();
 const card=page.locator('.attachment-card').filter({hasText:'room-note.md'});await card.waitFor({timeout:60000});
 await card.getByRole('button',{name:/房间内浏览|View in room/}).click();
 await card.getByText('Attachment check',{exact:true}).waitFor();
 const downloadPromise=page.waitForEvent('download');await card.getByRole('button',{name:/下载原文件|Download original/}).click();
 const download=await downloadPromise,path=await download.path(),fs=await import('node:fs/promises');assert.equal(await fs.readFile(path,'utf8'),source);
 await page.reload();
 await page.locator('.attachment-card').filter({hasText:'room-note.md'}).waitFor({timeout:90000});
 const roomId=await page.evaluate(async()=>{for(const raw of Object.values(sessionStorage)){try{const state=JSON.parse(raw),room=state.rooms?.find(item=>item.room?.name?.startsWith('File check'))?.room;if(!room)continue;const value=room.v===2?['soft-room/v2',room.seed,room.name,room.pow]:['soft-room/v1',room.key,room.name,room.pow],hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))));return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');}catch{}}throw Error('Test room not found');});
 assert.deepEqual(failures,[]);console.log('PASS encrypted Markdown upload, inline view, original download and history recovery',roomId);
}finally{await browser.close();}
