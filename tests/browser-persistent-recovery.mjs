import {chromium} from 'playwright-core';
import {readFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import assert from 'node:assert/strict';

const root=new URL('../dist/',import.meta.url).pathname;
const appOrigin='https://identity.soft-room.test';
const pdsOrigin='https://pds.soft-room.test';
const did='did:plc:softroomrecoverytest';
const cid='bafyreigh2akiscaildcxngj3aevzg6w4xxl45h7iztzuuqop6ut3zo2w2i';
const records=new Map();
const requests=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const cors={'access-control-allow-origin':appOrigin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json'};

function recordKey(collection,rkey){return `${collection}/${rkey}`;}
function uri(collection,rkey){return `at://${did}/${collection}/${rkey}`;}

async function installRoutes(page){
 await page.route(`${appOrigin}/**`,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/cdn-cgi/trace'){await route.fulfill({body:'ip=203.0.113.8\nloc=US\n',contentType:'text/plain'});return;}
  const file=path==='/'?'index.html':path.slice(1);
  try{await route.fulfill({body:readFileSync(join(root,file)),contentType:mime[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'not found'});}
 });
 await page.route(`${pdsOrigin}/**`,async route=>{
  const request=route.request(),url=new URL(request.url());
  requests.push(`${request.method()} ${url.pathname}${url.search}`);
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
  if(url.pathname==='/xrpc/com.atproto.server.createSession'){
   await route.fulfill({headers:cors,body:JSON.stringify({accessJwt:'access-token',refreshJwt:'refresh-token',handle:'alice.test',did,active:true})});return;
  }
  if(url.pathname==='/xrpc/com.atproto.server.refreshSession'){
   await route.fulfill({headers:cors,body:JSON.stringify({accessJwt:'access-token-refreshed',refreshJwt:'refresh-token-refreshed',handle:'alice.test',did,active:true})});return;
  }
  if(url.pathname==='/xrpc/com.atproto.server.getSession'){
   await route.fulfill({headers:cors,body:JSON.stringify({handle:'alice.test',did,active:true})});return;
  }
  if(url.pathname==='/xrpc/com.atproto.repo.getRecord'){
   const collection=url.searchParams.get('collection'),rkey=url.searchParams.get('rkey'),value=records.get(recordKey(collection,rkey));
   if(!value){await route.fulfill({status:400,headers:cors,body:JSON.stringify({error:'RecordNotFound',message:'Record not found'})});return;}
   await route.fulfill({headers:cors,body:JSON.stringify({uri:uri(collection,rkey),cid,value})});return;
  }
  if(url.pathname==='/xrpc/com.atproto.repo.listRecords'){
   const collection=url.searchParams.get('collection'),items=[];
   for(const [key,value] of records)if(key.startsWith(`${collection}/`)){const rkey=key.slice(collection.length+1);items.push({uri:uri(collection,rkey),cid,value});}
   await route.fulfill({headers:cors,body:JSON.stringify({records:items})});return;
  }
  if(url.pathname==='/xrpc/com.atproto.repo.putRecord'){
   const body=JSON.parse(request.postData()||'{}');records.set(recordKey(body.collection,body.rkey),body.record);
   await route.fulfill({headers:cors,body:JSON.stringify({uri:uri(body.collection,body.rkey),cid})});return;
  }
  if(url.pathname==='/xrpc/com.atproto.repo.deleteRecord'){
   const body=JSON.parse(request.postData()||'{}');records.delete(recordKey(body.collection,body.rkey));await route.fulfill({headers:cors,body:'{}'});return;
  }
  requests.push(`UNHANDLED ${request.method()} ${url.pathname}${url.search}`);await route.fulfill({status:404,headers:cors,body:JSON.stringify({error:'NotFound'})});
 });
}

async function openForm(page,create){
 await page.goto(`${appOrigin}/`);
 await page.getByRole('button',{name:create?'Create persistent identity':'Sign in to persistent identity',exact:true}).click();
 if(create)await page.getByRole('button',{name:'I have a Bluesky account'}).click();
 await page.getByLabel('Bluesky account or handle').fill('alice.test');
 await page.getByLabel('App Password').fill('test-password');
 await page.getByText('Advanced settings',{exact:true}).click();
 await page.getByLabel('Account service address').fill(pdsOrigin);
}

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const firstContext=await browser.newContext({locale:'en-US',acceptDownloads:true}),first=await firstContext.newPage();await installRoutes(first);
 await openForm(first,true);
 await first.getByRole('button',{name:'Create Soft Room identity'}).click();
 try{await first.getByRole('heading',{name:'Save your recovery file'}).waitFor();}catch(error){console.error(await first.locator('body').innerText());console.error(requests.join('\n'));throw error;}
 const downloadPromise=first.waitForEvent('download');await first.getByRole('button',{name:'Download recovery file'}).click();const download=await downloadPromise,path=await download.path();assert(path);
 const recoveryContents=readFileSync(path,'utf8'),recovery=JSON.parse(recoveryContents);assert.equal(recovery.type,'soft-room-recovery');assert.equal(recovery.account,did);assert.match(recovery.recoveryCode,/^SRK1\./);
 await first.getByRole('button',{name:/I saved it safely/}).click();
 const firstSession=JSON.parse(await first.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.match(firstSession.secret,/^[a-f0-9]{64}$/);assert.equal(firstSession.name,'alice.test');
 assert(records.has('uk.wakukusmartrecipe.soft.identity/self'));assert(records.has('uk.wakukusmartrecipe.soft.recovery/self'));

 const secondContext=await browser.newContext({locale:'en-US'}),second=await secondContext.newPage();await installRoutes(second);
 await openForm(second,false);
 await second.getByLabel(/Recovery file/).setInputFiles({name:'Soft-Room-Recovery.softroom-recovery',mimeType:'application/json',buffer:Buffer.from(recoveryContents)});
 await second.getByText('Recovery file loaded',{exact:true}).waitFor();assert(await second.getByText('Recovery file loaded',{exact:true}).evaluate(node=>node.classList.contains('recovery-loaded')));
 await second.getByRole('button',{name:'Sign in and restore'}).click();
 await second.waitForFunction(()=>sessionStorage.getItem('soft-room/persistent-active/v1')!==null);
 const secondSession=JSON.parse(await second.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.equal(secondSession.secret,firstSession.secret);assert.equal(secondSession.name,'alice.test');assert.equal(await second.evaluate(()=>sessionStorage.getItem('soft-room/persistent-active/v1')),did);
 await second.locator('#my-identity').click();await second.locator('#global-name').fill('Shared Name');await second.getByRole('button',{name:'Save username'}).click();await second.waitForTimeout(600);assert.equal(JSON.stringify([...records.values()]).includes('Shared Name'),false);

 const syncedContext=await browser.newContext({locale:'en-US'}),synced=await syncedContext.newPage();await installRoutes(synced);await openForm(synced,false);await synced.getByLabel(/Recovery file/).setInputFiles({name:'Soft-Room-Recovery.softroom-recovery',mimeType:'application/json',buffer:Buffer.from(recoveryContents)});await synced.getByRole('button',{name:'Sign in and restore'}).click();await synced.waitForFunction(()=>sessionStorage.getItem('soft-room/persistent-active/v1')!==null);let syncedSession=JSON.parse(await synced.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.equal(syncedSession.name,'Shared Name');
 const beforeRemote=JSON.stringify(records.get('uk.wakukusmartrecipe.soft.identity/self'));await synced.locator('#my-identity').click();await synced.locator('#global-name').fill('Remote Name');await synced.getByRole('button',{name:'Save username'}).click();await synced.waitForTimeout(2000);assert.notEqual(JSON.stringify(records.get('uk.wakukusmartrecipe.soft.identity/self')),beforeRemote);

 await second.evaluate(()=>window.dispatchEvent(new Event('focus')));await second.waitForFunction(()=>JSON.parse(sessionStorage.getItem('soft-room/session/v1')).name==='Remote Name');const refreshesBefore=requests.filter(value=>value.includes('/xrpc/com.atproto.server.refreshSession')).length;
 await second.evaluate(()=>sessionStorage.removeItem('soft-room/persistent-active/v1'));await second.reload();await second.getByRole('button',{name:'Continue as alice.test'}).click();await second.locator('#my-identity').waitFor();const refreshedSession=JSON.parse(await second.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.equal(refreshedSession.name,'Remote Name');assert(requests.filter(value=>value.includes('/xrpc/com.atproto.server.refreshSession')).length>refreshesBefore);
 second.once('dialog',dialog=>dialog.accept());await second.getByRole('button',{name:'Log out',exact:true}).click();await second.getByRole('heading',{name:'Choose your identity'}).waitFor();assert.equal(await second.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')),null);await second.getByRole('button',{name:'Continue as alice.test'}).click();await second.getByText(/needs one new Bluesky sign-in/).waitFor();

 const thirdContext=await browser.newContext({locale:'en-US'}),third=await thirdContext.newPage();await installRoutes(third);await openForm(third,false);await third.getByRole('button',{name:'Sign in and restore'}).click();await third.getByRole('alert').filter({hasText:/current identity is still temporary/}).waitFor();
 const thirdSession=JSON.parse(await third.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.equal(thirdSession.name,'alice.test');assert.notEqual(thirdSession.secret,firstSession.secret);assert.equal(await third.evaluate(()=>sessionStorage.getItem('soft-room/persistent-active/v1')),null);assert.equal(await third.evaluate(()=>sessionStorage.getItem('soft-room/persistent-recovery-pending/v1')),'1');
 await thirdContext.close();await syncedContext.close();await secondContext.close();await firstContext.close();
 console.log('PASS recovery restores identity, usernames sync through encrypted PDS state, no-file login stays temporary, and logout returns to identity selection');
}finally{await browser.close();}
