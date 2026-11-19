import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const version = '2.2.1';
const sha256 = '404dc07d6d0fe2de9b20646e352484cb22b636e083397ff8850907307d2f250e';
const directory = fileURLToPath(new URL('../.runtime/selkies/', import.meta.url));
const image = path.join(directory, `selkies-${version}.AppImage`);
const executable = path.join(directory, 'squashfs-root/AppRun');
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This installer targets Linux x86_64.');
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
try {
  const installed = JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'));
  if (installed.version === version && installed.sha256 === sha256) {
    await access(executable);
    console.log(`Selkies ${version} is already installed.`);
    process.exit(0);
  }
} catch { /* Missing or incomplete installation. */ }
async function digest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
let cached = false;
try { cached = await digest(image) === sha256; } catch { /* Download below. */ }
if (!cached) {
  const url = `https://github.com/selkies-project/selkies/releases/download/${version}/selkies-${version}-x86_64.AppImage`;
  console.log(`Downloading Selkies ${version} from its official release…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const part = `${image}.part`;
  await writeFile(part, Buffer.from(await response.arrayBuffer()), { mode: 0o700 });
  if (await digest(part) !== sha256) throw new Error('Selkies checksum mismatch; refusing to execute the download.');
  await rename(part, image);
}
await chmod(image, 0o700);
console.log('Verified release checksum. Extracting the packaged server and browser client…');
// Extract separately: never overwrite executable files an old process may map.
const staging = path.join(directory, `.install-${process.pid}`);
const previous = path.join(directory, `.previous-${process.pid}`);
await mkdir(staging);
try {
  execFileSync(image, ['--appimage-extract'], { cwd: staging, stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
  try { await rename(path.join(directory, 'squashfs-root'), previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(path.join(staging, 'squashfs-root'), path.join(directory, 'squashfs-root'));
} finally { await rm(staging, { recursive: true, force: true }); }
await rm(previous, { recursive: true, force: true });
await access(executable);
await writeFile(path.join(directory, 'release.json'), JSON.stringify({ version, sha256 }, null, 2));
console.log('Selkies installed locally. npm start will supervise it automatically; no system packages were changed.');
