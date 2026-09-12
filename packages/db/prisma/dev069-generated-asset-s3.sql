CREATE TABLE IF NOT EXISTS "GeneratedAsset" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "projectId" TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
  "bucket" VARCHAR(255) NOT NULL,
  "objectKey" VARCHAR(1024) NOT NULL,
  "versionId" VARCHAR(255),
  "etag" VARCHAR(255),
  "assetType" VARCHAR(80) NOT NULL,
  "mimeType" VARCHAR(160) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" VARCHAR(64) NOT NULL,
  "visibility" VARCHAR(40) NOT NULL DEFAULT 'private',
  "source" VARCHAR(80) NOT NULL,
  "originalFilename" VARCHAR(255),
  "altText" VARCHAR(500),
  "sourceEntityType" VARCHAR(80),
  "sourceEntityId" VARCHAR(191),
  "dedupeKey" VARCHAR(191),
  "status" VARCHAR(40) NOT NULL DEFAULT 'available',
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdByUserId" VARCHAR(191),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "GeneratedAsset_bucket_objectKey_key" ON "GeneratedAsset"("bucket", "objectKey");
CREATE UNIQUE INDEX IF NOT EXISTS "GeneratedAsset_dedupeKey_key" ON "GeneratedAsset"("dedupeKey");
CREATE INDEX IF NOT EXISTS "GeneratedAsset_workspaceId_createdAt_idx" ON "GeneratedAsset"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "GeneratedAsset_projectId_assetType_createdAt_idx" ON "GeneratedAsset"("projectId", "assetType", "createdAt");
CREATE INDEX IF NOT EXISTS "GeneratedAsset_sourceEntityType_sourceEntityId_idx" ON "GeneratedAsset"("sourceEntityType", "sourceEntityId");
CREATE INDEX IF NOT EXISTS "GeneratedAsset_checksumSha256_idx" ON "GeneratedAsset"("checksumSha256");

ALTER TABLE "DiscoveryIdeaExport" ADD COLUMN IF NOT EXISTS "storageAssetId" TEXT;
CREATE INDEX IF NOT EXISTS "DiscoveryIdeaExport_storageAssetId_idx" ON "DiscoveryIdeaExport"("storageAssetId");
DO $$ BEGIN
  ALTER TABLE "DiscoveryIdeaExport" ADD CONSTRAINT "DiscoveryIdeaExport_storageAssetId_fkey" FOREIGN KEY ("storageAssetId") REFERENCES "GeneratedAsset"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
