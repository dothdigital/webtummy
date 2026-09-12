-- DEV-051 Google Business Profile Limited V1
-- Additive migration: expiring provider snapshots plus durable drafts/actions.

CREATE TABLE IF NOT EXISTS "GoogleBusinessProfileConnection" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'not_connected',
  "oauthStateHash" VARCHAR(128),
  "oauthStateExpiresAt" TIMESTAMP(3),
  "pkceVerifierCiphertext" TEXT,
  "accessTokenCiphertext" TEXT,
  "refreshTokenCiphertext" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "grantedScopesJson" JSONB NOT NULL DEFAULT '[]',
  "googleAccountName" VARCHAR(191),
  "googleAccountLabel" VARCHAR(255),
  "googleLocationName" VARCHAR(255),
  "googleLocationLabel" VARCHAR(255),
  "googleLocationMetadata" JSONB NOT NULL DEFAULT '{}',
  "capabilitiesJson" JSONB NOT NULL DEFAULT '{}',
  "connectedByUserId" VARCHAR(191),
  "lastCapabilityCheckAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleBusinessProfileConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleBusinessProfileConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LocalBusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleBusinessProfileConnection_businessId_key" ON "GoogleBusinessProfileConnection"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleBusinessProfileConnection_oauthStateHash_key" ON "GoogleBusinessProfileConnection"("oauthStateHash");
CREATE INDEX IF NOT EXISTS "GoogleBusinessProfileConnection_status_updatedAt_idx" ON "GoogleBusinessProfileConnection"("status", "updatedAt");

CREATE TABLE IF NOT EXISTS "GoogleBusinessProfileSnapshot" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "kind" VARCHAR(40) NOT NULL,
  "providerRef" VARCHAR(255),
  "dataJson" JSONB NOT NULL DEFAULT '{}',
  "sourceFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleBusinessProfileSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleBusinessProfileSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleBusinessProfileConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "GoogleBusinessProfileSnapshot_connectionId_kind_sourceFetchedAt_idx" ON "GoogleBusinessProfileSnapshot"("connectionId", "kind", "sourceFetchedAt");
CREATE INDEX IF NOT EXISTS "GoogleBusinessProfileSnapshot_expiresAt_idx" ON "GoogleBusinessProfileSnapshot"("expiresAt");

CREATE TABLE IF NOT EXISTS "GoogleBusinessProfileDraft" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "subjectKey" VARCHAR(191) NOT NULL,
  "contentType" VARCHAR(40) NOT NULL,
  "version" INTEGER NOT NULL,
  "title" VARCHAR(255),
  "body" TEXT NOT NULL,
  "callToActionJson" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
  "sourceContextJson" JSONB NOT NULL DEFAULT '{}',
  "createdByUserId" VARCHAR(191),
  "reviewedByUserId" VARCHAR(191),
  "reviewNote" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleBusinessProfileDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleBusinessProfileDraft_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LocalBusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleBusinessProfileDraft_businessId_subjectKey_version_key" ON "GoogleBusinessProfileDraft"("businessId", "subjectKey", "version");
CREATE INDEX IF NOT EXISTS "GoogleBusinessProfileDraft_businessId_status_updatedAt_idx" ON "GoogleBusinessProfileDraft"("businessId", "status", "updatedAt");

CREATE TABLE IF NOT EXISTS "GoogleBusinessProfileAction" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "draftId" TEXT,
  "actionType" VARCHAR(60) NOT NULL,
  "capabilityKey" VARCHAR(80) NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  "payloadJson" JSONB NOT NULL DEFAULT '{}',
  "providerReceiptJson" JSONB NOT NULL DEFAULT '{}',
  "handoffUrl" VARCHAR(1000),
  "handoffInstructions" TEXT,
  "requestedByUserId" VARCHAR(191),
  "executedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleBusinessProfileAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleBusinessProfileAction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "LocalBusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoogleBusinessProfileAction_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "GoogleBusinessProfileDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "GoogleBusinessProfileAction_businessId_status_createdAt_idx" ON "GoogleBusinessProfileAction"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "GoogleBusinessProfileAction_draftId_idx" ON "GoogleBusinessProfileAction"("draftId");
