import {createServer} from 'node:https';
import {readFileSync,createReadStream,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
const root=resolve(new URL('../dist',import.meta.url).pathname);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
const server=createServer({key:readFileSync(new URL('../.certs/key.pem',import.meta.url)),cert:readFileSync(new URL('../.certs/cert.pem',import.meta.url))},(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
 try{
  const path=decodeURIComponent(new URL(req.url,'https://localhost').pathname);
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+sep)||!statSync(file).isFile())throw Error();
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
  if(req.method==='HEAD'){res.end();return;}createReadStream(file).on('error',()=>res.destroy()).pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||5173),'0.0.0.0',()=>console.log(`Static HTTPS server: https://localhost:${process.env.PORT||5173} (dist only)`));
