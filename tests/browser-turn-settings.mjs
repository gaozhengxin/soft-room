import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling']});
try{
 const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:375,height:812},isMobile:true,hasTouch:true,locale:'zh-CN'});let relayRequests=0;page.on('request',r=>{if(r.url().includes('soft-room-turn.'))relayRequests++;});
 await page.goto('https://127.0.0.1:5173/');await page.locator('#sidebar-toggle').click();await page.locator('#new-room').click();await page.locator('#room-name').fill('Relay settings');await page.locator('.toggle').click();await page.locator('#create-button').click();await page.waitForFunction(()=>!document.querySelector('#send')?.disabled,null,{timeout:90000});
 await page.locator('#room-network').click();await page.locator('#channel-new').click();await page.locator('#channel-name').fill('Custom relay');await page.locator('#channel-create button').click();
 await page.locator('#channel-advanced summary').click();assert.equal(await page.locator('#channel-turn-urls').inputValue(),'');assert.ok(!(await page.locator('#channel-advanced').textContent()).includes('cloudflare'));assert.ok(!(await page.locator('#channel-advanced').textContent()).includes('workers.dev'));
 await page.locator('#channel-custom-turn').check();await page.locator('#channel-turn-urls').fill('turns:relay.example:443?transport=tcp');await page.locator('#channel-turn-user').fill('local-user');await page.locator('#channel-turn-password').fill('local-password');await page.locator('#channel-turn-form button').click();assert.equal(await page.locator('#channel-advanced').getAttribute('open'),null);
 await page.locator('#channel-advanced summary').click();assert.equal(await page.locator('#channel-turn-user').inputValue(),'local-user');assert.equal(await page.locator('#channel-turn-password').getAttribute('type'),'password');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(relayRequests,0);
 await page.locator('#channel-back').click();assert.equal(await page.locator('#channel-turn-password').inputValue(),'');console.log('PASS: mobile advanced settings, custom credentials, no built-in relay exposure or requests, cleanup');
}finally{await browser.close();}
