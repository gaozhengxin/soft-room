import type {Network} from './mesh-wire.ts';
import {preserveScroll} from './scroll.ts';
import {createIceProvider} from './ice.ts';
import {keepMobileScreenOn} from './awake.ts';
import {nativeApp,invitationLink,copyText} from './platform.ts';
import {RoomMesh} from './mesh.ts';
import {mountMeshPanel} from './mesh-ui.ts';
import networkIcon from './icons/network.svg?raw';
import {browserLanguage} from './access.ts';
import userIcon from './icons/user-round.svg?raw';
import peopleIcon from './icons/users-round.svg?raw';
import settingsIcon from './icons/settings.svg?raw';
import downloadIcon from './icons/download.svg?raw';
import paperclipIcon from './icons/paperclip.svg?raw';
import closeIcon from './icons/x.svg?raw';
import logoutIcon from './icons/log-out.svg?raw';
import {hasAndroidUpdate,latestAndroidUpdate,type AndroidUpdateManifest} from './android-update.ts';
import './style.css';
import './sssp.css';
import './layout.css';
import './kabutack.css';
import {effectiveName,type ChatEntry} from './names.ts';
import { dayEpoch, normalizeNickname, makeRoom, invite, parseInvite, roomId, validWork, seal, open, openHistory, type Room, type Message } from './protocol.ts';
import { computeReadKey, computeWork, type WorkProgress } from './pow.ts';
import { loadSession, saveSession, freshSession, encodeSession, decodeSession, SESSION_KEY, type SavedRoom } from './session.ts';
import {activeProfile,deleteSavedRoom,exportRecoveryFile,isPersistent,logoutPersistent,persistSessionState,recoveryPending} from './persistent/runtime.ts';
import {saveNativeFileDetailed} from './native-files.ts';
import { translate, type TextKey, type Language } from './i18n.ts';
import {observeMember,online,HEARTBEAT_INTERVAL,type Member} from './members.ts';
import { connect } from './transport.ts';
import {shareFile,type MediaQuality} from './attachments.ts';
import {attachmentView} from './attachment-ui.ts';
import {backupMessage,storageHistory,type UploadProgress} from './storage.ts';
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
let storage:Storage|undefined;
try {storage=window.sessionStorage;} catch { /* Memory-only fallback. */ }
const loaded=loadSession(storage,browserLanguage(navigator.languages?.length?navigator.languages:[navigator.language]));
let session=loaded.session,cacheFailed=loaded.failed;
const iceProvider=createIceProvider(import.meta.env.VITE_TURN_CREDENTIALS_URL,fetch,Date.now,()=>session.identity,()=>meshPanel.render(),storage);
session.theme ??= 'soft';
const t=(key:TextKey,params:Record<string,string|number>={})=>translate(session.language,key,params);
let historyState:'idle'|'loading'|'error'='idle';
const channelMemory=new Map<string,Map<string,Network>>();
const histories=new Map<string,ChatEntry[]>();
const membersByRoom=new Map<string,Map<string,Member>>();
let heartbeatFlight:Promise<void>|undefined,lastHeartbeatAttempt=0;
const seenIds=new Map<string,Set<string>>();
let active:SavedRoom|undefined,connection:Awaited<ReturnType<typeof connect>>|undefined;
let mesh:RoomMesh|undefined;
let generation=0,busy=false,sending=false,fileSending=false,controller:AbortController|undefined;
let statusKey:TextKey='idle',noticeKey:TextKey|undefined,copyValue:string|undefined,sharingRoom:Room|undefined;
let writeController:AbortController|undefined,writeBusy=false,writePaused=false;
let progress:WorkProgress={attempts:0,elapsed:0};
let persistentTimer=0,persistentFlight=Promise.resolve();
const save=()=>{cacheFailed=!saveSession(storage,session);renderCache();if(isPersistent()){window.clearTimeout(persistentTimer);persistentTimer=window.setTimeout(()=>{const snapshot=decodeSession(encodeSession(session));persistentFlight=persistentFlight.then(()=>persistSessionState(snapshot)).catch(()=>{});},250);}};
$('app').innerHTML=`<div class="shell">
<header class="top"><a class="brand" href="/" data-label="home"><span class="mark"><span class="soft-monogram">s<span>r</span></span><img class="sssp-emblem" src="/sssp-emblem.svg" alt=""/></span><span>soft room<small data-i18n="tagline"></small></span></a><div class="top-tools"><div class="identity"><span class="avatar">✳</span><span><small data-i18n="temporaryIdentity"></small><b id="identity"></b></span></div><label class="sr-only" for="skin" data-i18n="skin"></label><select id="skin"><option value="soft" data-i18n="skinSoft"></option><option value="sssp" data-i18n="skinSssp"></option><option value="kabutack" data-i18n="skinKabutack"></option></select><label class="sr-only" for="language" data-i18n="language"></label><select id="language"><option value="zh">中文</option><option value="en">English</option></select></div></header>
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
<div id="history-status" class="history-status" role="status" hidden><i aria-hidden="true"></i><span></span><button id="history-retry" type="button" data-i18n="retry"></button></div>
<div id="messages" class="messages" role="log" data-label="messages" aria-live="polite"></div>
<section id="pow-wait" class="pow-wait" aria-busy="true" hidden><div class="pow-orbit" aria-hidden="true"><span>✳</span></div><h3 id="pow-title"></h3><p id="pow-description"></p><div class="pow-track" role="progressbar" data-label="powTitle"><i></i></div><div class="pow-stats"><div><b id="pow-time">0</b><small data-i18n="elapsed"></small></div></div><p class="pow-explanation" data-i18n="powTiming"></p><p class="footnote" id="pow-cache"></p><button id="cancel-work" data-i18n="cancel"></button></section>
<button id="resume-work" data-i18n="resumeWork" hidden></button><div id="notice" class="notice" role="status" aria-live="polite"></div><form id="composer" class="composer"><button id="attach" type="button" class="icon-button attach-button" data-label="fileShare">${paperclipIcon}</button><label class="sr-only" for="message" data-i18n="messageLabel"></label><textarea id="message" rows="1" maxlength="2000" disabled></textarea><button id="send" class="send" disabled data-label="send">↑</button></form><div class="chat-foot"><span data-i18n="encrypted"></span><span data-i18n="keyboard"></span></div><p class="history-note" data-i18n="historyHint"></p>
</section></main><footer><span data-i18n="footer"></span><span data-i18n="footerMark"></span></footer></div>`;
// Reuse the existing controls in scoped panels; the chat remains the main surface.
const shell=document.querySelector('.shell')!;
function makeDialog(id:string,title:TextKey){
 const dialog=document.createElement('dialog');dialog.id=id;dialog.className='sheet';
 dialog.innerHTML=`<div class="sheet-head"><h2 data-i18n="${title}"></h2><button type="button" class="icon-button" data-label="close">×</button></div><div class="sheet-body"></div>`;
 dialog.querySelector('button')!.onclick=()=>dialog.close();
 dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
 shell.append(dialog);return dialog.querySelector('.sheet-body')!;
}
function showPanel(id:string){document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());$<HTMLDialogElement>(id).showModal();}
function closePanels(){document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());}
const creation=makeDialog('new-dialog','newRoom');
creation.innerHTML='<div class="choice-tabs"><button id="choose-create" data-i18n="create"></button><button id="choose-join" data-i18n="join"></button></div><p id="form-feedback" role="status"></p>';
creation.append($('create'),$('join'));$('join').hidden=true;
const invitationTip=document.querySelector('[data-i18n="invitationTip"]')!;
creation.append(invitationTip.cloneNode(true));
$('choose-create').onclick=()=>{ $('create').hidden=false;$('join').hidden=true;$('choose-create').setAttribute('aria-pressed','true');$('choose-join').setAttribute('aria-pressed','false');};
$('choose-join').onclick=()=>{ $('create').hidden=true;$('join').hidden=false;$('choose-create').setAttribute('aria-pressed','false');$('choose-join').setAttribute('aria-pressed','true');};
$('choose-create').click();
const identityPanel=makeDialog('identity-dialog','myIdentity');
identityPanel.innerHTML='<span class="pill" data-i18n="temporaryIdentity"></span><p id="identity-key" class="identity-key"></p><form id="global-name-form"><label for="global-name" data-i18n="globalName"></label><input id="global-name" maxlength="24" autocomplete="off"/><p class="scope-hint" data-i18n="globalNameHint"></p><button class="primary" data-i18n="saveName"></button><p id="identity-feedback" role="status"></p></form><section id="recovery-file-tools" class="recovery-file-tools" hidden><p class="recovery-warning" data-i18n="recoveryFileSafety"></p><button id="download-recovery-file" type="button" data-i18n="recoveryFileDownload"></button><p id="recovery-file-feedback" role="status"></p></section>';
identityPanel.append(document.querySelector('.session-banner')!);
const preferences=document.createElement('details');preferences.className='preferences';preferences.innerHTML='<summary data-i18n="preferences"></summary>';
for(const id of ['skin','language']){const label=document.createElement('label');label.htmlFor=id;label.dataset.i18n=id;preferences.append(label,$(id));}
identityPanel.append(preferences);
const nicknamePanel=makeDialog('nickname-dialog','roomIdentity');
nicknamePanel.innerHTML='<p id="nickname-room" class="scope-title"></p><p id="global-name-context" class="scope-hint"></p>';
nicknamePanel.append($('nickname-form'));
nicknamePanel.insertAdjacentHTML('beforeend','<button id="reset-nickname" data-i18n="useGlobalName"></button><p id="nickname-feedback" role="status"></p>');
const roomPanel=makeDialog('room-dialog','roomInfo');
roomPanel.innerHTML='<h3 id="room-info-name"></h3><p data-i18n="roomsHint"></p><p data-i18n="historyHint"></p>';
roomPanel.append($('copy'),$('reconnect'),$('leave'));
roomPanel.insertAdjacentHTML('beforeend','<button id="remove-active" class="danger" data-i18n="remove"></button>');
roomPanel.append($('legacy-hint'));
const membersPanel=makeDialog('members-dialog','members');
membersPanel.innerHTML='<p id="members-room" class="scope-title"></p><div id="members-list"></div>';
const sharePanel=makeDialog('share-dialog','shareRoom');
sharePanel.innerHTML='<h3 id="share-name"></h3><p class="scope-hint" data-i18n="invitationTip"></p><label for="share-link" data-i18n="inviteLabel"></label><textarea id="share-link" readonly rows="4"></textarea><button id="share-copy" class="primary" data-i18n="copy"></button><p id="share-feedback" role="status"></p><p class="scope-hint" data-i18n="roomsHint"></p>';
const filePanel=makeDialog('file-dialog','fileShare');
filePanel.innerHTML='<form id="file-form"><label for="file-input" data-i18n="fileChoose"></label><input id="file-input" type="file"/><label for="file-quality" data-i18n="fileQuality"></label><select id="file-quality"><option value="original" data-i18n="fileQualityOriginal"></option><option value="balanced" data-i18n="fileQualityBalanced"></option><option value="compact" data-i18n="fileQualityCompact"></option></select><p class="scope-hint" data-i18n="fileQualityHint"></p><button id="file-submit" class="primary" data-i18n="fileSend"></button><progress id="file-progress" max="1" value="0" hidden></progress><p id="file-feedback" role="status"></p></form>';
const sidebar=document.querySelector<HTMLElement>('.controls')!;
const manager=document.querySelector('.room-manager')!;
const brand=document.querySelector('.brand')!;
sidebar.replaceChildren(brand);sidebar.insertAdjacentHTML('afterbegin',`<button id="sidebar-close" type="button" class="icon-button sidebar-close" data-label="close">${closeIcon}</button>`);
sidebar.insertAdjacentHTML('beforeend','<button id="new-room" class="primary" data-i18n="newRoom"></button>');sidebar.append(manager);
sidebar.insertAdjacentHTML('beforeend',`<div class="sidebar-bottom"><p class="identity-heading" data-i18n="myIdentity"></p><button id="my-identity" class="profile-button"><span class="profile-avatar" aria-hidden="true">${userIcon}</span><span class="profile-copy"><b id="identity"></b><small data-i18n="temporaryIdentity"></small></span><span class="profile-settings" aria-hidden="true">${settingsIcon}</span></button><p data-i18n="temporaryShort"></p><button id="logout" class="sidebar-logout" type="button">${logoutIcon}<span data-i18n="logout"></span></button></div>`);
const releaseLink='https://github.com/gaozhengxin/soft-room/releases/latest';
const androidChannel=import.meta.env.VITE_ANDROID_CHANNEL==='test'?'test':'stable';
const androidApkLink=androidChannel==='test'?'https://github.com/gaozhengxin/soft-room/releases/download/android-test/Soft-Room-android-test.apk':'https://github.com/gaozhengxin/soft-room/releases/latest/download/Soft-Room-android.apk';
sidebar.querySelector('.sidebar-bottom')!.insertAdjacentHTML('afterbegin',`<div class="release-links"><a class="release-link desktop-download" href="${releaseLink}" target="_blank" rel="noopener noreferrer" data-label="releases">${downloadIcon}<span data-i18n="releases"></span></a><a class="release-link desktop-download" href="${androidApkLink}" target="_blank" rel="noopener noreferrer" data-label="androidDownload">${downloadIcon}<span data-i18n="androidDownload"></span></a><a class="release-link mobile-download mobile-ios-download" href="${releaseLink}" target="_blank" rel="noopener noreferrer" data-label="downloadUpdate">${downloadIcon}<span data-i18n="downloadUpdate"></span></a><a id="android-update" class="release-link mobile-download mobile-android-download" target="_blank" rel="noopener noreferrer" data-label="downloadUpdate">${downloadIcon}<span data-i18n="downloadUpdate"></span></a></div>`);
const androidUpdateLink=$<HTMLAnchorElement>('android-update'),currentAndroidBuild=Number(import.meta.env.VITE_ANDROID_BUILD_ID||0);
let androidUpdateState:'idle'|'checking'|'available'|'current'|'error'='idle',androidUpdate:AndroidUpdateManifest|undefined;
function renderAndroidUpdate(){const label=androidUpdateLink.querySelector('span')!;label.textContent=androidUpdateState==='checking'?t('updateChecking'):androidUpdateState==='available'&&androidUpdate?t('updateAvailable',{version:androidUpdate.version}):androidUpdateState==='current'?t('updateCurrent'):androidUpdateState==='error'?t('updateRetry'):t('downloadUpdate');androidUpdateLink.setAttribute('aria-label',label.textContent);androidUpdateLink.classList.toggle('is-current',androidUpdateState==='current');}
async function checkAndroidUpdate(){androidUpdateState='checking';androidUpdate=undefined;androidUpdateLink.removeAttribute('href');renderAndroidUpdate();try{const manifest=await latestAndroidUpdate(androidChannel);androidUpdate=manifest;if(hasAndroidUpdate(currentAndroidBuild,manifest)){androidUpdateState='available';androidUpdateLink.href=manifest.apkUrl;}else androidUpdateState='current';}catch{androidUpdateState='error';}renderAndroidUpdate();}
androidUpdateLink.onclick=event=>{if(androidUpdateState==='available'&&androidUpdateLink.href)return;event.preventDefault();void checkAndroidUpdate();};
if(document.documentElement.dataset.runtime==='app'&&document.documentElement.dataset.platform==='android')void checkAndroidUpdate();
document.querySelector('.top')!.remove();document.querySelector('footer')!.remove();
const head=document.querySelector('.chat-head')!;
head.insertAdjacentHTML('afterbegin','<button id="sidebar-toggle" class="icon-button" data-label="myRooms" aria-controls="room-sidebar" aria-expanded="true">☰</button>');sidebar.id='room-sidebar';
$('room-tools').replaceChildren();$('room-tools').innerHTML='<button id="room-me" class="icon-button" data-label="roomIdentity">✳</button><button id="room-members" class="icon-button" data-label="members">♧</button><button id="room-menu" class="icon-button" data-label="roomInfo">···</button>';head.append($('room-tools'));
const meshButton=document.createElement('button');meshButton.id='room-network';meshButton.className='icon-button';meshButton.dataset.label='meshTitle';meshButton.innerHTML=networkIcon;$('room-tools').insertBefore(meshButton,$('room-menu'));
$('room-me').innerHTML=userIcon;$('room-members').innerHTML=peopleIcon;$('room-menu').innerHTML=settingsIcon;
document.querySelector('.history-note')!.remove();
shell.insertAdjacentHTML('beforeend','<div id="sidebar-backdrop" class="sidebar-backdrop" aria-hidden="true" hidden></div><div id="cache-alert" role="alert" hidden></div>');
function toggleSidebar(open:boolean){shell.classList.toggle('sidebar-open',open);shell.classList.toggle('sidebar-collapsed',!open);$('sidebar-toggle').setAttribute('aria-expanded',String(open));$('sidebar-backdrop').hidden=true;sidebar.toggleAttribute('aria-hidden',!open);sidebar.style.pointerEvents=open?'':'none';}
$('sidebar-toggle').onclick=()=>toggleSidebar(!shell.classList.contains('sidebar-open'));
$('sidebar-close').onclick=()=>toggleSidebar(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&matchMedia('(max-width:760px)').matches)toggleSidebar(false);});
const mobileLayout=matchMedia('(max-width:760px)');toggleSidebar(!mobileLayout.matches);mobileLayout.addEventListener('change',()=>toggleSidebar(!mobileLayout.matches));
function openNew(){ $('form-feedback').textContent='';showPanel('new-dialog');}
$('new-room').onclick=openNew;
$('my-identity').onclick=()=>{$<HTMLInputElement>('global-name').value=session.name||'';$('identity-feedback').textContent='';$('recovery-file-feedback').textContent='';showPanel('identity-dialog');};
$('room-me').onclick=()=>{if(active){$('nickname-room').textContent=t('inRoom',{name:active.room.name});$('global-name-context').textContent=t('globalContext',{name:session.name||t('visitor',{id:session.identity.publicKey.slice(0,8)})});$('nickname-feedback').textContent='';showPanel('nickname-dialog');}};
$('room-members').onclick=()=>{renderMembers();showPanel('members-dialog');};
$('room-menu').onclick=()=>{if(active){$('room-info-name').textContent=active.room.name;showPanel('room-dialog');}};
$('remove-active').onclick=()=>{if(active)void removeRoom(active);};
$('reset-nickname').onclick=()=>{$<HTMLInputElement>('nickname').value='';$<HTMLFormElement>('nickname-form').requestSubmit();};
$('global-name-form').onsubmit=event=>{event.preventDefault();try{const name=normalizeNickname($<HTMLInputElement>('global-name').value);if(name)session.name=name;else delete session.name;save();savedFeedback('global-name-form','identity-dialog','nameSaved');}catch{$('identity-feedback').textContent=t('nicknameInvalid');}};
$('download-recovery-file').onclick=()=>void(async()=>{const button=$<HTMLButtonElement>('download-recovery-file'),feedback=$('recovery-file-feedback');button.disabled=true;feedback.textContent='';try{const contents=await exportRecoveryFile();if(!contents){feedback.textContent=t('recoveryFileMissing');return;}const blob=new Blob([contents],{type:'application/json'}),name=`Soft-Room-Recovery-${new Date().toISOString().slice(0,10)}.softroom-recovery.json`,native=await saveNativeFileDetailed(blob,name);if(native==='cancelled')return;if(native==='unsupported'){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.rel='noopener';anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);}feedback.textContent=t('recoveryFileSaved');}catch{feedback.textContent=t('recoveryFileFailed');}finally{button.disabled=false;}})();
$('share-copy').onclick=async()=>{const button=$<HTMLButtonElement>('share-copy');button.classList.add('copy-pressed');setTimeout(()=>button.classList.remove('copy-pressed'),260);const input=$<HTMLTextAreaElement>('share-link');if(sharingRoom)input.value=invitationLink(invite(sharingRoom),nativeApp(),import.meta.env.VITE_PUBLIC_ORIGIN,location.href);try{await copyText(input.value);$('share-feedback').textContent=t('copied');}catch{input.focus();input.select();$('share-feedback').textContent=t('copyFallback');}};
const meshPanel=mountMeshPanel({host:shell,button:meshButton,t,isSelf:key=>key===session.identity.publicKey,selfName:()=>effectiveName(session.name,active?.nickname)||'',getMesh:()=>mesh,canJoin:()=>!!active&&!!connection?.connected()&&canWrite(active),name:key=>{const m=active?membersByRoom.get(roomId(active.room))?.get(key):undefined;return key===session.identity.publicKey?effectiveName(session.name,active?.nickname)||t('you'):m?.name||t('visitor',{id:key.slice(0,8)});}});
let membersView='';
const savedToast=document.createElement('div');savedToast.className='saved-toast';savedToast.setAttribute('role','status');savedToast.setAttribute('aria-live','polite');savedToast.hidden=true;document.body.append(savedToast);
let toastTimer:ReturnType<typeof setTimeout>|undefined;
function savedFeedback(formId:string,dialogId:string,key:TextKey){
 const button=$(formId).querySelector<HTMLButtonElement>('button')!;
 button.classList.add('save-confirmed');button.disabled=true;
 const message=t(cacheFailed?'cacheFailed':key);
 setTimeout(()=>{
  button.classList.remove('save-confirmed');button.disabled=false;
  $<HTMLDialogElement>(dialogId).close();
  clearTimeout(toastTimer);savedToast.textContent='✓ '+message;savedToast.hidden=false;
  toastTimer=setTimeout(()=>{savedToast.hidden=true;},3000);
 },180);
}
function renderMembers(){
 const list=$('members-list');
 const members=active?Array.from(membersByRoom.get(roomId(active.room))?.values()||[]):[];
 members.sort((a,b)=>Number(online(b))-Number(online(a))||a.publicKey.localeCompare(b.publicKey));
 const view=JSON.stringify([session.language,active?.room.name,members.map(m=>[m.publicKey,m.name,online(m)])]);if(view===membersView)return;membersView=view;list.replaceChildren();$('members-room').textContent=active?.room.name||'';
 if(!members.length){const p=document.createElement('p');p.textContent=t('noMembers');list.append(p);}
 for(const member of members){
  const row=document.createElement('article');row.className='member-card';
  const header=document.createElement('div');const name=document.createElement('b');name.textContent=member.name||t('visitor',{id:member.publicKey.slice(0,8)});if(member.publicKey===session.identity.publicKey)name.textContent+=' · '+t('you');
  const status=document.createElement('span');status.className='member-status'+(online(member)?' online':'');status.textContent=t(online(member)?'memberOnline':'memberOffline');header.append(name,status);
  const label=document.createElement('small');label.textContent=t('publicKey');const key=document.createElement('code');key.textContent=member.publicKey;
  row.append(header,label,key);list.append(row);
 }
}
async function sendHeartbeat(){
 const saved=active,transport=connection,current=generation;
 if(!saved||!transport?.connected()||!canWrite(saved)||sending||heartbeatFlight||Date.now()-lastHeartbeatAttempt<HEARTBEAT_INTERVAL)return;
 lastHeartbeatAttempt=Date.now();
 const flight=(async()=>{try{const packet=seal(saved.room,session.identity,saved.nonce!,'',effectiveName(session.name,saved.nickname),saved.epoch,'heartbeat',mesh?.membership??null,mesh?.announcements());await transport.send(packet.payload);if(current===generation)addMessage(saved,packet.message);}catch{ /* Presence expires naturally; never display heartbeat traffic or errors. */ }})();
 heartbeatFlight=flight;await flight;if(heartbeatFlight===flight)heartbeatFlight=undefined;
}
function renderCache(){
 const persistent=isPersistent(),profile=activeProfile(),pending=recoveryPending();
 $('cache-warning').textContent=t(cacheFailed?'cacheFailed':pending?'recoveryTemporary':persistent?'persistentSession':'sessionWarning',{name:profile?.label||''});
 document.querySelectorAll<HTMLElement>('[data-i18n="temporaryIdentity"]').forEach(node=>node.textContent=t(persistent?'persistentIdentity':'temporaryIdentity'));
 document.querySelectorAll<HTMLElement>('[data-i18n="temporaryShort"]').forEach(node=>node.textContent=t(persistent?'persistentShort':'temporaryShort'));
 const detail=document.querySelector<HTMLElement>('[data-i18n="sessionDetail"]');if(detail)detail.textContent=t(pending?'recoveryTemporaryDetail':persistent?'persistentDetail':'sessionDetail');
 $('recovery-file-tools').hidden=!persistent;
 document.querySelector('.session-banner')?.classList.toggle('cache-error',cacheFailed);
 $('identity').textContent=session.name||t('visitor',{id:session.identity.publicKey.slice(0,8)});
 $('identity-key').textContent=session.identity.publicKey;
 $('cache-alert').hidden=!cacheFailed&&!pending;$('cache-alert').textContent=cacheFailed?t('cacheFailed'):pending?t('recoveryTemporary'):'';
 $('identity').title=t(cacheFailed?'cacheFailed':'sessionWarning');
}
function renderNotice(){
 const node=$('notice');node.textContent=noticeKey?t(noticeKey):'';
 if(copyValue){const input=document.createElement('textarea');input.value=copyValue;input.readOnly=true;input.setAttribute('aria-label',t('copy'));node.append(input);}
}
function notice(key?:TextKey){noticeKey=key;copyValue=undefined;renderNotice();if($<HTMLDialogElement>('new-dialog').open)$('form-feedback').textContent=key?t(key):'';if($<HTMLDialogElement>('nickname-dialog').open)$('nickname-feedback').textContent=key?t(key):'';}
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
 $('attach').toggleAttribute('disabled',!ready||fileSending);
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
  const button=document.createElement('button');button.className='room-choice';
  const heading=document.createElement('b');heading.textContent=saved.room.name;
  const info=document.createElement('small');info.textContent=t(current?'currentRoom':saved.created?'created':'joined');button.append(heading,info);if(current)button.setAttribute('aria-current','true');
  button.onclick=()=>{if(!(current&&(busy||connection?.connected())))void enter(saved);else if(mobileLayout.matches)toggleSidebar(false);};
  const more=document.createElement('details');more.className='room-actions';const summary=document.createElement('summary');summary.textContent='···';summary.setAttribute('aria-label',t('roomInfo'));more.append(summary);
  const copy=document.createElement('button');copy.textContent=t('copy');copy.onclick=()=>{more.open=false;void copyInvitation(saved.room);};
  const remove=document.createElement('button');remove.textContent=t('remove');remove.onclick=()=>void removeRoom(saved);more.append(copy,remove);
  row.append(button,more);list.append(row);
 }
}
function renderMessages(){
 const log=$('messages'),restore=preserveScroll(log);log.replaceChildren();const messages=active?histories.get(roomId(active.room))||[]:[];
 if(!messages.length){const empty=document.createElement('div');empty.className='empty';empty.innerHTML='<div class="room-art"><span>✳</span><i></i><i></i></div><h3></h3><p></p><span class="pill"></span><div class="sssp-blueprint" aria-hidden="true"><img src="/sssp-vtol.svg" alt=""/><span>SSSP / VTOL–01</span></div>';empty.querySelector('h3')!.textContent=t(session.theme==='sssp'?'patrolEmpty':'emptyHeading');empty.querySelector('p')!.textContent=t(active?'emptyRoom':'emptyText');empty.querySelector('.pill')!.textContent=t('emptyPill');if(!active){const button=document.createElement('button');button.className='primary welcome-action';button.textContent=t('newRoom');button.onclick=openNew;empty.append(button);}log.append(empty);return;}
 for(const m of messages){
  if(m.nameChange){const change=document.createElement('p');change.className='name-change';change.dataset.message=m.id+'-name';const fallback=t('visitor',{id:m.sender.slice(0,8)});change.textContent=t('nameChanged',{from:m.nameChange.from||fallback,to:m.nameChange.to||fallback,id:m.sender.slice(0,8)});log.append(change);}
  if(m.kind==='heartbeat')continue;
  const own=m.sender===session.identity.publicKey,row=document.createElement('article');row.className='message-row'+(own?' own':'');row.dataset.message=m.id;
  const meta=document.createElement('div');meta.className='meta';meta.textContent=`${m.nickname?m.nickname+' · '+m.sender.slice(0,8):t('visitor',{id:m.sender.slice(0,8)})}${own?' · '+t('you'):''}  ${new Date(m.time).toLocaleTimeString(session.language==='zh'?'zh-CN':'en-US',{hour:'2-digit',minute:'2-digit'})}`;
  row.append(meta);
  if(m.kind==='file'&&m.file)row.append(attachmentView(active!.room,m.file,t));else{const bubble=document.createElement('p');bubble.textContent=m.text;row.append(bubble);}
  log.append(row);
 }
 restore();
}
function renderHistory(){const el=$('history-status');el.hidden=historyState==='idle';el.classList.toggle('loading',historyState==='loading');el.querySelector('span')!.textContent=t(historyState==='loading'?'historyLoading':'historyFailed');$('history-retry').hidden=historyState!=='error';}
$('history-retry').onclick=()=>{if(active&&connection)void loadHistory(active,connection,generation);};
async function loadHistory(saved:SavedRoom,transport:NonNullable<typeof connection>,current:number){
 historyState='loading';renderHistory();
 const accept=(payloads:Uint8Array[])=>{
  if(current!==generation)return;
  const id=roomId(saved.room),messages=histories.get(id)||[],known=new Set(messages.map(m=>m.id));
  const members=membersByRoom.get(id)||new Map<string,Member>();
  for(const payload of payloads){try{const m=openHistory(saved.room,payload);if(known.has(m.id))continue;known.add(m.id);messages.push(m);observeMember(members,m);}catch{ /* Historical text must authenticate independently of live freshness. */ }}
  messages.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  histories.set(id,messages.slice(-1000));membersByRoom.set(id,members);renderMessages();if($<HTMLDialogElement>('members-dialog').open)renderMembers();
 };
 const outcomes=await Promise.allSettled([transport.history(accept),storageHistory(roomId(saved.room),accept,controller?.signal)]);
 if(current===generation){historyState=outcomes.some(item=>item.status==='fulfilled')?'idle':'error';renderHistory();}
}
function languageChanged(){
 renderHistory();
 document.documentElement.dataset.theme=session.theme;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',session.theme==='sssp'?'#e0e4e7':session.theme==='kabutack'?'#eee9e2':'#e7ebe7');
 document.documentElement.lang=session.language==='zh'?'zh-CN':'en';document.title=session.language==='zh'?'Soft Room · 随便聊聊':'Soft Room · Just chatting';
 document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n as TextKey));
 for(const [data,attr] of [['placeholder','placeholder'],['label','aria-label'],['title','title']] as const)document.querySelectorAll<HTMLElement>(`[data-${data}]`).forEach(el=>el.setAttribute(attr,t(el.dataset[data] as TextKey)));
 if(session.theme==='sssp')document.querySelector('[data-i18n="tagline"]')!.textContent=t('patrolTagline');renderAndroidUpdate();
 $<HTMLSelectElement>('skin').value=session.theme||'soft';
 $<HTMLSelectElement>('language').value=session.language;renderCache();controls();renderRooms();renderMessages();renderNotice();renderMembers();meshPanel.render();
}
function remember(room:Room,created=false):SavedRoom|undefined{
 const found=session.rooms.find(saved=>roomId(saved.room)===roomId(room));if(found)return found;
 if(session.rooms.length>=100){notice('roomLimit');return;}
 const saved:SavedRoom={room,created};session.rooms.unshift(saved);save();renderRooms();return saved;
}
async function disconnect(){
 historyState='idle';renderHistory();
 meshPanel.reset();
 mesh?.leave();mesh?.stop();mesh=undefined;
 generation++;lastHeartbeatAttempt=0;heartbeatFlight=undefined;writeController?.abort();writeController=undefined;writeBusy=false;writePaused=false;controller?.abort();controller=undefined;const old=connection;connection=undefined;active=undefined;busy=false;sending=false;session.activeId=undefined;statusKey='idle';
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
  if(current===generation){statusKey='connected';notice('readyNotice');void sendHeartbeat();}
 }catch(error){if(current===generation){writePaused=true;statusKey='readOnly';notice(signal.aborted?'writeCancelled':'workerFailed');}}
 finally{if(current===generation){writeBusy=false;writeController=undefined;controls();renderRooms();}}
}
async function enter(saved:SavedRoom){
 closePanels();if(mobileLayout.matches)toggleSidebar(false);
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
  const catalog=channelMemory.get(roomId(saved.room))||new Map<string,Network>();channelMemory.set(roomId(saved.room),catalog);
  mesh=new RoomMesh({catalog,iceProvider,cancelIce:()=>iceProvider.cancel(),iceExpires:()=>iceProvider.expires(),turnState:iceProvider.state,room:roomId(saved.room),identity:session.identity,
   send:async message=>{if(current!==generation||!connection?.connected()||!canWrite(saved))throw Error('Not ready');const packet=seal(saved.room,session.identity,saved.nonce!,JSON.stringify(message),effectiveName(session.name,saved.nickname),saved.epoch,'mesh');await connection.send(packet.payload);},
   announce:()=>{lastHeartbeatAttempt=0;void sendHeartbeat();},changed:()=>meshPanel.render()});
  const next=await connect(saved.room,payload=>{
   if(current!==generation)return;
   try{const m=open(saved.room,payload);addMessage(saved,m);}catch{ /* Reject invalid ciphertext, signatures, work and epochs. */ }
  },signal);
  if(current!==generation){await next.stop();return;}connection=next;statusKey='connected';notice('readyNotice');void loadHistory(saved,next,current);
  if(!saved.room.pow)saved.nonce=0;
 }catch(error){if(current!==generation)return;statusKey='error';notice(error instanceof Error&&error.message==='workerFailed'?'workerFailed':'connectionFailed');}
 finally{if(current===generation){busy=false;controls();renderRooms();void prepareWrite();void sendHeartbeat();}}
}
function addMessage(saved:SavedRoom,m:Message){
 const id=roomId(saved.room),messages=histories.get(id)||[];
 const seen=seenIds.get(id)||new Set<string>();if(seen.has(m.id)||messages.some(item=>item.id===m.id))return;seen.add(m.id);if(seen.size>2000)seen.delete(seen.values().next().value!);seenIds.set(id,seen);if(active&&id===roomId(active.room))mesh?.receive(m);if(m.kind==='mesh')return;const members=membersByRoom.get(id)||new Map<string,Member>();const entry=observeMember(members,m);membersByRoom.set(id,members);if(m.kind!=='heartbeat'||entry.nameChange){messages.push(entry);messages.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));if(messages.length>1000)messages.shift();histories.set(id,messages);}
 if(active&&id===roomId(active.room)){if(m.kind!=='heartbeat'||entry.nameChange)renderMessages();if($<HTMLDialogElement>('members-dialog').open)renderMembers();}
}
async function copyInvitation(room:Room){
 sharingRoom=room;$('share-name').textContent=room.name;$<HTMLTextAreaElement>('share-link').value=invitationLink(invite(room),nativeApp(),import.meta.env.VITE_PUBLIC_ORIGIN,location.href);$('share-feedback').textContent='';showPanel('share-dialog');
}
async function removeRoom(saved:SavedRoom){
 if(!confirm(t('removeConfirm',{name:saved.room.name})))return;closePanels();
 const id=roomId(saved.room);if(active&&roomId(active.room)===id)await disconnect();
 session.rooms=session.rooms.filter(item=>roomId(item.room)!==id);histories.delete(id);seenIds.delete(id);membersByRoom.delete(id);channelMemory.delete(id);save();void deleteSavedRoom(id).catch(()=>{});renderRooms();notice('removed');
}
$('nickname-form').addEventListener('submit',event=>{event.preventDefault();if(!active)return;try{const nickname=normalizeNickname($<HTMLInputElement>('nickname').value);if(nickname)active.nickname=nickname;else delete active.nickname;$<HTMLInputElement>('nickname').value=nickname;save();savedFeedback('nickname-form','nickname-dialog','nicknameSaved');}catch{notice('nicknameInvalid');}});
$('create').addEventListener('submit',event=>{event.preventDefault();if(busy)return;const room=makeRoom($<HTMLInputElement>('room-name').value.trim()||t('defaultRoom'),$<HTMLInputElement>('pow').checked);const saved=remember(room,true);if(saved)void enter(saved);});
$('join').addEventListener('submit',event=>{event.preventDefault();if(busy)return;try{const room=parseInvite($<HTMLTextAreaElement>('invite-input').value);const saved=remember(room);if(saved){$<HTMLTextAreaElement>('invite-input').value='';void enter(saved);}}catch{notice('inviteInvalid');}});
$('leave').addEventListener('click',()=>{closePanels();void disconnect();notice('left');});
$('cancel-work').addEventListener('click',()=>{if(writeBusy){writePaused=true;writeController?.abort();}else{void disconnect();notice('cancelled');}});
$('resume-work').addEventListener('click',()=>{writePaused=false;void prepareWrite();});
$('reconnect').addEventListener('click',()=>{if(active)void enter(active);});
$('copy').addEventListener('click',()=>{if(active)void copyInvitation(active.room);});
$('clear-session').addEventListener('click',async()=>{
 if(!confirm(t('clearConfirm')))return;closePanels();await disconnect();
 logoutPersistent();
 try{storage?.removeItem(SESSION_KEY);}catch{ /* Save below reports storage failure. */ }
 const theme=session.theme;session=freshSession(session.language);session.theme=theme;histories.clear();seenIds.clear();membersByRoom.clear();channelMemory.clear();save();languageChanged();notice('sessionCleared');
});
$('logout').addEventListener('click',async()=>{
 if(!confirm(t('logoutConfirm')))return;closePanels();await disconnect();logoutPersistent();
 try{storage?.removeItem(SESSION_KEY);}catch{ /* Reload returns to identity selection even when storage is unavailable. */ }
 location.reload();
});
$('skin').addEventListener('change',()=>{session.theme=$<HTMLSelectElement>('skin').value as 'soft'|'sssp'|'kabutack';save();languageChanged();});
$('language').addEventListener('change',()=>{session.language=$<HTMLSelectElement>('language').value as Language;save();languageChanged();});
$('composer').addEventListener('submit',async event=>{
 event.preventDefault();const input=$<HTMLTextAreaElement>('message');if(!active||!connection||sending||!input.value.trim())return;
 if(!canWrite(active)){writePaused=false;void prepareWrite();return;}
 const current=generation,saved=active,body=input.value;sending=true;controls();
 try{await heartbeatFlight;if(current!==generation)return;const packet=seal(saved.room,session.identity,saved.nonce!,body,effectiveName(session.name,saved.nickname),saved.epoch);await connection.send(packet.payload,true);void backupMessage(roomId(saved.room),packet.payload).catch(()=>{});if(current!==generation)return;addMessage(saved,packet.message);if(input.value===body)input.value='';notice('sent');}
 catch{if(current===generation)notice('sendFailed');}finally{if(current===generation){sending=false;controls();input.focus();}}
});
$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$<HTMLFormElement>('composer').requestSubmit();}});
$('attach').onclick=()=>{if(active&&connection?.connected()&&canWrite(active)){$<HTMLFormElement>('file-form').reset();$('file-feedback').textContent='';$<HTMLProgressElement>('file-progress').hidden=true;showPanel('file-dialog');}else notice('fileNeedRoom');};
$<HTMLFormElement>('file-form').onsubmit=event=>{event.preventDefault();void(async()=>{const saved=active,current=generation,file=$<HTMLInputElement>('file-input').files?.[0],button=$<HTMLButtonElement>('file-submit'),bar=$<HTMLProgressElement>('file-progress');if(!saved||!connection?.connected()||!canWrite(saved)||!file||fileSending)return;fileSending=true;button.disabled=true;bar.hidden=false;controls();const show=(value:UploadProgress)=>{bar.value=value.total?value.loaded/value.total:0;const key=value.phase==='processing'?'fileProcessing':value.phase==='encrypting'?'fileEncrypting':'fileUploading';$('file-feedback').textContent=t(key,{percent:Math.round(bar.value*100)});};try{const attachment=await shareFile(saved.room,file,$<HTMLSelectElement>('file-quality').value as MediaQuality,show);if(current!==generation||active!==saved||!connection?.connected())throw Error('Room changed');const packet=seal(saved.room,session.identity,saved.nonce!,'',effectiveName(session.name,saved.nickname),saved.epoch,'file',undefined,undefined,attachment);await connection.send(packet.payload,true);void backupMessage(roomId(saved.room),packet.payload).catch(()=>{});addMessage(saved,packet.message);$<HTMLDialogElement>('file-dialog').close();notice('fileSent');}catch{$('file-feedback').textContent=t('fileFailed');}finally{fileSending=false;button.disabled=false;controls();}})();};
function checkDay(){
 if(!connection||!active)return;
 if(!connection.connected()){statusKey='disconnected';controls();return;}
 if(!canWrite(active)){controls();renderRooms();void prepareWrite();}
 else if(!writeBusy&&statusKey!=='connected'){statusKey='connected';controls();renderRooms();}
}
setInterval(()=>{mesh?.tick();meshPanel.render();checkDay();void sendHeartbeat();if($<HTMLDialogElement>('members-dialog').open)renderMembers();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){mesh?.tick();checkDay();void sendHeartbeat();}});
window.addEventListener('focus',checkDay);
languageChanged();save();keepMobileScreenOn();
if(location.hash){const code=location.hash.slice(1);history.replaceState(null,'',location.pathname);try{const room=parseInvite(code);$<HTMLTextAreaElement>('invite-input').value=code;openNew();$('choose-join').click();$('form-feedback').textContent=room.name;}catch{notice('inviteInvalid');}}
else if(session.activeId){const saved=session.rooms.find(item=>roomId(item.room)===session.activeId);if(saved)void enter(saved);}
