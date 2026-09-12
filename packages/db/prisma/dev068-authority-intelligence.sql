-- DEV-068: additive authority intelligence persistence and audit safeguards.
ALTER TABLE "AuthorityOpportunity" ADD COLUMN IF NOT EXISTS "dedupeKey" VARCHAR(191);
CREATE UNIQUE INDEX IF NOT EXISTS "AuthorityOpportunity_dedupeKey_key" ON "AuthorityOpportunity"("dedupeKey");

ALTER TABLE "BacklinkProfileSnapshot" ADD COLUMN IF NOT EXISTS "profileType" VARCHAR(40) NOT NULL DEFAULT 'owned';
ALTER TABLE "BacklinkProfileSnapshot" ADD COLUMN IF NOT EXISTS "competitorDomain" VARCHAR(255);
ALTER TABLE "BacklinkProfileSnapshot" ADD COLUMN IF NOT EXISTS "collectionKey" VARCHAR(191);
ALTER TABLE "BacklinkProfileSnapshot" ADD COLUMN IF NOT EXISTS "dataStatus" VARCHAR(40) NOT NULL DEFAULT 'available';
ALTER TABLE "BacklinkProfileSnapshot" ADD COLUMN IF NOT EXISTS "limitationsJson" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "BacklinkProfileSnapshot" ADD COLUMN IF NOT EXISTS "comparisonStartAt" TIMESTAMP(3);
ALTER TABLE "BacklinkProfileSnapshot" ADD COLUMN IF NOT EXISTS "comparisonEndAt" TIMESTAMP(3);
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "totalBacklinks" DROP NOT NULL;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "totalBacklinks" DROP DEFAULT;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "referringDomains" DROP NOT NULL;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "referringDomains" DROP DEFAULT;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "newBacklinks" DROP NOT NULL;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "newBacklinks" DROP DEFAULT;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "lostBacklinks" DROP NOT NULL;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "lostBacklinks" DROP DEFAULT;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "dofollowBacklinks" DROP NOT NULL;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "dofollowBacklinks" DROP DEFAULT;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "nofollowBacklinks" DROP NOT NULL;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "nofollowBacklinks" DROP DEFAULT;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "brokenBacklinks" DROP NOT NULL;
ALTER TABLE "BacklinkProfileSnapshot" ALTER COLUMN "brokenBacklinks" DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS "BacklinkProfileSnapshot_collectionKey_key" ON "BacklinkProfileSnapshot"("collectionKey");
CREATE INDEX IF NOT EXISTS "BacklinkProfileSnapshot_projectId_profileType_capturedAt_idx" ON "BacklinkProfileSnapshot"("projectId", "profileType", "capturedAt");
CREATE INDEX IF NOT EXISTS "BacklinkProfileSnapshot_projectId_competitorDomain_capturedAt_idx" ON "BacklinkProfileSnapshot"("projectId", "competitorDomain", "capturedAt");

ALTER TABLE "EarnedMention" ADD COLUMN IF NOT EXISTS "verificationStatus" VARCHAR(60) NOT NULL DEFAULT 'pending_provider_verification';
ALTER TABLE "EarnedMention" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

ALTER TABLE "OutreachMessage" ADD COLUMN IF NOT EXISTS "currentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OutreachMessage" ADD COLUMN IF NOT EXISTS "approvedVersion" INTEGER;
CREATE TABLE IF NOT EXISTS "OutreachMessageVersion" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "bodyText" TEXT NOT NULL,
  "changeType" VARCHAR(40) NOT NULL DEFAULT 'manual_edit',
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdByUserId" VARCHAR(191),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutreachMessageVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutreachMessageVersion_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutreachMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "OutreachMessageVersion" ADD COLUMN IF NOT EXISTS "metadataJson" JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS "OutreachMessageVersion_messageId_version_key" ON "OutreachMessageVersion"("messageId", "version");
CREATE INDEX IF NOT EXISTS "OutreachMessageVersion_messageId_createdAt_idx" ON "OutreachMessageVersion"("messageId", "createdAt");
INSERT INTO "OutreachMessageVersion" ("id", "messageId", "version", "subject", "bodyText", "changeType", "createdAt")
SELECT 'dev068_' || md5(message."id" || ':1'), message."id", 1, message."subject", message."bodyText", 'existing_draft', message."createdAt"
FROM "OutreachMessage" message
ON CONFLICT ("messageId", "version") DO NOTHING;

ALTER TABLE "ProviderCostEvent" ADD COLUMN IF NOT EXISTS "workspaceId" VARCHAR(191);
ALTER TABLE "ProviderCostEvent" ADD COLUMN IF NOT EXISTS "projectId" VARCHAR(191);
ALTER TABLE "ProviderCostEvent" ADD COLUMN IF NOT EXISTS "websiteId" VARCHAR(191);
ALTER TABLE "ProviderCostEvent" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(191);
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderCostEvent_idempotencyKey_key" ON "ProviderCostEvent"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ProviderCostEvent_workspaceId_createdAt_idx" ON "ProviderCostEvent"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProviderCostEvent_projectId_createdAt_idx" ON "ProviderCostEvent"("projectId", "createdAt");
