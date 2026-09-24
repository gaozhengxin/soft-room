import { dayEpoch, validWork, type Room } from './protocol.ts';
export type WorkProgress={attempts:number;elapsed:number};
export function computeWork(room:Room,sender:string,signal:AbortSignal,progress:(value:WorkProgress)=>void,epoch=dayEpoch()):Promise<number>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
  if(!room.pow){resolve(0);return;}
  const worker=new Worker(new URL('./pow.worker.ts',import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};
  signal.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>{cleanup();reject(Error('workerFailed'));};
  worker.onmessage=event=>{
   const value=event.data;
   if(value.type==='progress')progress(value);
   if(value.type==='done'){cleanup();if(validWork(room,sender,value.nonce,epoch)){progress(value);resolve(value.nonce);}else reject(Error('workerFailed'));}
   if(value.type==='error'){cleanup();reject(Error('workerFailed'));}
  };
  worker.postMessage({room,sender,epoch});
 });
}

export function computeReadKey(seed:string,signal:AbortSignal,progress:(value:WorkProgress)=>void):Promise<string>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
  const worker=new Worker(new URL('./pow.worker.ts',import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};
  signal.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>{cleanup();reject(Error('workerFailed'));};
  worker.onmessage=event=>{const value=event.data;if(value.type==='progress')progress(value);if(value.type==='done'){cleanup();if(typeof value.key==='string'&&/^[a-f0-9]{64}$/.test(value.key)){progress(value);resolve(value.key);}else reject(Error('workerFailed'));}if(value.type==='error'){cleanup();reject(Error('workerFailed'));}};
  worker.postMessage({type:'read',seed});
 });
}
