import { defineConfig } from 'vite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const packageVersion=(JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')) as {version:string}).version;
const versionParts=packageVersion.split('.').map(Number);
const stableBuild=versionParts[0]*1_000_000+versionParts[1]*1_000+versionParts[2];
const androidChannel=process.env.VITE_ANDROID_CHANNEL==='test'?'test':'stable';
const testBuild=Number(process.env.SOFT_ROOM_ANDROID_BUILD_NUMBER||0);
const androidBuild=androidChannel==='test'?testBuild:stableBuild;
const certDir = new URL('./.certs/', import.meta.url);
if (!existsSync(new URL('cert.pem', certDir))) {
  mkdirSync(certDir, { recursive: true });
  const lanIp=process.env.SOFT_ROOM_DEV_LAN_IP;
  const subjectAltName=`subjectAltName=DNS:localhost,IP:127.0.0.1${lanIp&&/^(?:\d{1,3}\.){3}\d{1,3}$/.test(lanIp)?`,IP:${lanIp}`:''}`;
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-sha256','-days','30','-nodes','-keyout',new URL('key.pem',certDir).pathname,'-out',new URL('cert.pem',certDir).pathname,'-subj','/CN=Soft Room Local Development','-addext',subjectAltName,'-addext','basicConstraints=critical,CA:FALSE','-addext','extendedKeyUsage=serverAuth'], { stdio: 'ignore' });
}
const https = {
  key: readFileSync(new URL('./.certs/key.pem', import.meta.url)),
  cert: readFileSync(new URL('./.certs/cert.pem', import.meta.url)),
};
export default defineConfig({define:{'import.meta.env.VITE_ANDROID_BUILD_ID':JSON.stringify(String(androidBuild))},server:{https,host:'0.0.0.0',port:5173,strictPort:true},preview:{https,host:'0.0.0.0',port:5173,strictPort:true}});
