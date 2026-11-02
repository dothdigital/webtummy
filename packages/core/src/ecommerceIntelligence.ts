export type EcommerceEvidenceType = "observed" | "inferred" | "user_provided" | "connected" | "unavailable";

export type PublicStorePageInput = {
  id: string;
  url: string;
  statusCode?: number | null;
  title?: string | null;
  metaDescription?: string | null;
  h1?: string[];
  wordCount?: number | null;
  inlinkCount?: number;
  outlinkCount?: number;
  canonicalUrl?: string | null;
  schemaTypes?: string[];
  imageCount?: number;
  missingAltCount?: number;
  issueCount?: number;
};

export type EcommerceKeywordInput = {
  keyword: string;
  location?: string | null;
  averageVolume?: number | null;
  rank?: number | null;
  rankingUrl?: string | null;
};

export type EcommercePerformanceInput = {
  productName: string;
  sku?: string | null;
  revenue?: number | null;
  marginPercent?: number | null;
  conversionRate?: number | null;
  inventory?: number | null;
  orders?: number | null;
  source: "user_provided" | "connected";
};

export type EcommercePageKind = "product" | "collection" | "guide" | "store_page" | "other";

export type EcommercePageAssessment = {
  id: string;
  url: string;
  name: string;
  kind: EcommercePageKind;
  score: number;
  priority: "critical" | "high" | "medium" | "low";
  evidenceType: EcommerceEvidenceType;
  signals: string[];
  gaps: string[];
};

export type EcommerceRecommendation = {
  key: string;
  category: "product_seo" | "collection_seo" | "content" | "internal_linking" | "merchandising" | "ai_citations" | "authority" | "measurement";
  title: string;
  explanation: string;
  recommendedAction: string;
  expectedImpact: string;
  evidenceType: EcommerceEvidenceType;
  evidence: string[];
  affectedUrls: string[];
  priority: "critical" | "high" | "medium" | "low";
  impactScore: number;
  confidenceScore: number;
  destination: "content" | "website" | "ai_citations" | "authority" | "measurement";
};

export type EcommerceIntelligenceResult = {
  version: "ecommerce-public-intelligence-v1";
  generatedAt: string;
  store: {
    platform: string;
    pageCount: number;
    productCount: number;
    collectionCount: number;
    guideCount: number;
    publicPriceSignals: number;
    publicReviewSignals: number;
  };
  pages: EcommercePageAssessment[];
  recommendations: EcommerceRecommendation[];
  evidenceCoverage: Array<{ key: string; label: string; status: EcommerceEvidenceType; detail: string }>;
  limitations: string[];
};

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function slugLabel(url: string) {
  try {
    const path = new URL(url).pathname.replace(/\.(?:html?|php)$/i, "").replace(/\/$/, "");
    const segment = path.split("/").filter(Boolean).at(-1) ?? "Store page";
    return segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "Store page";
  }
}

function pageKind(page: PublicStorePageInput): EcommercePageKind {
  const schema = (page.schemaTypes ?? []).map(normalized);
  const url = normalized(page.url);
  const text = normalized(`${page.title ?? ""} ${(page.h1 ?? []).join(" ")}`);
  if (schema.some((item) => item === "product" || item.endsWith("/product")) || /\/(?:products?|p)\//.test(url)) return "product";
  if (schema.some((item) => ["collectionpage", "itemlist", "offer catalog", "offercatalog"].includes(item)) || /\/(?:collections?|categor(?:y|ies)|shop)\//.test(url)) return "collection";
  if (/\/(?:blog|guides?|resources?|learn|compare|comparison)\//.test(url) || /\b(?:guide|comparison|compare|how to choose|best)\b/.test(text)) return "guide";
  if (/\b(?:shop|store|catalog|products|collections)\b/.test(text)) return "store_page";
  return "other";
}

function scorePage(page: PublicStorePageInput, kind: EcommercePageKind) {
  const gaps: string[] = [];
  const signals: string[] = [];
  let score = 100;
  if ((page.statusCode ?? 200) >= 400) { gaps.push(`Page returns HTTP ${page.statusCode}.`); score -= 45; }
  if (!String(page.title ?? "").trim()) { gaps.push("SEO title is missing."); score -= 14; } else signals.push("SEO title is present.");
  if (!String(page.metaDescription ?? "").trim()) { gaps.push("Meta description is missing."); score -= 10; } else signals.push("Meta description is present.");
  if (!(page.h1 ?? []).length) { gaps.push("Visible H1 is missing."); score -= 12; } else signals.push("Visible H1 is present.");
  const minimumWords = kind === "product" ? 180 : kind === "collection" ? 140 : 220;
  if ((page.wordCount ?? 0) < minimumWords) { gaps.push(`${kind === "product" ? "Product" : kind === "collection" ? "Collection" : "Page"} content appears thin (${page.wordCount ?? 0} words).`); score -= 12; }
  if (kind === "product" && !(page.schemaTypes ?? []).some((item) => normalized(item) === "product")) { gaps.push("Product schema was not detected."); score -= 12; }
  if (kind === "collection" && !(page.schemaTypes ?? []).some((item) => ["collectionpage", "itemlist", "offercatalog"].includes(normalized(item)))) { gaps.push("Collection or ItemList schema was not detected."); score -= 8; }
  if ((page.inlinkCount ?? 0) === 0) { gaps.push("No incoming internal links were detected."); score -= 14; } else signals.push(`${page.inlinkCount} incoming internal links detected.`);
  if ((page.missingAltCount ?? 0) > 0) { gaps.push(`${page.missingAltCount} product or page images need useful alt text.`); score -= Math.min(10, page.missingAltCount ?? 0); }
  if ((page.schemaTypes ?? []).length) signals.push(`Public schema detected: ${unique(page.schemaTypes ?? []).join(", ")}.`);
  return { score: Math.max(0, Math.round(score)), gaps, signals };
}

function priorityFor(score: number): EcommercePageAssessment["priority"] {
  if (score < 45) return "critical";
  if (score < 65) return "high";
  if (score < 82) return "medium";
  return "low";
}

function meaningfulTokens(value: string) {
  return new Set(normalized(value).split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !["and", "the", "for", "with", "from", "buy", "shop", "product", "best", "under", "online"].includes(token)));
}

function keywordPageAffinity(keyword: EcommerceKeywordInput, page: EcommercePageAssessment) {
  if (keyword.rankingUrl && normalized(keyword.rankingUrl).replace(/\/$/, "") === normalized(page.url).replace(/\/$/, "")) return 100;
  const keywordTokens = meaningfulTokens(keyword.keyword);
  const pageTokens = meaningfulTokens(`${page.name} ${page.url}`);
  if (!keywordTokens.size) return 0;
  const overlap = [...keywordTokens].filter((token) => pageTokens.has(token)).length;
  return Math.round((overlap / keywordTokens.size) * 100);
}

function recommendation(input: Omit<EcommerceRecommendation, "key">): EcommerceRecommendation {
  const keySeed = `${input.category}:${input.title}:${input.affectedUrls.join("|")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 150);
  return { key: keySeed || `ecommerce-${input.category}`, ...input };
}

export function buildEcommerceIntelligence(input: {
  pages: PublicStorePageInput[];
  keywords?: EcommerceKeywordInput[];
  performance?: EcommercePerformanceInput[];
  platformHint?: string | null;
}): EcommerceIntelligenceResult {
  const pages = input.pages.map((page) => {
    const kind = pageKind(page);
    const assessed = scorePage(page, kind);
    return {
      id: page.id,
      url: page.url,
      name: String(page.h1?.[0] ?? page.title ?? slugLabel(page.url)).trim() || slugLabel(page.url),
      kind,
      score: assessed.score,
      priority: priorityFor(assessed.score),
      evidenceType: "observed" as const,
      signals: assessed.signals,
      gaps: assessed.gaps,
    };
  });
  const products = pages.filter((page) => page.kind === "product");
  const collections = pages.filter((page) => page.kind === "collection");
  const guides = pages.filter((page) => page.kind === "guide");
  const weakProducts = products.filter((page) => page.score < 75);
  const weakCollections = collections.filter((page) => page.score < 75);
  const orphanCommerce = pages.filter((page) => ["product", "collection"].includes(page.kind) && page.gaps.some((gap) => gap.includes("incoming internal links")));
  const recommendations: EcommerceRecommendation[] = [];

  const productDemandMatches = products.flatMap((page) => (input.keywords ?? []).map((keyword) => ({ page, keyword, affinity: keywordPageAffinity(keyword, page) })))
    .filter((match) => match.affinity >= 50)
    .sort((left, right) => (right.keyword.averageVolume ?? 0) - (left.keyword.averageVolume ?? 0) || right.affinity - left.affinity);
  if (productDemandMatches.length) {
    const bestByPage = productDemandMatches.filter((match, index, matches) => matches.findIndex((candidate) => candidate.page.url === match.page.url) === index).slice(0, 12);
    recommendations.push(recommendation({
      category: "product_seo", title: `Prioritize ${bestByPage.length} product page${bestByPage.length === 1 ? "" : "s"} against recorded search demand`,
      explanation: "Public product pages can be matched to completed keyword evidence, allowing SEO effort to be ordered by relevance and recorded demand without assuming sales performance.",
      recommendedAction: "Review the highest-affinity product and keyword pairs first, confirm one canonical owner per intent, then improve descriptions, metadata, buyer questions, schema, images, and collection links for the approved priorities.",
      expectedImpact: "Directs product SEO effort toward the clearest evidence-backed search opportunities while keeping commercial performance unknown until supplied.",
      evidenceType: "observed",
      evidence: bestByPage.map((match) => `${match.page.name} ↔ ${match.keyword.keyword}: ${match.affinity}% relevance${match.keyword.averageVolume != null ? `, ${match.keyword.averageVolume} average searches` : ""}.`),
      affectedUrls: bestByPage.map((match) => match.page.url), priority: "high", impactScore: 93, confidenceScore: 88, destination: "content",
    }));
  }

  if (weakProducts.length) recommendations.push(recommendation({
    category: "product_seo", title: `Improve ${weakProducts.length} weak product page${weakProducts.length === 1 ? "" : "s"}`,
    explanation: "Public crawl evidence shows product pages with missing, thin, poorly linked, or structurally weak search content.",
    recommendedAction: "Prepare evidence-safe product descriptions, unique metadata, useful FAQs, Product schema corrections, image alt text, and links to the correct collection. Preserve verified product facts and never invent specifications or reviews.",
    expectedImpact: "Improves product discoverability, buyer clarity, and the quality of product-page search signals.", evidenceType: "observed", evidence: weakProducts.flatMap((page) => page.gaps.slice(0, 2)).slice(0, 12), affectedUrls: weakProducts.map((page) => page.url), priority: weakProducts.some((page) => page.priority === "critical") ? "critical" : "high", impactScore: 94, confidenceScore: 92, destination: "content",
  }));
  if (weakCollections.length || (!collections.length && products.length)) recommendations.push(recommendation({
    category: "collection_seo", title: collections.length ? `Strengthen ${weakCollections.length} collection page${weakCollections.length === 1 ? "" : "s"}` : "Create a crawlable collection structure",
    explanation: collections.length ? "Collection pages are publicly visible but do not yet provide strong category context or navigation support." : "Products were detected, but the crawl did not identify a clear collection or category owner structure.",
    recommendedAction: "Define one canonical collection owner per product family, add useful introductory copy, buyer filters or guidance, ItemList-compatible structure, and links to related products and guides.",
    expectedImpact: "Creates stronger category ownership and makes relevant products easier for customers and search systems to discover.", evidenceType: "observed", evidence: weakCollections.flatMap((page) => page.gaps.slice(0, 2)).slice(0, 12).concat(!collections.length && products.length ? ["Products were detected without a crawl-visible collection page."] : []), affectedUrls: weakCollections.map((page) => page.url), priority: "high", impactScore: 91, confidenceScore: 88, destination: "website",
  }));
  if (orphanCommerce.length) recommendations.push(recommendation({
    category: "internal_linking", title: `Repair internal discovery for ${orphanCommerce.length} commerce page${orphanCommerce.length === 1 ? "" : "s"}`,
    explanation: "Products or collections have no crawl-visible incoming internal links.", recommendedAction: "Link collections from navigation or relevant hubs, link products from their owning collections, and connect buying guides to the products they help customers evaluate.", expectedImpact: "Improves crawl paths, product discovery, and the customer journey between research and purchase.", evidenceType: "observed", evidence: orphanCommerce.map((page) => `${page.name}: no incoming internal links.`), affectedUrls: orphanCommerce.map((page) => page.url), priority: "high", impactScore: 88, confidenceScore: 96, destination: "website",
  }));
  const commercialKeywords = (input.keywords ?? []).filter((item) => /\b(?:buy|best|compare|comparison|review|under \$|vs|for)\b/i.test(item.keyword));
  if (commercialKeywords.length && !guides.length) recommendations.push(recommendation({
    category: "content", title: "Create buying guides and comparison content",
    explanation: "Commercial research topics exist in Keyword Intelligence, but the public crawl did not identify supporting buying guides or comparison pages.", recommendedAction: "Create focused guides that answer real buying decisions, compare relevant product attributes, and link directly to the owning collections and products.", expectedImpact: "Supports evaluation-stage searches and creates a clearer path from research content to products.", evidenceType: "inferred", evidence: commercialKeywords.slice(0, 10).map((item) => `Keyword opportunity: ${item.keyword}${item.averageVolume != null ? ` (${item.averageVolume} average searches)` : ""}.`), affectedUrls: [], priority: "medium", impactScore: 82, confidenceScore: 74, destination: "content",
  }));
  if (products.length >= 2) recommendations.push(recommendation({
    category: "merchandising", title: "Review complementary-product and bundle opportunities",
    explanation: "Multiple products are publicly visible, so SEnuke can propose logical product relationships, but no order history is connected to confirm purchase affinity.", recommendedAction: "Group products by customer need, compatibility, use case, and buying stage; prepare cross-sell, upsell, and bundle suggestions for human review. Label every suggestion as inferred until sales evidence is supplied.", expectedImpact: "May improve product discovery and basket-building opportunities after the relationships are verified.", evidenceType: "inferred", evidence: products.slice(0, 12).map((page) => `Public product: ${page.name}.`), affectedUrls: products.map((page) => page.url), priority: "medium", impactScore: 72, confidenceScore: 58, destination: "website",
  }));
  const seasonalSignals = (input.keywords ?? []).filter((item) => /\b(?:christmas|holiday|black friday|cyber monday|valentine|mother'?s day|father'?s day|summer|winter|spring|fall|autumn|back to school|seasonal|gift)\b/i.test(item.keyword));
  if (seasonalSignals.length) recommendations.push(recommendation({
    category: "content", title: "Plan the evidenced seasonal demand window",
    explanation: "Keyword Intelligence contains time-sensitive buying topics that may justify a campaign, guide, collection, or landing page.",
    recommendedAction: "Validate timing and inventory readiness, then prepare the appropriate seasonal collection, buying guide, internal links, metadata, email, and social assets. Keep the campaign in review until availability and promotion details are confirmed.",
    expectedImpact: "Helps the store prepare relevant pages and campaigns before the detected demand window without assuming inventory or promotion availability.",
    evidenceType: "observed", evidence: seasonalSignals.slice(0, 12).map((item) => `Seasonal keyword: ${item.keyword}.`), affectedUrls: [], priority: "medium", impactScore: 76, confidenceScore: 84, destination: "content",
  }));
  if (products.length && products.some((page) => page.gaps.some((gap) => /schema|faq|thin/i.test(gap)))) recommendations.push(recommendation({
    category: "ai_citations", title: "Improve product entity and answer readiness",
    explanation: "Important product pages lack complete public entity or buyer-answer signals.", recommendedAction: "Add verified product facts, concise buyer questions, Product and Offer schema where applicable, brand/manufacturer clarity, and source-safe supporting guidance.", expectedImpact: "Improves how search and AI systems can understand the products without promising citations or visibility.", evidenceType: "observed", evidence: products.flatMap((page) => page.gaps.filter((gap) => /schema|thin/i.test(gap)).map((gap) => `${page.name}: ${gap}`)).slice(0, 12), affectedUrls: products.map((page) => page.url), priority: "medium", impactScore: 78, confidenceScore: 80, destination: "ai_citations",
  }));

  if (products.length) recommendations.push(recommendation({
    category: "measurement", title: "Prepare a governed product-page conversion experiment",
    explanation: "Product pages are publicly visible, but the crawl cannot establish conversion performance or causal impact.",
    recommendedAction: "Select one high-priority product page, record its current product-view, add-to-cart, checkout, and purchase baseline, then test one approved change such as value clarity, proof placement, shipping information, imagery, or CTA treatment. Change only one meaningful variable and define the decision rule before launch.",
    expectedImpact: "Creates a measurable CRO learning cycle without promising a conversion lift or attributing results without evidence.",
    evidenceType: "inferred", evidence: [`${products.length} public product page${products.length === 1 ? " is" : "s are"} available for experiment selection.`, "No connected conversion baseline is assumed."], affectedUrls: products.slice(0, 12).map((page) => page.url), priority: "low", impactScore: 67, confidenceScore: 64, destination: "measurement",
  }));

  const performance = input.performance ?? [];
  const suppliedPerformanceEvidence = performance.slice(0, 10).map((item) => {
    const facts = [
      item.revenue != null ? `revenue ${item.revenue}` : "",
      item.marginPercent != null ? `margin ${item.marginPercent}%` : "",
      item.conversionRate != null ? `conversion ${item.conversionRate}%` : "",
      item.inventory != null ? `inventory ${item.inventory}` : "",
      item.orders != null ? `orders ${item.orders}` : "",
    ].filter(Boolean).join(", ");
    return `${item.productName}: ${facts || "performance record supplied"} (${item.source.replace("_", " ")}).`;
  });
  recommendations.push(recommendation({
    category: "measurement", title: performance.length ? "Use supplied product performance to refine priorities" : "Add optional product performance evidence",
    explanation: performance.length ? `${performance.length} user-provided or connected product performance record${performance.length === 1 ? " is" : "s are"} available for prioritization.` : "Public evidence cannot reveal margins, actual best sellers, inventory, revenue, conversion rate, or profitability.",
    recommendedAction: performance.length ? "Compare public search opportunity with the supplied revenue, margin, conversion, inventory, and order fields while preserving the source label. Prioritize only within this supplied dataset and do not present it as complete store performance unless the user confirms that scope." : "Optionally upload a product performance CSV or enter priority products. Keep unavailable fields unknown rather than treating them as zero.", expectedImpact: "Allows later recommendations to prioritize commercial outcomes as well as public search opportunity.", evidenceType: performance.length ? performance[0].source : "unavailable", evidence: performance.length ? suppliedPerformanceEvidence : ["No private store, order, CRM, margin, inventory, or conversion evidence is connected."], affectedUrls: [], priority: "low", impactScore: 65, confidenceScore: performance.length ? 90 : 100, destination: "measurement",
  }));

  const schemaText = input.pages.flatMap((page) => (page.schemaTypes ?? []).map(normalized));
  const publicPriceSignals = schemaText.filter((item) => item === "offer" || item === "aggregateoffer").length;
  const publicReviewSignals = schemaText.filter((item) => item === "review" || item === "aggregaterating").length;
  return {
    version: "ecommerce-public-intelligence-v1",
    generatedAt: new Date().toISOString(),
    store: { platform: String(input.platformHint || "Unknown"), pageCount: pages.length, productCount: products.length, collectionCount: collections.length, guideCount: guides.length, publicPriceSignals, publicReviewSignals },
    pages: pages.sort((a, b) => a.score - b.score),
    recommendations: recommendations.sort((a, b) => b.impactScore - a.impactScore),
    evidenceCoverage: [
      { key: "public_catalog", label: "Public product and collection evidence", status: products.length || collections.length ? "observed" : "unavailable", detail: products.length || collections.length ? `${products.length} products and ${collections.length} collections detected from crawl-visible evidence.` : "No crawl-visible product or collection structure was detected." },
      { key: "search_demand", label: "Keyword and search demand", status: (input.keywords ?? []).length ? "observed" : "unavailable", detail: (input.keywords ?? []).length ? `${input.keywords?.length} keyword-market records are available.` : "Complete Keyword Intelligence to compare the catalog with public demand." },
      { key: "commercial_performance", label: "Revenue, margin and conversion evidence", status: performance.length ? performance[0].source : "unavailable", detail: performance.length ? `${performance.length} supplied performance records are available.` : "Private store performance was not supplied and will not be inferred." },
      { key: "merchandising", label: "Cross-sell, upsell and bundle evidence", status: products.length >= 2 ? "inferred" : "unavailable", detail: products.length >= 2 ? "Suggestions can be based on public product relationships, not purchase history." : "At least two public products are needed for relationship suggestions." },
    ],
    limitations: [
      "Public crawling cannot determine margins, true best sellers, slow movers, inventory, average order value, revenue, conversion rate, profitability, or promotion performance.",
      "Cross-sell, upsell, bundle, and seasonal recommendations remain inferred until user-provided or connected performance evidence validates them.",
      "No public store change is made without approval; unsupported platforms receive a download or manual implementation brief.",
    ],
  };
}
