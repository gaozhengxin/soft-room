import { deriveReadKey, READ_ROUNDS, workChecker, type Room } from './protocol.ts';
self.onmessage = (event: MessageEvent<{type?:string;seed:string;room:Room;sender:string;epoch?:number}>) => {
 if(event.data.type==='read'){
  const start=performance.now();let last=start;
  try{const key=deriveReadKey(event.data.seed,attempts=>{const now=performance.now();if(now-last>=250){last=now;self.postMessage({type:'progress',attempts,elapsed:now-start});}});self.postMessage({type:'done',key,attempts:READ_ROUNDS,elapsed:performance.now()-start});}catch{self.postMessage({type:'error'});}return;
 }
 const {room,sender,epoch}=event.data;
 const check=workChecker(room,sender,epoch),start=performance.now();
 let last=start;
 for(let nonce=0;nonce<Number.MAX_SAFE_INTEGER;nonce++){
  if(!room.pow || check(nonce)) {self.postMessage({type:'done',nonce,attempts:nonce+1,elapsed:performance.now()-start});return;}
  if(nonce%4096===0){const now=performance.now();if(now-last>=250){last=now;self.postMessage({type:'progress',attempts:nonce+1,elapsed:now-start});}}
 }
 self.postMessage({type:'error'});
};
