// Capacitor can run on an older Android System WebView than the installed browser.
// Waku/libp2p uses these small modern helpers only after a room starts connecting.
type Resolvers<T>={promise:Promise<T>;resolve:(value:T|PromiseLike<T>)=>void;reject:(reason?:unknown)=>void};
const PromiseCompat=Promise as PromiseConstructor&{withResolvers?:<T>()=>Resolvers<T>;any?:<T>(values:Iterable<T|PromiseLike<T>>)=>Promise<Awaited<T>>;try?:(callback:(...args:unknown[])=>unknown,...args:unknown[])=>Promise<unknown>};
if(!PromiseCompat.withResolvers)PromiseCompat.withResolvers=function<T>(){
 let resolve!:Resolvers<T>['resolve'],reject!:Resolvers<T>['reject'];
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};
};
if(!PromiseCompat.any)PromiseCompat.any=function<T>(values:Iterable<T|PromiseLike<T>>){
 return new Promise<Awaited<T>>((resolve,reject)=>{const errors:unknown[]=[],items=Array.from(values);if(!items.length){reject(new AggregateError([],'All promises were rejected'));return;}let pending=items.length;items.forEach((item,index)=>Promise.resolve(item).then(resolve,error=>{errors[index]=error;if(--pending===0)reject(new AggregateError(errors,'All promises were rejected'));}));});
};
if(!PromiseCompat.try)PromiseCompat.try=(callback,...args)=>Promise.resolve().then(()=>callback(...args));
const SignalCompat=AbortSignal as typeof AbortSignal&{timeout?:(milliseconds:number)=>AbortSignal;any?:(signals:AbortSignal[])=>AbortSignal};
if(!SignalCompat.timeout)SignalCompat.timeout=(milliseconds:number)=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Timed out','TimeoutError')),milliseconds);return controller.signal;};
if(!SignalCompat.any)SignalCompat.any=(signals:AbortSignal[])=>{const controller=new AbortController();const abort=(signal:AbortSignal)=>{if(!controller.signal.aborted)controller.abort(signal.reason);};for(const signal of signals){if(signal.aborted){abort(signal);break;}signal.addEventListener('abort',()=>abort(signal),{once:true});}return controller.signal;};
if(!Object.hasOwn)Object.hasOwn=(object:object,key:PropertyKey)=>Object.prototype.hasOwnProperty.call(object,key);
if(!Array.prototype.at)Object.defineProperty(Array.prototype,'at',{value:function<T>(this:T[],index:number){const position=Math.trunc(index)||0;return this[position<0?this.length+position:position];},writable:true,configurable:true});
const ByteArrayCompat=Uint8Array as typeof Uint8Array&{fromBase64?:(value:string)=>Uint8Array};
if(!ByteArrayCompat.fromBase64)ByteArrayCompat.fromBase64=(value:string)=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
const URLCompat=URL as typeof URL&{parse?:(value:string,base?:string|URL)=>URL|null};
if(!URLCompat.parse)URLCompat.parse=(value:string,base?:string|URL)=>{try{return new URL(value,base);}catch{return null;}};
if(!crypto.randomUUID)crypto.randomUUID=()=>{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;const value=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;};
