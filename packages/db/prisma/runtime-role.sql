-- Apply as the database owner/migration role, after creating senuke_runtime.
-- Runtime applications must never execute this administrative script.
-- Provisioning and credential rotation are separate from these repeatable grants.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO senuke_runtime;
GRANT USAGE ON SCHEMA public TO senuke_runtime;

DO $runtime_grants$
DECLARE relation record;
BEGIN
  FOR relation IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO senuke_runtime', relation.tablename);
  END LOOP;
END
$runtime_grants$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO senuke_runtime;
-- Default grants apply only to objects subsequently created by senukeadmin.
-- Repeat these for a new migration owner if ownership changes later.
ALTER DEFAULT PRIVILEGES FOR ROLE senukeadmin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO senuke_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE senukeadmin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO senuke_runtime;
-- If Prisma migration history is introduced later, explicitly revoke its
-- runtime grants after creating it; it is administrative metadata.
