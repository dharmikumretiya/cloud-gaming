import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import supertest from 'supertest';
import lockfile from 'proper-lockfile';
import { createDatabase } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { gameCatalog } from '../src/game-catalog.js';
import { Launcher } from '../src/services/launcher.js';
import { Selkies } from '../src/services/selkies.js';
import WebSocket, { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { LIVE, SessionManager } from '../src/services/sessions.js';

const migrationsDir = new URL('../prisma/migrations/', import.meta.url);
const migration = (await Promise.all((await readdir(migrationsDir)).filter(name => /^\d/.test(name)).sort().map(name => readFile(new URL(`${name}/migration.sql`, migrationsDir), 'utf8')))).join('\n');
const config = loadConfig({ MAX_SESSIONS: '1' });
function readyStream() {
  return { running: true, origin: 'http://127.0.0.1:1',
    status: async () => ({ ready: true, engine: 'Selkies' }), assertReady: async () => {},
    gameEnvironment: () => ({}), closeSession: async () => {}, viewer: Selkies.prototype.viewer };
}
async function fixture(t, { executable = '/usr/bin/sleep', args = ['30'], stream = readyStream() } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'orbit-test-'));
  const filename = path.join(dir, 'test.db');
  const sql = new DatabaseSync(filename); sql.exec(migration); sql.close();
  const db = createDatabase(`file:${filename}`);
  const game = await db.game.create({ data: { title: 'Test game', launchId: 'test' } });
  const launcher = new Launcher({ test: { executable, args } }, { startupMs: 50, stopMs: 500 });
  const manager = new SessionManager({ db, launcher, config, stream });
  const app = createApp({ db, manager, config, stream });
  const api = supertest(app);
  const cookie = `orbit_device=${'a'.repeat(64)}`;
  const get = url => api.get(url).set('Host', '127.0.0.1:3001').set('Cookie', cookie);
  const post = (url, body = {}) => api.post(url).set('Host', '127.0.0.1:3001').set('Cookie', cookie).send(body);
  t.after(async () => {
    await manager.endAll();
    await launcher.stop();
    await manager.pending;
    await db.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, filename, db, game, launcher, manager, app, api, get, post, stream, cookie };
}

test('library, health, host and initial session use real SQLite', async t => {
  const { get } = await fixture(t);
  assert.equal((await get('/api/health')).body.database, 'ok');
  const games = await get('/api/games');
  assert.equal(games.body.games[0].title, 'Test game');
  assert.equal(games.body.games[0].available, true);
  assert.equal((await get('/api/session')).body.session, null);
  const host = (await get('/api/host/status')).body;
  assert.equal(host.streamingStatus, 'UNVERIFIED');
  assert.equal(host.system, undefined);
  assert.equal(host.slots, undefined);
  assert.equal((await get('/api/unknown')).status, 404);
});

test('start, READY, repeat start rejection, end, repeat end and next start', async t => {
  const { post, get, game, db } = await fixture(t);
  const result = await post('/api/session/start', { gameId: game.id });
  assert.equal(result.status, 201);
  assert.equal(result.body.session.status, 'READY');
  assert.equal(result.body.session.streamingStatus, 'UNVERIFIED');
  assert.equal((await get('/api/host/status')).body.reserved, true);
  assert.equal((await post('/api/session/start', { gameId: game.id })).status, 409);
  const end = await post('/api/session/end');
  assert.equal(end.body.session.status, 'ENDED');
  assert.ok(end.body.session.endedAt);
  assert.equal((await post('/api/session/end')).body.session.id, result.body.session.id);
  assert.equal((await get('/api/host/status')).body.available, true);
  assert.equal((await post('/api/session/start', { gameId: game.id })).status, 201);
  await post('/api/session/end');
  assert.equal(await db.session.count(), 2);
});

test('simultaneous API starts produce exactly one live session', async t => {
  const { post, game, db } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => post('/api/session/start', { gameId: game.id })));
  assert.deepEqual(results.map(x => x.status).sort(), [201, 409, 409, 409, 409]);
  assert.equal(await db.session.count({ where: { status: { in: LIVE } } }), 1);
  await post('/api/session/end');
});

test('SQLite partial index prevents reservations from an independent connection', async t => {
  const { db, game, filename } = await fixture(t);
  await db.session.create({ data: { gameId: game.id, status: 'STARTING', ownerId: 'index-device', slot: 0 } });
  const other = new DatabaseSync(filename);
  try {
    assert.throws(() => other.prepare('INSERT INTO Session (gameId, status, ownerId, slot) VALUES (?, ?, ?, ?)').run(game.id, 'READY', 'other-device', 0), /UNIQUE/);
    other.prepare('INSERT INTO Session (gameId, status, endedAt) VALUES (?, ?, CURRENT_TIMESTAMP)').run(game.id, 'FAILED');
  } finally { other.close(); }
});

test('bad IDs, extra command input, missing game and disabled game are rejected', async t => {
  const { post, game, db } = await fixture(t);
  for (const gameId of [0, -1, '1', 1.5, null, 2147483648]) {
    assert.equal((await post('/api/session/start', { gameId })).status, 400);
  }
  assert.equal((await post('/api/session/start', { gameId: game.id, command: '/bin/sh' })).status, 400);
  assert.equal((await post('/api/session/start', { gameId: 999 })).status, 404);
  await db.game.update({ where: { id: game.id }, data: { enabled: false } });
  assert.equal((await post('/api/session/start', { gameId: game.id })).status, 409);
  assert.equal(await db.session.count(), 0);
});

test('browser origin, Host and content type guards reject unsafe requests', async t => {
  const { api, post } = await fixture(t);
  assert.equal((await post('/api/session/end').set('Origin', 'https://example.com')).status, 403);
  assert.equal((await post('/api/session/end').set('Sec-Fetch-Site', 'cross-site')).status, 403);
  assert.equal((await api.post('/api/session/end').set('Host', '127.0.0.1:3001').set('Content-Type', 'text/plain').send('{}')).status, 415);
  assert.equal((await api.get('/api/health').set('Host', 'example.com')).status, 403);
  assert.equal((await post('/api/session/end').set('Origin', config.origin)).status, 200);
  assert.equal((await api.post('/api/session/start').set('Host', '127.0.0.1:3001').set('Content-Type', 'application/json').send('{bad')).status, 400);
});

test('unavailable Selkies blocks launching without leaving a reservation', async t => {
  const stream = readyStream();
  stream.status = async () => ({ ready: false, reason: 'Selkies is offline' });
  stream.assertReady = async () => { const error = new Error('Selkies is offline'); error.status = 503; throw error; };
  const { get, game, db, manager } = await fixture(t, { stream });
  assert.equal((await get('/api/host/status')).body.streaming.ready, false);
  await assert.rejects(manager.start(game.id), /Selkies is offline/);
  assert.equal(await db.session.count(), 0);
});

test('unknown and missing executable launchers do not reserve the host', async t => {
  const { post, game, db } = await fixture(t, { executable: '/nonexistent/approved-game' });
  assert.equal((await post('/api/session/start', { gameId: game.id })).body.error.code, 'LAUNCHER_UNAVAILABLE');
  await db.game.update({ where: { id: game.id }, data: { launchId: 'unapproved' } });
  assert.equal((await post('/api/session/start', { gameId: game.id })).status, 503);
  assert.equal(await db.session.count(), 0);
});

test('spawn error after readiness marks FAILED and releases reservation', async t => {
  const { post, game, db, launcher } = await fixture(t, { executable: '/nonexistent/approved-game' });
  launcher.readiness = async () => ({ ready: true });
  const result = await post('/api/session/start', { gameId: game.id });
  assert.equal(result.status, 503);
  assert.equal((await db.session.findFirst()).status, 'FAILED');
  assert.equal(await db.session.count({ where: { status: { in: LIVE } } }), 0);
});

test('early game exit marks FAILED and releases reservation', async t => {
  const { post, game, db } = await fixture(t, { executable: '/usr/bin/false', args: [] });
  const result = await post('/api/session/start', { gameId: game.id });
  assert.equal(result.status, 503);
  const row = await db.session.findFirst();
  assert.equal(row.status, 'FAILED');
  assert.ok(row.endedAt);
});

test('natural game exit ends a READY session and clears ownership', async t => {
  const { post, game, manager, launcher } = await fixture(t, { args: ['0.35'] });
  assert.equal((await post('/api/session/start', { gameId: game.id })).status, 201);
  await delay(500);
  await manager.pending;
  assert.equal((await manager.current()).status, 'ENDED');
  assert.equal(launcher.owned, null);
});

test('cleanup failure retains the reservation and allows an end retry', async t => {
  const { post, game, launcher, db } = await fixture(t);
  await post('/api/session/start', { gameId: game.id });
  const stop = launcher.stop.bind(launcher);
  launcher.stop = async () => { throw new Error('injected failure'); };
  assert.equal((await post('/api/session/end')).status, 503);
  assert.equal((await db.session.findFirst()).status, 'READY');
  launcher.stop = stop;
  assert.equal((await post('/api/session/end')).body.session.status, 'ENDED');
});

test('restart recovery fails interrupted records and blocks an unowned existing game', async t => {
  const { db, game, manager } = await fixture(t);
  const child = spawn('/usr/bin/sleep', ['30'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  t.after(() => child.kill());
  await db.session.create({ data: { gameId: game.id, status: 'READY', ownerId: 'restart-device', slot: 0 } });
  await manager.recover();
  const row = await db.session.findFirst();
  assert.equal(row.status, 'FAILED');
  assert.ok(row.endedAt);
  await assert.rejects(manager.start(game.id), /already running outside/);
  assert.equal(child.exitCode, null);
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
});

test('ending an owned game leaves an unrelated process alive', async t => {
  const { post, game } = await fixture(t);
  await post('/api/session/start', { gameId: game.id });
  const unrelated = spawn('/usr/bin/sleep', ['30'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
  t.after(() => unrelated.kill());
  assert.equal((await post('/api/session/end')).body.session.status, 'ENDED');
  assert.equal(unrelated.exitCode, null);
  unrelated.kill();
  await new Promise(resolve => unrelated.once('exit', resolve));
});

test('owned descendants are terminated even when the main game exits', async t => {
  const script = "const{spawn}=require('child_process');spawn('/usr/bin/sleep',['30'],{stdio:'ignore'});setTimeout(()=>process.exit(0),250);";
  const { post, game, launcher, manager } = await fixture(t, { executable: process.execPath, args: ['-e', script] });
  // Node also runs the test harness; bypass only the unrelated-executable scan.
  launcher.readiness = async () => ({ ready: true });
  assert.equal((await post('/api/session/start', { gameId: game.id })).status, 201);
  await delay(600);
  await manager.pending;
  assert.equal((await manager.current()).status, 'ENDED');
  assert.equal(await launcher.groupAlive(), false);
});

test('singleton database lock rejects a second backend owner', async t => {
  const { filename } = await fixture(t);
  const release = await lockfile.lock(filename, { realpath: false });
  try { await assert.rejects(lockfile.lock(filename, { realpath: false }), /already being held/); }
  finally { await release(); }
});

test('configuration defaults to loopback and rejects public/wildcard binding', () => {
  assert.equal(loadConfig({}).bindAddress, '127.0.0.1');
  assert.equal(loadConfig({}).maxSessions, 2);
  for (const value of ['0', '5', '1.5', 'no']) assert.throws(() => loadConfig({ MAX_SESSIONS: value }), /MAX_SESSIONS/);
  assert.throws(() => loadConfig({ PORT: '8083', SELKIES_PORT: '8082', MAX_SESSIONS: '2' }), /port range/);
  for (const bindAddress of ['0.0.0.0', '8.8.8.8', '::', '192.168.1.999']) assert.throws(() => loadConfig({ BIND_ADDRESS: bindAddress }));
  assert.equal(loadConfig({ BIND_ADDRESS: '192.168.1.10' }).bindAddress, '192.168.1.10');
  assert.throws(() => loadConfig({ SITE_ORIGIN: 'http://localhost:3001/' }));
  assert.throws(() => loadConfig({ TLS_CERT_PATH: './cert.pem' }), /both TLS/);
  assert.equal(loadConfig({ TLS_CERT_PATH: './cert.pem', TLS_KEY_PATH: './key.pem' }).origin, 'https://127.0.0.1:3001');
});

test('migration command creates a fresh database and repeated seeding is idempotent', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orbit-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const url = `file:${path.join(dir, 'nested', 'fresh.db')}`;
  const env = { ...process.env, DATABASE_URL: url };
  const cwd = new URL('../../', import.meta.url);
  execFileSync('npm', ['run', 'db:migrate', '-w', 'backend'], { cwd, env, stdio: 'pipe' });
  execFileSync('npm', ['run', 'db:seed', '-w', 'backend'], { cwd, env, stdio: 'pipe' });
  execFileSync('npm', ['run', 'db:seed', '-w', 'backend'], { cwd, env, stdio: 'pipe' });
  const db = createDatabase(url);
  try {
    const first = await db.game.findFirst({ orderBy: { id: 'asc' } });
    await db.game.update({ where: { id: first.id }, data: { enabled: false } });
    const history = await db.session.create({ data: { gameId: first.id, status: 'ENDED', endedAt: new Date() } });
    execFileSync('npm', ['run', 'db:seed', '-w', 'backend'], { cwd, env, stdio: 'pipe' });
    assert.equal((await db.game.findUnique({ where: { id: first.id } })).enabled, false);
    assert.equal((await db.session.findUnique({ where: { id: history.id } })).gameId, first.id);
    assert.equal(await db.game.count(), gameCatalog.length);
    assert.deepEqual((await db.game.findMany({ orderBy: { id: 'asc' } })).map(game => game.launchId), gameCatalog.map(game => game.launchId));
    assert.equal(await db.session.count(), 1);
    const indexes = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'Session_slot_live'");
    assert.equal(indexes.length, 1);
  } finally { await db.$disconnect(); }
});

async function browserFixture(t, { health = true, args = ['30'] } = {}) {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/streaming/api/health') { res.statusCode = health ? 200 : 503; return res.end(health ? 'OK' : 'Offline'); }
    if (req.url.startsWith('/streaming/?')) { res.setHeader('Content-Type', 'text/html'); return res.end('<html><body>Selkies packaged browser player</body></html>'); }
    if (req.url === '/streaming/selkies-core.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('// upstream core'); }
    res.statusCode = 404; res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => {
    ws.on('message', (data, binary) => ws.send(data, { binary }));
  }));
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const stream = new Selkies({ ...config, selkiesPort: upstream.address().port });
  stream.running = true; stream.error = null; stream.gameEnvironment = () => ({});
  const f = await fixture(t, { stream, args });
  const server = http.createServer(f.app);
  server.on('upgrade', f.app.streamUpgrade);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    stream.closeAll();
    for (const client of wss.clients) client.terminate();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    wss.close();
  });
  const connect = (headers = {}) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/streaming/api/websockets`, {
      headers: { Host: '127.0.0.1:3001', Origin: config.origin, Cookie: f.cookie, ...headers }, handshakeTimeout: 2000,
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (req, res) => {
      const error = new Error(`HTTP ${res.statusCode}`); error.status = res.statusCode;
      res.resume(); req.destroy(); reject(error);
    });
  });
  return { ...f, connect };
}

test('Selkies readiness is checked before allocating a game session', async t => {
  const { post, get, game, db } = await browserFixture(t, { health: false });
  assert.equal((await get('/api/games')).body.games[0].available, false);
  const start = await post('/api/session/start', { gameId: game.id });
  assert.equal(start.status, 503);
  assert.equal(start.body.error.code, 'STREAM_UNAVAILABLE');
  assert.equal(await db.session.count(), 0);
});

test('the packaged Selkies player is proxied only for the current session', async t => {
  const { get, post, game } = await browserFixture(t);
  assert.equal((await get('/streaming/?sessionId=1')).status, 409);
  const start = await post('/api/session/start', { gameId: game.id });
  assert.equal(start.status, 201);
  const url = start.body.session.browserPlayerUrl;
  const player = await get(url);
  assert.equal(player.status, 200);
  assert.match(player.text, /Selkies packaged browser player/);
  assert.match(player.headers['content-security-policy'], /frame-ancestors 'self'/);
  // Selkies loads its AudioWorklet from a generated data: module.
  const scriptPolicy = player.headers['content-security-policy'].split(';').find(value => value.trim().startsWith('script-src '));
  assert.ok(scriptPolicy.split(/\s+/).includes('data:'), 'Player policy must allow the packaged audio worklet');
  assert.equal((await get('/streaming/selkies-core.js')).status, 200);
  assert.equal((await get('/streaming/?sessionId=999')).status, 409);
  assert.equal((await get('/streaming/api/files/secrets')).status, 404);
  assert.equal((await post('/api/stream/pair')).status, 404);
});

test('the websocket proxy carries data and End Session closes the player', async t => {
  const { post, game, connect, stream, get } = await browserFixture(t);
  await post('/api/session/start', { gameId: game.id });
  const ws = await connect();
  const echoed = once(ws, 'message');
  ws.send('input-and-media-test');
  assert.equal((await echoed)[0].toString(), 'input-and-media-test');
  assert.equal(stream.sockets.size, 1);
  const closed = once(ws, 'close');
  assert.equal((await post('/api/session/end')).body.session.status, 'ENDED');
  await closed;
  assert.equal(stream.sockets.size, 0);
  assert.equal((await get('/api/host/status')).body.available, true);
});

test('websocket admission rejects missing sessions, bad origins and a second player', async t => {
  const { post, game, connect } = await browserFixture(t);
  await assert.rejects(connect(), error => error.status === 409);
  await post('/api/session/start', { gameId: game.id });
  await assert.rejects(connect({ Origin: 'https://example.com' }), error => error.status === 403);
  await assert.rejects(connect({ Host: 'example.com' }), error => error.status === 403);
  const ws = await connect();
  await assert.rejects(connect(), error => error.status === 409);
  const closed = once(ws, 'close');
  await post('/api/session/end'); await closed;
});

test('Reconnect replaces the browser socket without launching another game', async t => {
  const { post, game, connect, db } = await browserFixture(t);
  const session = (await post('/api/session/start', { gameId: game.id })).body.session;
  const ws = await connect();
  const closed = once(ws, 'close');
  assert.equal((await post('/api/stream/reconnect')).status, 200);
  await closed;
  const replacement = await connect();
  assert.equal(await db.session.count(), 1);
  assert.equal((await db.session.findFirst()).id, session.id);
  const ended = once(replacement, 'close');
  await post('/api/session/end'); await ended;
});

test('the game receives the streaming display environment', async t => {
  const stream = readyStream();
  stream.gameEnvironment = () => ({ ORBIT_DISPLAY_TEST: 'private-display' });
  const script = "if(process.env.ORBIT_DISPLAY_TEST!=='private-display')process.exit(1);setInterval(()=>{},1000);";
  const { post, game, launcher } = await fixture(t, { stream, executable: process.execPath, args: ['-e', script] });
  launcher.readiness = async () => ({ ready: true });
  assert.equal((await post('/api/session/start', { gameId: game.id })).status, 201);
  await post('/api/session/end');
});

async function multiFixture(t) {
  const f = await fixture(t);
  const secondLauncher = new Launcher({ test: { executable: '/usr/bin/sleep', args: ['30'] } }, { startupMs: 50, stopMs: 500 });
  // Controlled children share /usr/bin/sleep; they are all deliberately owned test processes.
  f.launcher.readiness = secondLauncher.readiness = async () => ({ ready: true, reason: null });
  f.manager.runtimes.push({ slot: 1, launcher: secondLauncher, stream: readyStream() });
  const second = await f.db.game.create({ data: { title: 'Second game', launchId: 'test' } });
  const third = await f.db.game.create({ data: { title: 'Third game', launchId: 'test' } });
  const client = letter => {
    const cookie = `orbit_device=${letter.repeat(64)}`;
    return { cookie,
      get: url => f.api.get(url).set('Host', '127.0.0.1:3001').set('Cookie', cookie),
      post: (url, body = {}) => f.api.post(url).set('Host', '127.0.0.1:3001').set('Cookie', cookie).send(body) };
  };
  t.after(async () => { for (const runtime of f.manager.runtimes) await runtime.launcher.stop(); });
  return { ...f, games: [f.game, second, third], clients: [client('a'), client('b'), client('c')] };
}

test('two devices concurrently launch different games, a third cannot exceed capacity', async t => {
  const { clients, games, db, manager } = await multiFixture(t);
  const results = await Promise.all(clients.map((client, index) => client.post('/api/session/start', { gameId: games[index].id })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 201, 409]);
  const live = await db.session.findMany({ where: { status: { in: LIVE } } });
  assert.equal(live.length, 2);
  assert.equal(new Set(live.map(row => row.slot)).size, 2);
  assert.equal(new Set(live.map(row => row.ownerId)).size, 2);
  for (let index = 0; index < 2; index++) {
    const own = (await clients[index].get('/api/session')).body.session;
    assert.equal(own.gameId, games[index].id);
    assert.equal('ownerId' in own, false);
  }
  assert.equal((await clients[2].get('/api/session')).body.session, null);
  const status = (await clients[2].get('/api/host/status')).body;
  assert.equal(status.activeSessions, 2);
  assert.equal(status.maxSessions, 2);
  assert.equal(status.availableSessions, 0);
  assert.equal(status.available, false);
  const details = await manager.hostStatus();
  assert.equal(status.slots, undefined);
  assert.equal(details.slots.length, 2);
  assert.ok(details.slots.every(slot => slot.state === 'occupied'));
  assert.deepEqual(details.slots.map(slot => slot.gameTitle), games.slice(0, 2).map(game => game.title));
  assert.ok(details.slots.every(slot => !('ownerId' in slot) && !('sessionId' in slot)));
  const ownStatus = await manager.hostStatus((await manager.current()).ownerId);
  assert.equal(ownStatus.slots.filter(slot => slot.isCurrentDevice).length, 1);
  assert.equal(manager.runtimes.every(runtime => runtime.launcher.owned), true);
});

test('one browser cannot reserve two games and one title cannot run twice', async t => {
  const { clients: [a, b], games, db } = await multiFixture(t);
  assert.equal((await a.post('/api/session/start', { gameId: games[0].id })).status, 201);
  assert.equal((await a.post('/api/session/start', { gameId: games[1].id })).body.error.code, 'DEVICE_BUSY');
  assert.equal((await b.post('/api/session/start', { gameId: games[0].id })).body.error.code, 'GAME_BUSY');
  assert.equal((await b.post('/api/games')).status, 404);
  const library = (await b.get('/api/games')).body.games;
  assert.equal(library.find(game => game.id === games[0].id).available, false);
  assert.equal(library.find(game => game.id === games[1].id).available, true);
  assert.equal(await db.session.count(), 1);
});

test('ending one device releases only its slot and leaves the other game alive', async t => {
  const { clients: [a, b, c], games, manager } = await multiFixture(t);
  const one = (await a.post('/api/session/start', { gameId: games[0].id })).body.session;
  const two = (await b.post('/api/session/start', { gameId: games[1].id })).body.session;
  assert.equal((await c.post('/api/session/end')).body.session, null);
  assert.equal((await a.post('/api/session/end')).body.session.id, one.id);
  assert.equal((await a.post('/api/session/end')).body.session.id, one.id);
  assert.equal((await b.get('/api/session')).body.session.id, two.id);
  assert.equal((await b.get('/api/session')).body.session.status, 'READY');
  assert.equal(await manager.runtimeFor(two).launcher.groupAlive(), true);
  const next = await c.post('/api/session/start', { gameId: games[2].id });
  assert.equal(next.status, 201);
  assert.equal(next.body.session.slot, one.slot);
});

test('failed second launch and failed cleanup do not disturb another player', async t => {
  const { clients: [a, b], games, manager } = await multiFixture(t);
  const one = (await a.post('/api/session/start', { gameId: games[0].id })).body.session;
  const runtime = manager.runtimes[1];
  runtime.launcher.definitions = { test: { executable: '/missing/controlled-game', args: [] } };
  assert.equal((await b.post('/api/session/start', { gameId: games[1].id })).status, 503);
  assert.equal((await a.get('/api/session')).body.session.status, 'READY');
  assert.equal(await manager.runtimeFor(one).launcher.groupAlive(), true);
  runtime.launcher.definitions = { test: { executable: '/usr/bin/sleep', args: ['30'] } };
  assert.equal((await b.post('/api/session/start', { gameId: games[1].id })).status, 201);
  const stop = runtime.launcher.stop.bind(runtime.launcher);
  runtime.launcher.stop = async () => { throw new Error('controlled cleanup failure'); };
  assert.equal((await b.post('/api/session/end')).status, 503);
  assert.equal((await a.get('/api/host/status')).body.activeSessions, 2);
  assert.equal(await manager.runtimeFor(one).launcher.groupAlive(), true);
  runtime.launcher.stop = stop;
  assert.equal((await b.post('/api/session/end')).body.session.status, 'ENDED');
});

test('a natural exit ends only the matching slot', async t => {
  const { clients: [a, b], games, manager } = await multiFixture(t);
  manager.runtimes[0].launcher.definitions = { test: { executable: '/usr/bin/sleep', args: ['0.35'] } };
  await a.post('/api/session/start', { gameId: games[0].id });
  const second = (await b.post('/api/session/start', { gameId: games[1].id })).body.session;
  await delay(450); await manager.pending;
  assert.equal((await a.get('/api/session')).body.session.status, 'ENDED');
  assert.equal((await b.get('/api/session')).body.session.status, 'READY');
  assert.equal(await manager.runtimeFor(second).launcher.groupAlive(), true);
});

test('SQLite independently rejects conflicting slots, devices, and titles', async t => {
  const { db, filename, games } = await multiFixture(t);
  await db.session.create({ data: { gameId: games[0].id, ownerId: 'first', slot: 0, status: 'STARTING' } });
  const other = new DatabaseSync(filename);
  const insert = other.prepare('INSERT INTO Session (gameId, ownerId, slot, status) VALUES (?, ?, ?, ?)');
  try {
    assert.throws(() => insert.run(games[1].id, 'second', 0, 'READY'), /UNIQUE/);
    assert.throws(() => insert.run(games[1].id, 'first', 1, 'READY'), /UNIQUE/);
    assert.throws(() => insert.run(games[0].id, 'second', 1, 'READY'), /UNIQUE/);
    assert.throws(() => insert.run(games[1].id, null, 1, 'READY'), /requires a device/);
    assert.throws(() => insert.run(games[1].id, 'second', 4, 'READY'), /valid slot/);
    insert.run(games[1].id, 'second', 1, 'READY');
    assert.equal(other.prepare("SELECT COUNT(*) AS n FROM Session WHERE status IN ('STARTING','READY')").get().n, 2);
  } finally { other.close(); }
});

test('recovery fails every interrupted slot and preserves completed history', async t => {
  const { db, games, manager } = await multiFixture(t);
  await db.session.create({ data: { gameId: games[0].id, ownerId: 'a', slot: 0, status: 'READY' } });
  await db.session.create({ data: { gameId: games[1].id, ownerId: 'b', slot: 1, status: 'STARTING' } });
  const old = await db.session.create({ data: { gameId: games[2].id, status: 'ENDED', endedAt: new Date() } });
  await manager.recover();
  assert.equal(await db.session.count({ where: { status: 'FAILED' } }), 2);
  assert.equal((await db.session.findUnique({ where: { id: old.id } })).status, 'ENDED');
  assert.equal((await manager.hostStatus()).availableSessions, 2);
});

test('multi-session migration preserves old IDs and ends ownerless interrupted records', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orbit-upgrade-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sql = new DatabaseSync(path.join(dir, 'old.db'));
  try {
    sql.exec(await readFile(new URL('../prisma/migrations/202611190001_initial/migration.sql', import.meta.url), 'utf8'));
    sql.exec("INSERT INTO Game(id,title,launchId) VALUES(77,'Saved game','test'); INSERT INTO Session(id,gameId,status) VALUES(88,77,'READY');");
    sql.exec(await readFile(new URL('../prisma/migrations/202611190002_multi_session/migration.sql', import.meta.url), 'utf8'));
    const row = sql.prepare('SELECT * FROM Session WHERE id=88').get();
    assert.equal(row.gameId, 77); assert.equal(row.status, 'FAILED'); assert.ok(row.endedAt);
    assert.equal(row.ownerId, null);
  } finally { sql.close(); }
});

test('session cookies are HttpOnly, same-site, and Secure over HTTPS', async t => {
  const f = await fixture(t);
  const app = createApp({ db: f.db, manager: f.manager, config: { ...config, tls: { cert: 'test', key: 'test' } } });
  const response = await supertest(app).get('/api/session').set('Host', '127.0.0.1:3001');
  const cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /^orbit_device=[a-f0-9]{64};/);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/);
  assert.equal(response.body.session, null);
});

test('two WebSocket streams route to their own runtime and reconnect/end cannot cross devices', async t => {
  const f = await multiFixture(t);
  const servers = [];
  const sockets = new Set();
  for (const runtime of f.manager.runtimes) {
    const upstream = http.createServer((req, res) => {
      if (req.url === '/streaming/api/health') return res.end('OK');
      res.setHeader('Content-Type', 'text/html'); res.end(`Player slot ${runtime.slot}`);
    });
    const wss = new WebSocketServer({ noServer: true });
    upstream.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => {
      ws.on('message', data => ws.send(`slot-${runtime.slot}:${data}`));
    }));
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const stream = new Selkies({ ...config, selkiesPort: upstream.address().port });
    stream.running = true; stream.gameEnvironment = () => ({});
    runtime.stream = stream;
    servers.push({ upstream, wss });
  }
  const server = http.createServer(f.app); server.on('upgrade', f.app.streamUpgrade);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    for (const { upstream, wss } of servers) {
      for (const socket of wss.clients) socket.terminate();
      await new Promise(resolve => upstream.close(resolve)); wss.close();
    }
    await new Promise(resolve => server.close(resolve));
  });
  const connect = cookie => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/streaming/api/websockets`, { headers: { Host: '127.0.0.1:3001', Origin: config.origin, Cookie: cookie }, handshakeTimeout: 1500 });
    sockets.add(ws); ws.once('open', () => resolve(ws)); ws.once('error', reject);
    ws.once('unexpected-response', (req, res) => { res.resume(); req.destroy(); reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })); });
  });
  const [a, b, stranger] = f.clients;
  const first = (await a.post('/api/session/start', { gameId: f.games[0].id })).body.session;
  const second = (await b.post('/api/session/start', { gameId: f.games[1].id })).body.session;
  assert.match((await a.get(first.browserPlayerUrl)).text, /Player slot 0/);
  assert.match((await b.get(second.browserPlayerUrl)).text, /Player slot 1/);
  assert.equal((await b.get(first.browserPlayerUrl)).status, 409);
  assert.equal((await stranger.get(first.browserPlayerUrl)).status, 409);
  await assert.rejects(connect(stranger.cookie), error => error.status === 409);
  const wsA = await connect(a.cookie), wsB = await connect(b.cookie);
  for (const [ws, slot] of [[wsA, 0], [wsB, 1]]) {
    const reply = once(ws, 'message'); ws.send('controls'); assert.equal((await reply)[0].toString(), `slot-${slot}:controls`);
  }
  const aClosed = once(wsA, 'close'); await a.post('/api/stream/reconnect'); await aClosed;
  assert.equal(wsB.readyState, WebSocket.OPEN);
  const replacement = await connect(a.cookie);
  const closed = once(replacement, 'close'); await a.post('/api/session/end'); await closed;
  assert.equal(wsB.readyState, WebSocket.OPEN);
  const bReply = once(wsB, 'message'); wsB.send('still-playing'); assert.equal((await bReply)[0].toString(), 'slot-1:still-playing');
  assert.equal((await b.get('/api/session')).body.session.status, 'READY');
});

test('concurrent host polling shares process scans but launch validation stays fresh', async t => {
  const { manager, launcher, db, game } = await fixture(t);
  await db.game.create({ data: { title: 'Another approved title', launchId: 'test' } });
  let scans = 0, external = false;
  launcher.scanProcesses = async () => {
    scans++; await delay(15);
    return external ? [{ pid: 999999, group: 999999, state: 'S', executable: '/usr/bin/sleep' }] : [];
  };
  await Promise.all(Array.from({ length: 8 }, () => manager.hostStatus('test-player')));
  assert.equal(scans, 1, 'Concurrent library/status requests must share one process inventory');
  external = true;
  await assert.rejects(manager.start(game.id), /already running outside/);
  assert.equal(scans, 2, 'Play must bypass the status cache and check actual process ownership');
  assert.equal(await db.session.count(), 0);
});

function accountClient(f, device = 'a') {
  let cookie = `orbit_device=${device.repeat(64)}`;
  const get = url => f.api.get(url).set('Host', '127.0.0.1:3001').set('Cookie', cookie);
  const post = async (url, body = {}) => {
    const response = await f.api.post(url).set('Host', '127.0.0.1:3001').set('Cookie', cookie).send(body);
    const login = response.headers['set-cookie']?.find(value => value.startsWith('orbit_login='));
    if (login) cookie = `orbit_device=${device.repeat(64)}; ${login.split(';')[0]}`;
    return response;
  };
  return { get, post, cookie: () => cookie };
}
const signup = (client, username = 'player_one') => client.post('/api/auth/register', { username, displayName: 'Player One', password: 'a-test-password-123' });

test('accounts normalize usernames, hash passwords, issue private cookies, and rotate login tokens', async t => {
  const f = await fixture(t), client = accountClient(f);
  const registered = await signup(client, 'Player_One');
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.username, 'player_one');
  assert.equal(registered.body.user.passwordHash, undefined);
  const cookie = registered.headers['set-cookie'].find(value => value.startsWith('orbit_login='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const record = await f.db.user.findUnique({ where: { username: 'player_one' } });
  assert.match(record.passwordHash, /^scrypt-v1\$/);
  assert.ok(!record.passwordHash.includes('a-test-password-123'));
  const stored = await f.db.authSession.findFirst();
  assert.ok(!cookie.includes(stored.tokenHash));
  assert.equal((await client.get('/api/auth/me')).body.user.id, record.id);
  assert.equal((await signup(client, 'PLAYER_ONE')).status, 409);
  assert.equal((await client.post('/api/auth/login', { username: 'player_one', password: 'wrong-password' })).status, 401);
  const oldCookie = client.cookie();
  assert.equal((await client.post('/api/auth/login', { username: 'PLAYER_ONE', password: 'a-test-password-123' })).status, 200);
  const stale = await f.api.get('/api/auth/me').set('Host', '127.0.0.1:3001').set('Cookie', oldCookie);
  assert.equal(stale.body.user, null);
  assert.equal(await f.db.authSession.count(), 1);
});

test('per-user history survives login on another device and never claims guest or other account history', async t => {
  const f = await fixture(t), first = accountClient(f), second = accountClient(f, 'b');
  await f.post('/api/session/start', { gameId: f.game.id }); await f.post('/api/session/end');
  assert.equal((await signup(first)).status, 201);
  assert.equal((await first.get('/api/history')).body.total, 0);
  const start = await first.post('/api/session/start', { gameId: f.game.id });
  assert.equal(start.status, 201);
  assert.equal(start.body.session.userId, undefined);
  await f.db.session.update({ where: { id: start.body.session.id }, data: { startedAt: new Date(Date.now() - 125000) } });
  await first.post('/api/session/end');
  const history = (await first.get('/api/history')).body;
  assert.equal(history.total, 1); assert.equal(history.summary.games, 1);
  assert.ok(history.summary.durationSeconds >= 125 && history.summary.durationSeconds < 130);
  assert.equal(history.sessions[0].ownerId, undefined);
  assert.equal((await signup(second, 'other_player')).status, 201);
  assert.equal((await second.get('/api/history')).body.total, 0);
  await second.post('/api/auth/logout');
  assert.equal((await second.post('/api/auth/login', { username: 'player_one', password: 'a-test-password-123' })).status, 200);
  assert.equal((await second.get('/api/history')).body.sessions[0].id, start.body.session.id);
  assert.equal((await second.get('/api/session')).body.session, null, 'Account history must not transfer stream ownership');
  assert.equal((await second.get('/api/history?page=0')).status, 400);
  assert.equal((await f.get('/api/history')).status, 401);
});

test('logout stops the owned game, revokes credentials, and hides old history on a shared browser', async t => {
  const f = await fixture(t), client = accountClient(f);
  await signup(client);
  await client.post('/api/session/start', { gameId: f.game.id });
  const oldCookie = client.cookie();
  assert.equal((await client.post('/api/auth/logout')).status, 200);
  assert.equal(await f.launcher.groupAlive(), false);
  assert.equal((await client.get('/api/auth/me')).body.user, null);
  assert.equal((await client.get('/api/session')).body.session, null);
  assert.equal((await client.get('/api/history')).status, 401);
  assert.equal((await f.api.get('/api/auth/me').set('Host', '127.0.0.1:3001').set('Cookie', oldCookie)).body.user, null);
  await signup(client, 'next_player');
  assert.equal((await client.get('/api/history')).body.total, 0);
});

test('expired login cannot expose a game, and failed logout cleanup preserves access for retry', async t => {
  const f = await fixture(t), client = accountClient(f);
  await signup(client); await client.post('/api/session/start', { gameId: f.game.id });
  const stop = f.launcher.stop.bind(f.launcher);
  f.launcher.stop = async () => { throw Error('controlled cleanup failure'); };
  const failed = await client.post('/api/auth/logout');
  f.launcher.stop = stop;
  assert.equal(failed.status, 503);
  assert.ok((await client.get('/api/auth/me')).body.user);
  f.launcher.stop = stop;
  await f.db.authSession.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal((await client.get('/api/auth/me')).body.user, null);
  assert.equal((await client.get('/api/history')).status, 401);
  assert.equal((await client.get('/api/session')).body.session, null);
  assert.equal((await client.post('/api/auth/login', { username: 'player_one', password: 'a-test-password-123' })).status, 200);
  assert.equal((await client.get('/api/session')).body.session.status, 'READY');
  await client.post('/api/auth/logout');
});

test('authentication protects both player assets and WebSocket upgrades', async t => {
  const f = await browserFixture(t), client = accountClient(f);
  await signup(client);
  const start = await client.post('/api/session/start', { gameId: f.game.id });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  assert.equal((await f.get(start.body.session.browserPlayerUrl)).status, 401);
  await assert.rejects(f.connect(), error => error.status === 401);
  assert.equal((await client.get(start.body.session.browserPlayerUrl)).status, 200);
  const ws = await f.connect({ Cookie: client.cookie() });
  assert.equal(ws.readyState, WebSocket.OPEN);
  await client.post('/api/auth/logout');
  await delay(50);
  assert.equal(ws.readyState, WebSocket.CLOSED);
});

test('credentials are validated, requests are rate limited, and secure sites set secure login cookies', async t => {
  const f = await fixture(t), client = accountClient(f);
  assert.equal((await client.post('/api/auth/register', { username: 'x', password: 'tiny' })).status, 400);
  assert.equal((await client.post('/api/auth/register', { username: 'valid_name', password: 'a-test-password-123', role: 'admin' })).status, 400);
  const secure = createApp({ db: f.db, manager: f.manager, config: { ...config, tls: { cert: 'test', key: 'test' } } });
  const response = await supertest(secure).post('/api/auth/register').set('Host', '127.0.0.1:3001').send({ username: 'secure_user', password: 'a-test-password-123' });
  assert.match(response.headers['set-cookie'].find(x => x.startsWith('orbit_login=')), /Secure/);
  for (let i = 0; i < 13; i++) await client.post('/api/auth/login', {});
  assert.equal((await client.post('/api/auth/login', {})).status, 429);
});

test('history pagination is stable and login survives recreating the application', async t => {
  const f = await fixture(t), client = accountClient(f);
  const registered = await signup(client);
  await f.db.session.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ gameId: f.game.id, userId: registered.body.user.id, status: 'ENDED', durationSeconds: i + 1, endedAt: new Date() })) });
  const first = (await client.get('/api/history')).body;
  const second = (await client.get('/api/history?page=2')).body;
  assert.equal(first.sessions.length, 20); assert.equal(second.sessions.length, 5);
  assert.equal(first.total, 25); assert.equal(first.summary.durationSeconds, 325);
  assert.ok(first.sessions.at(-1).id > second.sessions[0].id);
  assert.equal(first.sessions[0].userId, undefined);
  const freshApp = createApp({ db: f.db, manager: f.manager, config });
  const restored = await supertest(freshApp).get('/api/auth/me').set('Host', '127.0.0.1:3001').set('Cookie', client.cookie());
  assert.equal(restored.body.user.id, registered.body.user.id);
});

test('one account on two devices has independent games and logout affects only the current device', async t => {
  const f = await multiFixture(t), first = accountClient(f), second = accountClient(f, 'b');
  await signup(first);
  await second.post('/api/auth/login', { username: 'player_one', password: 'a-test-password-123' });
  const a = await first.post('/api/session/start', { gameId: f.games[0].id });
  const b = await second.post('/api/session/start', { gameId: f.games[1].id });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal((await first.get('/api/history')).body.total, 2);
  assert.equal((await second.get('/api/history')).body.sessions.filter(row => row.isCurrentDevice).length, 1);
  await first.post('/api/auth/logout');
  assert.equal((await second.get('/api/session')).body.session.status, 'READY');
  assert.ok((await second.get('/api/auth/me')).body.user);
  assert.equal(await f.db.session.count({ where: { status: { in: LIVE } } }), 1);
  await second.post('/api/auth/logout');
});

test('dashboard details require an admin and account requests cannot grant the role', async t => {
  const f = await fixture(t), client = accountClient(f);
  assert.equal((await f.get('/api/admin/host/status')).status, 401);
  const escalated = await client.post('/api/auth/register', { username: 'role_player', password: 'a-test-password-123', isAdmin: true });
  assert.equal(escalated.status, 400);
  const registered = await signup(client, 'role_player');
  assert.equal(registered.body.user.isAdmin, false);
  assert.equal((await client.get('/api/admin/host/status')).status, 403);
  const availability = (await client.get('/api/host/status')).body;
  assert.equal(availability.system, undefined); assert.equal(availability.slots, undefined);
  assert.equal(availability.available, true);
  const start = await client.post('/api/session/start', { gameId: f.game.id });
  assert.equal(start.status, 201, 'Player games remain available');
  await client.post('/api/session/end');

  const script = new URL('../scripts/user-role.js', import.meta.url);
  const env = { ...process.env, DATABASE_URL: `file:${f.filename}` };
  execFileSync(process.execPath, [script.pathname, 'ROLE_PLAYER', 'admin'], { env, stdio: 'pipe' });
  assert.equal((await client.get('/api/auth/me')).body.user.isAdmin, true);
  const dashboard = await client.get('/api/admin/host/status');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.system.platform, 'Linux');
  assert.ok(dashboard.body.system.memoryBytes > 0);
  assert.equal(dashboard.body.slots.length, 1);
  assert.equal(dashboard.body.slots[0].state, 'available');
  assert.equal((await client.get('/api/host/status')).body.system, undefined);
  execFileSync(process.execPath, [script.pathname, 'role_player', 'player'], { env, stdio: 'pipe' });
  assert.equal((await client.get('/api/admin/host/status')).status, 403, 'Revocation takes effect on the existing login');
  assert.equal((await client.get('/api/auth/me')).body.user.isAdmin, false);
  assert.throws(() => execFileSync(process.execPath, [script.pathname, 'role_player', 'owner'], { env, stdio: 'pipe' }));
  assert.equal((await f.db.user.findUnique({ where: { username: 'role_player' } })).isAdmin, false);
  await f.db.user.update({ where: { id: registered.body.user.id }, data: { isAdmin: true } });
  await f.db.authSession.updateMany({ data: { expiresAt: new Date(0) } });
  assert.equal((await client.get('/api/admin/host/status')).status, 401);
});

test('native game profiles follow the account across devices and stay separate from other users and guests', async t => {
  const { createGameRuntimes, playerProfile } = await import('../src/services/game-host.js');
  const { mkdir, writeFile, access } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'orbit-profiles-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const runtime=createGameRuntimes(config,{profileDirectory:dir})[0];
  runtime.stream.gameEnvironment=()=>({WAYLAND_DISPLAY:'test-display'});
  const a='a'.repeat(64), b='b'.repeat(64);
  await runtime.prepare(a,11);
  const env=runtime.gameEnvironment();
  assert.equal(env.HOME,path.join(dir,'users/11'));
  assert.equal(env.XDG_DATA_HOME,path.join(dir,'users/11/data'));
  const saves=path.join(env.XDG_DATA_HOME,'flare/saves/empyrean');
  await mkdir(saves,{recursive:true});
  await writeFile(path.join(saves,'slot1.txt'),'name=Persistent hero\nlevel=3\n');
  await writeFile(path.join(env.XDG_CONFIG_HOME,'flare/settings.txt'),'fullscreen=0\n');
  await runtime.prepare(b,11);
  assert.equal(runtime.profile,env.HOME);
  assert.match(await readFile(path.join(runtime.profile,'data/flare/saves/empyrean/slot1.txt'),'utf8'),/Persistent hero/);
  assert.equal(await readFile(path.join(runtime.profile,'config/flare/settings.txt'),'utf8'),'fullscreen=0\n');
  const restored=createGameRuntimes(config,{profileDirectory:dir})[0];
  await restored.prepare(b,11);
  assert.equal(restored.profile,env.HOME);
  await runtime.prepare(b,12);
  await assert.rejects(access(path.join(runtime.profile,'data/flare/saves/empyrean/slot1.txt')));
  await runtime.prepare(a);
  assert.equal(runtime.profile,path.join(dir,'players',a));
  await assert.rejects(access(path.join(runtime.profile,'data/flare/saves/empyrean/slot1.txt')));
  assert.throws(()=>playerProfile(a,'../11',dir),/Invalid account/);
  assert.throws(()=>playerProfile('../escape',11,dir),/Invalid device/);
});

test('Flare requires login and launches with the authenticated account rather than a requested user ID', async t => {
  const f=await fixture(t), client=accountClient(f);
  const flare=await f.db.game.create({data:{title:'Flare',launchId:'flare'}});
  f.launcher.definitions.flare=f.launcher.definitions.test;
  assert.equal((await client.post('/api/session/start',{gameId:flare.id})).status,401);
  const user=(await signup(client,'native_player')).body.user;
  let prepared;
  f.manager.runtimes[0].prepare=async (ownerId,userId)=>{prepared={ownerId,userId};};
  const result=await client.post('/api/session/start',{gameId:flare.id});
  assert.equal(result.status,201);assert.equal(prepared.userId,user.id);
  const firstOwner=prepared.ownerId;
  await client.post('/api/session/end');
  const second=accountClient(f,'b');
  await second.post('/api/auth/login',{username:'native_player',password:'a-test-password-123'});
  assert.equal((await second.post('/api/session/start',{gameId:flare.id,userId:999})).status,400);
  assert.equal((await second.post('/api/session/start',{gameId:flare.id})).status,201);
  assert.equal(prepared.userId,user.id);assert.notEqual(prepared.ownerId,firstOwner);
  await second.post('/api/session/end');
});
