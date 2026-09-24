import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIceProvider,turnConfiguration,customTurnServer} from '../src/ice.ts';
import {challengeFor,signTurnProof,turnWorkChecker,verifyTurnProof,TURN_EPOCH_MS} from '../src/turn-proof.ts';
import {makeIdentity} from '../src/protocol.ts';
import {handle,type Env} from '../workers/turn/index.ts';
const servers=[{urls:['turn:turn.cloudflare.com:3478?transport=udp','turns:turn.cloudflare.com:443?transport=tcp'],username:'temporary-user',credential:'temporary-password'}];
const user=makeIdentity(),secret='server-secret';
const solve=(c:ReturnType<typeof challengeFor>)=>{const check=turnWorkChecker(c);let nonce=0;while(!check(nonce))nonce++;return nonce;};
test('TURN proof binds epoch, identity, difficulty, server challenge and signature',()=>{
 const now=TURN_EPOCH_MS*100+1000,c=challengeFor(user.publicKey,secret,now,4),proof=signTurnProof(c,solve(c),user.secret);
 assert.ok(verifyTurnProof(proof,secret,now,4));assert.ok(!verifyTurnProof(proof,secret,now+TURN_EPOCH_MS,4));assert.ok(!verifyTurnProof(proof,'other secret',now,4));assert.ok(!verifyTurnProof(proof,secret,now,5));
 for(const bad of [{...proof,signature:'00'.repeat(64)},{...proof,challenge:{...c,publicKey:makeIdentity().publicKey}},{...proof,nonce:-1},{...proof,challenge:{...c,seed:'00'.repeat(32)}}])assert.ok(!verifyTurnProof(bad,secret,now,4));
});
test('TURN response and custom relay URLs are validated',()=>{
 assert.equal(turnConfiguration({iceServers:servers,expiresAt:Date.now()+900000}).configuration.iceServers?.length,2);
 assert.throws(()=>turnConfiguration({iceServers:servers,expiresAt:0}));
 assert.deepEqual(customTurnServer('turns:relay.example:443?transport=tcp','user','pass').urls,['turns:relay.example:443?transport=tcp']);
 for(const url of ['https://bad.example','turn:user:pass@host:3478','javascript:alert(1)'])assert.throws(()=>customTurnServer(url,'u','p'));
});
test('one proof is reused in its epoch and a new epoch requires new work',async()=>{
 let now=TURN_EPOCH_MS*100+1000,mined=0,issued=0;
 const provider=createIceProvider('https://turn.example/ice',async(url,init)=>{
  if(String(url).includes('/challenge'))return Response.json(challengeFor(user.publicKey,secret,now,4));
  assert.equal(init?.method,'POST');assert.ok(verifyTurnProof(JSON.parse(String(init?.body)),secret,now,4));issued++;return Response.json({iceServers:servers,expiresAt:(Math.floor(now/TURN_EPOCH_MS)+1)*TURN_EPOCH_MS});
 },()=>now,()=>user,()=>{},undefined,async c=>{mined++;return solve(c);});
 const values=await Promise.all([provider(),provider()]);assert.equal(values[0].iceServers?.length,2);assert.equal(mined,1);assert.equal(issued,1);await provider();assert.equal(mined,1);
 now+=TURN_EPOCH_MS;await provider();assert.equal(mined,2);assert.equal(issued,2);
});
const env:Env={TURN_KEY_ID:'key-id',TURN_API_TOKEN:secret,TURN_POW_BITS:'4',ALLOWED_ORIGINS:'https://app.example',TURN_RATE_LIMITER:{limit:async()=>({success:true})}};
const req=(body:unknown,origin='https://app.example')=>new Request('https://turn.example/ice',{method:'POST',headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json'},body:JSON.stringify(body)});
test('Worker rejects missing, stale and forged work before calling Cloudflare; TTL stays in epoch',async()=>{
 let calls=0;const c=challengeFor(user.publicKey,secret,Date.now(),4),proof=signTurnProof(c,solve(c),user.secret);
 const upstream:typeof fetch=async(url,options)=>{calls++;assert.equal(options?.redirect,'manual');assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer server-secret');const ttl=JSON.parse(String(options?.body)).ttl;assert.ok(ttl>0&&ttl<=7200);return Response.json({iceServers:servers});};
 for(const value of [{},{...proof,signature:'00'.repeat(64)},{...proof,challenge:{...c,epoch:c.epoch-1}}])assert.equal((await handle(req(value),env,upstream)).status,403);assert.equal(calls,0);
 const result=await handle(req(proof),env,upstream);assert.equal(result.status,200);const body=await result.json() as {expiresAt:number};assert.ok(body.expiresAt<=c.expiresAt);assert.equal(calls,1);
 assert.equal((await handle(req(proof,'https://bad.example'),env,upstream)).status,403);
 assert.equal((await handle(req(proof),{...env,TURN_RATE_LIMITER:{limit:async()=>({success:false})}},upstream)).status,429);
 const oldGet=new Request('https://turn.example/ice',{headers:{Origin:'https://app.example'}});assert.equal((await handle(oldGet,env,upstream)).status,405);
});
test('completed proof survives a refresh within the same session and epoch',async()=>{
 const now=TURN_EPOCH_MS*200+1000,map=new Map<string,string>();let mined=0;
 const storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}} as Storage;
 const request:typeof fetch=async(url,init)=>String(url).includes('/challenge')?Response.json(challengeFor(user.publicKey,secret,now,4)):Response.json({iceServers:servers,expiresAt:now+600000});
 const make=()=>createIceProvider('https://turn.example/ice',request,()=>now,()=>user,()=>{},storage,async c=>{mined++;return solve(c);});
 await make()();await make()();assert.equal(mined,1);
});

test('fractional difficulty verifies work and remains bound to the server challenge',()=>{
 const now=TURN_EPOCH_MS*100+1000,bits=4.5,c=challengeFor(user.publicKey,secret,now,bits);
 const proof=signTurnProof(c,solve(c),user.secret);
 assert.ok(verifyTurnProof(proof,secret,now,bits));
 assert.ok(!verifyTurnProof(proof,secret,now,4));
 assert.ok(!verifyTurnProof({...proof,challenge:{...c,bits:4}},secret,now,4));
 for(const invalid of [NaN,Infinity,-Infinity,0,31])assert.throws(()=>challengeFor(user.publicKey,secret,now,invalid));
});

test('a rejected cached proof is renewed immediately without a thirty-second STUN-only fallback',async()=>{
 const now=TURN_EPOCH_MS*200+1000,old=challengeFor(user.publicKey,secret,now,5);
 const map=new Map([['soft-room/turn-proof',JSON.stringify(signTurnProof(old,solve(old),user.secret))]]);
 const storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}} as Storage;
 let posts=0,mined=0;
 const request:typeof fetch=async(url,init)=>{
  if(String(url).includes('/challenge'))return Response.json(challengeFor(user.publicKey,secret,now,4));
  posts++;const proof=JSON.parse(String(init?.body));
  return verifyTurnProof(proof,secret,now,4)?Response.json({iceServers:servers,expiresAt:now+600000}):new Response('Invalid proof',{status:403});
 };
 const provider=createIceProvider('https://turn.example/ice',request,()=>now,()=>user,()=>{},storage,async c=>{mined++;return solve(c);});
 assert.equal((await provider()).iceServers?.length,2);assert.equal(provider.state.status,'ready');assert.equal(mined,1);assert.equal(posts,2);
});

test('repeated rejection has a bounded retry and reports failure',async()=>{
 const now=TURN_EPOCH_MS*200+1000;let posts=0;
 const provider=createIceProvider('https://turn.example/ice',async url=>{
  if(String(url).includes('/challenge'))return Response.json(challengeFor(user.publicKey,secret,now,4));
  posts++;return new Response('Forbidden',{status:403});
 },()=>now,()=>user,()=>{},undefined,async c=>solve(c));
 await provider();assert.equal(posts,2);assert.equal(provider.state.status,'error');
 await provider();assert.equal(posts,2);
});

test('Worker retries a transient provider failure once after verifying proof',async()=>{
 const c=challengeFor(user.publicKey,secret,Date.now(),4),proof=signTurnProof(c,solve(c),user.secret);let calls=0;
 const result=await handle(req(proof),env,async()=>{calls++;return calls===1?new Response('Unavailable',{status:503}):Response.json({iceServers:servers});});
 assert.equal(result.status,200);assert.equal(calls,2);
 assert.ok((await result.json() as {expiresAt:number}).expiresAt<c.expiresAt);
 calls=0;const permanent=await handle(req(proof),env,async()=>{calls++;return new Response('Unauthorized',{status:401});});
 assert.equal(permanent.status,502);assert.equal(calls,1);
});

test('provider retries shorten the TTL instead of extending the authorized epoch',async t=>{
 let now=TURN_EPOCH_MS*200+1000;t.mock.method(Date,'now',()=>now);
 const c=challengeFor(user.publicKey,secret,now,4),proof=signTurnProof(c,solve(c),user.secret),ttls:number[]=[];
 const response=await handle(req(proof),env,async(_url,options)=>{
  ttls.push(JSON.parse(String(options?.body)).ttl);
  if(ttls.length===1){now+=6000;return new Response('Unavailable',{status:503});}
  return Response.json({iceServers:servers});
 });
 assert.equal(response.status,200);assert.equal(ttls[0]-ttls[1],6);
 assert.equal((await response.json() as {expiresAt:number}).expiresAt,c.expiresAt-10000);
});
