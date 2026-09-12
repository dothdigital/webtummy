CREATE TABLE IF NOT EXISTS "DiscoveryIdeaExport" (
  "id" TEXT NOT NULL,
  "ideaId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agencyClientId" TEXT,
  "exportMode" VARCHAR(40) NOT NULL DEFAULT 'standard',
  "version" INTEGER NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'rendering',
  "filename" VARCHAR(255) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "snapshotJson" JSONB NOT NULL DEFAULT '{}',
  "pdfBytes" BYTEA,
  "byteLength" INTEGER,
  "sha256" VARCHAR(64),
  "generatedByUserId" VARCHAR(191),
  "generatedAt" TIMESTAMP(3),
  "lastDownloadedAt" TIMESTAMP(3),
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscoveryIdeaExport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscoveryIdeaExport_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "DiscoveryIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DiscoveryIdeaExport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveryIdeaExport_ideaId_exportMode_version_key" ON "DiscoveryIdeaExport"("ideaId", "exportMode", "version");
CREATE INDEX IF NOT EXISTS "DiscoveryIdeaExport_workspaceId_createdAt_idx" ON "DiscoveryIdeaExport"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "DiscoveryIdeaExport_ideaId_exportMode_sourceUpdatedAt_status_idx" ON "DiscoveryIdeaExport"("ideaId", "exportMode", "sourceUpdatedAt", "status");
CREATE INDEX IF NOT EXISTS "DiscoveryIdeaExport_agencyClientId_createdAt_idx" ON "DiscoveryIdeaExport"("agencyClientId", "createdAt");
