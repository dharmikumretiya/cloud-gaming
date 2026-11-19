import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ApiError } from './services/sessions.js';
import { deviceOwner } from './device.js';

export function validateSite(req, config, requireOrigin = false) {
  const hosts = new Set([new URL(config.origin).host, `${config.bindAddress}:${config.port}`]);
  if (!hosts.has(req.headers.host)) throw new ApiError(403, 'HOST_REJECTED', 'Use the configured site address.');
  const origin = req.headers.origin;
  if ((requireOrigin && !origin) || (origin && origin !== config.origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'ORIGIN_REJECTED', 'Use the configured website origin.');
}
export function createStreamProxy({ manager, config }) {
  const router = express.Router();
  const proxies = new Map();
  const wsOrigin = config.origin.replace(/^http/, 'ws');
  // Selkies loads its generated AudioWorklet as a data: JavaScript module.
  const playerCsp = `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' ${wsOrigin}; frame-ancestors 'self'; base-uri 'self'`;
  function proxyFor(stream) {
    if (proxies.has(stream)) return proxies.get(stream);
    const proxy = createProxyMiddleware({
      target: stream.origin, changeOrigin: true, pathRewrite: (pathname, req) => req.originalUrl || req.url, proxyTimeout: 30000,
      on: {
        proxyReq: request => { request.removeHeader('authorization'); request.removeHeader('cookie'); },
        proxyReqWs: request => { request.setHeader('origin', stream.origin); request.removeHeader('authorization'); request.removeHeader('cookie'); },
        proxyRes: response => { response.headers['content-security-policy'] = playerCsp; response.headers['cache-control'] = 'no-store'; },
        error: (error, req, res) => {
          console.error('Selkies proxy:', error.message);
          if (typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'STREAM_UNAVAILABLE', message: 'Your stream is unavailable. Reconnect or restart the app.' } }));
          } else res.destroy();
        },
      },
    });
    proxies.set(stream, proxy);
    return proxy;
  }
  async function viewer(req) {
    const ownerId = deviceOwner(req);
    if (!ownerId) throw new ApiError(403, 'DEVICE_REQUIRED', 'Open the game library in this browser first.');
    const session = await manager.current(ownerId);
    if (!session || !['READY', 'ACTIVE'].includes(session.status)) throw new ApiError(409, 'NO_SESSION', 'Start a game in this browser before opening the player.');
    const stream = manager.runtimeFor(session)?.stream;
    if (!stream?.running) throw new ApiError(503, 'STREAM_UNAVAILABLE', stream?.error || 'Your streaming display is not running.');
    return { session, stream };
  }
  router.use(async (req, res, next) => {
    validateSite(req, config);
    const { session, stream } = await viewer(req);
    const url = new URL(req.originalUrl, config.origin);
    const relative = url.pathname.slice('/streaming'.length);
    const asset = /^\/[a-zA-Z0-9_./-]+\.(js|css|wasm|svg|png|jpg|webp|ico|woff2?|json)$/.test(relative) && !relative.includes('..') && !relative.startsWith('/api/');
    if (!['GET', 'HEAD'].includes(req.method) || !(relative === '/' || asset || ['/api/status', '/api/health', '/api/websockets'].includes(relative))) throw new ApiError(404, 'NOT_FOUND', 'Player endpoint not found.');
    if (relative === '/' && url.searchParams.get('sessionId') !== String(session.id)) throw new ApiError(409, 'STALE_SESSION', 'Return to your current Session page.');
    return proxyFor(stream)(req, res, next);
  });
  function reject(socket, error) {
    const status = error instanceof ApiError ? error.status : 503;
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  function upgrade(req, socket, head) {
    socket.on('error', () => socket.destroy());
    try {
      validateSite(req, config, true);
      if (new URL(req.url, config.origin).pathname !== '/streaming/api/websockets') throw new ApiError(404, 'NOT_FOUND', 'Unknown stream route.');
    } catch (error) { return reject(socket, error); }
    manager.serialize(async () => {
      if (socket.destroyed) return;
      const { session, stream } = await viewer(req);
      stream.claimSocket(session.id, socket);
      req.originalUrl = req.url;
      proxyFor(stream).upgrade(req, socket, head);
    }).catch(error => reject(socket, error));
  }
  return { router, upgrade };
}
