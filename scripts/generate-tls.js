import { mkdir, access, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { backendRoot, loadConfig } from '../backend/src/config.js';

const { bindAddress, port } = loadConfig();
const directory = path.resolve(backendRoot, '../.runtime/tls');
await mkdir(directory, { recursive: true, mode: 0o700 });
const cert = path.join(directory, 'cert.pem'), key = path.join(directory, 'key.pem');
for (const file of [cert, key]) {
  try { await access(file); throw new Error(`Refusing to overwrite ${file}. Reuse the existing certificate or move it manually.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const names = ['DNS:localhost', 'IP:127.0.0.1'];
if (bindAddress !== 'localhost' && bindAddress !== '127.0.0.1') names.push(`IP:${bindAddress}`);
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '30',
  '-keyout', key, '-out', cert, '-subj', '/CN=Cloud Gaming LAN', '-addext', `subjectAltName=${names.join(',')}`], { stdio: 'pipe' });
await chmod(key, 0o600);
console.log(`Created local demo certificate: ${cert}\nReview its SHA-256 fingerprint with: openssl x509 -in ${cert} -noout -fingerprint -sha256`);
console.log(`To enable it, set these in .env:\nTLS_CERT_PATH=../.runtime/tls/cert.pem\nTLS_KEY_PATH=../.runtime/tls/key.pem\nSITE_ORIGIN=https://${bindAddress}:${port}\nRestart the backend. Each client must trust this certificate manually; no system trust settings were changed.`);
