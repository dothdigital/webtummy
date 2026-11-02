-- DEV-060: searchable JVZoo webhook reconciliation fields.
-- Safe to run repeatedly on PostgreSQL 17+.

ALTER TABLE "CommercialBillingEvent"
  ADD COLUMN IF NOT EXISTS "providerProductRef" VARCHAR(191),
  ADD COLUMN IF NOT EXISTS "providerCustomerEmail" VARCHAR(320);

UPDATE "CommercialBillingEvent"
SET
  "providerProductRef" = COALESCE("providerProductRef", NULLIF("normalizedPayload" ->> 'productId', '')),
  "providerCustomerEmail" = COALESCE("providerCustomerEmail", NULLIF(LOWER("normalizedPayload" ->> 'customerEmail'), ''))
WHERE "providerProductRef" IS NULL OR "providerCustomerEmail" IS NULL;

CREATE INDEX IF NOT EXISTS "CommercialBillingEvent_provider_providerProductRef_createdAt_idx"
  ON "CommercialBillingEvent"("provider", "providerProductRef", "createdAt");

CREATE INDEX IF NOT EXISTS "CommercialBillingEvent_provider_providerCustomerEmail_createdAt_idx"
  ON "CommercialBillingEvent"("provider", "providerCustomerEmail", "createdAt");
