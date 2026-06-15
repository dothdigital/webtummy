# Feature Map — Screaming Frog parity + Webtummy differentiators

You asked for the full Screaming Frog (SF) feature set. This maps **every** requested
feature to a phase, with effort (S/M/L/XL) and ROI for an agency SaaS, so we ship value
early and tackle the hard/low-ROI items deliberately — not all at once.

> **Honest headline:** full SF parity *plus* multi-tenant SaaS *plus* AI-search readiness
> is a **~6–9 month build** for a small team, not weeks. SF is 10+ years mature. The plan
> below front-loads the 80% of value (Phases 1–3) and sequences the long tail after.

Legend — Effort: **S**≤3d · **M**~1wk · **L**~2–3wk · **XL**~1mo+. ROI: ⭐–⭐⭐⭐.

---

## Phase 1 — Core crawler  *(in progress now)*
| Feature (your list) | Effort | ROI | Notes |
|---|---|---|---|
| Find Broken Links, Errors & Redirects | M | ⭐⭐⭐ | Built: status, redirect chains, broken internal links. |
| Analyse Page Titles & Meta Data | S | ⭐⭐⭐ | Built. |
| Review Meta Robots & Directives | S | ⭐⭐⭐ | Built: robots meta + X-Robots planned. |
| Crawl Limit | S | ⭐⭐⭐ | Built: `pageLimit` + `maxDepth`. |
| Crawl Configuration (include/exclude) | S | ⭐⭐ | Built: include/exclude regex. More config in P2. |
| Save & Open Crawls | S | ⭐⭐ | Inherent — every crawl persists in MySQL, reloadable by ID. |

## Phase 2 — SEO audit engine
| Feature | Effort | ROI | Notes |
|---|---|---|---|
| Discover Exact Duplicate Pages | S | ⭐⭐ | Hash titles/meta/body. |
| Near Duplicate Content | M | ⭐⭐ | Simhash over content shingles (ARCHITECTURE §4). |
| Audit hreflang Attributes | M | ⭐⭐ | Return-tag + lang-code validation. |
| Structured Data & Validation | L | ⭐⭐⭐ | Detection (P1-ready) + Google-rules validation. |
| JavaScript Rendering | L | ⭐⭐⭐ | Playwright render pool (ARCHITECTURE §5, §7). |
| Custom robots.txt | S | ⭐ | Override robots for testing owned sites. |
| Mixed content / HTTPS | S | ⭐⭐ | Added in our scope. |

## Phase 3 — Reporting dashboard + custom search
| Feature | Effort | ROI | Notes |
|---|---|---|---|
| Generate XML Sitemaps | M | ⭐⭐ | Build a sitemap from crawled 200s. |
| Custom Source Code Search | S | ⭐⭐ | Find string/regex in raw HTML. |
| Custom Extraction (XPath/CSS/regex) | L | ⭐⭐⭐ | High agency value; needs a rule builder UI. |
| Client reports (PDF/DOCX) | L | ⭐⭐⭐ | Our core deliverable — SF can't do this well. |

## Phase 4 — Integrations + advanced analysis
| Feature | Effort | ROI | Notes |
|---|---|---|---|
| PageSpeed Insights Integration | M | ⭐⭐⭐ | Google PSI API. |
| Search Console Integration | M | ⭐⭐⭐ | OAuth; clicks/impressions per URL. |
| Google Analytics Integration | M | ⭐⭐ | GA4 API. |
| Accessibility Auditing | M | ⭐⭐ | axe-core in the render pool. |
| Crawl with OpenAI & Gemini **(+ Claude)** | L | ⭐⭐⭐ | LLM content analysis — powers AI-readiness. Use Claude as primary (verify model IDs against the Claude API reference). |
| Custom JavaScript | L | ⭐ | Run user JS per page in render pool — advanced, niche. |
| Forms Based Authentication | M | ⭐⭐ | Crawl staging/gated sites. |
| Site Visualisations (crawl tree / force graph) | L | ⭐⭐ | D3/force-directed; we have depth + inlinks already. |
| Mobile Usability | M | ⭐⭐ | Viewport/tap-target checks via render. |
| Segmentation | M | ⭐⭐ | Tag URLs into segments for filtering/reporting. |

## Phase 5 — Multi-client automation + BI
| Feature | Effort | ROI | Notes |
|---|---|---|---|
| Scheduling | M | ⭐⭐⭐ | BullMQ repeatable jobs — big SaaS win over SF. |
| Crawl Comparison | M | ⭐⭐⭐ | Diff two crawls; before/after for clients. |
| Link Metrics Integration | M | ⭐ | Ahrefs/Majestic/Moz — paid APIs, add on demand. |
| Looker Studio Crawl Report | M | ⭐⭐ | Export to BigQuery / Looker connector. |

## Deprioritize (low ROI for an agency SaaS)
| Feature | Why |
|---|---|
| AMP Crawling & Validation | Google deprecated AMP's special treatment (2021); minimal upside. |
| Spelling & Grammar Checks | Niche, noisy, locale-heavy; clients rarely act on it. Revisit if asked. |

---

## What SF can't do that we will (our moat)
- **Multi-tenant SaaS** — super-admin → client → user, hosted, no desktop install.
- **Scheduled, hands-off crawling** across 100+ clients with emailed reports.
- **Client-ready PDF/DOCX** reports + developer fix checklists.
- **AI Search readiness** scoring (llms.txt, FAQ, entity consistency) — see
  [`AI_SEARCH_READINESS.md`](./AI_SEARCH_READINESS.md).

## Recommended sequencing rule
Ship **Phases 1–3** first (a usable, sellable agency tool: crawl → audit → client report).
Only then chase the SF long tail (Phases 4–5) based on which features clients actually ask
for. Building all 30 features before launch delays revenue by months for parity nobody has
asked to pay for yet.
