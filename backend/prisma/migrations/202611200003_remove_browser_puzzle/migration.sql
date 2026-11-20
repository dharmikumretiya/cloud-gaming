-- Retire the discarded browser puzzle without touching native game history.
DROP TABLE "GameSave";
UPDATE "Game" SET "enabled" = false WHERE "launchId" = '2048';
DELETE FROM "Game" WHERE "launchId" = '2048' AND NOT EXISTS (
  SELECT 1 FROM "Session" WHERE "Session"."gameId" = "Game"."id"
);
