-- Additive, read-only Google Search Console integration storage.
CREATE TABLE IF NOT EXISTS "GoogleSearchConsoleConnection" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
 "workspaceId" TEXT NOT NULL, "connectedByUserId" TEXT NOT NULL, "websiteId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'not_connected', "revision" INTEGER NOT NULL DEFAULT 0,
 "propertyUrl" TEXT, "propertiesJson" JSONB NOT NULL DEFAULT '[]',
 "oauthStateHash" TEXT, "oauthStateExpiresAt" TIMESTAMP(3), "pkceVerifierCiphertext" TEXT,
 "accessTokenCiphertext" TEXT, "refreshTokenCiphertext" TEXT, "accessTokenExpiresAt" TIMESTAMP(3),
 "grantedScopesJson" JSONB NOT NULL DEFAULT '[]', "lastSyncedAt" TIMESTAMP(3), "lastSyncAttemptAt" TIMESTAMP(3),
 "syncStatus" TEXT NOT NULL DEFAULT 'idle', "errorMessage" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleSearchConsoleConnection_projectId_key" ON "GoogleSearchConsoleConnection"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleSearchConsoleConnection_oauthStateHash_key" ON "GoogleSearchConsoleConnection"("oauthStateHash");
CREATE INDEX IF NOT EXISTS "GoogleSearchConsoleConnection_status_lastSyncedAt_idx" ON "GoogleSearchConsoleConnection"("status", "lastSyncedAt");
CREATE TABLE IF NOT EXISTS "GoogleSearchConsoleSnapshot" (
 "id" TEXT PRIMARY KEY, "connectionId" TEXT NOT NULL REFERENCES "GoogleSearchConsoleConnection"("id") ON DELETE CASCADE,
 "propertyUrl" TEXT NOT NULL, "startDate" TEXT NOT NULL, "endDate" TEXT NOT NULL,
 "dataJson" JSONB NOT NULL DEFAULT '{}', "sourceFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "GoogleSearchConsoleSnapshot_connectionId_sourceFetchedAt_idx" ON "GoogleSearchConsoleSnapshot"("connectionId", "sourceFetchedAt");
