# Separate runtime and administrative database access

Status on 2026-09-08: prepared and transaction-tested; **not applied to live services**.

The API and both worker processes currently connect to RDS database `postgres` as `senukeadmin`. That role owns the 220 application tables, has CREATEDB/CREATEROLE, and belongs to `rds_superuser`. The `public` schema also grants CREATE to PUBLIC. Removing only the two role flags would not remove ownership powers or inherited RDS privileges.

## Proposed change

Create `senuke_runtime` with LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION, NOBYPASSRLS and a 100-connection limit. Give it a newly generated, strong password. Do not grant membership in `senukeadmin`, `rds_superuser`, or another administrative role. Do not transfer object ownership to it.

Apply [runtime-role.sql](../packages/db/prisma/runtime-role.sql) in the same provisioning transaction as role creation. This grants connection/schema usage, SELECT/INSERT/UPDATE/DELETE on application tables and sequence usage. It removes PUBLIC's schema CREATE and database TEMPORARY privileges, which would otherwise also apply to the new account. The current owner retains its administrative abilities. Default privileges grant access to future tables/sequences created by `senukeadmin`; changes to the migration owner require corresponding default grants. Prisma migration history is excluded from current grants and must have runtime privileges revoked if introduced later.

Keep migration/admin credentials in a root-owned file separate from service environment files. Do not place passwords in Git, command-line arguments, logs or this document. `/etc/senuke-rds.env` is the database environment file loaded by the API and local worker and, separately, by the dedicated worker. Preserve its existing URL host, database, TLS options, and any pool parameters when replacing only username/password. Check other service environment files for duplicate administrative credentials before the switch.

## Tested evidence

A NOLOGIN role with the proposed flags and grants was created inside a transaction, exercised using SET LOCAL ROLE, and rolled back. No role, changed grants or synthetic data remained afterward.

- All 220 existing application tables had the required four DML privileges.
- A newly created throwaway table received default DML grants: 221/221 tables covered during the test.
- A synthetic inactive User row could be inserted, read, updated and deleted without committing or sending mail.
- pgvector distance query and the application's advisory-lock pattern succeeded.
- CREATE TABLE, ALTER TABLE, DROP TABLE, TRUNCATE, CREATE ROLE, CREATE SCHEMA and CREATE TEMP TABLE all failed with SQLSTATE 42501.
- Effective schema CREATE, database CREATE and database TEMP privileges were false.
- Superuser, role creation, database creation, replication and RLS bypass flags were false.

This validates effective SQL permissions, not password authentication or full customer workflows. The test connection's session user remained `senukeadmin`; it does not demonstrate that a real runtime login cannot SET ROLE to an administrator. Verify that separately after provisioning, along with absence of administrative role memberships.

## Live switch and rollback

1. Verify no new migration/owner roles or other applications rely on PUBLIC CREATE/TEMP grants. Capture current ACLs and role metadata.
2. Generate/store a new secret privately, create the runtime login, and commit the tested grants atomically. No application credential is changed yet.
3. Open a separate real TLS connection as the runtime login. Repeat DML/vector/lock checks with synthetic writes rolled back. Verify attempted SET ROLE to `senukeadmin` and `rds_superuser` fails. Confirm no object ownership or administrative memberships.
4. Securely preserve the existing connection on each host for migration use and rollback. Atomically replace the runtime database environment on the dedicated worker first, restart when its work is drained, and check for permission errors.
5. Switch/restart the API and local worker. Verify HTTPS health, a database-backed endpoint, worker startup/queue state, and pg_stat_activity showing the new account from both hosts. Check representative account/queue workflows without sending unsolicited emails or creating real purchases.
6. If authentication or permissions fail, restore the original environment file on the affected host and restart the affected services. The administrator role, ownership and original data remain intact. Do not blindly broaden runtime grants to ALL PRIVILEGES.
7. After stability is established, remove runtime-accessible copies of the old credential and document the explicit migration procedure. Rotating the administrator password requires a separate inventory of its consumers.

This change limits damage from SQL injection or a leaked runtime database password. The application still needs data access across its tables; this is not database-enforced tenant isolation. Root-owned credential files do not protect against a compromised host administrator or an application OS user with unrestricted sudo.

References: [PostgreSQL GRANT](https://www.postgresql.org/docs/18/sql-grant.html), [default privileges](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html), [AWS RDS master-account privileges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html).
