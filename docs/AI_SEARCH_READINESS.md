# AI Search Readiness — Concrete Checks

This is our **differentiator** vs Screaming Frog, so it gets the most precise spec, not
the least. "AI Search readiness" = how well a page can be **understood, quoted, and cited**
by AI answer engines (ChatGPT, Perplexity, Google AI Overviews, Gemini, Copilot).

Worth **10 points** of the 100-pt site score (see [`SCOPE.md`](./SCOPE.md) §4). Below,
each check is defined so a developer can implement it and a client can understand the fix.

---

## Scoring breakdown (10 pts total)

| # | Check | Pts | Severity if failing |
|---|---|----:|---|
| 1 | Answer-first content (direct-answer intro) | 1.5 | medium |
| 2 | FAQ presence + FAQPage schema | 1.5 | medium |
| 3 | Heading structure as Q&A / scannable | 1.0 | low |
| 4 | `llms.txt` present + valid | 1.5 | medium |
| 5 | Entity consistency (NAP / brand / sameAs) | 1.5 | high |
| 6 | Structured data for entities (Org/LocalBusiness/Article/Product) | 1.5 | high |
| 7 | Content freshness signals (dates, `dateModified`) | 0.5 | low |
| 8 | Citable, self-contained chunks | 0.5 | low |
| 9 | Comparison / "vs" content where relevant | 0.5 | low |

Each check below specifies **how to measure it** (deterministic where possible; an
optional LLM-assisted pass for the fuzzy ones), and the **recommendation** emitted.

---

## 1. Answer-first content (1.5 pts)

**Why:** AI engines extract the first clear, self-contained answer near the top.

**Measure (deterministic):**
- Locate the first content block after the H1 (skip nav/hero).
- PASS if the first paragraph is **40–320 chars**, is a complete sentence (ends in
  `.!?`), and contains the page's primary entity/keyword (from title/H1).
- FAIL if the page opens with a bare heading, a list with no intro, or marketing
  fluff with no factual statement.

**Recommendation on fail:** *"Add a 1–2 sentence direct answer immediately under the H1
that plainly states what this page/service is."*

---

## 2. FAQ presence + FAQPage schema (1.5 pts)

**Why:** Q&A pairs map directly to how users prompt AI engines.

**Measure (deterministic):**
- Detect a FAQ section: ≥2 question-like headings (text ending in `?` or matching
  `^(what|how|why|when|where|who|can|do|is|are|should)\b`) each followed by answer text.
- 0.75 pt for an FAQ section existing.
- 0.75 pt for valid **FAQPage** JSON-LD wrapping those Q&As.

**Recommendation:** *"Add an FAQ section answering the top questions, and mark it up with
FAQPage schema so AI engines can extract the Q&A pairs."*

---

## 3. Scannable Q&A heading structure (1.0 pt)

**Measure (deterministic):**
- ≥60% of H2/H3 headings are descriptive (3–10 words, not single words like "Services").
- Question-phrased headings present where appropriate.
- No heading-level skips (H1→H3 without H2).

**Recommendation:** *"Use descriptive, question-style subheadings so each section answers
a discrete query."*

---

## 4. `llms.txt` present + valid (1.5 pts)

**Why:** Emerging convention for giving LLMs a curated map of a site.

**Measure (deterministic):** fetch `/llms.txt`.
- 0.5 pt: returns 200, `text/plain` or markdown.
- 0.5 pt: has an `# H1` title line + at least one `## section` with markdown links.
- 0.5 pt: links to key URLs (sitemap, top pages) and includes contact/brand info.

**Recommendation:** *"Publish an `/llms.txt` summarizing your site for AI crawlers, linking
to your most important pages and your sitemap."* (Generate a draft from crawl data.)

---

## 5. Entity consistency / NAP (1.5 pts) — *high severity*

**Why:** AI engines cross-reference entities; inconsistent Name/Address/Phone or brand
naming reduces confidence and citation likelihood.

**Measure (deterministic + cross-page):**
- Extract NAP from: LocalBusiness/Organization schema, footer, contact page.
- Brand name consistent across `<title>` suffixes, OG `site_name`, schema `name`.
- `sameAs` links to social/authority profiles present in Organization schema.
- FAIL if phone/address differ across pages, or brand name varies materially.

**Recommendation:** *"Ensure your business name, address, phone, and brand naming are
identical across all pages and in your Organization/LocalBusiness schema, with `sameAs`
links to your official profiles."*

---

## 6. Entity structured data (1.5 pts) — *high severity*

**Measure (deterministic, reuses schema validator):**
- Page has valid schema for its type: home/about → Organization/LocalBusiness;
  articles → Article + author + datePublished; products → Product + offers.
- 0.75 pt presence, 0.75 pt required-fields valid.

**Recommendation:** *"Add valid {detected type} structured data with all required fields
so AI engines can reliably identify this entity."*

---

## 7. Freshness signals (0.5 pt)

**Measure:** visible published/updated date AND `dateModified` in schema where the page
is article/news/blog. Missing on content pages → fail.

**Recommendation:** *"Show a visible last-updated date and include `dateModified` in schema
for time-sensitive content."*

---

## 8. Citable self-contained chunks (0.5 pt)

**Measure (heuristic):**
- Paragraphs average **40–600 chars** (not wall-of-text, not fragmented).
- Key facts stated as standalone sentences (don't rely on prior paragraph context).
- Presence of definition-style or list-style content that quotes cleanly.

**Recommendation:** *"Break content into self-contained paragraphs that state facts
plainly, so they can be quoted out of context."*

---

## 9. Comparison content (0.5 pt)

**Measure:** for commercial/service pages, detect comparison signals — a `<table>`
comparing options, or "vs"/"compared to"/"alternative" language, or a pros/cons list.

**Recommendation:** *"Where users compare options, add a comparison table or 'X vs Y'
section — AI engines favor these for comparative queries."*

---

## Optional LLM-assisted layer (Phase 2+)

Checks 1, 3, 8 have fuzzy edges. After the deterministic pass, an **optional** LLM call
(Claude) can grade "does the intro directly answer the implied query?" on a 0–1 scale to
refine the score. Keep it:
- **Optional + cached** (cost control — don't call per page on every crawl).
- **Explainable** — store the model's one-line rationale in the issue `message`.
- **Never the sole signal** — deterministic checks remain the backbone so scores are
  reproducible.

> Model note: if/when we add the LLM layer, use the latest Claude (e.g. `claude-opus-4-8`
> for quality grading, `claude-haiku-4-5` for cheap bulk passes). Verify current model IDs
> and pricing against the Claude API reference before wiring it up.

---

## Implementation location

`packages/core/ai-readiness/` — one module per check, each exporting
`check(page, ctx): Issue[]`. Pure functions over parsed page data → unit-testable.
The site-level checks (entity consistency, llms.txt) run in the post-crawl pass with
access to all pages.
