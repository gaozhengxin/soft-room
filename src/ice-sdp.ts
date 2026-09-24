// SDP snapshots are retransmitted over Waku. Extract later candidates without renegotiating.
export function sdpCandidates(sdp:string):RTCIceCandidateInit[]{
 const parts=sdp.split(/\r?\nm=/),session=parts.shift()||'',sessionUfrag=session.match(/(?:^|\n)a=ice-ufrag:([^\r\n]+)/)?.[1];
 return parts.flatMap((part,sdpMLineIndex)=>{
  const sdpMid=part.match(/(?:^|\n)a=mid:([^\r\n]+)/)?.[1],usernameFragment=part.match(/(?:^|\n)a=ice-ufrag:([^\r\n]+)/)?.[1]||sessionUfrag;
  return [...part.matchAll(/(?:^|\n)a=(candidate:[^\r\n]+)/g)].map(match=>({candidate:match[1],sdpMLineIndex,...(sdpMid!==undefined?{sdpMid}:{}),...(usernameFragment?{usernameFragment}:{})}));
 });
}
export const candidateKey=(c:RTCIceCandidateInit)=>JSON.stringify([c.sdpMid,c.sdpMLineIndex,c.usernameFragment,c.candidate]);

// Candidate updates keep these credentials; a rebuilt remote peer does not.
export function sdpIceCredentials(sdp:string){
 return JSON.stringify(sdp.split(/\r?\nm=/).map(part=>[
  part.match(/(?:^|\n)a=ice-ufrag:([^\r\n]+)/)?.[1]||'',
  part.match(/(?:^|\n)a=ice-pwd:([^\r\n]+)/)?.[1]||'',
 ]));
}
