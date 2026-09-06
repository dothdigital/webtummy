ALTER TABLE "ProjectKeywordGroup"
ADD COLUMN IF NOT EXISTS "approvalVersion" INTEGER NOT NULL DEFAULT 0;

UPDATE "ProjectKeywordGroup"
SET "approvalVersion" = 1
WHERE "status" = 'approved' AND "approvalVersion" = 0;
