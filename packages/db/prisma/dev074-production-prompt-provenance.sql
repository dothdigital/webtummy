-- Internal production-prompt provenance. This stores identifiers and audit
-- metadata only; prompt instructions remain server-side in source control.
ALTER TABLE "AiRun"
  ADD COLUMN IF NOT EXISTS "workflowId" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "promptId" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "promptDefinitionHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "provider" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "model" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "validationStatus" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "qualityJson" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "StrategyPlan"
  ADD COLUMN IF NOT EXISTS "sourceAiRunId" VARCHAR(191);

ALTER TABLE "AiContentGeneration"
  ADD COLUMN IF NOT EXISTS "workflowId" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "promptId" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "promptVersion" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "promptDefinitionHash" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "AiRun_workflowId_promptId_promptVersion_idx"
  ON "AiRun"("workflowId", "promptId", "promptVersion");

CREATE INDEX IF NOT EXISTS "StrategyPlan_sourceAiRunId_idx"
  ON "StrategyPlan"("sourceAiRunId");

CREATE INDEX IF NOT EXISTS "AiContentGeneration_workflowId_promptId_promptVersion_idx"
  ON "AiContentGeneration"("workflowId", "promptId", "promptVersion");
