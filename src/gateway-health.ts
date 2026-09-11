// A subscription acknowledgement belongs to a particular live connection, not just a peer ID.
export class GatewayHealth {
 private leases=new Map<string,{connection:string;expires:number}>();
 acknowledge(peer:string,connection:string,now=Date.now()){this.leases.set(peer,{connection,expires:now+35000});}
 drop(peer:string,connection?:string){if(!connection||this.leases.get(peer)?.connection===connection)this.leases.delete(peer);}
 clear(){this.leases.clear();}
 available(connections:Map<string,string>,now=Date.now()){
  return [...this.leases].filter(([peer,lease])=>lease.expires>now&&connections.get(peer)===lease.connection).map(([peer])=>peer);
 }
}
export async function firstAcknowledged<T>(attempts:Promise<T>[],success:(result:T)=>boolean){
 if(!attempts.length)throw Error('No gateway available');
 return Promise.any(attempts.map(async attempt=>{const result=await attempt;if(!success(result))throw Error('Gateway rejected request');return result;}));
}
