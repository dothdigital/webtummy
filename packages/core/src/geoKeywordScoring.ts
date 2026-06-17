export interface GeoKeywordAuditInput {
  targetKeyword: string;
  targetCity?: string | null;
  secondaryKeywords?: string[];
  targetUrl?: string | null;
}

export interface GeoKeywordPageInput {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  wordCount: number | null;
  schemaTypes: string[];
  internalLinks: { href: string; anchor: string | null; placement?: string | null }[];
  imageAlts?: (string | null)[];
}

export interface GeoKeywordScoreItem {
  key: string;
  label: string;
  score: number;
  max: number;
  status: "good" | "partial" | "missing";
  detail: string;
}

export interface GeoKeywordScoreResult {
  total: number;
  intentMatch: "strong" | "medium" | "weak";
  breakdown: GeoKeywordScoreItem[];
  missing: string[];
  recommendations: string[];
}

const SUPPORTING_INTENTS = [
  "cost",
  "pricing",
  "process",
  "timeline",
  "services",
  "service",
  "faq",
  "case stud",
  "compare",
  "benefit",
  "workflow",
  "automation",
  "business",
];

export function scoreGeoKeywordPage(
  page: GeoKeywordPageInput,
  audit: GeoKeywordAuditInput,
): GeoKeywordScoreResult {
  const city = normalizeText(audit.targetCity || "");
  const keyword = normalizeKeywordForMatching(audit.targetKeyword, city);
  const secondary = (audit.secondaryKeywords || []).map(normalizeText).filter(Boolean);
  const title = normalizeText(page.title || "");
  const meta = normalizeText(page.metaDescription || "");
  const h1 = normalizeText(page.h1.join(" "));
  const h2 = normalizeText(page.h2.join(" "));
  const slug = normalizeText(pathSlug(page.url).replace(/-/g, " "));
  const combinedHeadings = `${h1} ${h2}`;
  const linkText = normalizeText(page.internalLinks.map((link) => link.anchor || "").join(" "));
  const schemaText = normalizeText(page.schemaTypes.join(" "));

  const breakdown: GeoKeywordScoreItem[] = [];
  const add = (item: GeoKeywordScoreItem) => breakdown.push(item);

  add(scoreTextMatch("title", "Title match", 10, title, keyword, city, "Title should include the primary keyword and city where local intent matters."));
  add(scoreTextMatch("meta", "Meta description match", 8, meta, keyword, city, "Meta description should mention the service, city, and business outcome."));
  add(scoreTextMatch("h1", "H1 match", 10, h1, keyword, city, "H1 should closely match the keyword and city intent."));

  const primaryHeadingHits = keywordMatches(combinedHeadings, keyword) ? 3 : 0;
  const supportingHits = SUPPORTING_INTENTS.filter((term) => combinedHeadings.includes(term)).length;
  const secondaryHits = secondary.filter((term) => combinedHeadings.includes(term)).length;
  const h2Score = Math.min(10, Math.round(primaryHeadingHits + (supportingHits / 5) * 6 + Math.min(secondaryHits, 3)));
  add({
    key: "h2",
    label: "H2/supporting headings",
    score: h2Score,
    max: 10,
    status: h2Score >= 8 ? "good" : h2Score >= 4 ? "partial" : "missing",
    detail: h2Score >= 8 ? "Supporting headings cover useful search intent." : "Add H2s for process, cost, use cases, comparison, FAQ, and related services.",
  });

  add(scoreTextMatch("url", "URL slug match", 8, slug, keyword, city, "URL should contain the service term and city when this is a local page."));

  const firstFields = normalizeText(`${page.title || ""} ${page.metaDescription || ""} ${page.h1.join(" ")}`);
  add(scoreTextMatch("early_intent", "First impression intent", 8, firstFields, keyword, city, "Keyword and city should be visible in the first page signals."));

  const wordCount = page.wordCount || 0;
  const topicalTerms = [keyword, ...secondary, ...SUPPORTING_INTENTS].filter(Boolean);
  const topicalHits = topicalTerms.filter((term) => `${title} ${meta} ${combinedHeadings} ${slug}`.includes(term)).length;
  const bodyScore = Math.min(15, Math.round((wordCount >= 900 ? 7 : wordCount >= 500 ? 5 : wordCount >= 300 ? 3 : 1) + Math.min(8, topicalHits)));
  add({
    key: "body",
    label: "Body topical relevance",
    score: bodyScore,
    max: 15,
    status: bodyScore >= 12 ? "good" : bodyScore >= 7 ? "partial" : "missing",
    detail: bodyScore >= 12 ? "Page has reasonable topical depth." : "Expand content with problems solved, use cases, process, proof, and related terms.",
  });

  const citySignals = city ? [title, meta, h1, h2, slug, linkText].filter((value) => value.includes(city)).length : 0;
  const localScore = city ? Math.min(10, citySignals * 2) : 6;
  add({
    key: "local",
    label: "City/local relevance",
    score: localScore,
    max: 10,
    status: localScore >= 8 ? "good" : localScore >= 4 ? "partial" : "missing",
    detail: city ? "Checks city mentions across SEO fields, headings, URL, and anchors." : "No target city provided; local scoring is capped.",
  });

  const faqSignals = /faq|question|how much|cost|timeline|compare|best|should/i.test(`${combinedHeadings} ${schemaText}`);
  add({
    key: "faq",
    label: "FAQ/search intent coverage",
    score: faqSignals ? 8 : 2,
    max: 8,
    status: faqSignals ? "good" : "missing",
    detail: faqSignals ? "FAQ or buyer-question intent is present." : "Add FAQs for cost, timeline, fit, comparison, and platform questions.",
  });

  const contextualLinks = page.internalLinks.filter((link) => link.placement === "body" || !link.placement);
  const descriptiveAnchors = contextualLinks.filter((link) => !isWeakAnchor(link.anchor)).length;
  const linkScore = Math.min(8, Math.round(contextualLinks.length * 1.5 + descriptiveAnchors));
  add({
    key: "links",
    label: "Internal linking/anchor support",
    score: linkScore,
    max: 8,
    status: linkScore >= 7 ? "good" : linkScore >= 4 ? "partial" : "missing",
    detail: linkScore >= 7 ? "Internal contextual links and anchors support the page." : "Add contextual links to parent service, related services, case studies, and contact.",
  });

  const schemaScore = Math.min(5, (
    hasSchema(page.schemaTypes, "Service") ? 2 : 0
  ) + (
    hasSchema(page.schemaTypes, "LocalBusiness") || hasSchema(page.schemaTypes, "Organization") ? 1 : 0
  ) + (
    hasSchema(page.schemaTypes, "FAQPage") ? 1 : 0
  ) + (
    hasSchema(page.schemaTypes, "BreadcrumbList") ? 1 : 0
  ));
  add({
    key: "schema",
    label: "Schema/local service signals",
    score: schemaScore,
    max: 5,
    status: schemaScore >= 4 ? "good" : schemaScore >= 2 ? "partial" : "missing",
    detail: schemaScore >= 4 ? "Schema supports local/service understanding." : "Add Service/LocalBusiness, FAQPage, BreadcrumbList, and Organization schema where relevant.",
  });

  const total = breakdown.reduce((sum, item) => sum + item.score, 0);
  const missing = breakdown.filter((item) => item.status !== "good").map((item) => item.label);
  return {
    total,
    intentMatch: total >= 80 ? "strong" : total >= 65 ? "medium" : "weak",
    breakdown,
    missing,
    recommendations: buildRecommendations(breakdown, audit, page),
  };
}

function scoreTextMatch(
  key: string,
  label: string,
  max: number,
  value: string,
  keyword: string,
  city: string,
  recommendation: string,
): GeoKeywordScoreItem {
  const hasKeyword = keywordMatches(value, keyword);
  const hasCity = city ? value.includes(city) : true;
  const score = hasKeyword && hasCity ? max : hasKeyword || hasCity ? Math.round(max * 0.55) : 0;
  return {
    key,
    label,
    score,
    max,
    status: score >= max * 0.8 ? "good" : score > 0 ? "partial" : "missing",
    detail: score >= max * 0.8 ? "Keyword and location intent are present." : recommendation,
  };
}

function buildRecommendations(
  items: GeoKeywordScoreItem[],
  audit: GeoKeywordAuditInput,
  page: GeoKeywordPageInput,
): string[] {
  const city = audit.targetCity?.trim();
  const keyword = normalizeKeywordForMatching(audit.targetKeyword, normalizeText(city || ""));
  const target = [keyword, city].filter(Boolean).join(" ");
  const recommendations: string[] = [];
  const weak = new Map(items.filter((item) => item.status !== "good").map((item) => [item.key, item]));

  if (weak.has("title")) {
    recommendations.push(`SEO title: Rewrite the title to include "${target}" naturally and keep it near 50-60 characters.`);
  }
  if (weak.has("meta")) {
    recommendations.push(`Meta description: Add "${target}" plus a clear service outcome, such as better leads, workflow automation, conversion, or operational improvement.`);
  }
  if (weak.has("h1")) {
    recommendations.push(`H1: Update the H1 so it clearly matches "${target}" without using a generic heading.`);
  }
  if (weak.has("h2")) {
    recommendations.push(`Content structure: Add H2 sections for "${keyword} services${city ? ` in ${city}` : ""}", process, pricing/cost, comparison, use cases, and related services.`);
  }
  if (weak.has("url")) {
    recommendations.push(`URL: If this is the intended ranking page, use a clean slug that reflects the keyword${city ? " and city" : ""}, for example "${slugSuggestion(keyword, city)}".`);
  }
  if (weak.has("early_intent")) {
    recommendations.push(`First 100 words: Mention "${target}" early and explain who the service is for, what problem it solves, and why this page is the right local/service page.`);
  }
  if (weak.has("body")) {
    recommendations.push(`Content depth: Add sections covering problems solved, industries served, deliverables, process, platforms/tools, proof points, and outcomes for "${keyword}".`);
  }
  if (weak.has("local")) {
    recommendations.push(city
      ? `Local relevance: Add ${city} service-area context, nearby areas, local business use cases, and one example scenario for a ${city} customer.`
      : "Local relevance: Add a target city if this is a local SEO page, then include service-area context and nearby locations.");
  }
  if (weak.has("faq")) {
    recommendations.push(...faqRecommendations(keyword, city));
  }
  if (weak.has("links")) {
    recommendations.push(`Internal links: Add contextual links from parent service pages, related service pages, relevant blog posts, case studies, and contact using descriptive anchors like "${target}".`);
  }
  if (weak.has("schema")) {
    recommendations.push(...schemaRecommendations(page.schemaTypes));
  }

  if (!page.schemaTypes.some((type) => type.toLowerCase().includes("breadcrumblist"))) {
    recommendations.push("Breadcrumb: Add BreadcrumbList schema so search engines understand this page's location in the site hierarchy.");
  }
  if (!page.schemaTypes.some((type) => type.toLowerCase().includes("faqpage")) && weak.has("faq")) {
    recommendations.push("FAQ schema: After adding visible FAQs, add FAQPage JSON-LD for the same questions and answers.");
  }

  return [...new Set(recommendations)];
}

function faqRecommendations(keyword: string, city?: string): string[] {
  const local = city ? ` in ${city}` : "";
  return [
    `FAQ: Add "How much does ${keyword}${local} cost?"`,
    `FAQ: Add "How long does a ${keyword} project take${city ? ` for a ${city} business` : ""}?"`,
    `FAQ: Add "What should a business look for in a ${keyword} provider${local}?"`,
    `FAQ: Add "Is ${keyword} better handled as a custom project or an off-the-shelf tool?"`,
  ];
}

function schemaRecommendations(schemaTypes: string[]): string[] {
  const lower = schemaTypes.map((type) => type.toLowerCase());
  const recs: string[] = [];
  if (!lower.some((type) => type.includes("service"))) {
    recs.push("Schema: Add Service schema describing the offer, service area, provider, and relevant service type.");
  }
  if (!lower.some((type) => type.includes("organization") || type.includes("localbusiness"))) {
    recs.push("Schema: Add Organization or LocalBusiness schema to connect the page to the company and local service entity.");
  }
  if (!lower.some((type) => type.includes("breadcrumblist"))) {
    recs.push("Schema: Add BreadcrumbList schema for hierarchy and richer search understanding.");
  }
  return recs;
}

function slugSuggestion(keyword: string, city?: string): string {
  return `/${[keyword, city].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bsupervisa\b/g, "super visa")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKeywordForMatching(value: string, city: string): string {
  const words = normalizeText(value).split(" ").filter(Boolean);
  const cityWords = new Set(city.split(" ").filter(Boolean));
  const filtered = words.filter((word) => {
    if (cityWords.has(word)) return false;
    return ![...cityWords].some((cityWord) => cityWord.length > 4 && editDistance(word, cityWord) <= 2);
  });
  return filtered.join(" ").trim() || normalizeText(value);
}

function pathSlug(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return url;
  }
}

function keywordMatches(value: string, keyword: string): boolean {
  if (!keyword) return true;
  if (value.includes(keyword)) return true;
  if (compact(value).includes(compact(keyword))) return true;
  const words = keyword.split(" ").filter((word) => word.length > 2);
  return words.length > 0 && words.every((word) => value.includes(word));
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function hasSchema(types: string[], expected: string): boolean {
  return types.some((type) => type.toLowerCase().includes(expected.toLowerCase()));
}

function isWeakAnchor(anchor: string | null | undefined): boolean {
  const value = normalizeText(anchor || "");
  return !value || /^(click here|read more|learn more|more|view|details|here|continue|see more|find out more)$/.test(value);
}
