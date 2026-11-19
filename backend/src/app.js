import express from 'express';
import path from 'node:path';
import { backendRoot } from './config.js';
import { ApiError } from './services/sessions.js';
import { identifyDevice } from './device.js';
import { createStreamProxy } from './stream-proxy.js';
import { createAuth, requireAdmin } from './auth.js';

export function createApp({ db, manager, config, stream = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    next();
  });
  app.use(['/api', '/streaming'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const allowedHosts = new Set([new URL(config.origin).host, `${config.bindAddress}:${config.port}`]);
    if (!allowedHosts.has(req.headers.host)) return next(new ApiError(403, 'HOST_REJECTED', 'Use the configured site address.'));
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if ((req.headers.origin && req.headers.origin !== config.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
        return next(new ApiError(403, 'ORIGIN_REJECTED', 'Open the website at the configured SITE_ORIGIN.'));
      }
      if (!req.originalUrl.startsWith('/streaming/') && !req.is('application/json')) return next(new ApiError(415, 'JSON_REQUIRED', 'Send an application/json body.'));
    }
    next();
  });
  app.use('/api', identifyDevice(config));
  const auth = createAuth({ db, manager, config });
  const player = createStreamProxy({ manager, stream, config, auth });
  app.streamUpgrade = player.upgrade;
  app.use('/streaming', player.router);
  app.use(express.json({ limit: '2kb' }));
  app.use('/api', auth.middleware);
  auth.routes(app);
  app.get('/api/health', async (req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ok' });
  });
  app.get('/api/games', async (req, res) => {
    const [games, host] = await Promise.all([db.game.findMany({ orderBy: { id: 'asc' } }), manager.hostStatus(req.ownerId)]);
    res.json({ games: games.map(game => ({ ...game, available: game.enabled && host.available && Boolean(host.launchers.find(x => x.gameId === game.id)?.ready) })) });
  });
  app.get('/api/session', async (req, res) => res.json({ session: manager.present(await manager.current(req.ownerId, req.user?.id ?? null)) }));
  app.get('/api/host/status', async (req, res) => {
    const { system, slots, ...availability } = await manager.hostStatus(req.ownerId);
    res.json(availability);
  });
  app.get('/api/admin/host/status', requireAdmin, async (req, res) => res.json(await manager.hostStatus(req.ownerId)));
  app.post('/api/session/start', async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !Number.isSafeInteger(req.body.gameId) || req.body.gameId < 1 || req.body.gameId > 2147483647) {
      throw new ApiError(400, 'INVALID_GAME_ID', 'Provide one positive integer gameId.');
    }
    res.status(201).json({ session: manager.present(await manager.start(req.body.gameId, req.ownerId, req.user?.id ?? null, async () => {
      if (req.user && (await auth.resolve(req))?.user.id !== req.user.id) throw new ApiError(401, 'LOGIN_REQUIRED', 'Your login expired. Sign in again.');
    })) });
  });
  app.post('/api/session/end', async (req, res) => res.json({ session: manager.present(await manager.end(req.ownerId, req.user?.id ?? null)) }));
  app.post('/api/stream/reconnect', async (req, res) => {
    await manager.reconnect(req.ownerId, req.user?.id ?? null);
    res.json({ success: true });
  });
  app.use('/api', (req, res, next) => next(new ApiError(404, 'NOT_FOUND', 'API endpoint not found.')));
  const dist = path.resolve(backendRoot, '../frontend/dist');
  app.use(express.static(dist));
  app.get('/{*path}', (req, res, next) => res.sendFile(path.join(dist, 'index.html'), error => {
    if (error) next(new ApiError(404, 'FRONTEND_NOT_BUILT', 'Build the frontend with npm run build, or use npm run dev.'));
  }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof ApiError ? error.status : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: {
      code: error instanceof ApiError ? error.code : status === 400 ? 'INVALID_JSON' : status === 413 ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR',
      message: error instanceof ApiError ? error.message : status === 400 ? 'Malformed JSON.' : status === 413 ? 'Request body is too large.' : 'An internal error occurred. Check the backend logs.',
    } });
  });
  return app;
}
