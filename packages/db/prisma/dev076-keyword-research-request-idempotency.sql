-- Keep the newest historical row as the canonical result for each exact work
-- fingerprint. Older duplicates remain available as history without owning the
-- request key.
ALTER TABLE "KeywordResearchRun"
ADD COLUMN IF NOT EXISTS "requestKey" VARCHAR(64);

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "requestKey" ORDER BY "createdAt" DESC, "id" DESC) AS row_number
  FROM "KeywordResearchRun"
  WHERE "requestKey" IS NOT NULL
)
UPDATE "KeywordResearchRun" AS run
SET "requestKey" = NULL
FROM ranked
WHERE run."id" = ranked."id" AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "KeywordResearchRun_requestKey_key"
ON "KeywordResearchRun"("requestKey");
