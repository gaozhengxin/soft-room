import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserLanguage,localAddress,terminal,blockedCountry,parseTrace,accessCodeDigest,validAccessDigest} from '../src/access.ts';
test('language preferences choose supported locale in order',()=>{
 assert.equal(browserLanguage(['zh-Hant-HK','en']),'zh');assert.equal(browserLanguage(['en-US','zh-CN']),'en');assert.equal(browserLanguage(['fr','zh-CN']),'zh');assert.equal(browserLanguage(['ja']),'en');
});
test('only specified local addresses bypass location checks',()=>{
 for(const host of ['localhost','127.0.0.1','192.168.0.1','192.168.255.255'])assert.ok(localAddress(host));
 for(const host of ['192.168.1.999','192.168.1.example.com','localhost.evil.com','127.0.0.2','10.0.0.1','soft-room.example','[::1]'])assert.equal(localAddress(host),false);
 for(const country of ['CN','HK','MO'])assert.ok(blockedCountry(country));assert.equal(blockedCountry('US'),false);
});
const chrome='Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
test('embedded markers override claimed Chrome and Safari engines',()=>{
 assert.ok(terminal(chrome).supported);assert.equal(terminal(chrome).device,'phone');
 for(const token of ['MicroMessenger/8.0','aweme/1','BytedanceWebview','QQ/9.0','AlipayClient/1','Weibo','BaiduBoxApp'])assert.equal(terminal(chrome+' '+token).supported,false);
 assert.equal(terminal('Mozilla/5.0 (Linux; Android 14; wv) Chrome/130.0').supported,false);
 assert.equal(terminal('unknown browser').supported,false);
 assert.ok(terminal('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Version/17.0 Mobile/15 Safari/604.1').supported);
 assert.equal(terminal('Mozilla/5.0 (Macintosh) Version/17.0 Safari/604.1',5).device,'tablet');
});
test('Cloudflare trace validates visitor IP and location, not the edge server location',()=>{
 assert.deepEqual(parseTrace('ip=8.8.8.8\nloc=HK\ncolo=LAX\n'),{ip:'8.8.8.8',country:'HK'});
 assert.equal(parseTrace('ip=2001:4860:4860::8888\nloc=US').country,'US');
 for(const body of ['<html>Not found</html>','ip=8.8.8.8\nloc=XX0','ip=8.8.8.8\nloc=XX','ip=999.0.0.1\nloc=US','ip=8.8.8.8\ncolo=HKG'])assert.throws(()=>parseTrace(body));
});
test('access code digest trims input and produces a validated SHA-256 digest',async()=>{
 const digest=await accessCodeDigest(' 123456 ');
 assert.equal(digest,'8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
 assert.ok(validAccessDigest(digest));assert.equal(validAccessDigest(digest.toUpperCase()),false);assert.equal(validAccessDigest('123456'),false);
});
