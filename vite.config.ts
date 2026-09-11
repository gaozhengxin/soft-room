import { defineConfig } from 'vite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const certDir = new URL('./.certs/', import.meta.url);
if (!existsSync(new URL('cert.pem', certDir))) {
  mkdirSync(certDir, { recursive: true });
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-sha256','-days','30','-nodes','-keyout',new URL('key.pem',certDir).pathname,'-out',new URL('cert.pem',certDir).pathname,'-subj','/CN=Soft Room Local Development','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.2.112','-addext','basicConstraints=critical,CA:FALSE','-addext','extendedKeyUsage=serverAuth'], { stdio: 'ignore' });
}
import { wakuGateway } from './server/gateway.ts';
const https = {
  key: readFileSync(new URL('./.certs/key.pem', import.meta.url)),
  cert: readFileSync(new URL('./.certs/cert.pem', import.meta.url)),
};
export default defineConfig({plugins:[wakuGateway()],server:{https,host:'0.0.0.0',port:5173,strictPort:true},preview:{https,host:'0.0.0.0',port:4173,strictPort:true}});
