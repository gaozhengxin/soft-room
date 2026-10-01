import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeIdentity} from '../src/protocol.ts';
import {encodePublicProfile,parsePublicProfile,profileAppLink,profileHashFromAppUrl} from '../src/public-profile.ts';

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

test('native profile links round trip signed Unicode profiles and reject other routes',()=>{const code=encodePublicProfile(makeIdentity(),'小明 / Alice'),link=profileAppLink('#'+code);assert.equal(profileHashFromAppUrl(link),'#'+code);for(const bad of ['https://profile/#'+code,'softroom://other/#'+code,'softroom://profile/wrong#'+code,'softroom://profile/#profile=%'])assert.equal(profileHashFromAppUrl(bad),undefined);});
