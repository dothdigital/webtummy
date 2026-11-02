CREATE TABLE IF NOT EXISTS "Dev053VerificationRun" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "initiatedByUserId" VARCHAR(191),
  "status" VARCHAR(40) NOT NULL DEFAULT 'running',
  "summaryJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Dev053VerificationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Dev053CapabilityResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "capabilityId" VARCHAR(20) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "message" TEXT NOT NULL,
  "workflowDestination" VARCHAR(1000) NOT NULL,
  "evidenceJson" JSONB NOT NULL DEFAULT '{}',
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Dev053CapabilityResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Dev053VerificationRun_projectId_createdAt_idx" ON "Dev053VerificationRun"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "Dev053VerificationRun_status_createdAt_idx" ON "Dev053VerificationRun"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Dev053CapabilityResult_runId_capabilityId_key" ON "Dev053CapabilityResult"("runId", "capabilityId");
CREATE INDEX IF NOT EXISTS "Dev053CapabilityResult_capabilityId_status_idx" ON "Dev053CapabilityResult"("capabilityId", "status");

DO $$ BEGIN
  ALTER TABLE "Dev053VerificationRun" ADD CONSTRAINT "Dev053VerificationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Dev053CapabilityResult" ADD CONSTRAINT "Dev053CapabilityResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Dev053VerificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
