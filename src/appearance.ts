export type ColorMode='light'|'dark'|'system';
export type Skin='soft'|'sssp'|'kabutack';
const key='soft-room/appearance/v1';
export function readAppearance():{mode:ColorMode;theme:Skin}|undefined{try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value&&['light','dark','system'].includes(value.mode)&&['soft','sssp','kabutack'].includes(value.theme))return value;}catch{}return;}
export function applyAppearance(theme:Skin,mode:ColorMode,persist=true){
 const dark=mode==='dark'||mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches,root=document.documentElement;root.dataset.theme=theme;root.dataset.colorMode=mode;root.dataset.colorScheme=dark?'dark':'light';root.style.colorScheme=dark?'dark':'light';
 const colors=dark?{soft:'#101914',sssp:'#101821',kabutack:'#1c1215'}:{soft:'#e7ebe7',sssp:'#e0e4e7',kabutack:'#eee9e2'};document.querySelector('meta[name="theme-color"]')?.setAttribute('content',colors[theme]);if(persist)try{localStorage.setItem(key,JSON.stringify({theme,mode}));}catch{}
}
export function initAppearance(){const stored=readAppearance();applyAppearance(stored?.theme||'soft',stored?.mode||'system',false);matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{const root=document.documentElement;if(root.dataset.colorMode==='system')applyAppearance(root.dataset.theme as Skin,'system',false);});}
