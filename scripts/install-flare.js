import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, mkdir, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { databasePath } from '../backend/src/database.js';

// Official Flare 1.15 Linux release, pinned to the publisher's asset digest.
const url = 'https://github.com/flareteam/flare-game/releases/download/v1.15/flare-linux64-v1.15.AppImage';
const expected = '155cd3a58f0e510e5bbb9db1a093469c88e52c05295afef53c24854cc5bbaf82';
const directory = fileURLToPath(new URL('../.runtime/games/flare/', import.meta.url));
const archive = path.join(directory, 'flare.AppImage');
async function verified(file) {
  try { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') === expected; }
  catch { return false; }
}
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Flare bundle requires Linux x86_64.');
try { await access(`${databasePath()}.lock`); throw new Error('Stop the backend before installing Flare.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(directory, { recursive: true });
if (!await verified(archive)) {
  const partial = `${archive}.partial`;
  if (!await verified(partial)) execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '600', url, '-o', partial], { stdio: 'inherit' });
  if (!await verified(partial)) throw new Error('Flare checksum verification failed.');
  await rename(partial, archive);
}
await chmod(archive, 0o755);
try { await access(path.join(directory, 'squashfs-root/usr/bin/flare')); }
catch { execFileSync(archive, ['--appimage-extract'], { cwd: directory, stdio: 'ignore' }); }
console.log('Verified official Flare 1.15 and extracted it locally.');
