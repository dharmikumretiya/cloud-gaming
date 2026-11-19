import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databasePath } from '../backend/src/database.js';

// Curated Arch x86_64 packages and dependencies, verified against repository SHA-256 values.
// They are extracted locally, never installed into the operating system.
const packages = JSON.parse(await readFile(new URL('./game-packages.json', import.meta.url)));
const directory = fileURLToPath(new URL('../.runtime/games/', import.meta.url));
const fingerprint = createHash('sha256').update(JSON.stringify(packages)).digest('hex');
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This game bundle targets Arch-compatible Linux x86_64. On other distributions install games using their package manager and adjust the approved launchers.');
await mkdir(path.join(directory, 'packages'), { recursive: true });
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
let installed = false;
try {
  installed = (await readFile(path.join(directory, 'installed.sha256'), 'utf8')).trim() === fingerprint;
  await access(path.join(directory, 'root/usr/bin/supertux2'));
  await access(path.join(directory, 'root/usr/bin/openttd'));
  await access(path.join(directory, 'root/usr/bin/gnome-mahjongg'));
} catch { installed = false; }
if (!installed) {
  // Stop the backend before modifying game binaries; don't replace a bundle in use.
  try { await access(`${databasePath()}.lock`); throw new Error('Stop the backend before installing the game bundle.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const archives = await Promise.all(packages.map(async pkg => {
    const archive = path.join(directory, 'packages', path.basename(new URL(pkg.url).pathname));
    let valid = false;
    try { valid = await digest(archive) === pkg.sha256; } catch { /* Download below. */ }
    if (!valid) {
      console.log(`Downloading ${pkg.name}…`);
      const partial = `${archive}.partial`;
      execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '300', pkg.url, '-o', partial], { stdio: 'inherit' });
      if (await digest(partial) !== pkg.sha256) { await rm(partial, { force: true }); throw new Error(`Checksum mismatch: ${pkg.name}`); }
      await rename(partial, archive);
    }
    console.log(`Verified ${pkg.name}`);
    return archive;
  }));
  const staging = path.join(directory, 'root-staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging);
  for (const archive of archives) execFileSync('bsdtar', ['-xf', archive, '-C', staging, '--include', 'usr']);
  await rm(path.join(directory, 'root'), { recursive: true, force: true });
  execFileSync('glib-compile-schemas', [path.join(staging, 'usr/share/glib-2.0/schemas')]);
  await rename(staging, path.join(directory, 'root'));
  await writeFile(path.join(directory, 'installed.sha256'), `${fingerprint}\n`);
}
for (const profile of ['supertux', 'xonotic', 'openttd']) await mkdir(path.join(directory, profile), { recursive: true });
for (const name of ['baseset', 'data', 'lang']) {
  try { await symlink(`../root/usr/share/openttd/${name}`, path.join(directory, 'openttd', name)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
try {
  await writeFile(path.join(directory, 'openttd/openttd.cfg'), '[misc]\nvideo_driver = sdl\nresolution = 1280,720\nfullscreen = true\n', { flag: 'wx' });
} catch (error) { if (error.code !== 'EEXIST') throw error; }
console.log('SuperTux, OpenTTD, and Mahjongg are installed locally. Xonotic uses /usr/bin/xonotic-sdl (Arch: sudo pacman -S --needed xonotic).');
