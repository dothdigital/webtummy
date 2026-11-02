CREATE TABLE IF NOT EXISTS "DiscoveryDraft" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agencyClientId" TEXT,
  "createdByUserId" VARCHAR(191) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "startPath" VARCHAR(40) NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  "sourceText" TEXT,
  "answersJson" JSONB NOT NULL DEFAULT '{}',
  "factsJson" JSONB NOT NULL DEFAULT '[]',
  "questionHistoryJson" JSONB NOT NULL DEFAULT '[]',
  "aiSummaryJson" JSONB NOT NULL DEFAULT '{}',
  "selectedDirectionJson" JSONB NOT NULL DEFAULT '{}',
  "nextBestActionJson" JSONB NOT NULL DEFAULT '{}',
  "aiConversationSessionId" VARCHAR(191),
  "convertedProjectId" TEXT,
  "convertedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoveryDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DiscoveryIdea" (
  "id" TEXT NOT NULL,
  "discoveryDraftId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT NOT NULL,
  "whyFit" TEXT NOT NULL,
  "targetAudience" TEXT,
  "problemSolved" TEXT,
  "revenueModel" VARCHAR(180),
  "businessModel" VARCHAR(120),
  "evidenceJson" JSONB NOT NULL DEFAULT '[]',
  "validationSteps" JSONB NOT NULL DEFAULT '[]',
  "difficulty" VARCHAR(40),
  "timeCostBand" VARCHAR(180),
  "majorRisk" TEXT,
  "confidence" INTEGER,
  "detailsJson" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(40) NOT NULL DEFAULT 'GENERATED',
  "userFeedback" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoveryIdea_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DiscoveryIdea" ADD COLUMN IF NOT EXISTS "detailsJson" JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveryDraft_convertedProjectId_key" ON "DiscoveryDraft"("convertedProjectId");
CREATE INDEX IF NOT EXISTS "DiscoveryDraft_workspaceId_status_updatedAt_idx" ON "DiscoveryDraft"("workspaceId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "DiscoveryDraft_agencyClientId_status_updatedAt_idx" ON "DiscoveryDraft"("agencyClientId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "DiscoveryDraft_createdByUserId_updatedAt_idx" ON "DiscoveryDraft"("createdByUserId", "updatedAt");
CREATE INDEX IF NOT EXISTS "DiscoveryIdea_discoveryDraftId_status_position_idx" ON "DiscoveryIdea"("discoveryDraftId", "status", "position");

DO $$ BEGIN
  ALTER TABLE "DiscoveryDraft" ADD CONSTRAINT "DiscoveryDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DiscoveryDraft" ADD CONSTRAINT "DiscoveryDraft_agencyClientId_fkey" FOREIGN KEY ("agencyClientId") REFERENCES "AgencyClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DiscoveryDraft" ADD CONSTRAINT "DiscoveryDraft_convertedProjectId_fkey" FOREIGN KEY ("convertedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DiscoveryIdea" ADD CONSTRAINT "DiscoveryIdea_discoveryDraftId_fkey" FOREIGN KEY ("discoveryDraftId") REFERENCES "DiscoveryDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE "DiscoveryIdea" SET "status" = 'SAVED' WHERE "status" = 'SHORTLISTED';
UPDATE "DiscoveryDraft" SET "status" = 'IDEAS_GENERATED' WHERE "status" = 'SHORTLISTED';
