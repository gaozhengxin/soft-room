import './compat.ts';
import {nativeApp,readLocation} from './platform.ts';
import {Capacitor} from '@capacitor/core';
import './style.css';
import './sssp.css';
import './access.css';
import {browserLanguage,terminal,localAddress,blockedCountry,parseTrace,accessCodeDigest,validAccessDigest} from './access.ts';
import {REGION_BYPASS_STORAGE_KEY,regionBypassed} from './region-bypass.ts';
const language=browserLanguage(navigator.languages?.length?navigator.languages:[navigator.language]);
const info=terminal(navigator.userAgent,navigator.maxTouchPoints);
document.documentElement.lang=language==='zh'?'zh-CN':'en';document.documentElement.dataset.theme='soft';
const native=nativeApp();
document.documentElement.dataset.device=info.device;document.documentElement.dataset.runtime=native?'app':'web';document.documentElement.dataset.platform=native?Capacitor.getPlatform():info.platform;
if(native&&Capacitor.getPlatform()==='android'){
 const size=()=>document.documentElement.style.setProperty('--app-height',`${Math.round(window.visualViewport?.height||window.innerHeight)}px`);
 size();window.addEventListener('resize',size);window.visualViewport?.addEventListener('resize',size);
}
const text={zh:{checking:'正在检查访问环境',wait:'请稍候…',browser:'请使用独立浏览器打开',browserDetail:'此浏览器暂不支持。请使用 Safari、Chrome、Edge 或 Firefox 打开。',guide:'可从右上角菜单选择「在浏览器中打开」，或复制链接后粘贴到系统浏览器。',open:'尝试在浏览器中打开',copy:'复制链接',copied:'链接已复制',copyManual:'请复制下面的链接',region:'暂不提供服务',regionDetail:'当前网络所在地区不在服务范围内。',codeLabel:'访问代码',codePlaceholder:'输入访问代码',codeSubmit:'继续访问',codeInvalid:'代码不正确。',failed:'暂时无法确认网络所在地区',failedDetail:'请检查网络后重试。',retry:'重试',loadFailed:'页面加载失败'},en:{checking:'Checking access',wait:'Please wait…',browser:'Open in a standalone browser',browserDetail:'This browser is not supported. Please use Safari, Chrome, Edge or Firefox.',guide:'Choose “Open in browser” from the app menu, or copy this link into your system browser.',open:'Try opening in a browser',copy:'Copy link',copied:'Link copied',copyManual:'Copy the link below',region:'Service unavailable',regionDetail:'Service is not available in your current network region.',codeLabel:'Access code',codePlaceholder:'Enter access code',codeSubmit:'Continue',codeInvalid:'Incorrect code.',failed:'Unable to check your network region',failedDetail:'Check your connection and try again.',retry:'Retry',loadFailed:'Unable to load the page'}}[language];
const app=document.getElementById('app')!;
const bypassHash=(import.meta.env.VITE_REGION_BYPASS_SHA256||'').trim().toLowerCase();
let runtimeBypass=false;
const accessBypassed=()=>runtimeBypass||regionBypassed();
function screen(title:string,detail:string,loading=false){
 app.replaceChildren();const panel=document.createElement('section');panel.className='access-screen';panel.setAttribute('aria-live','polite');
 const mark=document.createElement('div');mark.className=loading?'access-spinner':'access-mark';if(!loading){const img=document.createElement('img');img.src='/sssp-emblem.svg';img.alt='';mark.append(img);}
 const h=document.createElement('h1');h.textContent=title;const p=document.createElement('p');p.textContent=detail;panel.append(mark,h,p);app.append(panel);return panel;
}
function button(panel:HTMLElement,label:string,action:()=>void){const b=document.createElement('button');b.textContent=label;b.onclick=action;panel.append(b);}
function blockedRegion(){
 const panel=screen(text.region,text.regionDetail);if(!validAccessDigest(bypassHash))return;
 const mark=panel.querySelector<HTMLElement>('.access-mark');if(!mark)return;
 let taps=0,resetTimer=0,revealed=false;
 const reveal=()=>{
  if(revealed)return;revealed=true;window.clearTimeout(resetTimer);
  const form=document.createElement('form');form.className='access-code-form';
  const label=document.createElement('label');label.textContent=text.codeLabel;
  const input=document.createElement('input');input.type='password';input.inputMode='numeric';input.pattern='[0-9]*';input.autocomplete='one-time-code';input.enterKeyHint='go';input.placeholder=text.codePlaceholder;input.setAttribute('aria-label',text.codeLabel);
  const submit=document.createElement('button');submit.type='submit';submit.textContent=text.codeSubmit;
  const status=document.createElement('p');status.className='access-code-status';status.setAttribute('role','alert');
  label.append(input);form.append(label,submit,status);panel.append(form);input.focus({preventScroll:true});
  form.addEventListener('submit',event=>{event.preventDefault();void(async()=>{
   submit.disabled=true;const digest=await accessCodeDigest(input.value);submit.disabled=false;
   if(digest!==bypassHash){status.textContent=text.codeInvalid;input.select();input.focus({preventScroll:true});return;}
   runtimeBypass=true;try{sessionStorage.setItem(REGION_BYPASS_STORAGE_KEY,bypassHash);}catch{}void start();
  })();});
 };
 mark.addEventListener('click',()=>{taps+=1;if(taps>=5){reveal();return;}window.clearTimeout(resetTimer);resetTimer=window.setTimeout(()=>{taps=0;},3000);});
}
function unsupported(){
 const panel=screen(text.browser,text.browserDetail);const guide=document.createElement('p');guide.textContent=text.guide;panel.append(guide);
 if(info.platform==='android')button(panel,text.open,()=>{
  const target=new URL(location.href);if(!['http:','https:'].includes(target.protocol))return;
  location.href=`intent:${target.href.slice(target.protocol.length)}#Intent;scheme=${target.protocol.slice(0,-1)};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(target.href)};end`;
 });
 const status=document.createElement('p');status.setAttribute('role','status');
 button(panel,text.copy,()=>{void(async()=>{try{await navigator.clipboard.writeText(location.href);status.textContent=text.copied;}catch{status.textContent=text.copyManual;const input=document.createElement('textarea');input.value=location.href;input.readOnly=true;input.setAttribute('aria-label',text.copy);panel.append(input);input.focus();input.select();}})();});panel.append(status);
}
async function start(){
 if(!native&&!info.supported){unsupported();return;}
 screen(text.checking,text.wait,true);
 if(native||!localAddress(location.hostname))try{
  const result=parseTrace(await readLocation(native,import.meta.env.VITE_PUBLIC_ORIGIN));
  if(blockedCountry(result.country)&&!accessBypassed()){blockedRegion();return;}
 }catch{const panel=screen(text.failed,text.failedDetail);button(panel,text.retry,()=>void start());return;}
 try{app.replaceChildren();const {identityStartup}=await import('./persistent/startup.ts');await identityStartup(app,language);await import('./main.ts');}catch{const panel=screen(text.loadFailed,text.failedDetail);button(panel,text.retry,()=>location.reload());}
}
void start();
