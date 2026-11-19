-- Old interrupted sessions cannot be assigned to a device retroactively.
UPDATE "Session" SET "status" = 'FAILED', "endedAt" = CURRENT_TIMESTAMP
  WHERE "status" IN ('STARTING', 'READY', 'ACTIVE');
DROP INDEX "Session_one_live";
ALTER TABLE "Session" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Session" ADD COLUMN "slot" INTEGER;
CREATE UNIQUE INDEX "Session_slot_live" ON "Session" ("slot")
  WHERE "status" IN ('STARTING', 'READY', 'ACTIVE');
CREATE UNIQUE INDEX "Session_owner_live" ON "Session" ("ownerId")
  WHERE "status" IN ('STARTING', 'READY', 'ACTIVE');
CREATE UNIQUE INDEX "Session_game_live" ON "Session" ("gameId")
  WHERE "status" IN ('STARTING', 'READY', 'ACTIVE');
CREATE INDEX "Session_owner_history" ON "Session" ("ownerId", "id");
CREATE TRIGGER "Session_live_insert" BEFORE INSERT ON "Session"
  WHEN NEW."status" IN ('STARTING', 'READY', 'ACTIVE') AND
       (NEW."ownerId" IS NULL OR NEW."ownerId" = '' OR NEW."slot" IS NULL OR NEW."slot" < 0 OR NEW."slot" > 3)
  BEGIN SELECT RAISE(ABORT, 'Live session requires a device and a valid slot'); END;
CREATE TRIGGER "Session_live_update" BEFORE UPDATE ON "Session"
  WHEN NEW."status" IN ('STARTING', 'READY', 'ACTIVE') AND
       (NEW."ownerId" IS NULL OR NEW."ownerId" = '' OR NEW."slot" IS NULL OR NEW."slot" < 0 OR NEW."slot" > 3)
  BEGIN SELECT RAISE(ABORT, 'Live session requires a device and a valid slot'); END;
