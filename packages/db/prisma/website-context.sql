-- Explicit website existence, domain ownership, build intent, and source/destination URLs.
-- Existing rows remain NULL; ambiguous records require user confirmation.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "websiteContextJson" JSONB;
