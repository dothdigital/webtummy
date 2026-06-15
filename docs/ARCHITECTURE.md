# Webtummy — Architecture

Technical design for **Webtummy**, the SEO + AI Search crawler & audit platform.
Pairs with [`SCOPE.md`](./SCOPE.md).

---

## 1. System overview

```
                ┌─────────────┐
                │  React SPA  │  (Vite + TS)
                │  dashboard  │
                └──────┬──────┘
                       │ REST/JSON
                ┌──────▼───────┐
                │   API server │  (Express + TS)
                │  - clients   │
                │  - websites  │
                │  - crawls    │      enqueue
                │  - reports   ├──────────────┐
                └──────┬───────┘              │
                       │ Prisma               ▼
                ┌──────▼───────┐      ┌────────────────┐
                │  PostgreSQL  │◄─────┤  Redis (BullMQ)│
                │              │      └───────┬────────┘
                │  crawl data  │              │ consume
                └──────▲───────┘              │
                       │ Prisma    ┌──────────▼───────────┐
                       └───────────┤   Crawler workers     │
                                   │                       │
                                   │  ┌─────────────────┐  │
                                   │  │  Fetch pool     │  │ undici + Cheerio
                                   │  │  (high conc.)   │  │
                                   │  └────────┬────────┘  │
                                   │           │ if JS-dep │
                                   │  ┌────────▼────────┐  │
                                   │  │  Render pool    │  │ Playwright (capped 2-4)
                                   │  └─────────────────┘  │
                                   └───────────┬───────────┘
                                               │
                                        ┌──────▼──────┐
                                        │ S3 / MinIO  │  HTML snapshots, PDFs, DOCX
                                        └─────────────┘
```

### Components
- **React SPA** — modern, responsive dashboard (see §UI). Role-aware: renders the
  super-admin console or the client workspace based on the logged-in user.
- **API server** — stateless Express app. Owns CRUD + enqueues crawl jobs. Never crawls.
- **Crawler workers** — BullMQ consumers. Two internal pools (fetch / render). Horizontally scalable.
- **PostgreSQL** — system of record for all crawl results + issues.
- **Redis** — BullMQ queues + crawl-frontier dedup set (per job).
- **S3/MinIO** — large blobs (raw HTML, reports, screenshots) — never in Postgres.

---

## 1a. Auth & RBAC (multi-tenant)

Webtummy is multi-tenant from day one. Three roles (see `schema.prisma` → `Role`):

| Role | Tenant | Can do |
|---|---|---|
| **super_admin** | none (global) | Create/disable **clients**, create the first **client_admin** per client, see all tenants, all crawls, billing/plans. This is Dot H Digital staff. |
| **client_admin** | one Client | Manage that client's **websites**, start **crawls**, view/download **reports**, invite **client_users** within the same client. |
| **client_user** | one Client | Start crawls + view reports for their client. No user management. |

**Auth flow:** email + password → bcrypt verify → **JWT** (`{ userId, role, clientId }`,
short-lived) + refresh token. The SPA stores the access token in memory and sends it as
`Authorization: Bearer`.

**Tenant isolation (the critical invariant):** every domain object hangs off a
`clientId` via `Website`. The API wraps all client-scoped queries in a guard:

```
if (user.role !== 'super_admin') {
  // force-scope every query to user.clientId — never trust a clientId from the request body
  where.website.clientId = user.clientId
}
```

A `client_*` user physically cannot read or mutate another tenant's data because the
`clientId` comes from their JWT, not from request input. Middleware: `requireAuth` →
`requireRole(...)` → `scopeToTenant`. See `apps/api/src/middleware/`.

**Provisioning path:** super_admin creates `Client` + its `client_admin` (sets a temp
password / invite). client_admin logs in, adds websites, runs crawls, invites teammates.

---

## 2. Crawl lifecycle (the core flow)

A crawl is a **frontier-based BFS** bounded by depth + page-limit:

1. **API** creates a `crawl_jobs` row (`status=queued`) and enqueues a `crawl:start` job
   with `{ crawlJobId, rootUrl, options }`.
2. **Worker (start)**:
   - Fetch + parse `robots.txt` → store in `robots_files`, build a matcher.
   - Fetch sitemap(s) → store `sitemaps` + `sitemap_urls`.
   - Seed the frontier with the root URL (depth 0).
3. **Frontier loop** (per discovered URL, as `crawl:page` jobs):
   - Skip if already visited (Redis `SADD` returns 0) or blocked by robots / exclude-regex.
   - Fetch via **fetch pool**. Capture status, redirect chain, headers, response time.
   - If JS-dependent → re-fetch via **render pool**.
   - Parse with Cheerio → extract SEO fields, links, images, schema, meta.
   - Persist `pages`, `page_seo`, `links`, `images`, `schemas`.
   - Enqueue newly discovered in-scope internal links at `depth+1` (until limit/depth hit).
4. **Completion**: when frontier drains (or limit reached), worker runs:
   - **Post-crawl passes** that need the whole graph: duplicate detection (titles/meta/H1
     + simhash near-dup), inlink-count aggregation, orphan detection, sitemap-vs-crawl diff,
     broken-link resolution.
   - **Scoring engine** → page scores + site score.
   - Mark `crawl_jobs.status=completed`.

### Why a Redis frontier set
Cross-worker dedup of URLs must be atomic. `SADD job:{id}:seen <normalizedUrl>` returning
1 = "claim it", 0 = "someone already has it". Avoids double-crawling under concurrency.

### Idempotency / resumability
Each `crawl:page` job is keyed by `(crawlJobId, normalizedUrl)`. Re-delivery (BullMQ retry)
upserts the page row rather than duplicating. Frontier set survives worker restarts.

---

## 3. URL normalization (first-class component)

`packages/core/url.ts` — the single source of truth. Order matters:

1. Lowercase scheme + host.
2. Force HTTPS **only** if the canonical site uses HTTPS (configurable).
3. Strip fragment (`#...`).
4. Resolve relative → absolute against the page URL.
5. Remove default ports (`:80`, `:443`).
6. Trailing-slash policy: normalize per host (config: keep | strip).
7. Drop tracking params (`utm_*`, `gclid`, `fbclid`, `mc_*`).
8. Drop known session params (`sid`, `sessionid`, `phpsessid`, `jsessionid`).
9. Sort remaining query params for stable dedup keys.

The **dedup key** is the fully normalized URL. The **fetch URL** keeps meaningful query
params. Two functions: `normalizeForDedup(url)` and `resolveUrl(base, href)`.
**Unit-tested** — this is where crawlers rot.

---

## 4. Near-duplicate detection (simhash)

Exact MD5 only catches byte-identical pages. We need *near*-dup (boilerplate templates).

- Extract visible text → lowercase → tokenize into **word 3-shingles**.
- Hash each shingle (64-bit), accumulate into a 64-bit **simhash** fingerprint.
- Two pages are near-dup if **Hamming distance ≤ 3** (tunable).
- Store `page_seo.content_simhash` (bigint). Post-crawl: bucket by high bits, compare within buckets (avoids O(n²) on large crawls).

---

## 5. JS-rendering decision

Route to Playwright only when static parse signals an app-shell:
- `<body>` visible text < N chars **and** page has `<script>` bundles, **or**
- known SPA root markers (`<div id="root">` / `id="app"` empty), **or**
- `<noscript>` "enable JavaScript" fallback present.

Render pool is hard-capped (§Infra). Rendered HTML re-enters the same parse pipeline.

---

## 6. Scoring engine

- Each check emits zero or more `issues` rows with `{ severity, weight_impact }`.
- Page score = 100 − Σ(weighted deductions for that page), floored at 0.
- Category sub-scores computed from issues tagged with that category.
- Site score = weighted aggregate of category sub-scores (weights from `SCOPE.md` §4).
- **Every deduction is traceable to an issue** → reports explain the score precisely.

---

## 7. Infra & concurrency budget (worked example)

Target box: 1 worker container, 4 GB RAM.

| Pool | Concurrency | Mem each | Total |
|---|---|---|---|
| Fetch (undici+Cheerio) | 30 | ~5–15 MB | ~450 MB |
| Render (Playwright) | 3 | ~300 MB | ~900 MB |
| Node heap + Prisma + overhead | — | — | ~800 MB |
| **Headroom** | | | ~1.8 GB |

Rules: render pool **never** shares its concurrency budget with fetch. Job payloads carry
IDs + URLs only (HTML to S3). Scale crawl throughput by adding worker containers, not by
raising render concurrency on one box.

---

## 7a. UI (modern + responsive)

`apps/web` — React (Vite) SPA, mobile-first responsive.

| Concern | Choice |
|---|---|
| Build | Vite + React + TypeScript |
| Styling | **Tailwind CSS** |
| Components | **shadcn/ui** (Radix primitives) — accessible, themeable |
| Charts | Recharts (score gauges, issue breakdowns, trends) |
| Data fetching | TanStack Query (caching, polling crawl status) |
| Routing | React Router, role-gated routes |
| State | Auth/session in a small context; server state via Query |

**Two role-aware surfaces, one app:**
- **Super-admin console** — clients list, create client + first admin, cross-tenant
  crawl overview, plan/usage.
- **Client workspace** — websites list, "New crawl" wizard (limits, depth,
  include/exclude regex), live crawl progress, results dashboard (site score gauge,
  issue table with severity filters, page detail), report download, team invites
  (client_admin only).

Responsive: collapsible sidebar → bottom nav on mobile; tables become stacked cards;
charts reflow. Layout target: usable from 360px wide up to desktop.

---

## 8. Repository layout (npm workspaces monorepo)

```
webtummy/  (folder: crawler/)
  package.json                 # workspaces root  (name: "webtummy")
  docker-compose.yml           # mysql/redis/minio (local uses host MySQL + redis)
  docs/
  packages/
    db/                        # @webtummy/db — Prisma schema, migrations, client
    core/                      # @webtummy/core — types, url normalization, parsers,
                               #   robots, sitemap, issue rules, scoring — no I/O
  apps/
    api/                       # @webtummy/api — Express REST API + auth/RBAC
    worker/                    # @webtummy/worker — BullMQ crawler (fetch + render pools)
    web/                       # @webtummy/web — React (Vite) dashboard  [Phase 3]
```

`packages/core` is pure logic (unit-testable, no DB/network). `apps/*` wire it to I/O.

---

## 9. DB Schema (Prisma)

See [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma) — the
authoritative version. Summary of relations:

```
Client 1──n Website 1──n CrawlJob 1──n Page 1──1 PageSeo
                                  │           1──n Link   (source page → target url)
                                  │           1──n Image
                                  │           1──n Schema
                                  │           1──n Issue
                          1──n Sitemap 1──n SitemapUrl
                          1──n RobotsFile
                          1──n LlmsFile
                          1──n Report
```

Key indexes: `Page(crawlJobId, statusCode)`, `Page(crawlJobId, normalizedUrl)` unique,
`Issue(crawlJobId, severity)`, `Issue(pageId, issueType)`, `Link(targetUrlNormalized)`.

---

## 10. Tech decisions log

| Decision | Choice | Why |
|---|---|---|
| HTTP client | **undici** | Fastest native Node client; fine-grained timeout/redirect control. |
| HTML parse | **Cheerio** | jQuery-like, fast, no browser. |
| Browser | **Playwright** | Better automation API + auto-wait than Puppeteer; multi-engine. |
| Queue | **BullMQ** | Mature, Redis-backed, supports repeatable (scheduled) jobs for Phase 5. |
| ORM | **Prisma** | Typed, great migrations, `jsonb` support. |
| API | **Express** | Minimal; NestJS DI overhead not justified at MVP. |
| Lang | **TypeScript everywhere** | One language across web/api/worker/core; shared types. |
```
