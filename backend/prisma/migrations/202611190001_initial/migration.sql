CREATE TABLE "Game" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "launchId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE "Session" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "gameId" INTEGER NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('STARTING', 'READY', 'ACTIVE', 'ENDED', 'FAILED')),
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" DATETIME,
  CONSTRAINT "Session_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Constant-key partial index: SQLite arbitrates competing reservations.
CREATE UNIQUE INDEX "Session_one_live" ON "Session" ((1))
  WHERE "status" IN ('STARTING', 'READY', 'ACTIVE');
