import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeIdentity} from '../src/protocol.ts';
import {encodePublicProfile,parsePublicProfile} from '../src/public-profile.ts';

test('public profile shares only signed public identity and Unicode name',()=>{
 const identity=makeIdentity(),name='小明 / Alice 🌿',code=encodePublicProfile(identity,name);
 assert.deepEqual(parsePublicProfile('#'+code),{publicKey:identity.publicKey,name});
 const payload=JSON.parse(decodeURIComponent(code.slice('profile='.length)));
 assert.deepEqual(Object.keys(payload).sort(),['name','publicKey','signature']);
 payload.name='Changed';assert.throws(()=>parsePublicProfile('profile='+encodeURIComponent(JSON.stringify(payload))));
 payload.name=name;payload.publicKey=makeIdentity().publicKey;assert.throws(()=>parsePublicProfile('profile='+encodeURIComponent(JSON.stringify(payload))));
});
test('rejects malformed and oversized profile links',()=>{
 for(const code of ['profile=%','profile=null','profile={}','profile='+ 'x'.repeat(2500),'room=abc'])assert.throws(()=>parsePublicProfile(code));
 assert.throws(()=>encodePublicProfile(makeIdentity(),''));
});
