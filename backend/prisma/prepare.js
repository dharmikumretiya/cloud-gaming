import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { databasePath } from '../src/database.js';

// Prisma migrate deploy needs an existing SQLite file on this host.
// Append mode creates a missing file without truncating an existing database.
const filename = databasePath();
await mkdir(path.dirname(filename), { recursive: true });
await (await open(filename, 'a')).close();
