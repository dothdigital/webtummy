-- JVZoo Complete Processing: durable provider events, pre-account purchases,
-- lifecycle state, and single-use activation tokens.

CREATE TABLE IF NOT EXISTS "ExternalSubscription" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(40) NOT NULL DEFAULT 'jvzoo',
  "providerTransactionId" VARCHAR(191) NOT NULL,
  "providerSubscriptionRef" VARCHAR(191),
  "providerCustomerEmail" VARCHAR(320) NOT NULL,
  "providerCustomerName" VARCHAR(180),
  "providerProductRef" VARCHAR(191) NOT NULL,
  "priceId" TEXT,
  "planVersionId" TEXT,
  "policyVersionId" TEXT,
  "planCode" VARCHAR(40),
  "billingInterval" VARCHAR(20),
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "amountCents" INTEGER,
  "status" VARCHAR(40) NOT NULL DEFAULT 'unclaimed',
  "activationStatus" VARCHAR(40) NOT NULL DEFAULT 'unclaimed',
  "workspaceId" TEXT,
  "userId" TEXT,
  "purchasedAt" TIMESTAMP(3) NOT NULL,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "foundingMember" BOOLEAN NOT NULL DEFAULT false,
  "foundingCampaignCode" VARCHAR(80),
  "protectedPriceId" TEXT,
  "lastEventAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "chargebackAt" TIMESTAMP(3),
  "activationEmailSentAt" TIMESTAMP(3),
  "activationEmailError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalSubscription_provider_providerTransactionId_key"
  ON "ExternalSubscription"("provider", "providerTransactionId");
CREATE INDEX IF NOT EXISTS "ExternalSubscription_provider_providerSubscriptionRef_idx"
  ON "ExternalSubscription"("provider", "providerSubscriptionRef");
CREATE INDEX IF NOT EXISTS "ExternalSubscription_providerCustomerEmail_activationStatus_idx"
  ON "ExternalSubscription"("providerCustomerEmail", "activationStatus");
CREATE INDEX IF NOT EXISTS "ExternalSubscription_workspaceId_status_idx"
  ON "ExternalSubscription"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "ExternalSubscription_status_currentPeriodEnd_idx"
  ON "ExternalSubscription"("status", "currentPeriodEnd");

DO $$ BEGIN
  ALTER TABLE "ExternalSubscription" ADD CONSTRAINT "ExternalSubscription_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ExternalSubscription" ADD CONSTRAINT "ExternalSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ExternalSubscription" ADD CONSTRAINT "ExternalSubscription_priceId_fkey"
    FOREIGN KEY ("priceId") REFERENCES "CommercialPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ExternalSubscription" ADD CONSTRAINT "ExternalSubscription_planVersionId_fkey"
    FOREIGN KEY ("planVersionId") REFERENCES "CommercialPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ExternalSubscription" ADD CONSTRAINT "ExternalSubscription_policyVersionId_fkey"
    FOREIGN KEY ("policyVersionId") REFERENCES "CommercialPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ExternalSubscriptionActivationToken" (
  "id" TEXT NOT NULL,
  "externalSubscriptionId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalSubscriptionActivationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalSubscriptionActivationToken_tokenHash_key"
  ON "ExternalSubscriptionActivationToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "ExternalSubscriptionActivationToken_externalSubscriptionId_expiresAt_idx"
  ON "ExternalSubscriptionActivationToken"("externalSubscriptionId", "expiresAt");

DO $$ BEGIN
  ALTER TABLE "ExternalSubscriptionActivationToken" ADD CONSTRAINT "ExternalSubscriptionActivationToken_externalSubscriptionId_fkey"
    FOREIGN KEY ("externalSubscriptionId") REFERENCES "ExternalSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CommercialBillingEvent" ADD COLUMN IF NOT EXISTS "eventFingerprint" VARCHAR(64);
ALTER TABLE "CommercialBillingEvent" ADD COLUMN IF NOT EXISTS "providerTransactionId" VARCHAR(191);
ALTER TABLE "CommercialBillingEvent" ADD COLUMN IF NOT EXISTS "providerStatus" VARCHAR(80);
ALTER TABLE "CommercialBillingEvent" ADD COLUMN IF NOT EXISTS "externalSubscriptionId" TEXT;

UPDATE "CommercialBillingEvent"
SET "eventFingerprint" = md5("provider" || ':' || "id")
WHERE "eventFingerprint" IS NULL;

DROP INDEX IF EXISTS "CommercialBillingEvent_provider_providerEventId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CommercialBillingEvent_provider_eventFingerprint_key"
  ON "CommercialBillingEvent"("provider", "eventFingerprint");
CREATE INDEX IF NOT EXISTS "CommercialBillingEvent_provider_providerEventId_idx"
  ON "CommercialBillingEvent"("provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "CommercialBillingEvent_externalSubscriptionId_createdAt_idx"
  ON "CommercialBillingEvent"("externalSubscriptionId", "createdAt");

DROP INDEX IF EXISTS "CommercialPrice_provider_providerProductRef_idx";
CREATE INDEX IF NOT EXISTS "CommercialPrice_provider_providerProductRef_status_idx"
  ON "CommercialPrice"("provider", "providerProductRef", "status");

DO $$ BEGIN
  ALTER TABLE "CommercialBillingEvent" ADD CONSTRAINT "CommercialBillingEvent_externalSubscriptionId_fkey"
    FOREIGN KEY ("externalSubscriptionId") REFERENCES "ExternalSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
