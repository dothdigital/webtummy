// Phase 1 issue rules. Pure functions over parsed page data -> DetectedIssue[].
// Thresholds are defaults; SCOPE.md §12 says keep these configurable per page type.
import type { ParsedPage, DetectedIssue, FetchResult } from "./types.js";

export interface IssueThresholds {
  titleMin: number;
  titleMax: number;
  metaMin: number;
  metaMax: number;
  minWordCount: number;
}

export const DEFAULT_THRESHOLDS: IssueThresholds = {
  titleMin: 15,
  titleMax: 60,
  metaMin: 70,
  metaMax: 160,
  minWordCount: 300,
};

/** Issues derivable from a single page in isolation (Phase 1). */
export function detectPageIssues(
  fetch: FetchResult,
  parsed: ParsedPage | null,
  pageUrlNormalized: string,
  thresholds: IssueThresholds = DEFAULT_THRESHOLDS,
): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  // ── Status / indexability ────────────────────────────────────────────────
  if (fetch.statusCode >= 500) {
    issues.push({
      issueType: "server_error",
      category: "indexability",
      severity: "high",
      weightImpact: 10,
      message: `Page returned ${fetch.statusCode}.`,
      recommendation: "Fix the server error so the page is crawlable and indexable.",
    });
  } else if (fetch.statusCode >= 400) {
    issues.push({
      issueType: "client_error",
      category: "indexability",
      severity: "high",
      weightImpact: 8,
      message: `Page returned ${fetch.statusCode}.`,
      recommendation: "Fix or remove links to this URL; restore the page or 301 it.",
    });
  }
  if (fetch.redirectChain.length > 2) {
    issues.push({
      issueType: "long_redirect_chain",
      category: "links",
      severity: "medium",
      weightImpact: 3,
      message: `Redirect chain of ${fetch.redirectChain.length} hops.`,
      recommendation: "Point links directly at the final URL to remove redirect hops.",
    });
  }

  if (!parsed) return issues; // non-HTML or fetch failed — nothing more to check

  // ── Robots / canonical ─────────────────────────────────────────────────────
  const robots = (parsed.robotsMeta || "").toLowerCase();
  if (robots.includes("noindex")) {
    issues.push({
      issueType: "noindex",
      category: "indexability",
      severity: "high",
      weightImpact: 10,
      message: "Page is set to noindex via robots meta.",
      recommendation: "Remove noindex if this page should appear in search.",
    });
  }

  // ── Hreflang ────────────────────────────────────────────────────────────────
  for (const tag of parsed.hreflangs) {
    if (!tag.lang || !/^(x-default|[a-z]{2,3}(-[A-Z]{2})?)$/.test(tag.lang)) {
      issues.push(mk("invalid_hreflang_code", "indexability", "medium", 2, `Invalid hreflang value: ${tag.lang || "empty"}.`, "Use valid language or language-region codes, such as en, en-US, fr-CA, or x-default."));
    }
    if (!tag.href) {
      issues.push(mk("invalid_hreflang_url", "indexability", "medium", 2, "A hreflang tag has no valid href URL.", "Point each hreflang tag to an absolute or resolvable alternate URL."));
    }
  }
  if (!parsed.canonicalUrl) {
    issues.push({
      issueType: "missing_canonical",
      category: "indexability",
      severity: "low",
      weightImpact: 1,
      message: "No canonical tag.",
      recommendation: "Add a self-referencing canonical tag.",
    });
  } else if (parsed.canonicalUrl.replace(/\/$/, "") !== pageUrlNormalized.replace(/\/$/, "")) {
    issues.push({
      issueType: "non_self_canonical",
      category: "indexability",
      severity: "medium",
      weightImpact: 3,
      message: `Canonical points elsewhere: ${parsed.canonicalUrl}`,
      recommendation: "Confirm the canonical target is intended; otherwise self-canonicalize.",
    });
  }

  // ── On-page: title ──────────────────────────────────────────────────────────
  if (!parsed.title) {
    issues.push(mk("missing_title", "onpage", "high", 6, "Page has no <title>.", "Add a unique, descriptive title."));
  } else {
    if (parsed.title.length < thresholds.titleMin)
      issues.push(mk("short_title", "onpage", "low", 2, `Title is ${parsed.title.length} chars (short).`, `Aim for ${thresholds.titleMin}-${thresholds.titleMax} chars.`));
    if (parsed.title.length > thresholds.titleMax)
      issues.push(mk("long_title", "onpage", "low", 1, `Title is ${parsed.title.length} chars (may truncate).`, `Keep under ${thresholds.titleMax} chars.`));
  }

  // ── On-page: meta description ────────────────────────────────────────────────
  if (!parsed.metaDescription) {
    issues.push(mk("missing_meta_description", "onpage", "medium", 3, "No meta description.", "Add a compelling 70-160 char description."));
  } else {
    if (parsed.metaDescription.length < thresholds.metaMin)
      issues.push(mk("short_meta_description", "onpage", "low", 1, "Meta description is short.", `Aim for ${thresholds.metaMin}-${thresholds.metaMax} chars.`));
    if (parsed.metaDescription.length > thresholds.metaMax)
      issues.push(mk("long_meta_description", "onpage", "low", 1, "Meta description may truncate.", `Keep under ${thresholds.metaMax} chars.`));
  }

  // ── On-page: headings ────────────────────────────────────────────────────────
  if (parsed.h1.length === 0)
    issues.push(mk("missing_h1", "onpage", "medium", 3, "No H1 on the page.", "Add a single descriptive H1."));
  else if (parsed.h1.length > 1)
    issues.push(mk("multiple_h1", "onpage", "low", 2, `Page has ${parsed.h1.length} H1s.`, "Use exactly one H1."));

  // ── Content ──────────────────────────────────────────────────────────────────
  if (parsed.wordCount < thresholds.minWordCount)
    issues.push(mk("low_word_count", "onpage", "low", 2, `Only ${parsed.wordCount} words.`, `Thin content; aim for ${thresholds.minWordCount}+ words on key pages.`));

  if (parsed.looksJsDependent) {
    issues.push(mk("javascript_dependent_content", "performance", "medium", 3, "Page appears to depend on JavaScript rendering for meaningful content.", "Enable JavaScript rendering for this crawl or ensure critical SEO content is present in the initial HTML."));
  }

  // ── Media: image alt ──────────────────────────────────────────────────────────
  const missingAlt = parsed.images.filter((i) => i.alt === null || i.alt === undefined).length;
  if (missingAlt > 0)
    issues.push(mk("missing_image_alt", "media", "low", Math.min(3, missingAlt * 0.5), `${missingAlt} image(s) missing alt text.`, "Add descriptive alt text to meaningful images."));

  // ── Social ────────────────────────────────────────────────────────────────────
  if (Object.keys(parsed.ogTags).length === 0)
    issues.push(mk("missing_open_graph", "social", "low", 1, "No Open Graph tags.", "Add og:title, og:description, og:image for better sharing."));

  // ── Structured data ─────────────────────────────────────────────────────────
  const invalidSchema = parsed.schemas.filter((s) => !s.validJson).length;
  if (invalidSchema > 0) {
    issues.push(mk("invalid_structured_data_json", "schema", "medium", 3, `${invalidSchema} JSON-LD block(s) contain invalid JSON.`, "Fix malformed JSON-LD so search engines can parse structured data."));
  }
  const schemaTypes = parsed.schemas.map((s) => (s.schemaType || "").toLowerCase());
  if (parsed.schemas.length === 0 && /\/(blog|article|service|services|product|location|locations)\b/i.test(pageUrlNormalized)) {
    issues.push(mk("missing_structured_data", "schema", "low", 2, "No structured data found on an important page.", "Add the appropriate JSON-LD schema, such as Article, Service, FAQPage, BreadcrumbList, Organization, or LocalBusiness."));
  }
  if (/\/(blog|article)\b/i.test(pageUrlNormalized) && !schemaTypes.some((t) => t.includes("article") || t.includes("blogposting"))) {
    issues.push(mk("missing_article_schema", "schema", "low", 2, "Blog/article page has no Article or BlogPosting schema.", "Add Article or BlogPosting JSON-LD for editorial content."));
  }
  if (/faq/i.test(parsed.h1.join(" ") + " " + parsed.h2.join(" ") + " " + pageUrlNormalized) && !schemaTypes.includes("faqpage")) {
    issues.push(mk("missing_faq_schema", "schema", "low", 2, "FAQ content appears present but FAQPage schema was not found.", "Add FAQPage JSON-LD when the page contains visible FAQ content."));
  }
  if (pageUrlNormalized.split("/").length > 4 && !schemaTypes.includes("breadcrumblist")) {
    issues.push(mk("missing_breadcrumb_schema", "schema", "low", 1, "Deep page has no BreadcrumbList schema.", "Add BreadcrumbList JSON-LD to help search engines understand page hierarchy."));
  }

  return issues;
}

function mk(
  issueType: string,
  category: DetectedIssue["category"],
  severity: DetectedIssue["severity"],
  weightImpact: number,
  message: string,
  recommendation: string,
): DetectedIssue {
  return { issueType, category, severity, weightImpact, message, recommendation };
}
