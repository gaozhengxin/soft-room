import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {decryptState,encryptState,IDENTITY_COLLECTION,IDENTITY_RKEY} from '../src/persistent/portable-state.ts';
import {createRecoveryBundle,decodeRecoveryCode,parseRecoveryFile,recoveryFile,recoverMasterKey} from '../src/persistent/recovery.ts';

if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
const did='did:plc:softroomrecoverytest';

test('recovery file restores the same non-extractable master key on another device',async()=>{
 const created=await createRecoveryBundle(did),state={version:1,wakuPrivateKey:'1'.repeat(64)},encrypted=await encryptState(created.key,IDENTITY_COLLECTION,IDENTITY_RKEY,state),file=recoveryFile(did,created.code),parsed=parseRecoveryFile(file,did),restored=await recoverMasterKey(did,parsed.recoveryCode,created.record);
 assert.deepEqual(await decryptState(restored,IDENTITY_COLLECTION,IDENTITY_RKEY,encrypted),state);await assert.rejects(crypto.subtle.exportKey('raw',restored));
});

test('recovery files are account-bound and reject damage or another valid secret',async()=>{
 const created=await createRecoveryBundle(did),file=recoveryFile(did,created.code);assert.throws(()=>parseRecoveryFile(file,'did:plc:other'),/account mismatch/);assert.throws(()=>decodeRecoveryCode(created.code.slice(0,-1)+(created.code.endsWith('A')?'B':'A')),/Invalid recovery code/);
 const other=await createRecoveryBundle(did);await assert.rejects(recoverMasterKey(did,other.code,created.record),/Invalid recovery code/);assert.throws(()=>parseRecoveryFile('{"type":"soft-room-recovery"}',did),/Invalid recovery file/);
});
