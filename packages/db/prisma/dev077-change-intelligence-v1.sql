CREATE TABLE IF NOT EXISTS "ChangeIntelligenceSource" (
  "id" TEXT PRIMARY KEY, "key" VARCHAR(120) NOT NULL UNIQUE, "name" VARCHAR(255) NOT NULL, "sourceType" VARCHAR(40) NOT NULL, "url" VARCHAR(1024) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE, "official" BOOLEAN NOT NULL DEFAULT TRUE, "discoveryOnly" BOOLEAN NOT NULL DEFAULT FALSE, "categoriesJson" JSONB NOT NULL DEFAULT '[]',
  "lastCheckedAt" TIMESTAMP(3), "lastSuccessfulAt" TIMESTAMP(3), "lastContentHash" VARCHAR(64), "consecutiveFailures" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceSource_enabled_lastCheckedAt_idx" ON "ChangeIntelligenceSource"("enabled", "lastCheckedAt");
CREATE TABLE IF NOT EXISTS "ChangeIntelligenceItem" (
  "id" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL REFERENCES "ChangeIntelligenceSource"("id") ON DELETE RESTRICT, "url" VARCHAR(2048) NOT NULL, "canonicalUrl" VARCHAR(2048) NOT NULL,
  "title" VARCHAR(500) NOT NULL, "publishedAt" TIMESTAMP(3), "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "contentHash" VARCHAR(64) NOT NULL,
  "evidenceJson" JSONB NOT NULL DEFAULT '{}', "category" VARCHAR(40) NOT NULL DEFAULT 'other', "summary" TEXT, "whyItMatters" TEXT,
  "affectedCapabilitiesJson" JSONB NOT NULL DEFAULT '[]', "confidence" INTEGER NOT NULL DEFAULT 0, "meaningful" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" VARCHAR(40) NOT NULL DEFAULT 'detected', "reviewNote" TEXT, "reviewedByUserId" VARCHAR(191), "reviewedAt" TIMESTAMP(3), "approvedByUserId" VARCHAR(191),
  "approvedAt" TIMESTAMP(3), "deployedAt" TIMESTAMP(3), "rolledBackAt" TIMESTAMP(3), "classificationModel" VARCHAR(120), "classificationError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("canonicalUrl", "contentHash")
);
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceItem_status_detectedAt_idx" ON "ChangeIntelligenceItem"("status", "detectedAt");
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceItem_sourceId_publishedAt_idx" ON "ChangeIntelligenceItem"("sourceId", "publishedAt");
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceItem_meaningful_status_idx" ON "ChangeIntelligenceItem"("meaningful", "status");
CREATE TABLE IF NOT EXISTS "ChangeIntelligenceConfigurationVersion" (
  "id" TEXT PRIMARY KEY, "itemId" TEXT NOT NULL REFERENCES "ChangeIntelligenceItem"("id") ON DELETE RESTRICT, "targetType" VARCHAR(40) NOT NULL, "targetKey" VARCHAR(191) NOT NULL,
  "version" INTEGER NOT NULL, "status" VARCHAR(40) NOT NULL DEFAULT 'draft', "configurationJson" JSONB NOT NULL, "previousVersionId" VARCHAR(191),
  "createdByUserId" VARCHAR(191) NOT NULL, "approvedByUserId" VARCHAR(191), "approvedAt" TIMESTAMP(3), "deployedByUserId" VARCHAR(191), "deployedAt" TIMESTAMP(3),
  "rolledBackByUserId" VARCHAR(191), "rolledBackAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("targetType", "targetKey", "version")
);
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceConfigurationVersion_targetType_targetKey_status_idx" ON "ChangeIntelligenceConfigurationVersion"("targetType", "targetKey", "status");
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceConfigurationVersion_itemId_createdAt_idx" ON "ChangeIntelligenceConfigurationVersion"("itemId", "createdAt");
CREATE TABLE IF NOT EXISTS "ChangeIntelligenceRevalidation" (
  "id" TEXT PRIMARY KEY, "itemId" VARCHAR(191) NOT NULL, "configurationId" VARCHAR(191) NOT NULL, "projectId" VARCHAR(191) NOT NULL,
  "capabilitiesJson" JSONB NOT NULL DEFAULT '[]', "status" VARCHAR(40) NOT NULL DEFAULT 'pending', "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedAt" TIMESTAMP(3), "resultJson" JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("configurationId", "projectId")
);
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceRevalidation_projectId_status_scheduledAt_idx" ON "ChangeIntelligenceRevalidation"("projectId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "ChangeIntelligenceRevalidation_itemId_status_idx" ON "ChangeIntelligenceRevalidation"("itemId", "status");
