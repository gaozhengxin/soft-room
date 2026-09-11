import { topic, type Room } from './protocol.ts';
export async function connect(room: Room, receive: (payload: Uint8Array) => void, signal?: AbortSignal) {
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const socket=new WebSocket(`${location.origin.replace(/^http/,'ws')}/waku-api`);
 const abort=()=>socket.close();
 signal?.addEventListener('abort',abort,{once:true});
 socket.addEventListener('close',()=>signal?.removeEventListener('abort',abort));
 let nextId=0,ready=false;
 const pending=new Map<number,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.close();reject(Error('连接超时，请重试。'));},55000);
  socket.addEventListener('open',()=>socket.send(JSON.stringify({type:'join',topic:topic(room)})));
  socket.addEventListener('message',event=>{
   try{
    const result=JSON.parse(event.data);
    if(result.type==='ready'){ready=true;clearTimeout(timer);resolve();}
    if(result.type==='message'&&typeof result.payload==='string'&&result.payload.length<=22000)receive(Uint8Array.from(atob(result.payload),c=>c.charCodeAt(0)));
    if(result.type==='sent'||result.type==='error'){
     const item=pending.get(result.id);
     if(item){clearTimeout(item.timer);pending.delete(result.id);result.type==='sent'?item.resolve():item.reject(Error('消息未确认。'));}
     else if(!ready&&result.type==='error'){clearTimeout(timer);socket.close();reject(Error('Waku 连接失败。'));}
    }
   }catch{ /* Invalid gateway frames are ignored. Ciphertext is verified separately. */ }
  });
  const disconnected=()=>{ready=false;clearTimeout(timer);reject(Error('连接中断。'));for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('连接中断。'));}pending.clear();};
  socket.addEventListener('error',disconnected);socket.addEventListener('close',disconnected);
 });
 return {
  send(payload:Uint8Array){return new Promise<void>((resolve,reject)=>{
   if(!ready||socket.readyState!==WebSocket.OPEN){reject(Error('连接中断。'));return;}
   const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('发送超时。'));},20000);
   pending.set(id,{resolve,reject,timer});
   socket.send(JSON.stringify({type:'send',id,payload:btoa(String.fromCharCode(...payload))}));
  });},
  connected:()=>ready&&socket.readyState===WebSocket.OPEN,
  stop:async()=>{socket.close();}
 };
}
