import { createDatabase } from '../src/database.js';
import { gameCatalog } from '../src/game-catalog.js';
const db = createDatabase();
try {
  await db.$transaction(async tx => {
    for (const metadata of gameCatalog) {
      const existing = await tx.game.findFirst({ where: { launchId: metadata.launchId } });
      if (existing) await tx.game.update({ where: { id: existing.id }, data: metadata });
      else await tx.game.create({ data: metadata });
    }
  });
  console.log(`Game library seeded: ${gameCatalog.map(game => game.title).join(', ')}`);
} finally { await db.$disconnect(); }
