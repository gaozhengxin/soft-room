import {challengeFor,verifyTurnProof,TURN_BITS,TURN_EPOCH_MS,turnEpoch,type TurnProof} from '../../src/turn-proof.ts';
import {turnConfiguration} from '../../src/ice-config.ts';
export type Env={TURN_KEY_ID:string;TURN_API_TOKEN:string;ALLOWED_ORIGINS:string;TURN_POW_BITS?:string;TURN_RATE_LIMITER:{limit:(options:{key:string})=>Promise<{success:boolean}>}};
export async function handle(request:Request,env:Env,upstream:typeof fetch=(input,init)=>globalThis.fetch(input,init)){
 const origin=request.headers.get('Origin')||'';
 if(!origin||!env.ALLOWED_ORIGINS?.split(',').map(x=>x.trim()).includes(origin))return new Response('Forbidden',{status:403});
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','Cache-Control':'no-store'};
 const path=new URL(request.url).pathname;
 if(!['/ice','/challenge'].includes(path))return new Response('Not found',{status:404,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!==(path==='/challenge'?'GET':'POST'))return new Response('Method not allowed',{status:405,headers});
 if(!env.TURN_KEY_ID||!env.TURN_API_TOKEN||!env.TURN_RATE_LIMITER)return new Response('Unavailable',{status:503,headers});
 const ip=request.headers.get('CF-Connecting-IP');if(!ip)return new Response('Forbidden',{status:403,headers});
 const limit=await env.TURN_RATE_LIMITER.limit({key:ip});if(!limit.success)return new Response('Try again later',{status:429,headers});
 try{
  const issuedAt=Date.now(),bits=Number(env.TURN_POW_BITS||TURN_BITS);
  if(path==='/challenge'){
   const key=new URL(request.url).searchParams.get('publicKey')||'';
   if(!/^[a-f0-9]{64}$/.test(key))return new Response('Invalid identity',{status:400,headers});
   return Response.json(challengeFor(key,env.TURN_API_TOKEN,issuedAt,bits),{headers});
  }
  if(Number(request.headers.get('Content-Length')||0)>4096)return new Response('Too large',{status:413,headers});
  const reader=request.body?.getReader();if(!reader)return new Response('Proof required',{status:403,headers});
  let text='',size=0;const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();return new Response('Too large',{status:413,headers});}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
  let proof:TurnProof;try{proof=JSON.parse(text);}catch{return new Response('Proof required',{status:403,headers});}
  if(!verifyTurnProof(proof,env.TURN_API_TOKEN,issuedAt,bits))return new Response('Invalid proof',{status:403,headers});
  const epochEnd=(turnEpoch(issuedAt)+1)*TURN_EPOCH_MS,ttl=Math.floor((epochEnd-issuedAt-10000)/1000);
  if(ttl<1)return new Response('Epoch ended',{status:409,headers});
  const result=await upstream(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,{method:'POST',headers:{Authorization:`Bearer ${env.TURN_API_TOKEN}`,'Content-Type':'application/json','User-Agent':'SoftRoom-TURN/1.0'},body:JSON.stringify({ttl}),signal:AbortSignal.timeout(8000),redirect:'manual'});
  if(!result.ok){console.warn('TURN provider HTTP status',result.status);throw Error('Provider failure');}
  const data=await result.json() as {iceServers:RTCIceServer[]};
  const valid=turnConfiguration({...data,expiresAt:issuedAt+ttl*1000});
  return Response.json({iceServers:valid.configuration.iceServers,expiresAt:valid.expiresAt},{headers});
 }catch(error){console.warn('TURN issuance failure',error instanceof Error?error.message.replace(/[a-f0-9]{24,}/gi,'[redacted]'):'Unknown');return new Response('Unavailable',{status:502,headers});}
}
export default {fetch:(request:Request,env:Env)=>handle(request,env)};
