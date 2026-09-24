// Capture a visible message, not the total height: wrapping and prepends both change height.
export function preserveScroll(log:HTMLElement){
 const bottom=log.scrollHeight-log.clientHeight-log.scrollTop<32,top=log.scrollTop;
 const rect=log.getBoundingClientRect();
 const anchor=Array.from(log.querySelectorAll<HTMLElement>('[data-message]')).find(el=>el.getBoundingClientRect().bottom>rect.top);
 const id=anchor?.dataset.message,offset=anchor?anchor.getBoundingClientRect().top-rect.top:0;
 return ()=>{
  if(bottom){log.scrollTop=log.scrollHeight;return;}
  const next=Array.from(log.querySelectorAll<HTMLElement>('[data-message]')).find(el=>el.dataset.message===id);
  log.scrollTop=next?log.scrollTop+next.getBoundingClientRect().top-log.getBoundingClientRect().top-offset:top;
 };
}
