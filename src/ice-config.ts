export const defaultIceServers:RTCIceServer[]=[{urls:'stun:stun.cloudflare.com:3478'}];
export function turnConfiguration(value:unknown,now=Date.now()){
 const v=value as {iceServers?:RTCIceServer[];expiresAt?:number};
 if(!v||!Array.isArray(v.iceServers)||v.iceServers.length>8||!Number.isSafeInteger(v.expiresAt)||v.expiresAt!<=now)throw Error('Invalid TURN response');
 const servers:RTCIceServer[]=[];
 for(const server of v.iceServers){
  const urls=typeof server?.urls==='string'?[server.urls]:server?.urls;
  if(!Array.isArray(urls)||urls.length>8)throw Error('Invalid ICE URLs');
  const allowed=urls.filter(url=>typeof url==='string'&&/^turns?:turn\.cloudflare\.com:(3478|5349|443|80)\?transport=(udp|tcp)$/.test(url));
  if(!allowed.length)continue;
  if(typeof server.username!=='string'||!server.username||typeof server.credential!=='string'||!server.credential)throw Error('Invalid TURN credential');
  servers.push({urls:allowed,username:server.username,credential:server.credential});
 }
 if(!servers.length)throw Error('No Cloudflare TURN server');
 return {configuration:{iceServers:[...defaultIceServers,...servers],bundlePolicy:'max-bundle'} as RTCConfiguration,expiresAt:v.expiresAt!};
}
