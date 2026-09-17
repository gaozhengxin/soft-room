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
 const firstSession=JSON.parse(await first.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.match(firstSession.secret,/^[a-f0-9]{64}$/);
 assert(records.has('uk.wakukusmartrecipe.soft.identity/self'));assert(records.has('uk.wakukusmartrecipe.soft.recovery/self'));

 const secondContext=await browser.newContext({locale:'en-US'}),second=await secondContext.newPage();await installRoutes(second);
 await openForm(second,false);
 await second.getByLabel(/Recovery file/).setInputFiles({name:'Soft-Room-Recovery.softroom-recovery',mimeType:'application/json',buffer:Buffer.from(recoveryContents)});
 await second.getByRole('button',{name:'Sign in and restore'}).click();
 await second.waitForFunction(()=>sessionStorage.getItem('soft-room/persistent-active/v1')!==null);
 const secondSession=JSON.parse(await second.evaluate(()=>sessionStorage.getItem('soft-room/session/v1')));assert.equal(secondSession.secret,firstSession.secret);assert.equal(await second.evaluate(()=>sessionStorage.getItem('soft-room/persistent-active/v1')),did);
 await secondContext.close();await firstContext.close();
 console.log('PASS recovery file restores the same persistent Waku identity on a new device');
}finally{await browser.close();}
