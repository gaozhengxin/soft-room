import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAndroidUpdate,parseAndroidUpdate} from '../src/android-update.ts';

const manifest={channel:'test' as const,build:8,version:'0.2.5-test.8',apkUrl:'https://github.com/gaozhengxin/soft-room/releases/download/android-test/Soft-Room-android-0.2.5-test.8.apk',sha256:'ab'.repeat(32),publishedAt:'2026-09-18T00:00:00.000Z'};

test('Android update manifests select a unique channel-specific APK and compare builds',()=>{
 const parsed=parseAndroidUpdate(manifest,'test');assert.equal(parsed.apkUrl,manifest.apkUrl);assert.equal(hasAndroidUpdate(7,parsed),true);assert.equal(hasAndroidUpdate(8,parsed),false);assert.equal(hasAndroidUpdate(9,parsed),false);
 const stable=parseAndroidUpdate({...manifest,channel:'stable',build:2005,version:'0.2.5',apkUrl:'https://github.com/gaozhengxin/soft-room/releases/download/v0.2.5/Soft-Room-android-0.2.5.apk'},'stable');assert.equal(stable.build,2005);
});

test('Android update manifests reject another channel, fixed latest assets and unsafe URLs',()=>{
 assert.throws(()=>parseAndroidUpdate({...manifest,channel:'stable'},'test'));
 assert.throws(()=>parseAndroidUpdate({...manifest,version:'0.2.5-test.9'},'test'));
 assert.throws(()=>parseAndroidUpdate({...manifest,apkUrl:'https://github.com/gaozhengxin/soft-room/releases/download/android-test/Soft-Room-android-test.apk'},'test'));
 assert.throws(()=>parseAndroidUpdate({...manifest,apkUrl:'https://example.com/Soft-Room-android-0.2.5-test.8.apk'},'test'));
 assert.throws(()=>parseAndroidUpdate({...manifest,sha256:'bad'},'test'));
});
