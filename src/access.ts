export function browserLanguage(languages:readonly string[]):'zh'|'en'{
 for(const language of languages){const base=language.toLowerCase().split(/[-_]/)[0];if(base==='zh'||base==='en')return base;}return 'en';
}
export function localAddress(hostname:string){
 const host=hostname.toLowerCase().replace(/\.$/,'');if(host==='localhost'||host==='127.0.0.1')return true;
 const parts=host.split('.');return parts.length===4&&parts[0]==='192'&&parts[1]==='168'&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255);
}
export function terminal(ua:string,touch=0){
 const ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&touch>1),android=/Android/i.test(ua);
 const platform=ios?'ios':android?'android':/Windows/i.test(ua)?'windows':/Macintosh|Mac OS X/i.test(ua)?'macos':/Linux/i.test(ua)?'linux':'other';
 const device=/iPad|Tablet/i.test(ua)||(ios&&!/iPhone|iPod/i.test(ua))||(android&&!/Mobile/i.test(ua))?'tablet':ios||android?'phone':'desktop';
 const embedded=/MicroMessenger|WeChat|BytedanceWebview|aweme|Douyin|Toutiao|NewsArticle|musical_ly|TikTok|QQ\/[\d.]|Weibo|AlipayClient|AliApp|DingTalk|BaiduBoxApp|Kwai|Kuaishou|XiaoHongShu|RedApp|FBAN|FBAV|Instagram|;\s*wv\)/i.test(ua);
 const mainstream=/Chrome\/|Chromium\/|CriOS\/|Firefox\/|FxiOS\/|Edg(?:e|A|iOS)?\/|OPR\/|SamsungBrowser\//i.test(ua)||(/Version\/[\d.]+.*Safari\//i.test(ua)&&!android);
 return {platform,device,embedded,supported:!embedded&&mainstream};
}
export function blockedCountry(country:string){return ['CN','HK','MO'].includes(country.toUpperCase());}

export async function accessCodeDigest(value:string){
 const bytes=new TextEncoder().encode(value.trim());
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function validAccessDigest(value:string){return /^[a-f0-9]{64}$/.test(value);}

// Cloudflare serves this at the site's own origin; never transmit room data or invitations.
export function parseTrace(body:string):{ip:string;country:string}{
 const fields=new Map(body.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
 const ip=fields.get('ip')||'',country=fields.get('loc')||'';
 if(!/^[A-Z]{2}$/.test(country)||country==='XX'||country==='ZZ')throw Error('Unknown region');
 const parts=ip.split('.');let valid=parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255);
 if(ip.includes(':'))try{valid=new URL(`http://[${ip}]/`).hostname.startsWith('[');}catch{valid=false;}
 if(!valid)throw Error('Invalid IP');return {ip,country};
}
