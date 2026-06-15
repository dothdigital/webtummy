# Webtummy

SEO + AI Search website crawler & audit platform for **Dot H Digital**. Crawls client
websites, audits page-level SEO + AI-search signals, scores them, and (later) produces
client-ready reports. Multi-tenant: a super-admin provisions clients; each client manages
its own websites and crawls.

> Screaming-Frog-class auditing delivered as a hosted, multi-client SaaS with scheduled
> crawls, client reports, and an AI-search-readiness layer SF doesn't have.

## Docs
- [`docs/SCOPE.md`](docs/SCOPE.md) — product scope (revised), phases, acceptance criteria
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, RBAC, DB schema, infra budget
- [`docs/FEATURE_MAP.md`](docs/FEATURE_MAP.md) — every Screaming Frog feature mapped to a phase
- [`docs/AI_SEARCH_READINESS.md`](docs/AI_SEARCH_READINESS.md) — the AI-readiness checks (our moat)

## Stack
TypeScript monorepo (npm workspaces). React (Vite) SPA · Express API · BullMQ workers ·
MySQL (Prisma) · Redis · undici + Cheerio (Playwright render pool in Phase 2).

```
packages/db     @webtummy/db    Prisma schema + client
packages/core   @webtummy/core  url norm, robots, sitemap, parse, issues, scoring (pure, tested)
apps/api        @webtummy/api    REST API + JWT auth + RBAC
apps/worker     @webtummy/worker BullMQ crawler runner
apps/web        @webtummy/web    React dashboard            [Phase 3 — not built yet]
```

## Prerequisites (local)
- Node 22+
- MySQL running on :3306 (db `crawller`)
- Redis on :6379 → `redis-server --daemonize yes`

## Setup
```bash
npm install
cp .env.example .env          # adjust DATABASE_URL / JWT_SECRET if needed
npm run db:generate           # generate Prisma client
npm run db:push               # create tables in MySQL
npm run -w @webtummy/api seed # create first super_admin (admin@webtummy.com / ChangeMe!2026)
```

## Run (two terminals)
```bash
npm run dev:api     # http://localhost:4000
npm run dev:worker  # consumes crawl jobs
```

## Quick test
```bash
# login
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@webtummy.com","password":"ChangeMe!2026"}' | jq -r .token)

# create client (+ first client_admin)
curl -s -X POST localhost:4000/api/clients -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme","adminEmail":"acme@x.com","adminPassword":"password123"}'

# add a website, then start a crawl
curl -s -X POST localhost:4000/api/websites/<WEBSITE_ID>/crawls \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"pageLimit":50,"maxDepth":3}'

# poll + read results
curl localhost:4000/api/crawls/<CRAWL_ID>/status   -H "Authorization: Bearer $TOKEN"
curl localhost:4000/api/crawls/<CRAWL_ID>/summary  -H "Authorization: Bearer $TOKEN"
curl localhost:4000/api/crawls/<CRAWL_ID>/issues   -H "Authorization: Bearer $TOKEN"
```

## Tests
```bash
npm test   # unit tests (url normalization, etc.)
```

## Status — Phase 1 (core crawler) ✅ working
Implemented: auth + RBAC (super_admin / client_admin / client_user), tenant isolation,
client/website provisioning, robots.txt + sitemap discovery, BFS crawl with limits +
include/exclude regex, status/redirect capture, title/meta/H1/H2/canonical/robots-meta
extraction, image-alt + OG detection, inlink counts + orphan detection, broken-link
resolution, per-page + site scoring, results API.

Next: Phase 2 (near-dup simhash, schema validation, JS rendering, hreflang) and Phase 3
(React dashboard + PDF/DOCX reports). See [`docs/FEATURE_MAP.md`](docs/FEATURE_MAP.md).
