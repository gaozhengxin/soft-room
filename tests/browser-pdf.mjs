import {build} from 'vite';
import {chromium,devices} from 'playwright-core';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

function samplePdf(){
 const stream='BT /F1 24 Tf 30 100 Td (Soft Room PDF) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let source='%PDF-1.4\n',offsets=[0];for(let index=0;index<objects.length;index++){offsets.push(source.length);source+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}
 const xref=source.length;source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return new TextEncoder().encode(source);
}
const output=await mkdtemp(join(tmpdir(),'soft-room-pdf-'));
const built=await build({configFile:false,logLevel:'error',build:{outDir:output,emptyOutDir:true,target:'es2022',rollupOptions:{input:'tests/pdf-harness.ts'}}});
const result=Array.isArray(built)?built[0]:built,entry=result.output.find(item=>item.type==='chunk'&&item.isEntry).fileName;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({...devices['Pixel 7']});
await context.addInitScript(()=>{for(const [owner,key] of [[Promise,'withResolvers'],[Promise,'try'],[Uint8Array,'fromBase64'],[URL,'parse']])Object.defineProperty(owner,key,{value:undefined,writable:true,configurable:true});});
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'};
await page.route('https://pdf.soft-room.test/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/'){await route.fulfill({contentType:'text/html',body:`<main id="pdf"></main><script type="module" src="/${entry}"></script>`});return;}try{await route.fulfill({body:await readFile(join(output,path.slice(1))),contentType:mime[extname(path)]||'application/octet-stream'});}catch{await route.fulfill({status:404});}});
try{await page.goto('https://pdf.soft-room.test/');const value=await page.evaluate(async data=>await globalThis.renderPdfCheck(data),Array.from(samplePdf()));assert.equal(value.pages,1);assert.ok(value.renders>=1&&value.width>0&&value.height>0);assert.deepEqual(errors,[]);console.log('PASS Android-compatible PDF.js canvas preview',value);}finally{await browser.close();await rm(output,{recursive:true,force:true});}
