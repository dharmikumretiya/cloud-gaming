// Run inside dbus-run-session so each compositor and PulseAudio daemon has its
// own bus names. Publish only that bus address to the backend for game launches.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
if (!process.env.ORBIT_BUS_FILE || !process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error('Private session bus is missing');
writeFileSync(process.env.ORBIT_BUS_FILE, process.env.DBUS_SESSION_BUS_ADDRESS, { mode: 0o600 });
const child = spawn(process.argv[2], process.argv.slice(3), { stdio: 'inherit', shell: false });
child.once('error', error => { console.error(error.message); process.exit(1); });
child.once('exit', code => process.exit(code ?? 1));
