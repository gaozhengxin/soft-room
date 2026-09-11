import {turnWorkChecker,type TurnChallenge} from './turn-proof.ts';
self.onmessage=(event:MessageEvent<TurnChallenge>)=>{
 try{const check=turnWorkChecker(event.data),start=performance.now();let last=start;
 for(let nonce=0;nonce<Number.MAX_SAFE_INTEGER;nonce++){
  if(check(nonce)){self.postMessage({type:'done',nonce});return;}
  if(nonce%4096===0){const now=performance.now();if(now-last>250){last=now;self.postMessage({type:'progress',attempts:nonce+1,elapsed:now-start});}}
 }
 }catch{self.postMessage({type:'error'});}
};
