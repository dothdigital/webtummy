-- Required by ProjectAgentDocument.embedding for project-scoped semantic search.
CREATE EXTENSION IF NOT EXISTS vector;

-- Prisma creates the table later. Re-running this file after `prisma db push`
-- also installs the index; the guard keeps first-time database init safe.
DO $$
BEGIN
  IF to_regclass('public."ProjectAgentDocument"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "ProjectAgentDocument_embedding_hnsw_idx"
      ON "ProjectAgentDocument"
      USING hnsw ("embedding" vector_cosine_ops);
  END IF;
END
$$;
