import {CapacitorHttp} from '@capacitor/core';

export type AndroidChannel='stable'|'test';
export type AndroidUpdateManifest={channel:AndroidChannel;build:number;version:string;apkUrl:string;sha256:string;publishedAt:string};

const manifests:Record<AndroidChannel,string>={
 stable:'https://github.com/gaozhengxin/soft-room/releases/latest/download/android-update.json',
 test:'https://github.com/gaozhengxin/soft-room/releases/download/android-test/android-test-update.json',
};

export function parseAndroidUpdate(value:unknown,channel:AndroidChannel):AndroidUpdateManifest{
 const item=value as AndroidUpdateManifest;
 if(!item||item.channel!==channel||!Number.isSafeInteger(item.build)||item.build<1||typeof item.version!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-test\.[0-9]+)?$/.test(item.version)||typeof item.apkUrl!=='string'||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||typeof item.publishedAt!=='string'||!Number.isFinite(Date.parse(item.publishedAt)))throw Error('Invalid Android update manifest');
 const url=new URL(item.apkUrl),prefix='/gaozhengxin/soft-room/releases/download/';
 if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(prefix))throw Error('Invalid Android update URL');
 const file=decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/')+1));
 if(file!==`Soft-Room-android-${item.version}.apk`)throw Error('Invalid Android update asset');
 if(channel==='test'&&(!url.pathname.startsWith(prefix+'android-test/')||!item.version.endsWith(`-test.${item.build}`)))throw Error('Invalid Android test channel');
 if(channel==='stable'&&(url.pathname.startsWith(prefix+'android-test/')||item.version.includes('-test.')||!url.pathname.startsWith(`${prefix}v${item.version}/`)))throw Error('Invalid Android stable channel');
 return item;
}

export async function latestAndroidUpdate(channel:AndroidChannel,now=Date.now):Promise<AndroidUpdateManifest>{
 const separator=manifests[channel].includes('?')?'&':'?';
 const result=await CapacitorHttp.get({url:`${manifests[channel]}${separator}t=${now()}`,headers:{'Cache-Control':'no-cache'},connectTimeout:8000,readTimeout:8000,responseType:'json'});
 if(result.status!==200)throw Error('Android update unavailable');
 const value=typeof result.data==='string'?JSON.parse(result.data):result.data;
 return parseAndroidUpdate(value,channel);
}

export function hasAndroidUpdate(currentBuild:number,manifest:AndroidUpdateManifest){return Number.isSafeInteger(currentBuild)&&currentBuild>0&&manifest.build>currentBuild;}
