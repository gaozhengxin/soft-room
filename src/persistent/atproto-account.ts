import type {Agent,CredentialSession,AtpSessionData} from '@atproto/api';
import type {EncryptedRecord,RecordStore,StoredRecord} from './portable-state.ts';
import {RECOVERY_COLLECTION,RECOVERY_RKEY,type RecoveryRecord} from './recovery.ts';

export const DEFAULT_PDS='https://bsky.social';
export type AccountLogin={identifier:string;appPassword:string;pds?:string};
export function normalizePds(value:string|undefined){const url=new URL(value?.trim()||DEFAULT_PDS);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid PDS address');return url.origin;}

export class AtProtoRecordStore implements RecordStore {
 constructor(private agent:Agent,private repo:string){}
 async get(collection:string,rkey:string){try{return (await this.agent.com.atproto.repo.getRecord({repo:this.repo,collection,rkey})).data.value as EncryptedRecord;}catch(error){if((error as {status?:number}).status===400)return;throw error;}}
 async list(collection:string){const output:StoredRecord[]=[];let cursor:string|undefined;do{const result=await this.agent.com.atproto.repo.listRecords({repo:this.repo,collection,limit:100,cursor});for(const item of result.data.records){const rkey=item.uri.slice(item.uri.lastIndexOf('/')+1);output.push({collection,rkey,value:item.value as EncryptedRecord});}cursor=result.data.cursor;}while(cursor);return output;}
 async put(record:StoredRecord){await this.agent.com.atproto.repo.putRecord({repo:this.repo,collection:record.collection,rkey:record.rkey,record:record.value,validate:false});}
 async delete(collection:string,rkey:string){try{await this.agent.com.atproto.repo.deleteRecord({repo:this.repo,collection,rkey});}catch(error){if((error as {status?:number}).status!==400)throw error;}}
}
export class AtProtoRecoveryStore {
 constructor(private agent:Agent,private repo:string){}
 async get(){try{return (await this.agent.com.atproto.repo.getRecord({repo:this.repo,collection:RECOVERY_COLLECTION,rkey:RECOVERY_RKEY})).data.value as RecoveryRecord;}catch(error){if((error as {status?:number}).status===400)return;throw error;}}
 async put(record:RecoveryRecord){await this.agent.com.atproto.repo.putRecord({repo:this.repo,collection:RECOVERY_COLLECTION,rkey:RECOVERY_RKEY,record,validate:false});}
}
export type SignedInAccount={did:string;handle:string;pds:string;session:CredentialSession;records:AtProtoRecordStore;recovery:AtProtoRecoveryStore};
export async function signInAccount(input:AccountLogin,persist?:(session:AtpSessionData|undefined)=>void):Promise<SignedInAccount>{
 const {Agent,CredentialSession}=await import('@atproto/api');
 const pds=normalizePds(input.pds),session=new CredentialSession(new URL(pds),fetch,(_event,value)=>persist?.(value));
 await session.login({identifier:input.identifier.trim(),password:input.appPassword});
 if(!session.session)throw Error('Sign in failed');const agent=new Agent(session),{did,handle}=session.session;
 return {did,handle,pds,session,records:new AtProtoRecordStore(agent,did),recovery:new AtProtoRecoveryStore(agent,did)};
}
export async function resumeAccount(pds:string,saved:AtpSessionData,persist?:(session:AtpSessionData|undefined)=>void):Promise<SignedInAccount>{
 const {Agent,CredentialSession}=await import('@atproto/api'),service=normalizePds(pds),session=new CredentialSession(new URL(service),fetch,(_event,value)=>persist?.(value));
 await session.resumeSession(saved);if(!session.session)throw Error('Account session expired');const agent=new Agent(session),{did,handle}=session.session;if(did!==saved.did)throw Error('Account session mismatch');
 return {did,handle,pds:service,session,records:new AtProtoRecordStore(agent,did),recovery:new AtProtoRecoveryStore(agent,did)};
}
