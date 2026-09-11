import './style.css';
import './sssp.css';
import { dayEpoch, normalizeNickname, makeRoom, invite, parseInvite, roomId, validWork, seal, open, type Room, type Message } from './protocol.ts';
import { computeReadKey, computeWork, type WorkProgress } from './pow.ts';
import { loadSession, saveSession, freshSession, SESSION_KEY, type SavedRoom } from './session.ts';
import { translate, type TextKey, type Language } from './i18n.ts';
import { connect } from './transport.ts';
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
let storage:Storage|undefined;
try {storage=window.sessionStorage;} catch { /* Memory-only fallback. */ }
const loaded=loadSession(storage,navigator.language.startsWith('zh')?'zh':'en');
let session=loaded.session,cacheFailed=loaded.failed;
session.theme ??= 'sssp';
const t=(key:TextKey,params:Record<string,string|number>={})=>translate(session.language,key,params);
const histories=new Map<string,Message[]>();
const seenIds=new Map<string,Set<string>>();
let active:SavedRoom|undefined,connection:Awaited<ReturnType<typeof connect>>|undefined;
let generation=0,busy=false,sending=false,controller:AbortController|undefined;
let statusKey:TextKey='idle',noticeKey:TextKey|undefined,copyValue:string|undefined;
let writeController:AbortController|undefined,writeBusy=false,writePaused=false;
let progress:WorkProgress={attempts:0,elapsed:0};
const save=()=>{cacheFailed=!saveSession(storage,session);renderCache();};
$('app').innerHTML=`<div class="shell">
<header class="top"><a class="brand" href="/" data-label="home"><span class="mark"><span class="soft-monogram">s<span>r</span></span><img class="sssp-emblem" src="/sssp-emblem.svg" alt=""/></span><span>soft room<small data-i18n="tagline"></small></span></a><div class="top-tools"><div class="identity"><span class="avatar">✳</span><span><small data-i18n="temporaryIdentity"></small><b id="identity"></b></span></div><label class="sr-only" for="skin" data-i18n="skin"></label><select id="skin"><option value="sssp" data-i18n="skinSssp"></option><option value="soft" data-i18n="skinSoft"></option></select><label class="sr-only" for="language" data-i18n="language"></label><select id="language"><option value="zh">中文</option><option value="en">English</option></select></div></header>
<section class="session-banner"><div><strong id="cache-warning"></strong><p data-i18n="sessionDetail"></p></div><button id="clear-session" data-i18n="clearSession"></button></section>
<main class="layout"><aside class="panel controls">
<div class="eyebrow" data-i18n="eyebrow"></div><h1 data-i18n="heading"></h1><p class="intro" data-i18n="intro"></p>
<form id="create"><label for="room-name" data-i18n="roomName"></label><input id="room-name" maxlength="32" data-placeholder="roomPlaceholder" autocomplete="off"/><label class="toggle"><input id="pow" type="checkbox" checked/><span class="switch"></span><span><span data-i18n="powOption"></span><small data-i18n="powHint"></small></span></label><button class="primary" id="create-button" data-i18n="create"></button></form>
<div class="divider"><span data-i18n="orJoin"></span></div><form id="join"><label for="invite-input" data-i18n="inviteLabel"></label><textarea id="invite-input" rows="2" data-placeholder="invitePlaceholder" spellcheck="false" autocomplete="off"></textarea><button id="join-button" data-i18n="join"></button></form>
<p class="footnote" data-i18n="invitationTip"></p>
<section class="room-manager"><div class="manager-heading"><h3 data-i18n="myRooms"></h3><span id="room-count"></span></div><p class="footnote" data-i18n="roomsHint"></p><div id="room-list"></div></section>
</aside>
<section class="panel chat" data-label="chatLabel"><div class="chat-head"><div><div class="eyebrow" id="room-label"></div><h2 id="room-title"></h2></div><div class="status" id="status" role="status"></div></div>
<div id="room-tools" class="room-tools" hidden><button id="copy" data-i18n="copy"></button><button id="reconnect" data-i18n="retry"></button><button id="leave" data-i18n="leave" data-title="leaveTip"></button></div>
<form id="nickname-form" class="nickname-form" hidden><label for="nickname" data-i18n="nickname"></label><div><input id="nickname" maxlength="24" autocomplete="off" data-placeholder="nicknamePlaceholder"/><button data-i18n="nicknameSave"></button></div><small data-i18n="nicknameHint"></small></form>
<p id="legacy-hint" class="legacy-hint" data-i18n="legacyHint" hidden></p>
<div id="messages" class="messages" role="log" data-label="messages" aria-live="polite"></div>
<section id="pow-wait" class="pow-wait" aria-busy="true" hidden><div class="pow-orbit" aria-hidden="true"><span>✳</span></div><h3 id="pow-title"></h3><p id="pow-description"></p><div class="pow-track" role="progressbar" data-label="powTitle"><i></i></div><div class="pow-stats"><div><b id="pow-time">0</b><small data-i18n="elapsed"></small></div></div><p class="pow-explanation" data-i18n="powTiming"></p><p class="footnote" id="pow-cache"></p><button id="cancel-work" data-i18n="cancel"></button></section>
<button id="resume-work" data-i18n="resumeWork" hidden></button><div id="notice" class="notice" role="status" aria-live="polite"></div><form id="composer" class="composer"><label class="sr-only" for="message" data-i18n="messageLabel"></label><textarea id="message" rows="1" maxlength="2000" disabled></textarea><button id="send" class="send" disabled data-label="send">↑</button></form><div class="chat-foot"><span data-i18n="encrypted"></span><span data-i18n="keyboard"></span></div><p class="history-note" data-i18n="historyHint"></p>
</section></main><footer><span data-i18n="footer"></span><span data-i18n="footerMark"></span></footer></div>`;
function renderCache(){
 $('cache-warning').textContent=t(cacheFailed?'cacheFailed':'sessionWarning');
 document.querySelector('.session-banner')?.classList.toggle('cache-error',cacheFailed);
 $('identity').textContent=t('visitor',{id:session.identity.publicKey.slice(0,8)});
 $('identity').title=t(cacheFailed?'cacheFailed':'sessionWarning');
}
function renderNotice(){
 const node=$('notice');node.textContent=noticeKey?t(noticeKey):'';
 if(copyValue){const input=document.createElement('textarea');input.value=copyValue;input.readOnly=true;input.setAttribute('aria-label',t('copy'));node.append(input);}
}
function notice(key?:TextKey){noticeKey=key;copyValue=undefined;renderNotice();}
function renderProgress(){
 $('pow-time').textContent=`${(progress.elapsed/1000).toFixed(1)} ${t('seconds')}`;
 document.querySelector('.pow-explanation')!.textContent=t('powTiming');
 $('pow-title').textContent=t(statusKey==='reading'?'readTitle':'powTitle');
 $('pow-description').textContent=t(statusKey==='reading'?'readDescription':'powDescription');
 $('pow-cache').textContent=t(active?.room.v===2?'dailyHint':'powCache');
}
function controls(){
 $('create-button').toggleAttribute('disabled',busy);
 $('join-button').toggleAttribute('disabled',busy);
 const ready=!!connection?.connected()&&!!active&&canWrite(active);
 $('send').toggleAttribute('disabled',!ready||sending);
 $('message').toggleAttribute('disabled',!ready);
 $('message').setAttribute('placeholder',t(ready?'messagePlaceholder':'messageDisabled'));
 $('room-tools').hidden=!active;
 $('reconnect').hidden=busy||!!connection?.connected();
 $('resume-work').hidden=!connection?.connected()||ready||writeBusy;
 $('pow-wait').hidden=!writeBusy&&statusKey!=='reading';
 $('pow-wait').classList.toggle('write-wait',writeBusy&&!!connection);
 $('messages').hidden=statusKey==='reading';
 $('composer').hidden=statusKey==='reading';
 $('legacy-hint').hidden=active?.room.v===2||!active?.room.pow||active.room.pow===20;
 $('nickname-form').hidden=!active;
 const nickname=$<HTMLInputElement>('nickname');const id=active?roomId(active.room):'';if(nickname.dataset.room!==id){nickname.dataset.room=id;nickname.value=active?.nickname||'';}
 $('room-title').textContent=active?.room.name||t('noRoom');
 $('room-label').textContent=t(active?'privateRoom':'roomEyebrow');
 $('status').textContent=t(statusKey);$('status').classList.toggle('ready',statusKey==='connected');
 renderProgress();
}
function renderRooms(){
 const list=$('room-list');list.replaceChildren();$('room-count').textContent=String(session.rooms.length);
 if(!session.rooms.length){const p=document.createElement('p');p.className='footnote';p.textContent=t('noRooms');list.append(p);return;}
 for(const saved of session.rooms){
  const id=roomId(saved.room),current=active&&id===roomId(active.room);
  const row=document.createElement('article');row.className='saved-room'+(current?' selected':'');
  const heading=document.createElement('b');heading.textContent=saved.room.name;
  const info=document.createElement('small');info.textContent=[t(saved.created?'created':'joined'),t(saved.room.pow===20?'currentPow':saved.room.pow===1000?'strongPow':saved.room.pow===16?'legacyPow':'noPow'),saved.room.pow?t(canWrite(saved)?'proofSaved':'proofNeeded'):''].filter(Boolean).join(' · ');
  const actions=document.createElement('div');actions.className='saved-actions';
  const enterButton=document.createElement('button');enterButton.textContent=t(current?(busy||connection?.connected()?'currentRoom':'retry'):'enterRoom');enterButton.disabled=!!current&&(busy||!!connection?.connected());if(current)enterButton.setAttribute('aria-current','true');enterButton.onclick=()=>void enter(saved);
  const copyButton=document.createElement('button');copyButton.textContent=t('copy');copyButton.onclick=()=>void copyInvitation(saved.room);
  const removeButton=document.createElement('button');removeButton.textContent=t('remove');removeButton.onclick=()=>void removeRoom(saved);
  actions.append(enterButton,copyButton,removeButton);row.append(heading,info,actions);list.append(row);
 }
}
function renderMessages(){
 const log=$('messages');log.replaceChildren();const messages=active?histories.get(roomId(active.room))||[]:[];
 if(!messages.length){const empty=document.createElement('div');empty.className='empty';empty.innerHTML='<div class="room-art"><span>✳</span><i></i><i></i></div><h3></h3><p></p><span class="pill"></span><div class="sssp-blueprint" aria-hidden="true"><img src="/sssp-vtol.svg" alt=""/><span>SSSP / VTOL–01</span></div>';empty.querySelector('h3')!.textContent=t(session.theme==='sssp'?'patrolEmpty':'emptyHeading');empty.querySelector('p')!.textContent=t(active?'emptyRoom':'emptyText');empty.querySelector('.pill')!.textContent=t('emptyPill');log.append(empty);return;}
 for(const m of messages){
  const own=m.sender===session.identity.publicKey,row=document.createElement('article');row.className='message-row'+(own?' own':'');
  const meta=document.createElement('div');meta.className='meta';meta.textContent=`${m.nickname?m.nickname+' · '+m.sender.slice(0,8):t('visitor',{id:m.sender.slice(0,8)})}${own?' · '+t('you'):''}  ${new Date(m.time).toLocaleTimeString(session.language==='zh'?'zh-CN':'en-US',{hour:'2-digit',minute:'2-digit'})}`;
  const bubble=document.createElement('p');bubble.textContent=m.text;row.append(meta,bubble);log.append(row);
 }
 log.scrollTop=log.scrollHeight;
}
function languageChanged(){
 document.documentElement.dataset.theme=session.theme;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',session.theme==='sssp'?'#e0e4e7':'#e7ebe7');
 document.documentElement.lang=session.language==='zh'?'zh-CN':'en';document.title=session.language==='zh'?'Soft Room · 随便聊聊':'Soft Room · Just chatting';
 document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n as TextKey));
 for(const [data,attr] of [['placeholder','placeholder'],['label','aria-label'],['title','title']] as const)document.querySelectorAll<HTMLElement>(`[data-${data}]`).forEach(el=>el.setAttribute(attr,t(el.dataset[data] as TextKey)));
 if(session.theme==='sssp'){document.querySelector('[data-i18n="tagline"]')!.textContent=t('patrolTagline');document.querySelector('[data-i18n="eyebrow"]')!.textContent=t('patrolEyebrow');}
 $<HTMLSelectElement>('skin').value=session.theme||'sssp';
 $<HTMLSelectElement>('language').value=session.language;renderCache();controls();renderRooms();renderMessages();renderNotice();
}
function remember(room:Room,created=false):SavedRoom|undefined{
 const found=session.rooms.find(saved=>roomId(saved.room)===roomId(room));if(found)return found;
 if(session.rooms.length>=100){notice('roomLimit');return;}
 const saved:SavedRoom={room,created};session.rooms.unshift(saved);save();renderRooms();return saved;
}
async function disconnect(){
 generation++;writeController?.abort();writeController=undefined;writeBusy=false;writePaused=false;controller?.abort();controller=undefined;const old=connection;connection=undefined;active=undefined;busy=false;sending=false;session.activeId=undefined;statusKey='idle';
 $<HTMLTextAreaElement>('message').value='';save();controls();renderRooms();renderMessages();
 await old?.stop();
}
function canWrite(saved:SavedRoom){
 return (saved.room.v!==2||saved.epoch===dayEpoch())&&validWork(saved.room,session.identity.publicKey,saved.nonce as number,saved.epoch);
}
async function prepareWrite(){
 const saved=active;if(!saved||!connection?.connected()||writeBusy||writePaused)return;
 if(canWrite(saved)){controls();return;}
 const current=generation;writeController=new AbortController();const signal=writeController.signal;writeBusy=true;progress={attempts:0,elapsed:0};statusKey='mining';notice();controls();renderRooms();
 try{
  do{
   const epoch=dayEpoch();
   const nonce=await computeWork(saved.room,session.identity.publicKey,signal,value=>{if(current===generation){progress=value;renderProgress();}},epoch);
   if(current!==generation)return;
   if(saved.room.v===2&&epoch!==dayEpoch())continue;
   saved.nonce=nonce;if(saved.room.v===2)saved.epoch=epoch;save();break;
  }while(!signal.aborted);
  if(current===generation){statusKey='connected';notice('readyNotice');}
 }catch(error){if(current===generation){writePaused=true;statusKey='readOnly';notice(signal.aborted?'writeCancelled':'workerFailed');}}
 finally{if(current===generation){writeBusy=false;writeController=undefined;controls();renderRooms();}}
}
async function enter(saved:SavedRoom){
 await disconnect();const current=++generation;active=saved;session.activeId=roomId(saved.room);busy=true;controller=new AbortController();const signal=controller.signal;progress={attempts:0,elapsed:0};
 statusKey=saved.room.v===2&&!saved.room.key?'reading':'connecting';
 notice(statusKey==='reading'?undefined:'waitingNetwork');save();controls();renderRooms();renderMessages();
 if(matchMedia('(max-width:620px)').matches)document.querySelector('.chat')?.scrollIntoView({block:'start'});
 try{
  if(saved.room.v===2&&!saved.room.key){
   const key=await computeReadKey(saved.room.seed!,signal,value=>{if(current===generation){progress=value;renderProgress();}});
   if(current!==generation)return;saved.room.key=key;save();
  }
  statusKey='connecting';notice('waitingNetwork');controls();
  const next=await connect(saved.room,payload=>{
   if(current!==generation)return;
   try{const m=open(saved.room,payload);addMessage(saved,m);}catch{ /* Reject invalid ciphertext, signatures, work and epochs. */ }
  },signal);
  if(current!==generation){await next.stop();return;}connection=next;statusKey='connected';notice('readyNotice');
  if(!saved.room.pow)saved.nonce=0;
 }catch(error){if(current!==generation)return;statusKey='error';notice(error instanceof Error&&error.message==='workerFailed'?'workerFailed':'connectionFailed');}
 finally{if(current===generation){busy=false;controls();renderRooms();void prepareWrite();}}
}
function addMessage(saved:SavedRoom,m:Message){
 const id=roomId(saved.room),messages=histories.get(id)||[];
 const seen=seenIds.get(id)||new Set<string>();if(seen.has(m.id))return;seen.add(m.id);if(seen.size>2000)seen.delete(seen.values().next().value!);seenIds.set(id,seen);messages.push(m);if(messages.length>300)messages.shift();histories.set(id,messages);
 if(active&&id===roomId(active.room))renderMessages();
}
async function copyInvitation(room:Room){
 const value=`${location.origin}${location.pathname}#${invite(room)}`;
 try{await navigator.clipboard.writeText(value);notice('copied');}
 catch{notice('copyFallback');copyValue=value;renderNotice();$('notice').querySelector('textarea')?.select();}
}
async function removeRoom(saved:SavedRoom){
 if(!confirm(t('removeConfirm',{name:saved.room.name})))return;
 const id=roomId(saved.room);if(active&&roomId(active.room)===id)await disconnect();
 session.rooms=session.rooms.filter(item=>roomId(item.room)!==id);histories.delete(id);seenIds.delete(id);save();renderRooms();notice('removed');
}
$('nickname-form').addEventListener('submit',event=>{event.preventDefault();if(!active)return;try{const nickname=normalizeNickname($<HTMLInputElement>('nickname').value);if(nickname)active.nickname=nickname;else delete active.nickname;$<HTMLInputElement>('nickname').value=nickname;save();notice('nicknameSaved');}catch{notice('nicknameInvalid');}});
$('create').addEventListener('submit',event=>{event.preventDefault();if(busy)return;const room=makeRoom($<HTMLInputElement>('room-name').value.trim()||t('defaultRoom'),$<HTMLInputElement>('pow').checked);const saved=remember(room,true);if(saved)void enter(saved);});
$('join').addEventListener('submit',event=>{event.preventDefault();if(busy)return;try{const room=parseInvite($<HTMLTextAreaElement>('invite-input').value);const saved=remember(room);if(saved){$<HTMLTextAreaElement>('invite-input').value='';void enter(saved);}}catch{notice('inviteInvalid');}});
$('leave').addEventListener('click',()=>{void disconnect();notice('left');});
$('cancel-work').addEventListener('click',()=>{if(writeBusy){writePaused=true;writeController?.abort();}else{void disconnect();notice('cancelled');}});
$('resume-work').addEventListener('click',()=>{writePaused=false;void prepareWrite();});
$('reconnect').addEventListener('click',()=>{if(active)void enter(active);});
$('copy').addEventListener('click',()=>{if(active)void copyInvitation(active.room);});
$('clear-session').addEventListener('click',async()=>{
 if(!confirm(t('clearConfirm')))return;await disconnect();
 try{storage?.removeItem(SESSION_KEY);}catch{ /* Save below reports storage failure. */ }
 const theme=session.theme;session=freshSession(session.language);session.theme=theme;histories.clear();seenIds.clear();save();languageChanged();notice('sessionCleared');
});
$('skin').addEventListener('change',()=>{session.theme=$<HTMLSelectElement>('skin').value as 'soft'|'sssp';save();languageChanged();});
$('language').addEventListener('change',()=>{session.language=$<HTMLSelectElement>('language').value as Language;save();languageChanged();});
$('composer').addEventListener('submit',async event=>{
 event.preventDefault();const input=$<HTMLTextAreaElement>('message');if(!active||!connection||sending||!input.value.trim())return;
 if(!canWrite(active)){writePaused=false;void prepareWrite();return;}
 const current=generation,saved=active,body=input.value;sending=true;controls();
 try{const packet=seal(saved.room,session.identity,saved.nonce!,body,saved.nickname,saved.epoch);await connection.send(packet.payload);if(current!==generation)return;addMessage(saved,packet.message);if(input.value===body)input.value='';notice('sent');}
 catch{if(current===generation)notice('sendFailed');}finally{if(current===generation){sending=false;controls();input.focus();}}
});
$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$<HTMLFormElement>('composer').requestSubmit();}});
function checkDay(){
 if(!connection||!active)return;
 if(!connection.connected()){statusKey='disconnected';controls();return;}
 if(!canWrite(active)){controls();renderRooms();void prepareWrite();}
 else if(!writeBusy&&statusKey!=='connected'){statusKey='connected';controls();renderRooms();}
}
setInterval(checkDay,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDay();});
window.addEventListener('focus',checkDay);
languageChanged();save();
if(location.hash){const code=location.hash.slice(1);history.replaceState(null,'',location.pathname);try{const saved=remember(parseInvite(code));if(saved)void enter(saved);}catch{notice('inviteInvalid');}}
else if(session.activeId){const saved=session.rooms.find(item=>roomId(item.room)===session.activeId);if(saved)void enter(saved);}
