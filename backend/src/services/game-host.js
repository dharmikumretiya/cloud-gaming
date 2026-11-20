import path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { backendRoot } from '../config.js';
import { Selkies } from './selkies.js';
import { Launcher, approvedGameDefinitions } from './launcher.js';

// Each slot owns a compositor, PulseAudio server, encoder, and game process group.
// Signed-in profiles belong to accounts; guest profiles stay on their device.
export function playerProfile(ownerId, userId = null, profileDirectory = path.resolve(backendRoot, '../.runtime')) {
  if (!/^[a-f0-9]{64}$/.test(ownerId)) throw new Error('Invalid device profile identifier');
  if (userId !== null && (!Number.isSafeInteger(userId) || userId < 1)) throw new Error('Invalid account profile identifier');
  return path.resolve(profileDirectory, userId === null ? 'players' : 'users', userId === null ? ownerId : String(userId));
}
export function createGameRuntimes(config, { profileDirectory } = {}) {
  return Array.from({ length: config.maxSessions }, (_, slot) => ({
    slot,
    launcher: new Launcher(),
    stream: new Selkies({ ...config, selkiesPort: config.selkiesPort + slot,
      runtimeDirectory: path.resolve(backendRoot, `../.runtime/selkies/seats/${slot}`) }),
    gameEnvironment() {
      return { ...this.stream.gameEnvironment(), HOME: this.profile, XDG_CONFIG_HOME: path.join(this.profile, 'config'), XDG_DATA_HOME: path.join(this.profile, 'data'), XDG_CACHE_HOME: path.join(this.profile, 'cache') };
    },
    async prepare(ownerId, userId = null) {
      const profile = playerProfile(ownerId, userId, profileDirectory);
      this.profile = profile;
      for (const name of ['xonotic', 'supertux', 'openttd', 'config', 'data', 'cache']) await mkdir(path.join(profile, name), { recursive: true, mode: 0o700 });
      await mkdir(path.join(profile, 'config/flare'), { recursive: true, mode: 0o700 });
      try { await writeFile(path.join(profile, 'config/flare/settings.txt'), 'fullscreen=1\nresolution_w=1280\nresolution_h=720\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      for (const name of ['baseset', 'data', 'lang']) {
        try { await symlink(path.resolve(backendRoot, '../.runtime/games/root/usr/share/openttd', name), path.join(profile, 'openttd', name)); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      try { await writeFile(path.join(profile, 'openttd/openttd.cfg'), '[misc]\nvideo_driver = sdl\nresolution = 1280,720\nfullscreen = true\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      this.launcher = new Launcher(approvedGameDefinitions(profile));
    },
  }));
}
