import {nativeApp} from './platform.ts';
import {KeepAwake} from '@capacitor-community/keep-awake';
export type ScreenLease={release:()=>Promise<void>;addEventListener?:(type:string,listener:()=>void)=>void};
// A pending permission request may finish after the page hides: release it immediately in that case.
export class ScreenAwake {
 private wanted=false;private pending=false;private lease?:ScreenLease;
 constructor(privateRequest:()=>Promise<ScreenLease>,privateChanged:(active:boolean)=>void=()=>{}){this.request=privateRequest;this.changed=privateChanged;}
 private request:()=>Promise<ScreenLease>;private changed:(active:boolean)=>void;
 async visible(value:boolean){
  this.wanted=value;if(this.pending)return;this.pending=true;
  try{
   if(!this.wanted&&this.lease){const old=this.lease;this.lease=undefined;await old.release();this.changed(false);}
   if(this.wanted&&!this.lease){const lease=await this.request();this.lease=lease;lease.addEventListener?.('release',()=>{if(this.lease===lease){this.lease=undefined;this.changed(false);}});this.changed(true);}
   if(!this.wanted&&this.lease){const old=this.lease;this.lease=undefined;await old.release();this.changed(false);}
  }catch{this.changed(false);}finally{this.pending=false;}
 }
}
export function keepMobileScreenOn(){
 if(!nativeApp()&&!(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||navigator.maxTouchPoints>1||matchMedia('(pointer:coarse)').matches))return;
 const controller=new ScreenAwake(async()=>{
  if(nativeApp()){await KeepAwake.keepAwake();return {release:()=>KeepAwake.allowSleep()};}
  if(!navigator.wakeLock)throw Error('Wake lock unavailable');return navigator.wakeLock.request('screen');
 },active=>{document.documentElement.dataset.screenAwake=String(active);});
 let lastTry=0;const update=()=>{lastTry=Date.now();void controller.visible(document.visibilityState==='visible');};
 document.addEventListener('visibilitychange',update);window.addEventListener('pageshow',update);window.addEventListener('focus',update);
 document.addEventListener('pointerdown',()=>{if(Date.now()-lastTry>3000)update();},{passive:true});
 window.addEventListener('pagehide',()=>void controller.visible(false));update();return controller;
}
