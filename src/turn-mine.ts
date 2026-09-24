import {type TurnChallenge,turnWorkChecker} from './turn-proof.ts';
export function mineTurn(challenge:TurnChallenge,signal:AbortSignal,progress:(elapsed:number)=>void):Promise<number>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
  const worker=new Worker(new URL('./turn-pow.worker.ts',import.meta.url),{type:'module'});
  const clean=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
  const abort=()=>{clean();reject(new DOMException('Cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>{clean();reject(Error('Work failed'));};
  worker.onmessage=event=>{const value=event.data;if(value.type==='progress')progress(value.elapsed);else if(value.type==='done'){clean();if(turnWorkChecker(challenge)(value.nonce))resolve(value.nonce);else reject(Error('Invalid work'));}else{clean();reject(Error('Work failed'));}};
  worker.postMessage(challenge);
 });
}
