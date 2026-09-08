CREATE TABLE IF NOT EXISTS "WebsiteRecaptchaCredential" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "siteKey" VARCHAR(255) NOT NULL,
 "hostname" VARCHAR(255) NOT NULL,
 "secretCiphertext" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WebsiteRecaptchaCredential_projectId_createdAt_idx" ON "WebsiteRecaptchaCredential"("projectId", "createdAt");
