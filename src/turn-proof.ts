import {sha256} from '@noble/hashes/sha2.js';
import {hmac} from '@noble/hashes/hmac.js';
import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
export const TURN_EPOCH_MS=2*60*60*1000;
// One twentieth of the original minute-scale work: about 3 seconds on the same device.
export const TURN_BITS=23-Math.log2(20);
const utf8=new TextEncoder();
export type TurnChallenge={epoch:number;bits:number;publicKey:string;seed:string;expiresAt:number};
export type TurnProof={challenge:TurnChallenge;nonce:number;signature:string};
export const turnEpoch=(now=Date.now())=>Math.floor(now/TURN_EPOCH_MS);
export function challengeFor(publicKey:string,secret:string,now=Date.now(),bits=TURN_BITS):TurnChallenge{
 if(!/^[a-f0-9]{64}$/.test(publicKey)||!Number.isFinite(bits)||bits<1||bits>30)throw Error('Invalid challenge');
 const epoch=turnEpoch(now),seed=bytesToHex(hmac(sha256,utf8.encode(secret),utf8.encode(JSON.stringify(['soft-room/turn-challenge/v1',publicKey,epoch,bits]))));
 return {epoch,bits,publicKey,seed,expiresAt:(epoch+1)*TURN_EPOCH_MS};
}
export function validChallenge(c:TurnChallenge){return !!c&&/^[a-f0-9]{64}$/.test(c.publicKey)&&/^[a-f0-9]{64}$/.test(c.seed)&&Number.isSafeInteger(c.epoch)&&Number.isFinite(c.bits)&&c.bits>=1&&c.bits<=30&&c.expiresAt===(c.epoch+1)*TURN_EPOCH_MS;}
export function turnWorkChecker(c:TurnChallenge){
 if(!validChallenge(c))throw Error('Invalid challenge');
 const prefix=sha256.create().update(utf8.encode(JSON.stringify(['soft-room/turn-work/v1',c.epoch,c.bits,c.publicKey,c.seed])));
 const buffer=new Uint8Array(8),view=new DataView(buffer.buffer),target=2**(32-c.bits);
 return (nonce:number)=>{if(!Number.isSafeInteger(nonce)||nonce<0)return false;view.setBigUint64(0,BigInt(nonce));const digest=prefix.clone().update(buffer).digest();return new DataView(digest.buffer,digest.byteOffset,4).getUint32(0)<target;};
}
const proofBytes=(c:TurnChallenge,nonce:number)=>utf8.encode(JSON.stringify(['soft-room/turn-claim/v1',c.epoch,c.bits,c.publicKey,c.seed,nonce]));
export function signTurnProof(challenge:TurnChallenge,nonce:number,secret:Uint8Array):TurnProof{return {challenge,nonce,signature:bytesToHex(ed25519.sign(proofBytes(challenge,nonce),secret))};}
export function verifyTurnProof(value:unknown,secret:string,now=Date.now(),bits=TURN_BITS){
 try{const p=value as TurnProof,c=p.challenge;if(!validChallenge(c)||c.epoch!==turnEpoch(now)||c.bits!==bits||c.seed!==challengeFor(c.publicKey,secret,now,bits).seed||!turnWorkChecker(c)(p.nonce)||!/^[a-f0-9]{128}$/.test(p.signature))return false;
 return ed25519.verify(hexToBytes(p.signature),proofBytes(c,p.nonce),hexToBytes(c.publicKey));}catch{return false;}
}
