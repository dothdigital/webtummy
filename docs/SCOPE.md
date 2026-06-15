# SEO + AI Search Website Crawler — Scope (Revised)

> **React + Node.js platform for Dot H Digital — internal use + client reporting.**
> Revision of `seo_ai_crawler_tool_scope.docx` with gaps closed, the AI-readiness
> section sharpened into testable checks, an infra/concurrency budget added, and
> the crawl-engine timeline made realistic.

---

## 0. Positioning (read this first)

We are **not** cloning Screaming Frog. Screaming Frog is a mature desktop app that
crawls millions of URLs locally at extreme speed. We are building a **multi-tenant
web SaaS** for an agency, capped at hundreds–thousands of pages per crawl across
100+ client sites.

Our edge is the things Screaming Frog does *not* do well:

1. **Automated, scheduled, multi-client crawling** with no human at the keyboard.
2. **Polished client-ready reports** (PDF/DOCX) and a developer fix-checklist.
3. **AI Search readiness** auditing (llms.txt, FAQ, entity consistency, answer-first
   content) — see [`AI_SEARCH_READINESS.md`](./AI_SEARCH_READINESS.md).

**Design rule:** when a feature decision is "match Screaming Frog" vs "make the
agency workflow better", choose the agency workflow.

---

## 1. Objective

Build an internal SEO + AI Search audit platform that crawls client websites,
inspects page-level SEO signals, identifies technical/content issues, generates
prioritized recommendations, and produces client-ready reports. V1 replaces repeat
manual audits and Screaming-Frog-style checks for 100+ client sites.

---

## 2. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React (Vite) + TypeScript** | Dashboard, crawl setup, results, charts, report preview. (Next.js only if we need SSR/SEO on the app itself — we don't, internally.) |
| Backend API | **Node.js + Express + TypeScript** | REST API for clients, crawl jobs, reports. NestJS is overkill for MVP. |
| Crawl fetcher | **undici (HTTP) + Cheerio** | Fast static HTML parse — the default path for ~95% of pages. |
| JS rendering | **Playwright (separate worker pool)** | Only for pages flagged as JS-dependent. Capped, isolated — see §7. |
| Queue | **BullMQ + Redis** | Async crawls, concurrency control, retries, scheduling. |
| Database | **PostgreSQL** | Analytics-friendly; `jsonb` for flexible SEO fields. |
| ORM | **Prisma** | Typed schema + migrations. |
| Storage | **S3-compatible** (MinIO in dev) | Screenshots, PDFs, DOCX, optional raw HTML snapshots. |
| Reports | **Puppeteer/Playwright HTML→PDF + `docx` lib** | Client PDF/Word + developer checklist. |
| External APIs | PageSpeed Insights, Google Search Console, Bing IndexNow | Phase 4. |

---

## 3. MVP Feature Scope

### Crawl engine
- Crawl from homepage + sitemap URLs; discover internal links.
- Configurable **max pages**, **crawl depth**, **concurrency**.
- **Include/exclude URL regex** (NEW — needed immediately for messy sites).
- Respect `robots.txt` by default; admin override only for **verified owned** sites.
- **URL normalization** as a first-class, tested component (trailing slash, case,
  fragment removal, query-param policy, session-id stripping, HTTPS forcing).
- Crawl timeout, retry rules, max redirect-chain length.
- **Response time per URL** captured (NEW — cheap, useful).

### Page-level audits
- **Status codes**: 200/3xx/4xx/5xx, full redirect chain + final URL.
- **Title / meta / H1 / H2**: extract; flag missing, too long/short, duplicate, multiple H1.
- **Duplicate detection**: titles, metas, H1s, and **near-duplicate page bodies via
  simhash** over content shingles (NEW — explicit algorithm, not exact-match only).
- **Canonical audit**: missing, non-self, HTTP/HTTPS mismatch, redirected canonical,
  canonical → non-200.
- **Robots meta / X-Robots-Tag**: noindex/nofollow/none, blocked assets, inconsistencies.
- **Mixed content / HTTPS** (NEW): HTTP sub-resources on HTTPS pages, insecure links.
- **hreflang audit** (NEW, Phase 2): missing return tags, invalid lang codes, self-reference.
- **Sitemap audit**: fetch sitemap(s); diff sitemap URLs vs crawled URLs; flag
  sitemap-only, crawl-only, missing `lastmod`, non-200 sitemap URLs.
- **Broken internal links**: extract internal links, check target status, flag 404/5xx,
  redirected, and mixed-HTTP links. Track **inlink/outlink counts** per page (NEW —
  internal link equity + orphan detection).
- **Image alt audit**: missing/empty alt on meaningful images, oversized, broken src.
- **Low word count**: visible word-count estimate; configurable per page type.
- **Schema detection + validation** (CHANGED): extract JSON-LD/Microdata/RDFa AND
  validate required fields against Google's rules for key types (Organization,
  LocalBusiness, Service, FAQPage, BreadcrumbList, Article). Detection alone is low value.
- **Open Graph / Twitter tags**: presence + correctness.
- **llms.txt audit**: status, format, sections, key URLs, sitemap links, contact.
- **robots.txt audit**: status, sitemap refs, disallow rules, blocked important URLs.
- **PageSpeed** (Phase 4): PSI scores for selected URLs.

### Output
- **Client reports**: site score, issue summary, page table, priority fixes,
  developer checklist; export PDF/DOCX.

---

## 4. Scoring Model (100-pt, transparent)

| Category | Weight | Checks |
|---|---|---|
| Indexability | 20% | 200 status, not blocked, indexable robots, self-canonical, sitemap presence |
| On-page SEO | 25% | Title, meta, H1, H2 structure, duplicate checks, word count |
| Technical links | 15% | Broken internal links, redirect chains, orphan/sitemap-only pages, mixed content |
| Media | 10% | Image alt, broken images, oversized images |
| Structured data | 10% | Schema presence **and validity** for useful types |
| Social/meta | 5% | Open Graph + Twitter cards |
| **AI Search readiness** | 10% | See [`AI_SEARCH_READINESS.md`](./AI_SEARCH_READINESS.md) — defined as concrete checks |
| Performance | 5% | PageSpeed scores for selected templates/pages |

Score is computed per page, then aggregated to a site score. Every deduction maps to
a specific `issue` row so the report can explain *exactly* why the score is what it is.

---

## 5. Database Tables

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §DB-Schema for the full Prisma schema.
Tables: `clients`, `websites`, `crawl_jobs`, `pages`, `page_seo`, `links`, `images`,
`schemas`, `sitemaps`, `sitemap_urls`, `robots_files`, `llms_files`, `issues`,
`reports`. (Plus `users` once auth lands.)

---

## 6. Crawl Rules & Safety

- Default max pages/crawl: **500** (MVP), configurable per client.
- Default concurrency: **3–5 req/domain**; global concurrency capped by worker pool.
- Respect `robots.txt` by default; **admin override only for verified owned sites**
  (verification via DNS TXT or a token file — Phase 2).
- Normalize URLs (see §3). Skip `logout`, `cart`, `checkout`, `admin`, and query-heavy
  filter URLs unless explicitly allowed.
- Store raw HTML **optionally**; never store account/auth/form-submission pages.
- Per-request timeout, bounded retries, max redirect-chain length.
- Clear structured error logging per crawl for debugging.
- Identify as a named user-agent; honor `crawl-delay` where present.

---

## 7. Infrastructure & Concurrency Budget (NEW)

The original scope under-specified this — it's the #1 source of production pain.

- **Two distinct worker pools:**
  - **Fetch pool** (Cheerio/undici): cheap, high concurrency (e.g. 20–50 global).
  - **Render pool** (Playwright): each headless Chromium ≈ 200–400 MB RAM. **Hard-cap
    at 2–4 concurrent renders per worker**, isolated from the fetch pool so a render
    backlog can't starve fetches or OOM the box.
- Only route a page to the render pool when static parse signals JS-dependence
  (empty `<body>` text, app-shell markers, `<noscript>` fallbacks).
- Redis sizing: BullMQ job payloads kept small (IDs + URLs, not HTML).
- Postgres: index hot paths (`crawl_job_id`, `url`, `issue_type`, `severity`).
  Raw HTML goes to S3, not a DB column.
- Memory budget worked example documented in `ARCHITECTURE.md`.

---

## 8. API Endpoints (MVP)

```
POST   /api/clients
POST   /api/websites
POST   /api/websites/:id/crawls          # start a crawl
GET    /api/crawls/:id/status            # live status + progress
GET    /api/crawls/:id/summary           # site score + counts
GET    /api/crawls/:id/pages             # paginated page list
GET    /api/pages/:id/issues
GET    /api/crawls/:id/issues?severity=high
POST   /api/crawls/:id/reports           # generate PDF/DOCX
GET    /api/reports/:id/download
POST   /api/indexnow/submit              # Phase 4
POST   /api/pagespeed/run                # Phase 4
```

---

## 9. Client Report Requirements

- Executive summary + site score.
- Pages crawled, indexable, broken links, duplicate titles, missing descriptions.
- Top high-priority issues with business impact.
- Page-level issue table: URL, severity, issue, recommendation, owner.
- AI Search readiness section.
- Local SEO section where applicable (LocalBusiness schema, service-area pages, NAP).
- Developer fix checklist.
- Before/after comparison once historical crawls exist (Phase 5).

---

## 10. Build Phases (timeline corrected)

| Phase | Timeline | Deliverables |
|---|---|---|
| **1: Core crawler** | **4–5 weeks** *(was 2–3 — under-estimated)* | Client/website setup, sitemap discovery, robust polite crawl, URL normalization, status codes + redirect chains, title/meta/H1/H2, canonical, robots meta, broken links, inlink counts, response time, include/exclude regex. |
| **2: SEO audit engine** | 3 weeks | Duplicate + near-dup (simhash), image alt, word count, schema detection **+ validation**, OG/Twitter, robots.txt + llms.txt audit, hreflang, mixed content, scoring engine. |
| **3: Reporting dashboard** | 2–3 weeks | React dashboard, issue filters, page detail, PDF/DOCX export, dev checklist. |
| **4: Integrations** | 2–4 weeks | PageSpeed API, Google Search Console data, Bing IndexNow submission. |
| **5: Multi-client automation** | 2–4 weeks | Scheduled crawls, email reports, client portal + RBAC, historical trends, alerts. |

**Realistic total: ~13–19 weeks** for 1–2 experienced devs. The crawler engine is the
foundation everything depends on — do not rush Phase 1.

---

## 11. Acceptance Criteria

- Crawl ≥500 URLs from one site without crashing or memory blow-up.
- Store: status, title, description, H1, H2, canonical, robots meta, links (+ inlink
  counts), images, schema (+ validity), OG/Twitter, response time.
- Identify: missing/duplicate titles, missing descriptions, broken links, missing alt,
  low word count, noindex, canonical mismatch, sitemap-only pages, mixed content.
- Dashboard shows site score, issue counts, page list, filters by severity + issue type.
- Report export works in PDF **or** DOCX.
- Crawl jobs run asynchronously with visible progress/status.
- Supports ≥100 client websites with scheduled monthly crawls after MVP hardening.
- URL normalization + robots.txt parsing covered by unit tests.

---

## 12. Developer Notes

- Do **not** scrape Google SERPs directly in MVP; use approved APIs / SERP providers later.
- Do **not** claim the tool forces Google indexing. It audits readiness and can submit
  to Bing IndexNow.
- Keep issue rules **configurable** (per page type: word-count, title-length thresholds).
- Default to HTTP + Cheerio; route to Playwright only when rendering is genuinely needed.
- All crawling via background workers — never crawl synchronously in a web request.
- Add authentication + RBAC before any client logs in (Phase 5).
- Treat **URL normalization** and **robots.txt parsing** as core, test-covered components,
  not line items — they are the top sources of crawler bugs.
