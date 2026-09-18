export const REGION_BYPASS_STORAGE_KEY='soft-room-region-bypass-v1';
export function regionBypassed(){const digest=((import.meta as ImportMeta&{env?:Record<string,string|undefined>}).env?.VITE_REGION_BYPASS_SHA256||'').trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(digest))return false;try{return sessionStorage.getItem(REGION_BYPASS_STORAGE_KEY)===digest;}catch{return false;}}
