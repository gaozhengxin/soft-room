import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export async function renderPdf(blob:Blob,root:HTMLElement,onRender:()=>void){
 const {getDocument,GlobalWorkerOptions}=await import('pdfjs-dist');
 GlobalWorkerOptions.workerSrc=pdfWorker;
 const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false}).promise;
 const pages:HTMLElement[]=[];
 for(let number=1;number<=pdf.numPages;number++){
  const page=document.createElement('div');page.className='pdf-page';page.dataset.page=String(number);
  const label=document.createElement('small');label.textContent=`${number} / ${pdf.numPages}`;page.append(label);root.append(page);pages.push(page);
 }
 const render=async(number:number)=>{
  const host=pages[number-1];if(host.dataset.rendered)return;host.dataset.rendered='true';
  const page=await pdf.getPage(number),base=page.getViewport({scale:1}),cssWidth=Math.min(base.width,Math.max(260,root.clientWidth-4)),scale=cssWidth/base.width,density=Math.min(devicePixelRatio||1,1.75),viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('Canvas unavailable');
  canvas.width=Math.max(1,Math.floor(viewport.width*density));canvas.height=Math.max(1,Math.floor(viewport.height*density));canvas.style.width=`${Math.floor(viewport.width)}px`;canvas.style.height=`${Math.floor(viewport.height)}px`;host.append(canvas);
  await page.render({canvas,canvasContext:context,viewport,transform:density===1?undefined:[density,0,0,density,0,0]}).promise;onRender();
 };
 await render(1);
 if(pages.length>1&&'IntersectionObserver'in window){
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);void render(Number((entry.target as HTMLElement).dataset.page)).catch(()=>entry.target.classList.add('failed'));}},{root:root.closest('.messages'),rootMargin:'900px 0px'});
  pages.slice(1).forEach(page=>observer.observe(page));
 }else for(let number=2;number<=pages.length;number++)await render(number);
}
