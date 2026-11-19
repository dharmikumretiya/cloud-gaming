import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, mkdir, open, readdir, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { backendRoot } from '../config.js';
import { ApiError } from './sessions.js';
import { processGroupAlive } from './launcher.js';

const exec = promisify(execFile);
export class Selkies {
  constructor(config) {
    this.config = config;
    this.directory = config.runtimeDirectory || path.resolve(backendRoot, '../.runtime/selkies');
    this.appRoot = path.resolve(backendRoot, '../.runtime/selkies/squashfs-root');
    this.runtime = path.join(this.directory, 'run');
    this.busFile = path.join(this.directory, 'session-bus');
    this.busAddress = null;
    this.origin = `http://127.0.0.1:${config.selkiesPort}`;
    this.running = false;
    this.display = null;
    this.group = null;
    this.sockets = new Map();
    this.error = 'Selkies is not running. Run npm run stream:install, then restart the app.';
  }
  environment() {
    return { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '',
      XDG_RUNTIME_DIR: this.runtime, XDG_CONFIG_HOME: path.join(this.directory, 'config'), XDG_DATA_HOME: path.join(this.directory, 'data'),
      PULSE_RUNTIME_PATH: path.join(this.runtime, 'pulse'), PULSE_SERVER: `unix:${this.runtime}/pulse/native`, SELKIES_WAYLAND: 'true',
    };
  }
  gameEnvironment() {
    if (!this.display) throw new ApiError(503, 'STREAM_UNAVAILABLE', 'The private game display is not ready.');
    const interposer = path.join(this.appRoot, 'usr/lib/selkies_input_interposer.so');
    return { ...this.environment(), WAYLAND_DISPLAY: this.display, SDL_VIDEODRIVER: 'wayland', PULSE_SINK: 'output', DBUS_SESSION_BUS_ADDRESS: this.busAddress,
      LD_PRELOAD: [existsSync(interposer) ? interposer : '', process.env.LD_PRELOAD || ''].filter(Boolean).join(':'),
    };
  }
  async start() {
    const executable = path.join(this.appRoot, 'AppRun');
    try {
      await access(executable);
      const occupied = await new Promise(resolve => {
        const socket = net.createConnection({ host: '127.0.0.1', port: this.config.selkiesPort });
        const finish = value => { socket.destroy(); resolve(value); };
        socket.setTimeout(300);
        socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
      });
      if (occupied) throw new Error(`SELKIES_PORT ${this.config.selkiesPort} is already in use. Stop the other service or select another port.`);
      for (const dir of [this.runtime, path.join(this.directory, 'config'), path.join(this.directory, 'data')]) await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(this.runtime, 0o700);
      await access('/usr/bin/dbus-run-session');
      const env = { ...this.environment(), ORBIT_BUS_FILE: this.busFile };
      // Match the host graphics driver's libdrm ABI. This avoids the AppImage's
      // older AMD library shadowing a newer Mesa driver (observed on Omarchy).
      if (this.config.selkiesHostDrm) {
        const libraries = ['/usr/lib/libdrm.so.2', '/usr/lib/libdrm_amdgpu.so.1'].filter(existsSync);
        if (libraries.length) env.LD_PRELOAD = [...libraries, process.env.LD_PRELOAD || ''].filter(Boolean).join(':');
      }
      const args = ['--addr=127.0.0.1', `--port=${this.config.selkiesPort}`, '--enable-https=false', '--enable-basic-auth=false',
        '--subfolder=/streaming', '--mode=websockets', '--enable-dual-mode=false', '--manual-width=1280', '--manual-height=720',
        '--framerate=60', '--enable-resize=false', '--file-transfers=none', '--enable-clipboard=false', '--command-enabled=false',
        '--enable-sharing=false', '--printing-enabled=false', '--microphone-enabled=false', '--webcam-enabled=false',
        '--ui-title=Orbit', '--ui-show-logo=false', '--ui-sidebar-show-files=false', '--ui-sidebar-show-apps=false',
        '--ui-sidebar-show-sharing=false', '--ui-sidebar-show-clipboard=false'];
      const log = await open(path.join(this.directory, 'server.log'), 'a', 0o600);
      try { this.child = spawn('/usr/bin/dbus-run-session', ['--', process.execPath, path.join(backendRoot, 'src/services/stream-entry.js'), executable, ...args], { env, detached: true, stdio: ['ignore', log.fd, log.fd] }); }
      finally { await log.close(); }
      this.group = this.child.pid;
      this.child.once('error', error => { this.error = error.message; this.running = false; });
      this.child.once('exit', () => { this.running = false; this.display = null; this.error = 'Selkies stopped. Check .runtime/selkies/server.log and restart the app.'; this.closeAll(); });
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('Selkies exited during startup. Check .runtime/selkies/server.log.');
        try {
          const response = await fetch(`${this.origin}/streaming/api/health`, { signal: AbortSignal.timeout(400) });
          if (response.ok && (await response.text()) === 'OK') {
            for (const name of await readdir(this.runtime)) {
              if (/^wayland-\d+$/.test(name) && (await stat(path.join(this.runtime, name))).isSocket()) { this.display = name; break; }
            }
            if (this.display) break;
          }
        } catch { /* Wait for the private compositor and HTTP service. */ }
        await delay(150);
      }
      if (!this.display) throw new Error('Selkies did not bring up its private display in time. Check .runtime/selkies/server.log.');
      this.busAddress = (await readFile(this.busFile, 'utf8')).trim();
      if (!this.busAddress) throw new Error('Private session bus did not start.');
      const pactl = path.join(this.appRoot, 'usr/conda/bin/pactl');
      const pulse = `unix:${this.runtime}/pulse/native`;
      // AppRun starts PulseAudio asynchronously. The HTTP listener can become
      // ready first, particularly when several GPU/audio services start together.
      let sinks;
      const audioDeadline = Date.now() + 10000;
      while (Date.now() < audioDeadline) {
        try { sinks = await exec(pactl, ['-s', pulse, 'list', 'short', 'sinks'], { timeout: 800 }); break; }
        catch { await delay(150); }
      }
      if (!sinks) throw new Error('The private audio server did not become ready. Check the slot log and restart the backend.');
      if (!sinks.stdout.split('\n').some(line => line.split('\t')[1] === 'output')) {
        await exec(pactl, ['-s', pulse, 'load-module', 'module-null-sink', 'sink_name=output', 'channels=2'], { timeout: 3000 });
      }
      await exec(pactl, ['-s', pulse, 'set-default-sink', 'output'], { timeout: 3000 });
      this.running = true; this.error = null;
      console.log('Selkies ready: private Wayland display, audio, and browser streaming.');
    } catch (error) {
      const reason = error.code === 'ENOENT' ? 'Install Selkies with npm run stream:install, then restart the app.' : error.message;
      await this.stop();
      this.error = reason;
      console.error('Selkies:', reason);
    }
  }
  async status() {
    let ready = false;
    if (this.running) {
      try {
        const response = await fetch(`${this.origin}/streaming/api/health`, { signal: AbortSignal.timeout(800) });
        ready = response.ok && (await response.text()) === 'OK';
      } catch { /* Return unavailable without inventing stream state. */ }
    }
    return { engine: 'Selkies', ready, transport: 'websockets', connections: this.sockets.size,
      reason: ready ? null : this.error || 'Selkies is not responding. Check its runtime log.' };
  }
  async assertReady() {
    const status = await this.status();
    if (!status.ready) throw new ApiError(503, 'STREAM_UNAVAILABLE', status.reason);
  }
  viewer(session) {
    return session && ['READY', 'ACTIVE'].includes(session.status) ? `/streaming/?sessionId=${session.id}` : null;
  }
  claimSocket(sessionId, socket) {
    if (this.sockets.size) throw new ApiError(409, 'STREAM_BUSY', 'A player is already connected. Use Reconnect to replace it.');
    this.sockets.set(socket, sessionId);
    socket.once('close', () => this.sockets.delete(socket));
  }
  async closeSession(sessionId) {
    const sockets = [...this.sockets].filter(([, id]) => id === sessionId).map(([socket]) => socket);
    await Promise.all(sockets.map(socket => new Promise(resolve => {
      if (socket.destroyed) { this.sockets.delete(socket); return resolve(); }
      socket.once('close', resolve); socket.destroy();
    })));
  }
  closeAll() { for (const socket of this.sockets.keys()) socket.destroy(); this.sockets.clear(); }
  async stop() {
    this.closeAll(); this.running = false;
    if (!this.group) return;
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (!(await processGroupAlive(this.group))) break;
      try { process.kill(-this.group, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && await processGroupAlive(this.group)) await delay(50);
    }
    if (await processGroupAlive(this.group)) throw new Error('Could not stop the owned Selkies process group.');
    this.group = null; this.display = null; this.busAddress = null;
  }
}
