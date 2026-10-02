export function mountMessageActions(log:HTMLElement,language:()=>string,remove:(id:string)=>void){
 const menu=document.createElement('dialog');menu.id='message-actions';menu.className='message-actions';
 const button=document.createElement('button');button.id='message-delete';button.className='danger';menu.append(button);document.body.append(menu);
 let timer=0,start:{x:number;y:number;id:string}|undefined,suppressClick=false;
 const cancel=()=>{clearTimeout(timer);start=undefined;};
 const row=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('article[data-message]'):null;
 const show=(id:string,x:number,y:number)=>{cancel();button.textContent=language()==='zh'?'删除':'Delete';button.onclick=()=>{menu.close();remove(id);};if(!menu.open)menu.showModal();const r=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';button.focus();};
 log.addEventListener('contextmenu',e=>{const target=row(e.target);if(!target)return;e.preventDefault();show(target.dataset.message!,e.clientX,e.clientY);});
 log.addEventListener('pointerdown',e=>{cancel();if(e.pointerType!=='touch'&&e.pointerType!=='pen')return;const target=row(e.target);if(!target)return;suppressClick=false;start={x:e.clientX,y:e.clientY,id:target.dataset.message!};timer=window.setTimeout(()=>{if(!start)return;const {id,x,y}=start;suppressClick=true;show(id,x,y);},550);},{passive:true});
 log.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>10)cancel();},{passive:true});
 for(const event of ['pointerup','pointercancel','scroll'])log.addEventListener(event,cancel,{passive:true});window.addEventListener('blur',cancel);
 log.addEventListener('click',e=>{if(!suppressClick)return;suppressClick=false;e.preventDefault();e.stopImmediatePropagation();},true);
 log.addEventListener('keydown',e=>{if(e.key!=='ContextMenu'&&!(e.shiftKey&&e.key==='F10'))return;const target=row(e.target);if(!target)return;e.preventDefault();const rect=target.getBoundingClientRect();show(target.dataset.message!,rect.left+20,rect.top+20);});
 menu.addEventListener('close',()=>{suppressClick=false;});menu.addEventListener('click',e=>{if(e.target===menu)menu.close();});return {close:()=>{cancel();menu.close();}};
}
