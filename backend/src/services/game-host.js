import path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { backendRoot } from '../config.js';
import { Selkies } from './selkies.js';
import { Launcher, approvedGameDefinitions } from './launcher.js';

// Each slot owns a compositor, PulseAudio server, encoder, and game process group.
// Profiles belong to anonymous devices, rather than the reusable hardware slot.
export function createGameRuntimes(config) {
  return Array.from({ length: config.maxSessions }, (_, slot) => ({
    slot,
    launcher: new Launcher(),
    stream: new Selkies({ ...config, selkiesPort: config.selkiesPort + slot,
      runtimeDirectory: path.resolve(backendRoot, `../.runtime/selkies/seats/${slot}`) }),
    gameEnvironment() {
      return { ...this.stream.gameEnvironment(), XDG_CONFIG_HOME: path.join(this.profile, 'config'), XDG_DATA_HOME: path.join(this.profile, 'data') };
    },
    async prepare(ownerId) {
      if (!/^[a-f0-9]{64}$/.test(ownerId)) throw new Error('Invalid device profile identifier');
      const profile = path.resolve(backendRoot, '../.runtime/players', ownerId);
      this.profile = profile;
      for (const name of ['xonotic', 'supertux', 'openttd', 'config', 'data']) await mkdir(path.join(profile, name), { recursive: true, mode: 0o700 });
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
