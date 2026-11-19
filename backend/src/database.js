import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'node:path';
import { backendRoot } from './config.js';

export function databasePath(url = process.env.DATABASE_URL || 'file:./prisma/dev.db') {
  if (!url.startsWith('file:') || url.includes('?')) throw new Error('Use a local SQLite file DATABASE_URL');
  return path.resolve(backendRoot, url.slice(5));
}
export function createDatabase(url) {
  const adapter = new PrismaBetterSqlite3({ url: `file:${databasePath(url)}` });
  return new PrismaClient({ adapter });
}
