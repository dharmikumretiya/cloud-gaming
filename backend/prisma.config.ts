import 'dotenv/config';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
config({ path: '../.env', quiet: true });
const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
if (!databaseUrl.startsWith('file:') || databaseUrl.includes('?')) throw new Error('Use a local SQLite file DATABASE_URL');
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'node prisma/seed.js' },
  datasource: { url: `file:${path.resolve(path.dirname(fileURLToPath(import.meta.url)), databaseUrl.slice(5))}` },
});
