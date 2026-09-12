CREATE TABLE IF NOT EXISTS "WebsiteMeasurementPlan" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "projectId" VARCHAR(191),
  "version" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
  "businessGoal" VARCHAR(120) NOT NULL,
  "primaryConversion" VARCHAR(120) NOT NULL,
  "primaryMeasurement" VARCHAR(160) NOT NULL,
  "supportingActionsJson" JSONB NOT NULL DEFAULT '[]',
  "guardrailsJson" JSONB NOT NULL DEFAULT '[]',
  "pagesAndFormsJson" JSONB NOT NULL DEFAULT '[]',
  "dataSourcesJson" JSONB NOT NULL DEFAULT '[]',
  "baselineRule" VARCHAR(80) NOT NULL DEFAULT 'new_site_initial_baseline',
  "evaluationWindowDays" INTEGER NOT NULL DEFAULT 28,
  "consentRequirementsJson" JSONB NOT NULL DEFAULT '[]',
  "installationMethod" VARCHAR(60) NOT NULL DEFAULT 'manual',
  "installationJson" JSONB NOT NULL DEFAULT '{}',
  "trackingState" VARCHAR(60) NOT NULL DEFAULT 'CONNECTION_REQUIRED',
  "lastVerifiedAt" TIMESTAMP(3),
  "createdByUserId" VARCHAR(191),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteMeasurementPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebsiteMeasurementPlan_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebsiteMeasurementPlan_websiteId_version_key" ON "WebsiteMeasurementPlan"("websiteId", "version");
CREATE INDEX IF NOT EXISTS "WebsiteMeasurementPlan_websiteId_active_idx" ON "WebsiteMeasurementPlan"("websiteId", "active");
CREATE INDEX IF NOT EXISTS "WebsiteMeasurementPlan_clientId_trackingState_idx" ON "WebsiteMeasurementPlan"("clientId", "trackingState");
CREATE INDEX IF NOT EXISTS "WebsiteMeasurementPlan_projectId_idx" ON "WebsiteMeasurementPlan"("projectId");
