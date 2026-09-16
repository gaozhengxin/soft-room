import {chromium} from 'playwright-core';
import {build} from 'vite';
import assert from 'node:assert/strict';

const result=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:'tests/media-harness.ts',formats:['es']}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();let uploads=0;
await page.route('**/media-check',route=>route.fulfill({contentType:'text/html',body:'<main>media check</main>'}));
await page.route('**/media-harness.js',route=>route.fulfill({contentType:'text/javascript',body:code}));
await page.route('**/v1/config',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({fileChunkBytes:4*1024*1024,maxFileBytes:192*1024*1024})}));
await page.route('**/v1/files',route=>{uploads++;return route.fulfill({status:201,contentType:'application/json',body:'{"complete":false}'});});
await page.route('**/v1/files/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
try{
 await page.goto('https://127.0.0.1/media-check');
 const value=await page.evaluate(async()=>{
  const {shareFile}=await import('/media-harness.js'),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const context=canvas.getContext('2d'),stream=canvas.captureStream(30),mime='video/webm;codecs=vp8',recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5_000_000}),parts=[];
  recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start(200);
  for(let frame=0;frame<90;frame++){const data=context.createImageData(canvas.width,canvas.height);for(let offset=0;offset<data.data.length;offset+=65536)crypto.getRandomValues(data.data.subarray(offset,Math.min(data.data.length,offset+65536)));context.putImageData(data,0,0);await new Promise(resolve=>setTimeout(resolve,33));}
  recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());const source=new Blob(parts,{type:mime}),file=new File([source],'high-bitrate.webm',{type:mime});
  const probe=document.createElement('video'),url=URL.createObjectURL(source);probe.src=url;await new Promise((resolve,reject)=>{probe.onloadedmetadata=resolve;probe.onerror=reject;});const duration=probe.duration;URL.revokeObjectURL(url);const room={v:1,key:'11'.repeat(32),name:'Media check',pow:0};return {source:source.size,duration,attachment:await shareFile(room,file,'compact')};
 });
 console.log('SOURCE',value.source,value.duration,value.attachment.quality,uploads);assert.equal(value.attachment.media,'video');assert.equal(value.attachment.quality,'compact');assert.ok(value.attachment.preview);assert.ok(uploads>=2);console.log('PASS browser video preview bitrate conversion',value.source,value.attachment.preview.size);
}finally{await browser.close();}
