import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sdpCandidates,candidateKey} from '../src/ice-sdp.ts';
test('late ICE snapshots retain the media section, mid and ICE generation',()=>{
 const sdp='v=0\r\na=ice-ufrag:session\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:audio\r\na=candidate:1 1 udp 1 192.168.2.2 5000 typ host\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:data\r\na=ice-ufrag:other\r\na=candidate:2 1 udp 1 192.168.2.3 5001 typ host\r\n';
 const candidates=sdpCandidates(sdp);assert.equal(candidates.length,2);assert.deepEqual(candidates.map(c=>[c.sdpMid,c.sdpMLineIndex,c.usernameFragment]),[['audio',0,'session'],['data',1,'other']]);
 assert.notEqual(candidateKey(candidates[0]),candidateKey({...candidates[0],usernameFragment:'restart'}));
 assert.deepEqual(sdpCandidates('v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:audio\r\n'),[]);
});
