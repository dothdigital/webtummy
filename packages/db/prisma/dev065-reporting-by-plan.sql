-- DEV-065 Reporting by Plan
-- Additive and safe to run more than once on PostgreSQL.

ALTER TABLE "GapReportExport"
  ADD COLUMN IF NOT EXISTS "scheduleKey" VARCHAR(191),
  ADD COLUMN IF NOT EXISTS "generatedBy" VARCHAR(40) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "customerCapacityUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "shareTokenHash" VARCHAR(191),
  ADD COLUMN IF NOT EXISTS "shareExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shareRevokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shareCreatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "GapReportExport_scheduleKey_key"
  ON "GapReportExport"("scheduleKey");

CREATE UNIQUE INDEX IF NOT EXISTS "GapReportExport_shareTokenHash_key"
  ON "GapReportExport"("shareTokenHash");

CREATE INDEX IF NOT EXISTS "GapReportExport_shareExpiresAt_idx"
  ON "GapReportExport"("shareExpiresAt");
