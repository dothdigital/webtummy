CREATE TABLE IF NOT EXISTS "WebsiteTrackingSite" (
  "id" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "allowedHost" VARCHAR(255) NOT NULL,
  "installation" VARCHAR(40) NOT NULL DEFAULT 'pending',
  "lastEventAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteTrackingSite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebsiteTrackingSite_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebsiteTrackingSite_websiteId_key" ON "WebsiteTrackingSite"("websiteId");
CREATE INDEX IF NOT EXISTS "WebsiteTrackingSite_clientId_enabled_idx" ON "WebsiteTrackingSite"("clientId", "enabled");
CREATE INDEX IF NOT EXISTS "WebsiteTrackingSite_lastEventAt_idx" ON "WebsiteTrackingSite"("lastEventAt");

CREATE TABLE IF NOT EXISTS "WebsiteTrackingEvent" (
  "id" TEXT NOT NULL,
  "trackingSiteId" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "projectId" VARCHAR(191),
  "eventName" VARCHAR(60) NOT NULL,
  "path" VARCHAR(1024) NOT NULL,
  "referrer" VARCHAR(1024),
  "sessionId" VARCHAR(120),
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteTrackingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebsiteTrackingEvent_trackingSiteId_fkey" FOREIGN KEY ("trackingSiteId") REFERENCES "WebsiteTrackingSite"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WebsiteTrackingEvent_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WebsiteTrackingEvent_websiteId_occurredAt_idx" ON "WebsiteTrackingEvent"("websiteId", "occurredAt");
CREATE INDEX IF NOT EXISTS "WebsiteTrackingEvent_websiteId_eventName_occurredAt_idx" ON "WebsiteTrackingEvent"("websiteId", "eventName", "occurredAt");
CREATE INDEX IF NOT EXISTS "WebsiteTrackingEvent_trackingSiteId_receivedAt_idx" ON "WebsiteTrackingEvent"("trackingSiteId", "receivedAt");
CREATE INDEX IF NOT EXISTS "WebsiteTrackingEvent_projectId_occurredAt_idx" ON "WebsiteTrackingEvent"("projectId", "occurredAt");

INSERT INTO "WebsiteTrackingSite" ("id", "websiteId", "clientId", "allowedHost", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, website."id", website."clientId", regexp_replace(lower(website."domain"), '^www\.', ''), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Website" website
WHERE NOT EXISTS (SELECT 1 FROM "WebsiteTrackingSite" site WHERE site."websiteId" = website."id");

INSERT INTO "WebsiteMeasurementPlan" (
  "id", "websiteId", "clientId", "version", "active", "status", "businessGoal", "primaryConversion", "primaryMeasurement",
  "supportingActionsJson", "guardrailsJson", "pagesAndFormsJson", "dataSourcesJson", "baselineRule", "evaluationWindowDays",
  "consentRequirementsJson", "installationMethod", "installationJson", "trackingState", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, website."id", website."clientId", 1, true, 'auto_configured', 'leads', 'form_success', 'Qualified form completions',
  '["page_view","cta_click","form_start","form_submit","form_success","form_error","phone_click"]'::jsonb,
  '["Form error rate","Website availability"]'::jsonb,
  jsonb_build_array(website."rootUrl"),
  jsonb_build_array(
    jsonb_build_object('key','search_console','status','not_connected','required',false,'identifier',null),
    jsonb_build_object('key','ga4','status','not_connected','required',false,'identifier',null),
    jsonb_build_object('key','senuke_tag','status','not_connected','required',true,'identifier',null),
    jsonb_build_object('key','forms_booking','status','not_connected','required',true,'identifier',null),
    jsonb_build_object('key','call_tracking','status','not_connected','required',false,'identifier',null),
    jsonb_build_object('key','crm','status','not_connected','required',false,'identifier',null),
    jsonb_build_object('key','stripe_ecommerce','status','not_connected','required',false,'identifier',null),
    jsonb_build_object('key','behavior_provider','status','not_connected','required',false,'identifier',null),
    jsonb_build_object('key','site_monitoring','status','not_connected','required',true,'identifier',null)
  ),
  'new_site_initial_baseline', 28, '["analytics_consent"]'::jsonb, 'manual_platform',
  jsonb_build_object('measurementTagEnabled',true,'excludeStaging',true,'consentModeEnabled',true,'trackingSiteId',site."id",'capturedAutomatically',true),
  'CONNECTION_REQUIRED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Website" website
JOIN "WebsiteTrackingSite" site ON site."websiteId" = website."id"
WHERE NOT EXISTS (SELECT 1 FROM "WebsiteMeasurementPlan" plan WHERE plan."websiteId" = website."id");
