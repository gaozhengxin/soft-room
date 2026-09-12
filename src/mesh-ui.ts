import {customTurnServer} from './ice.ts';
import './mesh.css';
import {channelEnabled,channelMode,type ChannelMode,type Network} from './mesh-wire.ts';
import {ChannelMedia} from './channel-media.ts';
import type {RoomMesh} from './mesh.ts';
import type {TextKey} from './i18n.ts';
import micIcon from './icons/mic.svg?raw';
import videoIcon from './icons/video.svg?raw';
import radioIcon from './icons/radio.svg?raw';
import backIcon from './icons/arrow-left.svg?raw';
type Options={host:Element;button:HTMLButtonElement;t:(key:TextKey,params?:Record<string,string|number>)=>string;getMesh:()=>RoomMesh|undefined;canJoin:()=>boolean;name:(key:string)=>string;selfName:()=>string;isSelf:(key:string)=>boolean};
const holdIcon=`<span class="hold-art" aria-hidden="true"><span class="hold-sage">${micIcon}</span><svg class="hold-patrol" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"><path d="M32 5 39 23 57 30 39 37 32 57 25 37 7 30 25 23Z"/><path d="m14 49 36-36M19 52l33-33"/><circle cx="32" cy="30" r="7"/></svg><svg class="hold-beetle" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M32 30V10m0 8L21 9V4m11 14L43 9V4M24 28l-9-6m25 6 9-6"/><path d="M32 27c-12 0-20 9-20 20l10 12h20l10-12c0-11-8-20-20-20Z"/><path d="M32 29v28M15 43l13 5m21-5-13 5"/><path d="m27 35 5-4 5 4-5 5Z"/></svg></span>`;
const modes:ChannelMode[]=['voice','video','walkie'];
const modeKey=(mode:ChannelMode):TextKey=>mode==='video'?'channelVideo':mode==='walkie'?'channelWalkie':'channelVoice';
const modeIcon=(mode:ChannelMode)=>mode==='video'?videoIcon:mode==='walkie'?radioIcon:micIcon;
export function mountMeshPanel(o:Options){
 const chat=o.host.querySelector<HTMLElement>('.chat')!;
 const dialog=document.createElement('dialog');dialog.id='mesh-dialog';dialog.className='sheet';
 dialog.innerHTML='<div class="sheet-head"><h2 data-i18n="meshTitle"></h2><button class="icon-button" data-label="close">×</button></div><div class="sheet-body"><button id="channel-new" class="primary" data-i18n="meshCreate"></button><p id="mesh-feedback" role="status"></p><div id="mesh-networks"></div></div>';
 o.host.append(dialog);
 const page=document.createElement('section');page.id='channel-page';page.className='channel-page';page.hidden=true;
 page.innerHTML=`<header class="channel-head"><button id="channel-back" class="icon-button">${backIcon}</button><div><small id="channel-mode-label"></small><h2 id="channel-title"></h2></div></header>
 <section id="channel-create-view"><form id="channel-create"><label for="channel-name" data-i18n="meshName"></label><input id="channel-name" maxlength="32" autocomplete="off" required/><fieldset><legend data-i18n="channelMode"></legend>${modes.map((mode,i)=>`<label class="channel-mode"><input type="radio" name="mode" value="${mode}" ${i===0?'checked':''}/><span>${modeIcon(mode)}<strong data-i18n="${modeKey(mode)}"></strong><small data-i18n="${mode==='voice'?'channelVoiceHint':mode==='video'?'channelVideoHint':'channelWalkieHint'}"></small></span></label>`).join('')}</fieldset><p data-i18n="channelMediaOff"></p><button class="primary" data-i18n="channelStart"></button></form></section>
 <section id="channel-session"><div class="channel-actions"><span id="channel-state"></span><button id="channel-power" type="button" hidden></button><button id="channel-leave" type="button" data-i18n="meshLeave"></button></div><p id="channel-connection" role="status"></p><p id="channel-relay-work" role="status" hidden><span class="relay-spinner"></span><span id="channel-relay-label"></span></p><details id="channel-advanced"><summary data-i18n="channelAdvanced"></summary><form id="channel-turn-form"><label><input id="channel-custom-turn" type="checkbox"/><span data-i18n="channelCustomTurn"></span></label><p data-i18n="channelCustomTurnHint"></p><div id="channel-turn-fields" hidden><label for="channel-turn-urls" data-i18n="channelTurnUrls"></label><textarea id="channel-turn-urls" rows="2" placeholder="turns:relay.example:443?transport=tcp"></textarea><label for="channel-turn-user" data-i18n="channelTurnUser"></label><input id="channel-turn-user" autocomplete="off"/><label for="channel-turn-password" data-i18n="channelTurnPassword"></label><input id="channel-turn-password" type="password" autocomplete="off"/></div><button type="submit" class="primary" data-i18n="channelTurnSave"></button><p id="channel-turn-status" role="status"></p></form></details><div id="channel-people"></div><button id="channel-play" data-i18n="channelPlay" hidden></button><div id="channel-messages" role="log" aria-live="polite"></div><div class="channel-media-controls"><button id="channel-mic"></button><button id="channel-camera"></button><button id="channel-hold"></button></div><form id="channel-composer"><label class="sr-only" for="channel-text" data-i18n="channelPlaceholder"></label><textarea id="channel-text" maxlength="2000" rows="1" data-placeholder="channelPlaceholder"></textarea><button class="primary" data-i18n="channelSend"></button></form><p class="channel-exit-note" data-i18n="meshOne"></p></section><p id="channel-feedback" role="status"></p>`;
 chat.append(page);
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>page.querySelector<T>('#'+id)!;
 const list=dialog.querySelector<HTMLElement>('#mesh-networks')!,feedback=dialog.querySelector<HTMLElement>('#mesh-feedback')!;
 let view:'none'|'create'|'channel'='none',token='',listSnapshot='',textSnapshot='',error:TextKey|undefined;
 let advancedChannel='';
 let focusedNetwork:Network|undefined;
 let inertBefore=new Map<HTMLElement,boolean>();
 const media=new ChannelMedia(()=>o.getMesh(),()=>render());
 const mediaNodes=new Map<string,{root:HTMLElement;video:HTMLVideoElement;audio:HTMLAudioElement;name:HTMLElement;state:HTMLElement}>();
 function finish(showList=false,leave=false){
  view='none';
  if(leave){media.stop();o.getMesh()?.leave();
  for(const item of mediaNodes.values()){item.video.pause();item.video.srcObject=null;item.audio.pause();item.audio.srcObject=null;}mediaNodes.clear();$('channel-people').replaceChildren();
  advancedChannel='';$<HTMLInputElement>('channel-turn-password').value='';
  }
  page.hidden=true;for(const [node,value] of inertBefore)node.inert=value;inertBefore.clear();
  $('channel-messages').replaceChildren();$<HTMLTextAreaElement>('channel-text').value='';textSnapshot='';error=undefined;
  if(showList){listSnapshot='';render();dialog.showModal();}else o.button.focus();
 }
 function back(){const was=view;if(was==='none')return;finish(was==='create');if(history.state?.softRoomChannel===token)history.back();}
 function reset(){const was=view;finish(false,true);if(was!=='none'&&history.state?.softRoomChannel===token)history.back();focusedNetwork=undefined;dialog.close();}
 window.addEventListener('popstate',()=>{if(view!=='none'&&history.state?.softRoomChannel!==token)finish(view==='create');});
 window.addEventListener('pagehide',()=>finish(false,true));
 page.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();back();}});
 function show(next:'create'|'channel'){
  dialog.close();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());
  if(view==='none'){
   token='channel-'+Math.random().toString(36).slice(2);history.pushState({...history.state,softRoomChannel:token},'');
   for(const child of chat.children)if(child!==page&&child instanceof HTMLElement){inertBefore.set(child,child.inert);child.inert=true;}
  }
  view=next;page.hidden=false;error=undefined;render();$('channel-back').focus();
 }
 function enter(network:Network){
  if(!o.canJoin())return;
  try{const mesh=o.getMesh()!;network=mesh.getNetwork(network.id)||network;if(channelEnabled(network))mesh.join(network);focusedNetwork=network;show('channel');render();}catch{feedback.textContent=o.t('meshFailed');}
 }
 $<HTMLInputElement>('channel-custom-turn').onchange=()=>{$('channel-turn-fields').hidden=!$<HTMLInputElement>('channel-custom-turn').checked;};
 $<HTMLFormElement>('channel-turn-form').onsubmit=e=>{
  e.preventDefault();try{
   const enabled=$<HTMLInputElement>('channel-custom-turn').checked;
   const server=enabled?customTurnServer($<HTMLTextAreaElement>('channel-turn-urls').value,$<HTMLInputElement>('channel-turn-user').value,$<HTMLInputElement>('channel-turn-password').value):undefined;
   o.getMesh()?.setCustomTurn(server);$('channel-turn-status').textContent=o.t('channelTurnSaved');error='channelTurnSaved';render();$<HTMLDetailsElement>('channel-advanced').open=false;
  }catch{$('channel-turn-status').textContent=o.t('channelTurnInvalid');}
 };
 $('channel-back').onclick=back;
 $('channel-leave').onclick=()=>{finish(false,true);if(history.state?.softRoomChannel===token)history.back();};
 $('channel-power').onclick=()=>{const mesh=o.getMesh();if(!mesh||!focusedNetwork)return;try{const network=mesh.getNetwork(focusedNetwork.id)||focusedNetwork;mesh.setEnabled(network.id,!channelEnabled(network));focusedNetwork=mesh.getNetwork(network.id);if(focusedNetwork&&channelEnabled(focusedNetwork))mesh.join(focusedNetwork);render();}catch{error='meshFailed';render();}};
 dialog.querySelector('.sheet-head button')!.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 o.button.onclick=()=>{if(view==='channel')return;document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());listSnapshot='';render();dialog.showModal();};
 dialog.querySelector('#channel-new')!.addEventListener('click',()=>{if(!o.canJoin())return;show('create');$<HTMLInputElement>('channel-name').value='';$<HTMLInputElement>('channel-name').focus();});
 $<HTMLFormElement>('channel-create').onsubmit=e=>{
  e.preventDefault();if(!o.canJoin())return;
  try{const mode=page.querySelector<HTMLInputElement>('input[name=mode]:checked')!.value as ChannelMode;view='channel';o.getMesh()!.create($<HTMLInputElement>('channel-name').value.trim()||o.t('meshDefault'),mode);focusedNetwork=o.getMesh()!.membership!.network;render();$('channel-back').focus();}catch{view='create';error='meshFailed';render();}
 };
 const capture=async(kind:'audio'|'video')=>{try{error=undefined;await media.toggle(kind);}catch{error='channelMediaError';}render();};
 $('channel-mic').onclick=()=>void capture('audio');$('channel-camera').onclick=()=>void capture('video');
 const hold=$('channel-hold');hold.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();hold.setPointerCapture(e.pointerId);void media.hold().catch(()=>{error='channelMediaError';render();});};
 hold.onpointerup=()=>media.release();hold.onpointercancel=()=>media.release();hold.onlostpointercapture=()=>media.release();hold.oncontextmenu=e=>e.preventDefault();
 hold.onkeydown=e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();void media.hold().catch(()=>{error='channelMediaError';render();});}};hold.onkeyup=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();media.release();}};
 window.addEventListener('blur',()=>media.release());document.addEventListener('visibilitychange',()=>{if(document.hidden)media.release();});
 $('channel-play').onclick=()=>{let failed=false;void Promise.all([...mediaNodes.values()].map(async item=>{try{if(item.audio.srcObject)await item.audio.play();if(item.video.srcObject)await item.video.play();}catch{failed=true;}})).then(()=>{$('channel-play').hidden=!failed;});};
 $<HTMLFormElement>('channel-composer').onsubmit=e=>{e.preventDefault();const input=$<HTMLTextAreaElement>('channel-text');try{const count=o.getMesh()!.sendText(input.value,o.selfName());input.value='';error=undefined;render();$('channel-feedback').textContent=o.t('channelSent',{count});}catch{error='channelSendError';render();}};
 $('channel-text').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$<HTMLFormElement>('channel-composer').requestSubmit();}};
 const el=(tag:string,text:string)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 function labelButton(id:string,icon:string,key:TextKey,enabled:boolean){const button=$<HTMLButtonElement>(id);if(button.dataset.text!==o.t(key)){button.innerHTML=icon;button.append(el('span',o.t(key)));button.dataset.text=o.t(key);}button.setAttribute('aria-pressed',String(enabled));}
 function renderPeople(mesh:RoomMesh,mode:ChannelMode){
  const peers=mesh.peerViews(),holder=$('channel-people');holder.classList.toggle('video-grid',mode==='video');
  const entries=[{key:'self',label:o.t('you'),state:'',connectionState:'self',stream:undefined as MediaStream|undefined,video:!!mesh.localTracks.video},...peers.map(p=>({key:p.key,connectionState:p.state,label:o.name(p.key),state:o.t(p.state==='connected'?'meshConnected':p.state==='connecting'?'meshConnecting':p.state==='failed'?'channelConnectionFailed':'meshRetrying')+(p.audio?' · '+o.t('channelTalking').split(' · ')[0]:''),stream:mesh.remoteStream(p.key),video:p.video}))];
  for(const [key,item] of mediaNodes)if(!entries.some(e=>e.key===key)){item.video.pause();item.video.srcObject=null;item.audio.pause();item.audio.srcObject=null;item.root.remove();mediaNodes.delete(key);}
  for(const entry of entries){let item=mediaNodes.get(entry.key);if(!item){const root=document.createElement('article');root.className='channel-person';root.dataset.key=entry.key;const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;const audio=document.createElement('audio');audio.autoplay=true;audio.muted=entry.key==='self';video.setAttribute('playsinline','');const name=el('strong',''),state=el('small','');root.append(video,audio,name,state);holder.append(root);item={root,video,audio,name,state};mediaNodes.set(entry.key,item);}
   item.root.dataset.state=entry.connectionState;item.name.textContent=entry.label;item.state.textContent=entry.state;item.video.hidden=mode!=='video'||!entry.video;
   let stream=entry.stream;if(entry.key==='self'){const track=mesh.localTracks.video;const old=item.video.srcObject as MediaStream|null;stream=track?(old?.getVideoTracks()[0]===track?old:new MediaStream([track])):undefined;}
   if(item.video.srcObject!==(stream||null)){item.video.srcObject=stream||null;if(stream)void item.video.play().catch(()=>{});}
   const sound=entry.key==='self'?null:entry.stream||null;if(item.audio.srcObject!==sound){item.audio.srcObject=sound;if(sound)void item.audio.play().catch(()=>{if(view==='channel')$('channel-play').hidden=false;});}
  }
 }
 function render(){
  const mesh=o.getMesh(),groups=mesh?.networks()||[];
  o.button.dataset.count=String(groups.length);o.button.classList.toggle('mesh-active',!!mesh?.membership);
  dialog.querySelector<HTMLButtonElement>('#channel-new')!.disabled=!o.canJoin()||!mesh?.supported;
  feedback.textContent=mesh&&!mesh.supported?o.t('meshUnavailable'):!o.canJoin()?o.t('meshNeedWrite'):'';
  const snapshot=JSON.stringify([groups,o.canJoin(),o.t('meshTitle'),groups.map(g=>o.name(g.network.creator))]);
  if(snapshot!==listSnapshot){listSnapshot=snapshot;list.replaceChildren();if(!groups.length)list.append(el('p',o.t('meshEmpty')));
   for(const group of groups){const card=document.createElement('button');card.type='button';card.className='channel-card';card.dataset.network=group.network.id;card.disabled=!o.canJoin()||!mesh?.supported||(!channelEnabled(group.network)&&!o.isSelf(group.network.creator));card.dataset.enabled=String(channelEnabled(group.network));card.innerHTML=modeIcon(channelMode(group.network));const detail=document.createElement('span');detail.append(el('strong',group.network.name),el('small',(mesh?.membership?.network.id===group.network.id?o.t('meshCurrent')+' · ':'')+o.t(channelEnabled(group.network)?'channelOn':'channelOff')+' · '+o.t(modeKey(channelMode(group.network)))+' · '+o.t('meshCount',{count:group.people.length})),el('small',o.t('meshCreator',{name:o.name(group.network.creator)})));card.append(detail);card.onclick=()=>enter(group.network);list.append(card);}
  }
  if(!mesh?.membership&&mediaNodes.size){media.stop();for(const item of mediaNodes.values()){item.video.pause();item.video.srcObject=null;item.audio.pause();item.audio.srcObject=null;}mediaNodes.clear();$('channel-people').replaceChildren();}
  if(view!=='channel'&&mesh?.membership)renderPeople(mesh,channelMode(mesh.membership.network));
  if(view==='none')return;
  $('channel-create-view').hidden=view!=='create';$('channel-session').hidden=view!=='channel';$('channel-feedback').textContent=error?o.t(error):'';
  $('channel-back').setAttribute('aria-label',o.t(view==='create'?'channelCreateBack':'channelBack'));
  if(view==='create'){$('channel-title').textContent=o.t('meshCreate');$('channel-mode-label').textContent=o.t('meshTitle');$<HTMLButtonElement>('channel-create').querySelector('button')!.disabled=!o.canJoin();return;}
  if(!mesh||!focusedNetwork)return;
  focusedNetwork=mesh.getNetwork(focusedNetwork.id)||focusedNetwork;
  const enabled=channelEnabled(focusedNetwork),joined=mesh.membership?.network.id===focusedNetwork.id;
  $('channel-state').textContent=o.t(enabled?'channelOn':'channelOff');
  $('channel-power').hidden=!o.isSelf(focusedNetwork.creator);$('channel-power').textContent=o.t(enabled?'channelSwitchOff':'channelSwitchOn');$<HTMLButtonElement>('channel-power').disabled=!o.canJoin();$('channel-power').setAttribute('aria-pressed',String(enabled));
  $('channel-leave').hidden=!joined;
  for(const id of ['channel-advanced','channel-people','channel-messages','channel-composer'])$(id).hidden=!joined;
  page.querySelector<HTMLElement>('.channel-media-controls')!.hidden=!joined;
  if(!joined){$('channel-title').textContent=focusedNetwork.name;$('channel-mode-label').textContent=o.t(modeKey(channelMode(focusedNetwork)));$('channel-connection').textContent=o.t(enabled?'channelNotJoined':'channelClosed');$('channel-relay-work').hidden=true;if(mesh.membership)renderPeople(mesh,channelMode(mesh.membership.network));return;}
  if(!mesh.membership)return;
  if(advancedChannel!==mesh.membership.network.id){advancedChannel=mesh.membership.network.id;const custom=mesh.customTurn;$<HTMLInputElement>('channel-custom-turn').checked=!!custom;$('channel-turn-fields').hidden=!custom;$<HTMLTextAreaElement>('channel-turn-urls').value=custom?(Array.isArray(custom.urls)?custom.urls.join('\n'):custom.urls):'';$<HTMLInputElement>('channel-turn-user').value=custom?.username||'';$<HTMLInputElement>('channel-turn-password').value=typeof custom?.credential==='string'?custom.credential:'';$('channel-turn-status').textContent='';$<HTMLDetailsElement>('channel-advanced').open=false;}
  const work=mesh.relayWork;$('channel-relay-work').hidden=work?.status!=='mining';$('channel-relay-label').textContent=o.t('channelRelayMining',{seconds:Math.floor((work?.elapsed||0)/1000)});
  const mode=channelMode(mesh.membership.network);$('channel-title').textContent=mesh.membership.network.name;$('channel-mode-label').textContent=o.t(modeKey(mode));page.dataset.mode=mode;
  $('channel-mic').hidden=mode==='walkie';$('channel-camera').hidden=mode!=='video';$('channel-hold').hidden=mode!=='walkie';
  labelButton('channel-mic',micIcon,mesh.localTracks.audio?'channelMicOff':'channelMicOn',!!mesh.localTracks.audio);
  labelButton('channel-camera',videoIcon,mesh.localTracks.video?'channelCameraOff':'channelCameraOn',!!mesh.localTracks.video);
  labelButton('channel-hold',holdIcon,mesh.localTracks.audio?.enabled?'channelTalking':'channelHold',!!mesh.localTracks.audio?.enabled);
  const peers=mesh.peerViews(),connected=peers.filter(p=>p.state==='connected').length;
  $('channel-connection').textContent=o.t(!peers.length?'channelNoPeers':connected===peers.length?'channelConnectionReady':connected?'channelConnectionPartial':peers.some(p=>p.state==='failed')?'channelConnectionFailed':'channelConnectionWaiting',{count:connected,total:peers.length});
  $<HTMLButtonElement>('channel-composer').querySelector('button')!.disabled=connected===0;
  renderPeople(mesh,mode);
  const textState=JSON.stringify([mesh.messages,o.t('channelEmpty')]);if(textState!==textSnapshot){textSnapshot=textState;const log=$('channel-messages');const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;log.replaceChildren();if(!mesh.messages.length)log.append(el('p',o.t('channelEmpty')));for(const m of mesh.messages){const row=document.createElement('article');row.className='channel-message';row.append(el('small',m.name||o.name(m.sender)),el('p',m.body));log.append(row);}if(nearBottom)log.scrollTop=log.scrollHeight;}
 }
 return {render,reset};
}
