import '../src/compat.ts';
import {renderPdf} from '../src/pdf-preview.ts';

Object.assign(globalThis,{renderPdfCheck:async(data:number[])=>{
 const root=document.querySelector<HTMLElement>('#pdf')!;let renders=0;
 await renderPdf(new Blob([new Uint8Array(data)],{type:'application/pdf'}),root,()=>{renders+=1;});
 const canvas=root.querySelector('canvas')!;return{pages:root.querySelectorAll('.pdf-page').length,renders,width:canvas.width,height:canvas.height};
}});
