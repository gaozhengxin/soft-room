import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {seal,open,topic,invite,parseInvite,makeRoom,deriveReadKey,workChecker,dayEpoch} from '../src/protocol.ts';
const origin=process.env.LOCAL_WAKU_ORIGIN||'https://localhost:5173';
// Public deterministic test fixture: do not use this identity or key for real chats.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/current.json',import.meta.url),'utf8'));
const room=process.env.TEST_DAILY_POW?makeRoom('daily Waku test',true):parseInvite(invite(fixture.room));
if(room.v===2){room.key=deriveReadKey(room.seed!);const check=workChecker(room,fixture.publicKey,dayEpoch());let nonce=0;while(!check(nonce))nonce++;fixture.nonce=nonce;}
const clients:WebSocket[]=[];let deadline:ReturnType<typeof setTimeout>;
async function client(){
 const ws=new WebSocket(origin.replace(/^http/,'ws')+'/waku-api',{ca:readFileSync('.certs/cert.pem'),origin});clients.push(ws);
 await new Promise<void>((resolve,reject)=>{
  ws.on('open',()=>ws.send(JSON.stringify({type:'join',topic:topic(room)})));
  ws.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='ready')resolve();if(m.type==='error')reject(Error(m.message));});
  ws.on('error',reject);ws.on('close',()=>reject(Error('Closed before ready')));
 });
 return ws;
}
async function deliver(sender:WebSocket,receiver:WebSocket,body:string){
 const identity={secret:new Uint8Array(32).fill(34),publicKey:fixture.publicKey},nonce=fixture.nonce;
 const packet=seal(room,identity,nonce,body,body.includes("device A")?"Alice":"小明");
 const reception=new Promise<void>((resolve,reject)=>{
  receiver.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='message')try{const message=open(room,Buffer.from(m.payload,'base64'));if(message.id===packet.message.id){assert.equal(message.text,body);assert.equal(message.nickname,packet.message.nickname);resolve();}}catch(e){reject(e);}});
 });
 const ack=new Promise<void>((resolve,reject)=>{sender.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='sent'&&m.id===1)resolve();if(m.type==='error')reject(Error(m.message));});});
 sender.send(JSON.stringify({type:'send',id:1,payload:Buffer.from(packet.payload).toString('base64')}));
 await Promise.all([ack,reception]);
}
try{
 await Promise.race([(async()=>{const [a,b]=await Promise.all([client(),client()]);await deliver(a,b,'hello from device A');await deliver(b,a,'hello from device B');})(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Gateway E2E timeout')),90000);})]);
 console.log('PASS: two HTTPS clients, real Waku delivery both directions, room encryption + identity signatures + PoW verified');
}catch(error){console.error('FAIL:',(error as Error).message);process.exitCode=1;}
finally{clearTimeout(deadline!);for(const ws of clients)ws.close();}
process.exit(process.exitCode||0);
