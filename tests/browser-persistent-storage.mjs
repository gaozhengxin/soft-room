import {chromium} from 'playwright-core';
import {build} from 'vite';
import assert from 'node:assert/strict';

const result=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:'tests/persistent-browser-harness.ts',formats:['es']}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code,browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage();await page.route('https://127.0.0.1:5173/persistent-storage-test',route=>route.fulfill({contentType:'text/html',body:`<script type="module">${code}</script>`}));await page.goto('https://127.0.0.1:5173/persistent-storage-test');const value=await page.evaluate(()=>globalThis.persistentStorageCheck());assert.equal(value.sameIdentity,true);assert.equal(value.extractable,false);assert.equal(value.accountSessionRoundTrip,true);assert.equal(value.profileCleared,true);assert.match(value.roomKey,/^[a-f0-9]{64}$/);console.log('PASS IndexedDB non-extractable MasterKey, encrypted account session, state round trip and local profile wipe');}finally{await browser.close();}
