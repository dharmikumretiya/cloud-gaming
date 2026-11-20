import { spawn } from 'node:child_process';
import { access, readFile, readdir, readlink } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const gameRoot = fileURLToPath(new URL('../../../.runtime/games/', import.meta.url));
const localRoot = path.join(gameRoot, 'root/usr');
const localEnv = Object.freeze({ LD_LIBRARY_PATH: path.join(localRoot, 'lib') });
const flareRoot = path.join(gameRoot, 'flare/squashfs-root');

// Administrator-owned allowlist. API input can select a key, never a command.
export function approvedGameDefinitions(profileRoot = gameRoot) { return Object.freeze({
  flare: Object.freeze({ executable: path.join(flareRoot, 'usr/bin/flare'), args: [`--data-path=${path.join(flareRoot, 'usr/share/flare')}`], env: { LD_LIBRARY_PATH: `/usr/lib:${path.join(flareRoot, 'lib/x86_64-linux-gnu')}:${path.join(flareRoot, 'usr/lib/x86_64-linux-gnu')}` } }),
  mahjongg: Object.freeze({ executable: path.join(localRoot, 'bin/gnome-mahjongg'), args: [], env: { ...localEnv, GSETTINGS_BACKEND: 'keyfile', GSETTINGS_SCHEMA_DIR: path.join(localRoot, 'share/glib-2.0/schemas'), XDG_DATA_DIRS: `${localRoot}/share:/usr/local/share:/usr/share`, GSK_RENDERER: 'cairo' } }),
  supertuxkart: Object.freeze({ executable: '/usr/bin/supertuxkart', args: [] }),
  xonotic: Object.freeze({ executable: '/usr/bin/xonotic-sdl', args: ['-userdir', path.join(profileRoot, 'xonotic'), '+vid_fullscreen', '1', '+vid_width', '1280', '+vid_height', '720'] }),
  supertux: Object.freeze({ executable: existsSync('/usr/bin/supertux2') ? '/usr/bin/supertux2' : path.join(localRoot, 'bin/supertux2'), args: ['--datadir', existsSync('/usr/bin/supertux2') ? '/usr/share/games/supertux2' : path.join(localRoot, 'share/games/supertux2'), '--userdir', path.join(profileRoot, 'supertux'), '--fullscreen', '--geometry', '1280x720'], env: localEnv }),
  openttd: Object.freeze({ executable: path.join(localRoot, 'bin/openttd'), args: ['-c', path.join(profileRoot, 'openttd/openttd.cfg'), '-r', '1280x720'], env: localEnv }),
}); }
export const approvedGames = approvedGameDefinitions();

async function processes({ executables = false } = {}) {
  const entries = (await readdir('/proc')).filter(pid => /^\d+$/.test(pid));
  const result = [];
  // Bound filesystem work so a library refresh cannot flood libuv's worker pool
  // and delay the WebSocket proxy sharing this Node process.
  for (let offset = 0; offset < entries.length; offset += 16) {
    const batch = await Promise.all(entries.slice(offset, offset + 16).map(async pid => {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        let executable = null;
        if (executables) {
          try { executable = await readlink(`/proc/${pid}/exe`); } catch { /* An inaccessible process is never ours. */ }
        }
        return { pid: Number(pid), state: fields[0], group: Number(fields[2]), executable };
      } catch { return null; }
    }));
    result.push(...batch.filter(Boolean));
  }
  return result;
}

export async function processGroupAlive(group) {
  if (!group) return false;
  return (await processes()).some(p => p.group === group && !['Z', 'X'].includes(p.state));
}

export class Launcher {
  constructor(definitions = approvedGames, { startupMs = 650, stopMs = 2000, scanProcesses = processes } = {}) {
    this.definitions = definitions;
    this.startupMs = startupMs;
    this.stopMs = stopMs;
    this.owned = null;
    this.scanProcesses = scanProcesses;
    this.inventory = null;
    this.inventoryTask = null;
  }
  invalidateInventory() { this.inventory = null; this.inventoryTask = null; }
  async readinessMany(launchIds) {
    // Cache only the expensive OS inventory, never reservations or ownership
    // decisions. Each device still receives its own freshly queried session.
    let inventory = this.inventory?.expires > Date.now() ? this.inventory.value : null;
    if (!inventory) {
      if (!this.inventoryTask) {
        const task = this.scanProcesses({ executables: true });
        this.inventoryTask = task;
        task.then(value => {
          if (this.inventoryTask === task) this.inventory = { value, expires: Date.now() + 1000 };
        }).finally(() => { if (this.inventoryTask === task) this.inventoryTask = null; }).catch(() => {});
      }
      inventory = await this.inventoryTask;
    }
    return Promise.all(launchIds.map(launchId => this.readiness(launchId, inventory)));
  }
  async readiness(launchId, inventory = null) {
    const definition = this.definitions[launchId];
    if (!definition) return { ready: false, reason: 'Game has no approved launcher.' };
    try { await access(definition.executable, constants.X_OK); }
    catch { return { ready: false, reason: 'Approved game executable is not installed or executable.' }; }
    // Do not adopt or kill an existing game after losing ownership on restart.
    for (const proc of inventory || await this.scanProcesses({ executables: true })) {
      if (proc.state === 'Z' || proc.group === this.owned?.group) continue;
      try {
        if (proc.executable === definition.executable) {
          return { ready: false, reason: 'Game is already running outside this application. Close it manually first.' };
        }
      } catch { /* Other users' inaccessible processes are not ours. */ }
    }
    return { ready: true, reason: null };
  }
  async groupAlive() {
    if (!this.owned) return false;
    return processGroupAlive(this.owned.group);
  }
  async launch(launchId, onExit, environment = {}) {
    if (this.owned) throw new Error('An owned game still needs cleanup');
    this.invalidateInventory();
    const definition = this.definitions[launchId];
    if (!definition) throw new Error('Unapproved launcher');
    const child = spawn(definition.executable, definition.args, {
      shell: false, detached: true, env: { ...process.env, ...environment, ...definition.env }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    const owned = { child, group: child.pid, exited: false, code: null, output: '' };
    this.owned = owned;
    child.stderr.on('data', chunk => { owned.output = (owned.output + chunk.toString()).slice(-2000); });
    child.once('exit', (code, signal) => {
      this.invalidateInventory();
      owned.exited = true;
      owned.code = code;
      owned.signal = signal;
      onExit?.(code);
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', error => { owned.exited = true; reject(error); });
    });
    await delay(this.startupMs);
    if (owned.exited) throw new Error('Game exited during startup. Check the host display and game installation.');
  }
  async stop() {
    if (!this.owned) return;
    const owned = this.owned;
    const signal = name => {
      if (!owned.group) return;
      try { process.kill(-owned.group, name); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    for (const name of ['SIGTERM', 'SIGKILL']) {
      if (!(await this.groupAlive())) break;
      signal(name);
      const deadline = Date.now() + this.stopMs;
      while (await this.groupAlive()) {
        if (Date.now() >= deadline) break;
        await delay(40);
      }
    }
    if (await this.groupAlive()) throw new Error('Could not confirm game termination; host remains reserved.');
    if (this.owned === owned) this.owned = null;
    this.invalidateInventory();
  }
}
