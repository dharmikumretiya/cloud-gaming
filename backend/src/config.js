import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const backendRoot = fileURLToPath(new URL('../', import.meta.url));
dotenv({ path: path.join(backendRoot, '../.env'), quiet: true });

function port(value, fallback) {
  const n = Number(value || fallback);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Invalid configured port');
  return n;
}
export function loadConfig(env = process.env) {
  const bindAddress = env.BIND_ADDRESS || '127.0.0.1';
  const parts = bindAddress.split('.').map(Number);
  const privateIp = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  if (!privateIp && bindAddress !== 'localhost') throw new Error('BIND_ADDRESS must be localhost or a private IPv4 address');
  const httpPort = port(env.PORT, 3001);
  if (Boolean(env.TLS_CERT_PATH) !== Boolean(env.TLS_KEY_PATH)) throw new Error('Set both TLS_CERT_PATH and TLS_KEY_PATH to enable HTTPS');
  const tls = env.TLS_CERT_PATH ? { cert: path.resolve(backendRoot, env.TLS_CERT_PATH), key: path.resolve(backendRoot, env.TLS_KEY_PATH) } : null;
  const origin = env.SITE_ORIGIN || `${tls ? 'https' : 'http'}://${bindAddress}:${httpPort}`;
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('SITE_ORIGIN must be an HTTP origin without a trailing slash');
  const hostAddress = env.HOST_ADDRESS || bindAddress;
  if (!/^[a-zA-Z0-9.:-]+$/.test(hostAddress)) throw new Error('HOST_ADDRESS must be an IP or hostname');
  const selkiesPort = port(env.SELKIES_PORT, 8082);
  const maxSessions = Number(env.MAX_SESSIONS || 2);
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 4) throw new Error('MAX_SESSIONS must be an integer from 1 to 4');
  if (selkiesPort + maxSessions - 1 > 65535 || (httpPort >= selkiesPort && httpPort < selkiesPort + maxSessions)) throw new Error('Selkies port range must not overlap the website PORT or exceed 65535');
  return { bindAddress, port: httpPort, origin, tls, hostAddress, selkiesPort, maxSessions, selkiesHostDrm: env.SELKIES_HOST_DRM !== 'false' };
}
