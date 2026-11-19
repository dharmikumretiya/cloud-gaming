import lockfile from 'proper-lockfile';
import { loadConfig } from './config.js';
import { createDatabase, databasePath } from './database.js';
import { createGameRuntimes } from './services/game-host.js';
import { SessionManager } from './services/sessions.js';
import { createApp } from './app.js';
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';

const config = loadConfig();
const db = createDatabase();
const runtimes = createGameRuntimes(config);
let release, server, manager;
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down Orbit; cleaning up any owned game.');
  server?.close();
  // Do not hang indefinitely on a broken driver or shutdown request.
  const deadline = setTimeout(() => process.exit(1), 30000);
  try {
    await manager?.endAll();
  } catch (error) { console.error('Shutdown failed:', error.message); code = 1; }
  try {
    await Promise.all(runtimes.map(runtime => runtime.stream.stop()));
    await db.$disconnect();
    await release?.();
  } catch (error) { console.error('Resource cleanup failed:', error.message); code = 1; }
  clearTimeout(deadline);
  process.exit(code);
}
try {
  await db.$queryRaw`SELECT 1`;
  release = await lockfile.lock(databasePath(), { realpath: false, stale: 10000, update: 2000, onCompromised: error => { console.error(error.message); shutdown(1); } });
  await Promise.all(runtimes.map(runtime => runtime.stream.start()));
  manager = new SessionManager({ db, config, runtimes });
  await manager.recover();
  const app = createApp({ db, manager, config });
  server = config.tls ? https.createServer({ cert: await readFile(config.tls.cert), key: await readFile(config.tls.key) }, app) : http.createServer(app);
  server.on('upgrade', app.streamUpgrade);
  server.listen(config.port, config.bindAddress, () => {
    console.log(`Orbit running at ${config.tls ? 'https' : 'http'}://${config.bindAddress}:${config.port}`);
    console.log(`Host supports ${runtimes.length} separate gaming sessions; one game per browser and one player per title.`);
  });
  server.on('error', error => { console.error(error.message); shutdown(1); });
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
} catch (error) {
  console.error('Startup failed:', error.message, '\nRun npm run db:setup first. Only one backend may use this database; after a crash, wait 10 seconds before restarting.');
  await shutdown(1);
}
