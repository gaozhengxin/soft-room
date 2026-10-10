export type ControlSpec={id:string;icon:string;label:string};
export type ChannelControls={root:HTMLElement;button:(id:string)=>HTMLButtonElement;setFullscreen:(on:boolean)=>void;setHidden:(hidden:boolean)=>void;reveal:()=>void;setChatOpen:(open:boolean)=>void};
export function createChannelControls(specs:ControlSpec[]):ChannelControls{
 const root=document.createElement('div');root.className='channel-media-controls';root.id='channel-controls';
 const buttons=new Map<string,HTMLButtonElement>();
 for(const spec of specs){const button=document.createElement('button');button.type='button';button.id=spec.id;button.innerHTML=spec.icon;button.title=spec.label;button.setAttribute('aria-label',spec.label);root.append(button);buttons.set(spec.id,button);}
 let timer=0,fullscreen=false;
 const show=()=>{delete root.dataset.hidden;window.clearTimeout(timer);if(fullscreen)timer=window.setTimeout(()=>{root.dataset.hidden='true';},3200);};
 const reveal=()=>{show();};
 window.addEventListener('pointermove',reveal,{passive:true});
 window.addEventListener('pointerdown',reveal,{passive:true});
 window.addEventListener('keydown',reveal);
 root.addEventListener('pointerenter',()=>{window.clearTimeout(timer);delete root.dataset.hidden;});
 root.addEventListener('pointerleave',()=>{if(fullscreen)timer=window.setTimeout(()=>{root.dataset.hidden='true';},1200);});
 return {
  root,
  button:(id:string)=>buttons.get(id)!,
  setFullscreen:(on:boolean)=>{fullscreen=on;show();},
  setHidden:(hidden:boolean)=>{if(hidden)root.dataset.hidden='true';else show();},
  reveal,
  setChatOpen:(open:boolean)=>buttons.get('channel-chat')?.setAttribute('aria-pressed',String(open)),
 };
}
