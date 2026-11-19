import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { rateLimit } from 'express-rate-limit';
import { ApiError, LIVE } from './services/sessions.js';

const derive = promisify(scrypt);
const cookieName = 'orbit_login';
const lifetime = 30 * 86400000;
const publicUser = { id: true, username: true, displayName: true, createdAt: true, isAdmin: true };
const digest = token => createHash('sha256').update(token).digest('hex');
const cookieOptions = config => ({ httpOnly: true, secure: Boolean(config.tls), sameSite: 'strict', path: '/' });
function loginToken(req) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
export async function resolveLogin(db, req) {
  const token = loginToken(req);
  if (!token) return null;
  const login = await db.authSession.findUnique({ where: { tokenHash: digest(token) }, include: { user: { select: publicUser } } });
  return login && login.expiresAt > new Date() ? login : null;
}
export function requireAdmin(req, res, next) {
  if (!req.user) throw new ApiError(401, 'LOGIN_REQUIRED', 'Sign in with an admin account to view the dashboard.');
  if (!req.user.isAdmin) throw new ApiError(403, 'ADMIN_REQUIRED', 'The dashboard is available to admins only.');
  next();
}
function credentials(body, registration = false) {
  const keys = registration ? ['username', 'password', 'displayName'] : ['username', 'password'];
  if (!body || Object.keys(body).some(key => !keys.includes(key)) || typeof body.username !== 'string' || typeof body.password !== 'string') {
    throw new ApiError(400, 'INVALID_CREDENTIALS', 'Enter a username and password.');
  }
  const username = body.username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new ApiError(400, 'INVALID_USERNAME', 'Use 3–24 letters, numbers, or underscores for your username.');
  if (body.password.length < 10 || body.password.length > 128) throw new ApiError(400, 'INVALID_PASSWORD', 'Use a password between 10 and 128 characters.');
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : username;
  if (registration && (displayName.length < 1 || displayName.length > 40)) throw new ApiError(400, 'INVALID_NAME', 'Display name must be 1–40 characters.');
  return { username, password: body.password, displayName };
}
export function createAuth({ db, manager, config }) {
  // Bound expensive password work independently of the request rate limit so
  // account operations cannot flood the worker pool used by the stream proxy.
  let hashing = 0;
  async function passwordKey(password, salt) {
    if (hashing >= 2) throw new ApiError(429, 'AUTH_BUSY', 'Sign-in is busy. Please retry in a moment.');
    hashing++;
    try { return await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
    finally { hashing--; }
  }
  async function issue(req, res, user) {
    const token = randomBytes(32).toString('hex');
    await db.$transaction(async tx => {
      const old = loginToken(req);
      if (old) await tx.authSession.deleteMany({ where: { tokenHash: digest(old) } });
      await tx.authSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      await tx.authSession.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt: new Date(Date.now() + lifetime) } });
    });
    res.cookie(cookieName, token, { ...cookieOptions(config), maxAge: lifetime });
    return user;
  }
  async function canSwitch(req, userId) {
    const current = await manager.current(req.ownerId);
    if (current && LIVE.includes(current.status) && current.userId !== userId) throw new ApiError(409, 'END_SESSION_FIRST', 'End the game in this browser before switching accounts.');
  }
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'AUTH_RATE_LIMIT', message: 'Too many sign-in attempts. Try again in 15 minutes.' } } });
  return {
    resolve: req => resolveLogin(db, req),
    middleware: async (req, res, next) => {
      const login = await resolveLogin(db, req);
      req.user = login?.user || null;
      next();
    },
    routes(app) {
      app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
      app.post('/api/auth/register', limiter, async (req, res) => {
        const { username, password, displayName } = credentials(req.body, true);
        const salt = randomBytes(16).toString('hex');
        const passwordHash = `scrypt-v1$${salt}$${(await passwordKey(password, salt)).toString('hex')}`;
        const user = await manager.serialize(async () => {
          const current = await manager.current(req.ownerId);
          if (current && LIVE.includes(current.status)) throw new ApiError(409, 'END_SESSION_FIRST', 'End the game in this browser before creating an account.');
          let created;
          try { created = await db.user.create({ data: { username, displayName, passwordHash }, select: publicUser }); }
          catch (error) { if (error.code === 'P2002') throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already in use. Choose another.'); throw error; }
          return issue(req, res, created);
        });
        res.status(201).json({ user });
      });
      app.post('/api/auth/login', limiter, async (req, res) => {
        const { username, password } = credentials(req.body);
        const record = await db.user.findUnique({ where: { username } });
        const [, salt, hash] = record?.passwordHash.split('$') || ['scrypt-v1', '0'.repeat(32), '0'.repeat(128)];
        const key = await passwordKey(password, salt);
        if (!record || !timingSafeEqual(key, Buffer.from(hash, 'hex'))) throw new ApiError(401, 'LOGIN_FAILED', 'Username or password is incorrect.');
        const user = Object.fromEntries(Object.keys(publicUser).map(key => [key, record[key]]));
        res.json({ user: await manager.serialize(async () => { await canSwitch(req, record.id); return issue(req, res, user); }) });
      });
      app.post('/api/auth/logout', async (req, res) => {
        // Keep credentials valid if game cleanup fails, so the owner can retry.
        await manager.serialize(async () => {
          const current = await manager.current(req.ownerId, req.user?.id ?? null);
          if (current && LIVE.includes(current.status)) await manager.stopSession(current);
          const token = loginToken(req);
          if (token) await db.authSession.deleteMany({ where: { tokenHash: digest(token) } });
        });
        res.clearCookie(cookieName, cookieOptions(config));
        res.json({ user: null });
      });
      app.get('/api/history', async (req, res) => {
        if (!req.user) throw new ApiError(401, 'LOGIN_REQUIRED', 'Sign in to see your play history.');
        const page = Number(req.query.page || 1);
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new ApiError(400, 'INVALID_PAGE', 'Choose a valid history page.');
        const where = { userId: req.user.id };
        const [rows, total, totals, titles] = await Promise.all([
          db.session.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * 20, take: 20, include: { game: true } }),
          db.session.count({ where }),
          db.session.aggregate({ where, _sum: { durationSeconds: true } }),
          db.session.groupBy({ by: ['gameId'], where }),
        ]);
        res.json({ sessions: rows.map(row => ({ id: row.id, game: row.game, status: row.status, startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds: row.durationSeconds,
          isCurrentDevice: row.ownerId === req.ownerId && LIVE.includes(row.status) })),
          page, pageSize: 20, total, summary: { sessions: total, games: titles.length, durationSeconds: totals._sum.durationSeconds || 0 } });
      });
    },
  };
}
