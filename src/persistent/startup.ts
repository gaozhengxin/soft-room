import {encodeSession,loadSession,SESSION_KEY,type Session} from '../session.ts';
import {DEFAULT_PDS} from './atproto-account.ts';
import {activeProfileId,continuePersistent,loginPersistent,profiles,chooseTemporary,type PersistentProfile} from './runtime.ts';
import './startup.css';

type Language='zh'|'en';
const copy={
 zh:{title:'选择你的身份',detail:'你可以继续使用临时身份，也可以用已有账户保存加密后的身份和房间。',temporary:'使用临时身份继续',signIn:'登录持久身份',create:'创建持久身份',continue:'继续使用 {name}',account:'Bluesky 账户或用户名',password:'App Password',passwordHint:'请在 Bluesky 设置中单独生成 App Password。这里不能使用普通登录密码；App Password 不会保存在设备或房间中。',submitSignIn:'登录并恢复',submitCreate:'创建 Soft Room 持久身份',back:'返回',advanced:'高级设置',pds:'账户服务地址',working:'正在安全地读取身份…',recovery:'这台设备没有该身份的本地主密钥。当前版本尚未提供跨设备恢复密钥导入，请回到原设备继续使用。',missing:'这个账户还没有 Soft Room 持久身份。请选择“创建持久身份”。',exists:'已恢复加密身份和房间。',failed:'暂时无法完成，请检查网络后重试。',credentials:'账户或 App Password 不正确。App Password 不是普通登录密码，请在 Bluesky 设置中单独生成。',rateLimited:'尝试次数过多，请稍后再试。',createIntro:'Soft Room 使用 Bluesky / AT Protocol 账户作为持久身份的归属。还没有账户时，请先到 Bluesky 注册。',register:'前往 Bluesky 注册',afterRegister:'注册完成后，在 Bluesky 设置中生成一个 App Password，再回到这里继续。',haveAccount:'我已有 Bluesky 账户，继续',createHint:'使用 Bluesky 账户创建 Soft Room 持久身份。这里只会保存加密后的 Soft Room 数据，不会替你发布社交内容。'},
 en:{title:'Choose your identity',detail:'Continue temporarily, or use an existing account to keep an encrypted identity and room list.',temporary:'Continue with temporary identity',signIn:'Sign in to persistent identity',create:'Create persistent identity',continue:'Continue as {name}',account:'Bluesky account or handle',password:'App Password',passwordHint:'Generate a separate App Password in Bluesky settings. Your regular password will not work here; the App Password is never saved on this device or sent to a room.',submitSignIn:'Sign in and restore',submitCreate:'Create Soft Room identity',back:'Back',advanced:'Advanced settings',pds:'Account service address',working:'Securely loading your identity…',recovery:'This device does not have the local master key for this identity. Recovery-key import is not available in this version; continue on the original device.',missing:'This account does not have a Soft Room persistent identity. Choose “Create persistent identity”.',exists:'Encrypted identity and rooms restored.',failed:'Could not complete this request. Check the network and try again.',credentials:'The account or App Password is incorrect. An App Password is different from your regular password; generate one in Bluesky settings.',rateLimited:'Too many attempts. Please try again later.',createIntro:'Soft Room uses a Bluesky / AT Protocol account to own your persistent identity. If you do not have an account, register with Bluesky first.',register:'Register with Bluesky',afterRegister:'After registering, generate an App Password in Bluesky settings, then return here to continue.',haveAccount:'I have a Bluesky account',createHint:'Use your Bluesky account to create a persistent Soft Room identity. This stores encrypted Soft Room data and does not publish social content for you.'}
};

function failureMessage(error:unknown,t:typeof copy.zh):string{
 const response=error as {status?:number;error?:string};
 if(response.status===401||response.error==='AuthenticationRequired'||response.error==='InvalidToken')return t.credentials;
 if(response.status===429||response.error==='RateLimitExceeded')return t.rateLimited;
 return t.failed;
}

export async function identityStartup(host:HTMLElement,language:Language):Promise<void>{
 const t=copy[language];
 return new Promise(resolve=>{
  let initialTemporary:Session|undefined;if(!activeProfileId())try{initialTemporary=loadSession(sessionStorage,language).session;}catch{}
  const panel=document.createElement('section');panel.className='identity-startup';
  const card=document.createElement('div');card.className='identity-startup-card';panel.append(card);host.replaceChildren(panel);
  const saveAndContinue=(session?:Session)=>{if(session)try{sessionStorage.setItem(SESSION_KEY,encodeSession(session));}catch{}host.replaceChildren();resolve();};
  const showHome=()=>{
   card.replaceChildren();const mark=document.createElement('div');mark.className='identity-startup-mark';mark.textContent='S';const h=document.createElement('h1');h.textContent=t.title;const p=document.createElement('p');p.textContent=t.detail;card.append(mark,h,p);
   const actions=document.createElement('div');actions.className='identity-startup-actions';
   for(const profile of profiles()){const button=document.createElement('button');button.className='primary';button.textContent=t.continue.replace('{name}',profile.label);button.onclick=()=>void continueLocal(profile,button);actions.append(button);}
   const temporary=document.createElement('button');temporary.textContent=t.temporary;temporary.onclick=()=>{const switchingFromPersistent=!!activeProfileId();chooseTemporary();if(switchingFromPersistent)try{sessionStorage.removeItem(SESSION_KEY);}catch{}saveAndContinue();};
   const signIn=document.createElement('button');signIn.textContent=t.signIn;signIn.onclick=()=>showForm(false);
   const create=document.createElement('button');create.textContent=t.create;create.onclick=showCreateGuide;actions.append(temporary,signIn,create);card.append(actions);
  };
  const continueLocal=async(profile:PersistentProfile,button:HTMLButtonElement)=>{button.disabled=true;status(t.working);try{saveAndContinue(await continuePersistent(profile,language));}catch(error){button.disabled=false;status(error instanceof Error&&error.message==='Recovery key required'?t.recovery:t.failed,true);}};
  const status=(message:string,error=false)=>{let node=card.querySelector<HTMLElement>('[data-status]');if(!node){node=document.createElement('p');node.dataset.status='';node.setAttribute('role','status');card.append(node);}node.textContent=message;node.classList.toggle('error',error);};
  const showCreateGuide=()=>{
   card.replaceChildren();const back=document.createElement('button');back.className='identity-startup-back';back.textContent='‹ '+t.back;back.onclick=showHome;const h=document.createElement('h1');h.textContent=t.create;const intro=document.createElement('p');intro.textContent=t.createIntro;
   const actions=document.createElement('div');actions.className='identity-startup-actions';const register=document.createElement('a');register.className='identity-startup-link primary';register.href='https://bsky.app/';register.target='_blank';register.rel='noopener noreferrer';register.textContent=t.register;const after=document.createElement('small');after.textContent=t.afterRegister;const next=document.createElement('button');next.textContent=t.haveAccount;next.onclick=()=>showForm(true);actions.append(register,after,next);card.append(back,h,intro,actions);
  };
  const showForm=(create:boolean)=>{
   card.replaceChildren();const back=document.createElement('button');back.className='identity-startup-back';back.textContent='‹ '+t.back;back.onclick=create?showCreateGuide:showHome;const h=document.createElement('h1');h.textContent=create?t.create:t.signIn;const hint=document.createElement('p');hint.textContent=create?t.createHint:t.detail;
   const form=document.createElement('form');form.className='identity-startup-form';
   const account=document.createElement('input');account.required=true;account.autocomplete='username';account.placeholder=t.account;account.setAttribute('aria-label',t.account);const accountLabel=document.createElement('label');accountLabel.textContent=t.account;accountLabel.append(account);
   const password=document.createElement('input');password.required=true;password.type='password';password.autocomplete='current-password';password.placeholder=t.password;password.setAttribute('aria-label',t.password);const passwordLabel=document.createElement('label');passwordLabel.textContent=t.password;passwordLabel.append(password);
   const small=document.createElement('small');small.textContent=t.passwordHint;
   const advanced=document.createElement('details');const summary=document.createElement('summary');summary.textContent=t.advanced;const pds=document.createElement('input');pds.type='url';pds.value=DEFAULT_PDS;pds.placeholder=DEFAULT_PDS;pds.setAttribute('aria-label',t.pds);const label=document.createElement('label');label.textContent=t.pds;label.append(pds);advanced.append(summary,label);
   const submit=document.createElement('button');submit.className='primary';submit.type='submit';submit.textContent=create?t.submitCreate:t.submitSignIn;form.append(accountLabel,passwordLabel,small,advanced,submit);card.append(back,h,hint,form);
   form.onsubmit=event=>{event.preventDefault();void(async()=>{submit.disabled=true;status(t.working);try{const session=await loginPersistent({identifier:account.value,appPassword:password.value,pds:pds.value},language,create,create?initialTemporary:undefined);password.value='';saveAndContinue(session);}catch(error){submit.disabled=false;password.value='';const message=error instanceof Error?error.message:'';status(message==='Recovery key required'?t.recovery:message==='No persistent identity exists for this account'?t.missing:failureMessage(error,t),true);}})();};
  };
  showHome();
 });
}
