# Launch readiness audit — 8 September 2026 UTC

**Decision: conditional launch; 500 successful customer activations have not been demonstrated.** Source/dependency drift and wasted server resources were corrected. The bounded security probes did not establish an injection or authentication bypass. This is an authorized source review and controlled live test, not certification that the application has no vulnerabilities.

## Deployment and fixes

- API/web host: `172.31.6.22`, AWS `t3.large`, 2 vCPUs, approximately 7.6 GiB RAM. API and local worker run from `/var/www/senuke` under systemd as `ubuntu`.
- Dedicated worker: `172.31.10.73`, 2 vCPUs, approximately 3.7 GiB RAM. Its deployment is a file copy, not a Git checkout.
- Before synchronization, 198 of 536 application/deployment files differed; 106 were missing on the worker. Copied server source and the exact lockfile to the worker; ran `npm ci` and Prisma generation on both hosts. Replaced worker files were backed up under `/tmp/senuke-before-launch-20260908` on that host.
- Compared 729 installed package manifests per host: **zero name/version/path differences**. Both manifest SHA-256 values: `75cac0b7ccd181a879475b65ef5defcb9b225d413bbc0a64d64d02fbf90cd2dc`. This establishes package-version parity, not a byte-level integrity scan of every dependency file.
- The previously uncommitted application changes were committed and pushed to `origin/dev` as `6bfd70f`. The hardening changes and this report are committed subsequently on `dev`.
- Stopped 34 abandoned one-off diagnostic process groups, aged 4–15 days. Checked process identities and excluded production service cgroups. Available server memory increased from about 2.0 GiB to 5.2 GiB; Redis clients fell from 426 to 58 in the after-cleanup snapshot. Summed process RSS is not equivalent to uniquely allocated physical memory.
- Added activation inspection/completion rate limits and bounded activation-token input size. Completion previously allowed repeated password guesses against an eligible activation token without its own limiter. New regression tests exercise invalid token types/size and enforcement when Redis is unavailable.
- Added `API_HOST`. Installed `deploy/senuke-api-network.conf` at `/etc/systemd/system/senuke-api.service.d/network.conf` and reloaded systemd. API now binds to **127.0.0.1:4000**, routing public API access through the HTTPS reverse proxy. A connection attempt from the dedicated worker to the API host's private-address port 4000 did not succeed.
- Restarted local API/worker and remote worker after installation. All reported active/running with zero automatic restarts at verification. Published the validated frontend build.

## Validation

- Initial full suite: 158 files, 1,116 tests passed.
- Clean release with hardening: **159 files, 1,118 tests passed**; Prisma client generation and frontend production build passed.
- Activation security tests passed again against the installed server dependencies.
- Root `npm run typecheck` **fails** because `/var/www/senuke/tsconfig.json` is missing. Test/build success does not establish a clean TypeScript check.
- No private-key or AWS access-key-ID patterns found in the staged source scan. This is a limited pattern scan, not proof that all secrets or historical commits are clean.

### Controlled live security probes

Target: `https://app.senuke.com`. No real accounts, purchases, password resets, outgoing test emails, or destructive payloads were created. Tests were repeated after deployment.

| Probe | Observed result |
| --- | --- |
| Anonymous users, clients, projects, billing and builder routes | 401 |
| Unsigned JWT declaring a super-admin role | 401 |
| Forged workspace/client headers without authentication | 401 |
| Untrusted Origin, cross-site request, CORS preflight | 403 |
| SQL-style email, object/NoSQL email, HTML payload in login | 400 |
| Invalid activation token and password-reset token | 400 |
| Forged JVZoo payment notification | 400 |
| Public self-registration | 403; intentionally disabled |
| Repeated invalid login attempts | Eventually 429 with Retry-After |
| `.env`, `.git/config`, database-dump path, traversal-like path | SPA HTML fallback; no sensitive contents found |

Public route checks do not prove authenticated cross-tenant isolation. Existing authorization/SSRF tests passed with the suite, but no live two-account IDOR test, browser-based stored-XSS exploit test, comprehensive SSRF/egress test, or exhaustive endpoint fuzzing was performed. SQL-related source searches found Prisma parameterized/tagged queries in reviewed paths; rejected login payloads alone do not prove all query paths safe.

### Capacity evidence and its limits

After deployment, 500 GET requests to `/api/auth/config` at concurrency 20 all returned 200 in 1.39 seconds: p50 53 ms, p95 83 ms, p99 133 ms. A preceding 100-request run at concurrency 5 also passed. Requests originated on the API host and used the public HTTPS hostname. This is a short proxy/API/database-read test, not 500 concurrent sessions or successful registrations, and it excludes external-user network latency.

A separate bounded bcryptjs cost-12 benchmark completed 20 hashes at concurrency 2 in 11.20 seconds; p50 hash latency 1,099 ms, p95 1,240 ms, event-loop p99 delay 205 ms. This synthetic measurement indicates password work can become a CPU/event-loop bottleneck. It does not predict complete activation throughput because database writes, entitlement provisioning, mail delivery and other traffic were excluded.

**Registration actually means JVZoo purchase → verified notification → queued purchase processing → activation email → account activation.** Public self-signup is disabled in code. JVZoo notification processing runs in the API with concurrency 5. Crawls run at concurrency 2 per worker process; other queue consumers have their own limits. Multiple heavy jobs per new customer cannot be treated as equivalent to a registration request. Large bursts require a representative end-to-end test.

## Database and queue findings

- PostgreSQL 18.3 on RDS; database size approximately 94 MB. Observed application connection negotiated TLS 1.3. `max_connections=829`; roughly 25 total database sessions in the initial snapshot, no blocked sessions or idle transactions. This is current headroom, not a peak-capacity guarantee.
- Newly required `WebsiteRecaptchaCredential` table exists. Prisma clients regenerated from synchronized schema. No production schema migration or database content modification was performed by the audit.
- Application database role is `senukeadmin`, with `CREATEDB` and `CREATEROLE`. It is not a PostgreSQL superuser, but has more privileges than a runtime account needs.
- Redis 7.2.4 uses TLS (`rediss:`). Roughly 22 MB used against a ~1.1 GB memory limit; no evictions or rejected connections in the inspected snapshot. URL has no password. ACL/IAM authentication and network boundaries were not fully verified.
- Redis `maxmemory-policy=volatile-lru`; BullMQ logs explicitly warn that it should be **noeviction**. Correct this using the ElastiCache parameter group before relying on queue durability under pressure.
- No waiting or active crawl, website-builder, or JVZoo jobs in the after-cleanup snapshot. Retained historical failures: website-builder 3, growth-intelligence 13, social-images 1. Causes and customer impact require review; these are not proof of current failures. No failed jobs were blindly replayed.
- Database `statement_timeout=0`, and idle-in-transaction timeout is 24 hours. Review bounded runtime query/transaction timeouts with long-running workload requirements.

## Outstanding launch gates

1. **Verify recoverability:** RDS backup retention, latest restorable time, restore procedure, encryption at rest, Multi-AZ/failover and storage alarms. A backup/restore test was not performed.
2. **Verify cloud controls:** security groups, worker SSH exposure, RDS/Redis private access and EC2 CPU credits. Local UFW is inactive; AWS network policy is therefore material. API loopback binding now removes the direct port-4000 path on this host.
3. **Verify SES delivery capacity:** production/sandbox status, daily/rate quotas, bounce handling, activation-email delivery and alerting. No test email was sent. 500 purchases can require more than 500 messages.
4. **Correct Redis eviction policy**, establish queue/backlog alerts and review retained failed jobs.
5. **Patch dependencies in a separately validated release.** Final clean install audit: production dependency tree has 26 affected package entries (24 moderate, 2 low; no high/critical). Full tree has 27 (one additional high build-tool finding). These counts include transitive propagation, not 27 independent exploitable bugs. Compatible update attempts were not deployed because they did not produce a complete dependency tree; both hosts retain the same validated baseline.
6. **Use a least-privilege database runtime role**, separate from the migration/admin role. Plan grants and rollback before switching live credentials.
7. **Run a full activation/first-job test and representative sustained load in an isolated environment**, including notification retry/replay, token reuse rejection, two-account tenant isolation and email/provider quotas. Rate limits are per IP and identity; shared-NAT users can reach limits even when they are distinct customers.
8. **Repair the root typecheck configuration** and obtain a meaningful passing check.

The available instance role denied `ec2:DescribeInstances`, `ec2:DescribeSecurityGroups`, `rds:DescribeDBInstances`, `elasticache:DescribeCacheClusters` and `ses:GetAccount`. Those denials explain the infrastructure verification gaps; configuration was not inferred to be safe from an absence of access.

Dependency advisories reviewed: [Tiptap prototype/DOM attribute injection](https://github.com/advisories/GHSA-cp6q-959q-f8rh), [qs denial of service](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g). The full-tree high finding concerns Browserslist build tooling; audit metadata was captured locally.

**Recommendation:** resolve the launch gates, then release gradually with CPU, memory, queue age, activation failures and mail delivery monitored. Current evidence supports healthy basic service operation after synchronization; it does not support an unconditional promise of 500+ successful registrations or complete security.
