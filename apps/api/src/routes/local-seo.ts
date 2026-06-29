import { createHash } from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { matchLocalBusinessEntity, normalizeDomain, scoreLocalSeo, type LocalBusinessEntity, type LocalListingEntity } from "@webtummy/core";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config } from "../config.js";

export const localSeoRouter = Router();
localSeoRouter.use(requireAuth);

const SEARCH_PROVIDER_KEY = "data" + "forseo";

const businessSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().optional().nullable(),
  websiteId: z.string().optional().nullable(),
  businessName: z.string().min(2).max(180),
  domain: z.string().min(2).max(255),
  phone: z.string().min(4).max(80),
  address: z.string().min(3).max(255),
  city: z.string().min(2).max(120),
  region: z.string().max(120).optional().nullable(),
  country: z.string().min(2).max(120).default("United States"),
  postalCode: z.string().max(40).optional().nullable(),
  mainCategory: z.string().min(2).max(160),
  services: z.array(z.string().max(120)).default([]),
  targetLocations: z.array(z.string().max(120)).default([]),
  googleBusinessProfileUrl: z.string().max(512).optional().nullable(),
  googleAverageRating: z.number().min(0).max(5).optional().nullable(),
  googleReviewCount: z.number().int().min(0).optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
});

const keywordSchema = z.object({
  keywords: z.array(z.string().min(2).max(255)).min(1),
  targetLocations: z.array(z.string().min(2).max(120)).min(1),
  country: z.string().min(2).max(120).default("United States"),
  device: z.enum(["desktop", "mobile"]).default("desktop"),
  language: z.string().min(2).max(16).default("en"),
});

const keywordSuggestionSchema = z.object({
  limit: z.number().int().min(3).max(20).default(10),
  language: z.string().min(2).max(16).default("en"),
});

const citationSchema = z.object({
  source: z.string().min(2).max(120),
  found: z.boolean().default(false),
  nameMatch: z.boolean().default(false),
  phoneMatch: z.boolean().default(false),
  addressMatch: z.boolean().default(false),
  websiteMatch: z.boolean().default(false),
  status: z.string().max(40).default("missing"),
  fixUrl: z.string().max(512).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const reviewSchema = z.object({
  source: z.string().min(2).max(80),
  reviewer: z.string().max(180).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  reviewText: z.string().max(5000).optional().nullable(),
  reviewDate: z.string().datetime().optional().nullable(),
  sentiment: z.string().max(40).optional().nullable(),
  replyStatus: z.string().max(40).default("not_replied"),
});

type SearchDataPayload = { status_code?: number; status_message?: string; tasks?: { id?: string; status_code?: number; status_message?: string; result?: unknown[] }[] };
type ReviewAggregate = { rating: number | null; reviewCount: number | null; cacheId?: string | null };
type LocalMapsListing = LocalListingEntity & {
  rank?: number | null;
  rankAbsolute?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  featureId?: string | null;
  additionalCategories?: string[];
  categoryIds?: string[];
  isClaimed?: boolean | null;
  totalPhotos?: number | null;
  mainImage?: string | null;
  currentStatus?: string | null;
  hasWorkHours?: boolean;
  contactUrl?: string | null;
  bookOnlineUrl?: string | null;
};
type SerpItem = { rank: number | null; url: string | null; domain: string | null; title: string | null; raw: unknown };

type CitationSourceConfig = { source: string; domains: string[]; queryTerms: string[] };

function cleanText(value: string): string {
  return value.trim().replace(/,+$/g, "").trim();
}

function normalizeDisplayPhone(value: string): string {
  const digits = value.replace(/\D+/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length === 10) return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  return cleanText(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(cleanText).filter(Boolean) : [];
}

function normalizeKeywordText(value: string): string {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

async function openaiKeywordSuggestions(prompt: string): Promise<unknown> {
  if (!config.openaiApiKey) throw new Error("openai_not_configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You return valid JSON only. No markdown fences." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(typeof data?.error?.message === "string" ? data.error.message : "OpenAI request failed");
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI returned no content");
  return JSON.parse(content);
}

function parseKeywordSuggestions(value: unknown, existingKeywords: Set<string>, limit: number): KeywordSuggestion[] {
  const raw = (value as { suggestions?: unknown; keywords?: unknown })?.suggestions ?? (value as { keywords?: unknown })?.keywords ?? [];
  const items = Array.isArray(raw) ? raw : [];
  const seen = new Set(existingKeywords);
  const suggestions: KeywordSuggestion[] = [];
  for (const item of items) {
    const keyword = typeof item === "string" ? item : typeof (item as { keyword?: unknown })?.keyword === "string" ? String((item as { keyword: string }).keyword) : "";
    const cleaned = cleanText(keyword);
    const key = normalizeKeywordText(cleaned);
    if (!cleaned || cleaned.length < 2 || seen.has(key)) continue;
    seen.add(key);
    const reason = typeof item === "object" && item && typeof (item as { reason?: unknown }).reason === "string" ? cleanText(String((item as { reason: string }).reason)) : "Relevant local search target.";
    suggestions.push({ keyword: cleaned, reason: reason || "Relevant local search target." });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

async function suggestLocalKeywords(business: Awaited<ReturnType<typeof scopedBusiness>>, limit: number, language: string): Promise<KeywordSuggestion[]> {
  if (!business) return [];
  const services = stringList(business.services);
  const locations = stringList(business.targetLocations);
  const existingKeywords = new Set((business.keywords ?? []).map((item) => normalizeKeywordText(item.keyword)));
  const prompt = [
    "Suggest local SEO rank-tracking keywords for this business.",
    "Return JSON with key suggestions: an array of objects with keyword and reason.",
    "Keywords should be concise search phrases a customer would type, not full sentences.",
    "Mix core service, near-me intent, category, city, and high-commercial-intent variations.",
    "Do not include duplicate ideas or competitor brand names.",
    `Return at most ${limit} suggestions.`,
    `Language: ${language}`,
    `Business name: ${business.businessName}`,
    `Main category: ${business.mainCategory}`,
    `Domain: ${business.domain}`,
    `City: ${business.city}`,
    `Region: ${business.region ?? "not provided"}`,
    `Country: ${business.country}`,
    `Services: ${services.length ? services.join(", ") : "not provided"}`,
    `Target locations: ${locations.length ? locations.join(", ") : business.city}`,
    `Already tracked keywords: ${business.keywords?.length ? business.keywords.map((item) => item.keyword).join(", ") : "none"}`,
  ].join("\n");
  const generated = await openaiKeywordSuggestions(prompt);
  return parseKeywordSuggestions(generated, existingKeywords, limit);
}

type KeywordSuggestion = { keyword: string; reason: string };

const citationScanSources: CitationSourceConfig[] = [
  { source: "Google Business Profile", domains: ["google.com", "maps.google.com", "share.google"], queryTerms: ["Google Business Profile", "Google Maps"] },
  { source: "Bing Places", domains: ["bing.com", "bingplaces.com"], queryTerms: ["Bing Places", "Bing Maps"] },
  { source: "Apple Maps", domains: ["maps.apple.com", "apple.com"], queryTerms: ["Apple Maps"] },
  { source: "Facebook", domains: ["facebook.com"], queryTerms: ["Facebook"] },
  { source: "Yelp", domains: ["yelp.com", "yelp.ca"], queryTerms: ["Yelp"] },
  { source: "YellowPages", domains: ["yellowpages.com", "yellowpages.ca", "yp.ca"], queryTerms: ["YellowPages", "Yellow Pages"] },
  { source: "BBB", domains: ["bbb.org"], queryTerms: ["BBB", "Better Business Bureau"] },
];

async function scopedBusiness(req: Request, id: string) {
  const clientId = await projectClientIdForRequest(req);
  return prisma.localBusinessProfile.findFirst({
    where: { id, ...(clientId ? { clientId } : {}) },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      keywords: { orderBy: { createdAt: "desc" } },
      scores: { orderBy: { scoreDate: "desc" }, take: 20, include: { keyword: true } },
      recommendations: { where: { status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 20 },
      citations: { orderBy: { source: "asc" } },
      reviews: { orderBy: { reviewDate: "desc" }, take: 20 },
      competitors: { orderBy: [{ mapsPosition: "asc" }, { reviewCount: "desc" }], take: 20 },
    },
  });
}

async function getClientIdForRequest(req: Request, inputClientId?: string | null) {
  return projectClientIdForRequest(req, inputClientId);
}

localSeoRouter.get("/local/business", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const businesses = await prisma.localBusinessProfile.findMany({
    where: clientId ? { clientId } : {},
    orderBy: { updatedAt: "desc" },
    include: {
      website: { select: { id: true, domain: true } },
      scores: { orderBy: { scoreDate: "desc" }, take: 1 },
      _count: { select: { keywords: true, recommendations: true } },
    },
  });
  res.json({ businesses });
});

localSeoRouter.post("/local/business", async (req, res) => {
  const parsed = businessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const clientId = await getClientIdForRequest(req, input.clientId);
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  if (!input.websiteId) return res.status(400).json({ error: "Project is required for Local SEO profiles." });
  const website = await prisma.website.findFirst({ where: { id: input.websiteId, clientId } });
  if (!website) return res.status(404).json({ error: "website not found" });

  const data = {
    clientId,
    websiteId: input.websiteId,
    businessName: cleanText(input.businessName),
    domain: normalizeDomain(input.domain),
    phone: normalizeDisplayPhone(input.phone),
    address: cleanText(input.address),
    city: cleanText(input.city),
    region: input.region ? cleanText(input.region) : null,
    country: cleanText(input.country),
    postalCode: input.postalCode ? cleanText(input.postalCode) : null,
    mainCategory: cleanText(input.mainCategory),
    services: input.services,
    targetLocations: input.targetLocations,
    googleBusinessProfileUrl: input.googleBusinessProfileUrl ?? null,
    googleAverageRating: input.googleAverageRating ?? null,
    googleReviewCount: input.googleReviewCount ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  };

  if (input.id) {
    const existing = await scopedBusiness(req, input.id);
    if (!existing) return res.status(404).json({ error: "business not found" });
    const business = await prisma.localBusinessProfile.update({ where: { id: input.id }, data });
    return res.json({ business });
  }

  const business = await prisma.localBusinessProfile.create({ data });
  res.status(201).json({ business });
});

localSeoRouter.get("/local/business/:id/dashboard", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const keywordIds = business.keywords.map((keyword) => keyword.id);
  const snapshotRows = keywordIds.length
    ? await prisma.localRankSnapshot.findMany({
        where: { keywordId: { in: keywordIds } },
        orderBy: { scanDate: "desc" },
        take: Math.max(200, keywordIds.length * 10),
        include: { keyword: true },
      })
    : [];
  const seenSnapshotKeywordIds = new Set<string>();
  const latestSnapshots = snapshotRows.filter((snapshot) => {
    if (seenSnapshotKeywordIds.has(snapshot.keywordId)) return false;
    seenSnapshotKeywordIds.add(snapshot.keywordId);
    return true;
  });
  res.json({ business, latestSnapshots });
});

localSeoRouter.delete("/local/business/:id/keywords", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  await prisma.$transaction([
    prisma.localRecommendation.deleteMany({ where: { businessId: business.id } }),
    prisma.localScore.deleteMany({ where: { businessId: business.id } }),
    prisma.localKeyword.deleteMany({ where: { businessId: business.id } }),
  ]);
  res.json({ keywords: [] });
});

localSeoRouter.post("/local/business/:id/keyword-suggestions", async (req, res) => {
  const parsed = keywordSuggestionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  try {
    const suggestions = await suggestLocalKeywords(business, parsed.data.limit, parsed.data.language);
    res.json({ suggestions });
  } catch (error) {
    if (error instanceof Error && error.message === "openai_not_configured") return res.status(503).json({ error: "OpenAI is not configured" });
    res.status(500).json({ error: error instanceof Error ? error.message : "keyword suggestions failed" });
  }
});

localSeoRouter.post("/local/business/:id/keywords", async (req, res) => {
  const parsed = keywordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const input = parsed.data;
  const existing = await prisma.localKeyword.findMany({ where: { businessId: business.id } });
  const existingKeys = new Set(existing.map((item) => keywordKey(item.keyword, item.city, item.country, item.device, item.language)));
  const seenKeys = new Set(existingKeys);
  const rows = input.keywords.flatMap((keyword) => input.targetLocations.map((city) => ({
    businessId: business.id,
    keyword: keyword.trim(),
    city: city.trim(),
    country: input.country.trim(),
    device: input.device,
    language: input.language.trim().toLowerCase(),
  }))).filter((item) => {
    const key = keywordKey(item.keyword, item.city, item.country, item.device, item.language);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  if (rows.length) await prisma.localKeyword.createMany({ data: rows, skipDuplicates: true });
  res.status(201).json({ added: rows.length, keywords: await prisma.localKeyword.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" } }) });
});

localSeoRouter.get("/local/business/:id/rankings", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const snapshots = await prisma.localRankSnapshot.findMany({
    where: { keyword: { businessId: business.id } },
    orderBy: { scanDate: "desc" },
    take: 500,
    include: { keyword: true },
  });
  const ordered = [...snapshots].sort((a, b) => a.scanDate.getTime() - b.scanDate.getTime());
  const latestByKeyword = new Map<string, { organicPosition: number | null; mapsPosition: number | null; localPackPosition: number | null }>();
  const enriched = new Map<string, (typeof snapshots)[number] & { previousOrganicPosition: number | null; organicPositionChange: number | null; previousMapsPosition: number | null; mapsPositionChange: number | null; previousLocalPackPosition: number | null; localPackPositionChange: number | null }>();
  for (const snapshot of ordered) {
    const previous = latestByKeyword.get(snapshot.keywordId) ?? null;
    enriched.set(snapshot.id, {
      ...snapshot,
      previousOrganicPosition: previous?.organicPosition ?? null,
      organicPositionChange: snapshot.organicPosition != null && previous?.organicPosition != null ? snapshot.organicPosition - previous.organicPosition : null,
      previousMapsPosition: previous?.mapsPosition ?? null,
      mapsPositionChange: snapshot.mapsPosition != null && previous?.mapsPosition != null ? snapshot.mapsPosition - previous.mapsPosition : null,
      previousLocalPackPosition: previous?.localPackPosition ?? null,
      localPackPositionChange: snapshot.localPackPosition != null && previous?.localPackPosition != null ? snapshot.localPackPosition - previous.localPackPosition : null,
    });
    latestByKeyword.set(snapshot.keywordId, { organicPosition: snapshot.organicPosition, mapsPosition: snapshot.mapsPosition, localPackPosition: snapshot.localPackPosition });
  }
  res.json({ snapshots: snapshots.map((snapshot) => enriched.get(snapshot.id) ?? snapshot) });
});

localSeoRouter.get("/local/business/:id/competitors", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const competitors = await prisma.localCompetitor.findMany({ where: { businessId: business.id }, orderBy: [{ mapsPosition: "asc" }, { reviewCount: "desc" }] });
  res.json({ competitors });
});

localSeoRouter.get("/local/business/:id/citations", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  res.json({ citations: await prisma.localCitation.findMany({ where: { businessId: business.id }, orderBy: { source: "asc" } }) });
});


localSeoRouter.post("/local/business/:id/citations/scan", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });

  const citations = await scanBusinessCitations(business);
  await prisma.$transaction(citations.map((citation) => prisma.localCitation.upsert({
    where: { businessId_source: { businessId: business.id, source: citation.source } },
    create: { businessId: business.id, ...citation },
    update: { ...citation, checkedAt: new Date() },
  })));

  res.json({ citations: await prisma.localCitation.findMany({ where: { businessId: business.id }, orderBy: { source: "asc" } }) });
});

localSeoRouter.post("/local/business/:id/citations", async (req, res) => {
  const parsed = z.array(citationSchema).safeParse(req.body?.citations ?? req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  await prisma.$transaction(parsed.data.map((citation) => prisma.localCitation.upsert({
    where: { businessId_source: { businessId: business.id, source: citation.source } },
    create: { businessId: business.id, ...citation, fixUrl: citation.fixUrl ?? null, notes: citation.notes ?? null },
    update: { ...citation, fixUrl: citation.fixUrl ?? null, notes: citation.notes ?? null, checkedAt: new Date() },
  })));
  res.json({ citations: await prisma.localCitation.findMany({ where: { businessId: business.id }, orderBy: { source: "asc" } }) });
});

localSeoRouter.get("/local/business/:id/reviews", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  res.json({ reviews: await prisma.localReview.findMany({ where: { businessId: business.id }, orderBy: { reviewDate: "desc" }, take: 200 }) });
});

localSeoRouter.post("/local/business/:id/reviews", async (req, res) => {
  const parsed = z.array(reviewSchema).safeParse(req.body?.reviews ?? req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (parsed.data.length) {
    await prisma.localReview.createMany({ data: parsed.data.map((review) => ({
      businessId: business.id,
      source: review.source,
      reviewer: review.reviewer ?? null,
      rating: review.rating ?? null,
      reviewText: review.reviewText ?? null,
      reviewDate: review.reviewDate ? new Date(review.reviewDate) : null,
      sentiment: review.sentiment ?? null,
      replyStatus: review.replyStatus,
    })) });
  }
  res.status(201).json({ reviews: await prisma.localReview.findMany({ where: { businessId: business.id }, orderBy: { reviewDate: "desc" }, take: 200 }) });
});

localSeoRouter.post("/local/business/:id/audit", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const keywords = business.keywords.filter((keyword) => keyword.active);
  if (!keywords.length) return res.status(400).json({ error: "Add at least one local keyword before running an audit." });

  const [reviews, citations, competitors, websiteBasicsByKeyword] = await Promise.all([
    prisma.localReview.findMany({ where: { businessId: business.id } }),
    prisma.localCitation.findMany({ where: { businessId: business.id } }),
    prisma.localCompetitor.findMany({ where: { businessId: business.id } }),
    getWebsiteBasics(business.id),
  ]);

  const reviewStats = summarizeReviews(reviews);
  const lastKnownReviewAggregate = latestKnownReviewAggregate(business.scores);
  const citationGroups = summarizeCitations(citations);
  const competitorMedianReviewCount = median(competitors.map((competitor) => competitor.reviewCount ?? 0).filter((count) => count > 0));
  const createdScores = [];

  for (const keyword of keywords) {
    const provider = await collectProviderSignals(business, keyword);
    const websiteBasics = websiteBasicsByKeyword(keyword.keyword, keyword.city);
    const score = scoreLocalSeo({
      organicPosition: provider.organicPosition,
      mapsPosition: provider.mapsPosition,
      localPackPosition: provider.localPackPosition,
      matchConfidence: provider.match.confidence,
      listingComplete: provider.listingComplete,
      averageRating: provider.rating ?? lastKnownReviewAggregate.rating ?? reviewStats.averageRating,
      reviewCount: provider.reviewCount ?? lastKnownReviewAggregate.reviewCount ?? reviewStats.reviewCount,
      competitorMedianReviewCount,
      recentReviewCount: reviewStats.recentReviewCount,
      negativeThemeCount: reviewStats.negativeThemeCount,
      citationGroups,
      websiteBasics: websiteBasics.websiteBasics,
      contentCoverage: websiteBasics.contentCoverage,
    });

    const snapshot = await prisma.localRankSnapshot.create({
      data: {
        keywordId: keyword.id,
        organicPosition: provider.organicPosition,
        mapsPosition: provider.mapsPosition,
        localPackPosition: provider.localPackPosition,
        foundDomain: Boolean(provider.organicPosition),
        matchedBusinessName: provider.matchedBusinessName,
        confidenceScore: provider.match.confidence,
        matchStatus: provider.match.status,
        rawResponseRef: provider.rawResponseRef,
        evidenceJson: provider.evidence as Prisma.InputJsonValue,
      },
    });

    const localScore = await prisma.localScore.create({
      data: {
        businessId: business.id,
        keywordId: keyword.id,
        totalScore: score.totalScore,
        organicScore: score.organicScore,
        mapsScore: score.mapsScore,
        packScore: score.packScore,
        reviewScore: score.reviewScore,
        napScore: score.napScore,
        websiteScore: score.websiteScore,
        contentScore: Math.round(score.contentScore),
        statusLabel: score.statusLabel,
        evidenceJson: { ...score.evidence, snapshotId: snapshot.id } as Prisma.InputJsonValue,
      },
    });
    createdScores.push(localScore);
  }

  await replaceRecommendations(business.id, createdScores);
  res.status(201).json({ scores: createdScores, business: await scopedBusiness(req, business.id) });
});

localSeoRouter.post("/local/business/:id/recommendations/generate", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  await replaceRecommendations(business.id, business.scores);
  res.json({ recommendations: await prisma.localRecommendation.findMany({ where: { businessId: business.id, status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }] }) });
});

localSeoRouter.get("/local/business/:id/report", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  res.json({ business, generatedAt: new Date().toISOString(), note: "PDF export can be layered on this report payload in Phase 2." });
});


async function scanBusinessCitations(business: LocalBusinessEntity & { id: string; googleBusinessProfileUrl?: string | null; country?: string | null }) {
  const results = [];
  for (const source of citationScanSources) {
    if (source.source === "Google Business Profile" && business.googleBusinessProfileUrl) {
      results.push({
        source: source.source,
        found: true,
        nameMatch: true,
        phoneMatch: true,
        addressMatch: true,
        websiteMatch: true,
        status: "found",
        fixUrl: business.googleBusinessProfileUrl,
        notes: "Matched from stored Google Business Profile URL.",
      });
      continue;
    }
    results.push(await scanCitationSource(business, source));
  }
  return results;
}

async function scanCitationSource(business: LocalBusinessEntity & { country?: string | null }, source: CitationSourceConfig) {
  const query = buildCitationQuery(business, source);
  const payload = await cachedSearchData("citation_" + source.source, {
    keyword: query,
    ...searchCountryLocation(business.country || "Canada"),
    language_code: "en",
    device: "desktop",
    os: "windows",
    depth: 20,
  }, "/v3/serp/google/organic/live/advanced");

  const items = payload ? extractItems(payload.response).map(parseOrganicItem).filter((item): item is SerpItem => Boolean(item)) : [];
  const match = items.map((item) => ({ item, evidence: citationEvidence(business, source, item) })).find((result) => result.evidence.found);
  if (!match) {
    return {
      source: source.source,
      found: false,
      nameMatch: false,
      phoneMatch: false,
      addressMatch: false,
      websiteMatch: false,
      status: payload ? "missing" : "not_scanned",
      fixUrl: null,
      notes: payload ? "No matching " + source.source + " listing found in Google search results." : "Search data credentials are not configured.",
    };
  }

  const fullyConsistent = match.evidence.nameMatch && match.evidence.phoneMatch && match.evidence.addressMatch && match.evidence.websiteMatch;
  return {
    source: source.source,
    found: true,
    nameMatch: match.evidence.nameMatch,
    phoneMatch: match.evidence.phoneMatch,
    addressMatch: match.evidence.addressMatch,
    websiteMatch: match.evidence.websiteMatch,
    status: fullyConsistent ? "consistent" : "found",
    fixUrl: match.item.url,
    notes: "Matched " + source.source + " from Google result" + (match.item.title ? ": " + match.item.title : "") + ".",
  };
}

function buildCitationQuery(business: LocalBusinessEntity, source: CitationSourceConfig) {
  const domain = normalizeDomain(business.domain);
  const site = source.domains[0] ? "site:" + source.domains[0] : source.source;
  return ["\"" + business.businessName + "\"", business.city, domain, source.queryTerms[0], site].filter(Boolean).join(" ");
}

function citationEvidence(business: LocalBusinessEntity, source: CitationSourceConfig, item: SerpItem) {
  const resultDomain = normalizeDomain(item.url ?? item.domain ?? "");
  const sourceDomainMatch = source.domains.some((domain) => resultDomain === normalizeDomain(domain) || resultDomain.endsWith("." + normalizeDomain(domain)));
  const resultText = citationResultText(item);
  const text = normalizeText(resultText);
  const digits = normalizeDigits(resultText);
  const targetDomain = normalizeDomain(business.domain);
  const importantNameTokens = normalizeText(business.businessName).split(" ").filter((token) => token.length > 2);
  const nameMatch = importantNameTokens.length > 0 && importantNameTokens.every((token) => text.includes(token));
  const phoneMatch = normalizeDigits(business.phone).length >= 7 && digits.includes(normalizeDigits(business.phone));
  const addressTokens = normalizeText(business.address + " " + business.city).split(" ").filter((token) => token.length > 3 || /^\d+$/.test(token));
  const addressMatch = addressTokens.length >= 2 && addressTokens.filter((token) => text.includes(token)).length >= Math.min(3, addressTokens.length);
  const websiteMatch = Boolean(targetDomain && (text.includes(targetDomain) || normalizeDomain(item.url ?? "") === targetDomain));
  return { found: sourceDomainMatch && (nameMatch || websiteMatch), nameMatch, phoneMatch, addressMatch, websiteMatch };
}

function citationResultText(item: SerpItem) {
  const raw = item.raw as Record<string, unknown> | null;
  return [
    item.title,
    item.url,
    item.domain,
    stringOrNull(raw?.description),
    stringOrNull(raw?.breadcrumb),
    stringOrNull(raw?.snippet),
  ].filter(Boolean).join(" ");
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D+/g, "");
}

function keywordKey(keyword: string, city: string, country: string, device: string, language: string) {
  return [keyword, city, country, device, language].map((item) => item.trim().toLowerCase()).join("::");
}

function businessEntity(business: LocalBusinessEntity): LocalBusinessEntity {
  return business;
}

async function collectProviderSignals(business: LocalBusinessEntity & { id: string }, keyword: { keyword: string; city: string; country: string; device: string; language: string }) {
  const organicPayload = await cachedSearchData("google_organic", {
    keyword: keyword.keyword,
    location_name: searchLocationName(business, keyword.city, keyword.country),
    language_code: keyword.language,
    device: keyword.device,
    os: keyword.device === "mobile" ? "android" : "windows",
    depth: 100,
  }, "/v3/serp/google/organic/live/advanced");
  const mapsPayload = await cachedSearchData("google_maps", {
    keyword: keyword.keyword,
    location_name: searchLocationName(business, keyword.city, keyword.country),
    language_code: keyword.language,
    device: keyword.device,
    os: keyword.device === "mobile" ? "android" : "windows",
    depth: 50,
  }, "/v3/serp/google/maps/live/advanced");

  const organicItems = organicPayload ? extractItems(organicPayload.response).map(parseOrganicItem).filter((item): item is SerpItem => Boolean(item)) : [];
  const localPackListings = organicPayload ? extractLocalPackListings(organicPayload.response) : [];
  const mapsListings = mapsPayload ? extractItems(mapsPayload.response).map(parseListingItem).filter((item): item is LocalMapsListing => Boolean(item)) : [];
  const targetDomain = normalizeDomain(business.domain);
  const organic = organicItems.find((item) => item.domain === targetDomain);
  const packMatches = localPackListings.map((listing) => ({ listing, match: matchLocalBusinessEntity(businessEntity(business), listing) })).filter((item) => item.match.confidence >= 40);
  const mapMatches = mapsListings.map((listing) => ({ listing, match: matchLocalBusinessEntity(businessEntity(business), listing) })).filter((item) => item.match.confidence >= 40).sort((a, b) => b.match.confidence - a.match.confidence);
  const bestMap = mapMatches[0];
  const bestPack = packMatches.sort((a, b) => b.match.confidence - a.match.confidence)[0];
  const match = bestMap?.match ?? bestPack?.match ?? { confidence: 0, status: "no_reliable_match" as const, signals: [] };
  const listing = bestMap?.listing ?? bestPack?.listing ?? null;
  const reviewAggregate = await collectGoogleReviewAggregate(business, keyword, listing);
  const competitorComparison = buildCompetitorComparison(listing, mapsListings, businessEntity(business));

  return {
    organicPosition: organic?.rank ?? null,
    mapsPosition: numberOrNull(bestMap?.listing.rank),
    localPackPosition: numberOrNull(bestPack?.listing.rank),
    match,
    listingComplete: Boolean(listing?.website && listing?.phone && listing?.address && listing?.category),
    matchedBusinessName: listing?.name ?? null,
    rating: reviewAggregate?.rating ?? numberOrNull((listing as { rating?: number | null } | null)?.rating),
    reviewCount: reviewAggregate?.reviewCount ?? numberOrNull((listing as { reviewCount?: number | null } | null)?.reviewCount),
    rawResponseRef: [organicPayload?.cacheId, mapsPayload?.cacheId, reviewAggregate?.cacheId].filter(Boolean).join(",") || null,
    evidence: {
      organicProviderConfigured: Boolean(organicPayload),
      mapsProviderConfigured: Boolean(mapsPayload),
      googleReviewsProviderConfigured: Boolean(reviewAggregate),
      googleReviewSource: reviewAggregate ? "business_data_google_reviews" : listing ? "serp_google_maps" : null,
      domainNotFoundTop100: !organic,
      matchSignals: match.signals,
      mapsListing: listing ? mapsListingEvidence(listing) : null,
      competitorComparison,
    },
  };
}

function mapsListingEvidence(extended: LocalMapsListing) {
  return {
    name: extended.name ?? null,
    website: extended.website ?? null,
    phone: extended.phone ?? null,
    address: extended.address ?? null,
    city: extended.city ?? null,
    postalCode: extended.postalCode ?? null,
    category: extended.category ?? null,
    additionalCategories: extended.additionalCategories ?? [],
    categoryIds: extended.categoryIds ?? [],
    rank: extended.rank ?? null,
    rankAbsolute: extended.rankAbsolute ?? null,
    rating: extended.rating ?? null,
    reviewCount: extended.reviewCount ?? null,
    placeId: extended.placeId ?? null,
    cid: extended.cid ?? null,
    featureId: extended.featureId ?? null,
    gbpUrl: extended.gbpUrl ?? null,
    latitude: extended.latitude ?? null,
    longitude: extended.longitude ?? null,
    isClaimed: extended.isClaimed ?? null,
    totalPhotos: extended.totalPhotos ?? null,
    mainImage: extended.mainImage ?? null,
    currentStatus: extended.currentStatus ?? null,
    hasWorkHours: Boolean(extended.hasWorkHours),
    contactUrl: extended.contactUrl ?? null,
    bookOnlineUrl: extended.bookOnlineUrl ?? null,
  };
}

function buildCompetitorComparison(target: LocalMapsListing | null, listings: LocalMapsListing[], business: LocalBusinessEntity) {
  const targetEvidence = target ? mapsListingEvidence(target) : null;
  const competitors = listings
    .filter((listing) => matchLocalBusinessEntity(business, listing).confidence < 40)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, 2)
    .map((listing) => {
      const competitor = mapsListingEvidence(listing);
      return {
        ...competitor,
        gaps: {
          rank: gapNumber(targetEvidence?.rank, competitor.rank),
          reviews: gapNumber(targetEvidence?.reviewCount, competitor.reviewCount),
          rating: gapNumber(targetEvidence?.rating, competitor.rating),
          photos: gapNumber(targetEvidence?.totalPhotos, competitor.totalPhotos),
          categoryMatch: Boolean(targetEvidence?.category && competitor.category && targetEvidence.category === competitor.category),
          claimedGap: Boolean(competitor.isClaimed) && !Boolean(targetEvidence?.isClaimed),
          hoursGap: Boolean(competitor.hasWorkHours) && !Boolean(targetEvidence?.hasWorkHours),
        },
      };
    });
  const reviewCounts = competitors.map((competitor) => competitor.reviewCount).filter((count): count is number => typeof count === "number");
  const photoCounts = competitors.map((competitor) => competitor.totalPhotos).filter((count): count is number => typeof count === "number");
  return {
    target: targetEvidence,
    competitors,
    summary: {
      competitorCount: competitors.length,
      medianReviewCount: median(reviewCounts),
      medianPhotoCount: median(photoCounts),
      reviewGapToMedian: gapNumber(targetEvidence?.reviewCount, median(reviewCounts)),
      photoGapToMedian: gapNumber(targetEvidence?.totalPhotos, median(photoCounts)),
    },
  };
}

function gapNumber(target: unknown, competitor: unknown): number | null {
  const targetNumber = numberOrNull(target);
  const competitorNumber = numberOrNull(competitor);
  return targetNumber == null || competitorNumber == null ? null : Math.round((competitorNumber - targetNumber) * 10) / 10;
}

async function collectGoogleReviewAggregate(business: LocalBusinessEntity, keyword: { city: string; country: string; language: string }, listing: LocalListingEntity | null): Promise<ReviewAggregate | null> {
  const placeId = stringOrNull((listing as { placeId?: string | null } | null)?.placeId);
  const cid = stringOrNull((listing as { cid?: string | null } | null)?.cid);
  const taskRequest: Record<string, unknown> = {
    location_name: searchLocationName(business, keyword.city, keyword.country),
    language_code: keyword.language,
    depth: 10,
  };
  if (placeId) taskRequest.place_id = placeId;
  else if (cid) taskRequest.cid = cid;
  else taskRequest.keyword = `${business.businessName} ${business.city}`;

  const payload = await cachedSearchDataTaskGet(
    "google_reviews",
    taskRequest,
    "/v3/business_data/google/reviews/task_post",
    "/v3/business_data/google/reviews/task_get",
  );
  if (!payload) return null;
  const result = payload.response.tasks?.flatMap((task) => task.result ?? [])?.[0] as Record<string, unknown> | undefined;
  if (!result) return null;
  const rating = result.rating as Record<string, unknown> | null | undefined;
  return {
    rating: numberOrNull(rating?.value),
    reviewCount: numberOrNull(result.reviews_count ?? rating?.votes_count),
    cacheId: payload.cacheId,
  };
}

async function cachedSearchDataTaskGet(endpoint: string, request: Record<string, unknown>, postPath: string, getPath: string): Promise<{ cacheId: string; response: SearchDataPayload } | null> {
  const auth = searchDataAuth();
  if (!auth) return null;
  const cacheKey = createHash("sha256").update(JSON.stringify({ endpoint, request })).digest("hex");
  const now = new Date();
  const cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
  if (cached && cached.expiresAt > now && cached.status === "ok") return { cacheId: cached.id, response: cached.responseJson as SearchDataPayload };

  const postResponse = await fetch(`https://api.${SEARCH_PROVIDER_KEY}.com${postPath}`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify([request]),
  });
  const postPayload = await postResponse.json() as SearchDataPayload;
  const taskId = postPayload.tasks?.[0]?.id;
  let payload = postPayload;
  if (postResponse.ok && taskId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const getResponse = await fetch(`https://api.${SEARCH_PROVIDER_KEY}.com${getPath}/${taskId}`, {
        method: "GET",
        headers: { authorization: `Basic ${auth}`, accept: "application/json" },
      });
      payload = await getResponse.json() as SearchDataPayload;
      if (payload.tasks?.some((task) => (task.result ?? []).length > 0)) break;
    }
  }

  const hasResult = payload.tasks?.some((task) => (task.result ?? []).length > 0) ?? false;
  const status = (!payload.status_code || payload.status_code <= 40000) && hasResult ? "ok" : "pending";
  const expiresAt = new Date(now.getTime() + (hasResult ? 7 * 24 * 60 * 60 * 1000 : 5 * 60 * 1000));
  const row = await prisma.externalApiCache.upsert({
    where: { cacheKey },
    create: { provider: "search_data", endpoint, cacheKey, requestJson: request as Prisma.InputJsonValue, responseJson: payload as unknown as Prisma.InputJsonValue, status, expiresAt },
    update: { requestJson: request as Prisma.InputJsonValue, responseJson: payload as unknown as Prisma.InputJsonValue, status, fetchedAt: now, expiresAt },
  });
  return status === "ok" ? { cacheId: row.id, response: payload } : null;
}

async function cachedSearchData(endpoint: string, request: Record<string, unknown>, path: string): Promise<{ cacheId: string; response: SearchDataPayload } | null> {
  const auth = searchDataAuth();
  if (!auth) return null;
  const cacheKey = createHash("sha256").update(JSON.stringify({ endpoint, request })).digest("hex");
  const now = new Date();
  const cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
  if (cached && cached.expiresAt > now) return { cacheId: cached.id, response: cached.responseJson as SearchDataPayload };
  const response = await fetch(`https://api.${SEARCH_PROVIDER_KEY}.com${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify([request]),
  });
  const payload = await response.json() as SearchDataPayload;
  const hasTaskError = payload.tasks?.some((task) => typeof task.status_code === "number" && task.status_code > 40000) ?? false;
  const status = response.ok && (!payload.status_code || payload.status_code <= 40000) && !hasTaskError ? "ok" : "error";
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const requestJson = request as Prisma.InputJsonValue;
  const responseJson = payload as unknown as Prisma.InputJsonValue;
  const row = await prisma.externalApiCache.upsert({
    where: { cacheKey },
    create: { provider: "search_data", endpoint, cacheKey, requestJson, responseJson, status, expiresAt },
    update: { requestJson, responseJson, status, fetchedAt: now, expiresAt },
  });
  return status === "ok" ? { cacheId: row.id, response: payload } : null;
}

function searchLocationName(business: { region?: string | null }, city: string, country: string): string {
  const cleanCity = cleanText(city);
  const cleanCountry = cleanText(country);
  const region = provinceName(cleanText(business.region ?? ""));
  if (/^canada$/i.test(cleanCountry) && region) {
    if (/^toronto$/i.test(cleanCity) && /^ontario$/i.test(region)) return "Toronto,Toronto,Ontario,Canada";
    return [cleanCity, region, cleanCountry].filter(Boolean).join(",");
  }
  return [cleanCity, cleanCountry].filter(Boolean).join(",");
}

const SEARCH_COUNTRY_LOCATIONS = [
  { name: "Albania", isoCode: "AL", locationType: "Country", locationCode: 2008 },
  { name: "Algeria", isoCode: "DZ", locationType: "Country", locationCode: 2012 },
  { name: "Angola", isoCode: "AO", locationType: "Country", locationCode: 2024 },
  { name: "Azerbaijan", isoCode: "AZ", locationType: "Country", locationCode: 2031 },
  { name: "Argentina", isoCode: "AR", locationType: "Country", locationCode: 2032 },
  { name: "Australia", isoCode: "AU", locationType: "Country", locationCode: 2036 },
  { name: "Austria", isoCode: "AT", locationType: "Country", locationCode: 2040 },
  { name: "Bahrain", isoCode: "BH", locationType: "Country", locationCode: 2048 },
  { name: "Bangladesh", isoCode: "BD", locationType: "Country", locationCode: 2050 },
  { name: "Armenia", isoCode: "AM", locationType: "Country", locationCode: 2051 },
  { name: "Belgium", isoCode: "BE", locationType: "Country", locationCode: 2056 },
  { name: "Bolivia", isoCode: "BO", locationType: "Country", locationCode: 2068 },
  { name: "Bosnia and Herzegovina", isoCode: "BA", locationType: "Country", locationCode: 2070 },
  { name: "Brazil", isoCode: "BR", locationType: "Country", locationCode: 2076 },
  { name: "Bulgaria", isoCode: "BG", locationType: "Country", locationCode: 2100 },
  { name: "Myanmar (Burma)", isoCode: "MM", locationType: "Country", locationCode: 2104 },
  { name: "Cambodia", isoCode: "KH", locationType: "Country", locationCode: 2116 },
  { name: "Cameroon", isoCode: "CM", locationType: "Country", locationCode: 2120 },
  { name: "Canada", isoCode: "CA", locationType: "Country", locationCode: 2124 },
  { name: "Sri Lanka", isoCode: "LK", locationType: "Country", locationCode: 2144 },
  { name: "Chile", isoCode: "CL", locationType: "Country", locationCode: 2152 },
  { name: "Taiwan", isoCode: "TW", locationType: "Region", locationCode: 2158 },
  { name: "Colombia", isoCode: "CO", locationType: "Country", locationCode: 2170 },
  { name: "Costa Rica", isoCode: "CR", locationType: "Country", locationCode: 2188 },
  { name: "Croatia", isoCode: "HR", locationType: "Country", locationCode: 2191 },
  { name: "Cyprus", isoCode: "CY", locationType: "Country", locationCode: 2196 },
  { name: "Czechia", isoCode: "CZ", locationType: "Country", locationCode: 2203 },
  { name: "Denmark", isoCode: "DK", locationType: "Country", locationCode: 2208 },
  { name: "Ecuador", isoCode: "EC", locationType: "Country", locationCode: 2218 },
  { name: "El Salvador", isoCode: "SV", locationType: "Country", locationCode: 2222 },
  { name: "Estonia", isoCode: "EE", locationType: "Country", locationCode: 2233 },
  { name: "Finland", isoCode: "FI", locationType: "Country", locationCode: 2246 },
  { name: "France", isoCode: "FR", locationType: "Country", locationCode: 2250 },
  { name: "Germany", isoCode: "DE", locationType: "Country", locationCode: 2276 },
  { name: "Ghana", isoCode: "GH", locationType: "Country", locationCode: 2288 },
  { name: "Greece", isoCode: "GR", locationType: "Country", locationCode: 2300 },
  { name: "Guatemala", isoCode: "GT", locationType: "Country", locationCode: 2320 },
  { name: "Hong Kong", isoCode: "HK", locationType: "Region", locationCode: 2344 },
  { name: "Hungary", isoCode: "HU", locationType: "Country", locationCode: 2348 },
  { name: "India", isoCode: "IN", locationType: "Country", locationCode: 2356 },
  { name: "Indonesia", isoCode: "ID", locationType: "Country", locationCode: 2360 },
  { name: "Ireland", isoCode: "IE", locationType: "Country", locationCode: 2372 },
  { name: "Israel", isoCode: "IL", locationType: "Country", locationCode: 2376 },
  { name: "Italy", isoCode: "IT", locationType: "Country", locationCode: 2380 },
  { name: "Cote d'Ivoire", isoCode: "CI", locationType: "Country", locationCode: 2384 },
  { name: "Japan", isoCode: "JP", locationType: "Country", locationCode: 2392 },
  { name: "Kazakhstan", isoCode: "KZ", locationType: "Country", locationCode: 2398 },
  { name: "Jordan", isoCode: "JO", locationType: "Country", locationCode: 2400 },
  { name: "Kenya", isoCode: "KE", locationType: "Country", locationCode: 2404 },
  { name: "South Korea", isoCode: "KR", locationType: "Country", locationCode: 2410 },
  { name: "Latvia", isoCode: "LV", locationType: "Country", locationCode: 2428 },
  { name: "Lithuania", isoCode: "LT", locationType: "Country", locationCode: 2440 },
  { name: "Malaysia", isoCode: "MY", locationType: "Country", locationCode: 2458 },
  { name: "Malta", isoCode: "MT", locationType: "Country", locationCode: 2470 },
  { name: "Mexico", isoCode: "MX", locationType: "Country", locationCode: 2484 },
  { name: "Monaco", isoCode: "MC", locationType: "Country", locationCode: 2492 },
  { name: "Moldova", isoCode: "MD", locationType: "Country", locationCode: 2498 },
  { name: "Morocco", isoCode: "MA", locationType: "Country", locationCode: 2504 },
  { name: "Netherlands", isoCode: "NL", locationType: "Country", locationCode: 2528 },
  { name: "New Zealand", isoCode: "NZ", locationType: "Country", locationCode: 2554 },
  { name: "Nicaragua", isoCode: "NI", locationType: "Country", locationCode: 2558 },
  { name: "Nigeria", isoCode: "NG", locationType: "Country", locationCode: 2566 },
  { name: "Norway", isoCode: "NO", locationType: "Country", locationCode: 2578 },
  { name: "Pakistan", isoCode: "PK", locationType: "Country", locationCode: 2586 },
  { name: "Panama", isoCode: "PA", locationType: "Country", locationCode: 2591 },
  { name: "Paraguay", isoCode: "PY", locationType: "Country", locationCode: 2600 },
  { name: "Peru", isoCode: "PE", locationType: "Country", locationCode: 2604 },
  { name: "Philippines", isoCode: "PH", locationType: "Country", locationCode: 2608 },
  { name: "Poland", isoCode: "PL", locationType: "Country", locationCode: 2616 },
  { name: "Portugal", isoCode: "PT", locationType: "Country", locationCode: 2620 },
  { name: "Romania", isoCode: "RO", locationType: "Country", locationCode: 2642 },
  { name: "Saudi Arabia", isoCode: "SA", locationType: "Country", locationCode: 2682 },
  { name: "Senegal", isoCode: "SN", locationType: "Country", locationCode: 2686 },
  { name: "Serbia", isoCode: "RS", locationType: "Country", locationCode: 2688 },
  { name: "Singapore", isoCode: "SG", locationType: "Country", locationCode: 2702 },
  { name: "Slovakia", isoCode: "SK", locationType: "Country", locationCode: 2703 },
  { name: "Vietnam", isoCode: "VN", locationType: "Country", locationCode: 2704 },
  { name: "Slovenia", isoCode: "SI", locationType: "Country", locationCode: 2705 },
  { name: "South Africa", isoCode: "ZA", locationType: "Country", locationCode: 2710 },
  { name: "Spain", isoCode: "ES", locationType: "Country", locationCode: 2724 },
  { name: "Sweden", isoCode: "SE", locationType: "Country", locationCode: 2752 },
  { name: "Switzerland", isoCode: "CH", locationType: "Country", locationCode: 2756 },
  { name: "Thailand", isoCode: "TH", locationType: "Country", locationCode: 2764 },
  { name: "United Arab Emirates", isoCode: "AE", locationType: "Country", locationCode: 2784 },
  { name: "Tunisia", isoCode: "TN", locationType: "Country", locationCode: 2788 },
  { name: "Turkiye", isoCode: "TR", locationType: "Country", locationCode: 2792 },
  { name: "Ukraine", isoCode: "UA", locationType: "Country", locationCode: 2804 },
  { name: "North Macedonia", isoCode: "MK", locationType: "Country", locationCode: 2807 },
  { name: "Egypt", isoCode: "EG", locationType: "Country", locationCode: 2818 },
  { name: "United Kingdom", isoCode: "GB", locationType: "Country", locationCode: 2826 },
  { name: "United States", isoCode: "US", locationType: "Country", locationCode: 2840 },
  { name: "Burkina Faso", isoCode: "BF", locationType: "Country", locationCode: 2854 },
  { name: "Uruguay", isoCode: "UY", locationType: "Country", locationCode: 2858 },
  { name: "Venezuela", isoCode: "VE", locationType: "Country", locationCode: 2862 },
] as const;

type SearchCountryLocation = (typeof SEARCH_COUNTRY_LOCATIONS)[number];

function searchCountryLocationInfo(value: string): SearchCountryLocation | null {
  const normalized = normalizeText(value);
  return SEARCH_COUNTRY_LOCATIONS.find((location) => normalizeText(location.name) === normalized || location.isoCode.toLowerCase() === normalized) ?? null;
}

function searchCountryLocation(country: string): { location_code: number } | { location_name: string } {
  const match = searchCountryLocationInfo(country);
  return match ? { location_code: match.locationCode } : { location_name: country };
}

function provinceName(value: string): string {
  const key = value.trim().toLowerCase();
  const map: Record<string, string> = { on: "Ontario", ontario: "Ontario", bc: "British Columbia", ab: "Alberta", qc: "Quebec", mb: "Manitoba", sk: "Saskatchewan", ns: "Nova Scotia", nb: "New Brunswick", nl: "Newfoundland and Labrador", pe: "Prince Edward Island" };
  return map[key] ?? value;
}

function searchDataAuth(): string | null {
  const legacyPrefix = "DATA" + "FOR" + "SEO";
  const login = process.env.SEARCH_DATA_PROVIDER_LOGIN || process.env[`${legacyPrefix}_LOGIN`];
  const password = process.env.SEARCH_DATA_PROVIDER_PASSWORD || process.env[`${legacyPrefix}_PASSWORD`];
  return process.env.SEARCH_DATA_PROVIDER_AUTH_BASE64 || process.env[`${legacyPrefix}_AUTH_BASE64`] || (login && password ? Buffer.from(`${login}:${password}`).toString("base64") : null);
}

function extractItems(payload: SearchDataPayload): unknown[] {
  return payload.tasks?.flatMap((task) => task.result ?? []).flatMap((result: any) => Array.isArray(result?.items) ? result.items : []) ?? [];
}

function extractLocalPackListings(payload: SearchDataPayload): Array<LocalListingEntity & { rank?: number | null }> {
  return extractItems(payload).flatMap((item: any) => {
    if (item?.type !== "local_pack" && item?.type !== "local_pack_element") return [];
    const children = Array.isArray(item?.items) ? item.items : Array.isArray(item?.rectangle) ? item.rectangle : [item];
    return children.map(parseListingItem).filter(Boolean) as Array<LocalListingEntity & { rank?: number | null }>;
  });
}

function parseOrganicItem(item: any): SerpItem | null {
  if (item?.type && item.type !== "organic") return null;
  const url = stringOrNull(item?.url ?? item?.breadcrumb_url);
  const domain = normalizeDomain(url);
  if (!url || !domain) return null;
  return { rank: numberOrNull(item?.rank_group ?? item?.rank_absolute), url, domain, title: stringOrNull(item?.title), raw: item };
}

function parseListingItem(item: any): LocalMapsListing | null {
  const name = stringOrNull(item?.title ?? item?.name);
  if (!name) return null;
  return {
    name,
    website: stringOrNull(item?.url ?? item?.website ?? item?.domain),
    phone: stringOrNull(item?.phone),
    address: stringOrNull(item?.address ?? item?.address_info?.address),
    city: stringOrNull(item?.address_info?.city),
    postalCode: stringOrNull(item?.address_info?.zip),
    category: stringOrNull(item?.category ?? item?.main_category),
    placeId: stringOrNull(item?.place_id),
    cid: stringOrNull(item?.cid),
    featureId: stringOrNull(item?.feature_id),
    gbpUrl: stringOrNull(item?.url),
    latitude: numberOrNull(item?.latitude ?? item?.gps_coordinates?.latitude),
    longitude: numberOrNull(item?.longitude ?? item?.gps_coordinates?.longitude),
    rank: numberOrNull(item?.rank_group ?? item?.rank_absolute),
    rankAbsolute: numberOrNull(item?.rank_absolute),
    rating: numberOrNull(item?.rating?.value ?? item?.rating),
    reviewCount: numberOrNull(item?.rating?.votes_count ?? item?.reviews_count),
    additionalCategories: Array.isArray(item?.additional_categories) ? item.additional_categories.filter((category: unknown): category is string => typeof category === "string") : [],
    categoryIds: Array.isArray(item?.category_ids) ? item.category_ids.filter((category: unknown): category is string => typeof category === "string") : [],
    isClaimed: typeof item?.is_claimed === "boolean" ? item.is_claimed : null,
    totalPhotos: numberOrNull(item?.total_photos),
    mainImage: stringOrNull(item?.main_image),
    currentStatus: stringOrNull(item?.work_hours?.current_status),
    hasWorkHours: Boolean(item?.work_hours?.timetable),
    contactUrl: stringOrNull(item?.contact_url),
    bookOnlineUrl: stringOrNull(item?.book_online_url),
  };
}

async function getWebsiteBasics(businessId: string) {
  const business = await prisma.localBusinessProfile.findUnique({ where: { id: businessId }, include: { website: true } });
  if (!business?.websiteId) return () => ({ websiteBasics: {}, contentCoverage: {} });
  const crawl = await prisma.crawlJob.findFirst({ where: { websiteId: business.websiteId, status: "completed" }, orderBy: { completedAt: "desc" } });
  if (!crawl) return () => ({ websiteBasics: {}, contentCoverage: {} });
  const pages = await prisma.page.findMany({ where: { crawlJobId: crawl.id, statusCode: { gte: 200, lt: 400 } }, include: { seo: true, schemas: true }, take: 500 });
  return (keyword: string, city: string) => {
    const key = normalizeText(keyword);
    const loc = normalizeText(city);
    const phone = normalizeText(business.phone);
    const address = normalizeText(business.address);
    const matchingPages = pages.filter((page) => pageMatches(page.url, page.seo?.title, key, loc));
    const schemaTypes = pages.flatMap((page) => page.schemas.map((schema) => schema.schemaType ?? ""));
    return {
      websiteBasics: {
        titleMetaLocal: pages.some((page) => textHas(page.seo?.title, key, loc) || textHas(page.seo?.metaDescription, key, loc)),
        h1ContentLocal: pages.some((page) => textHas(JSON.stringify(page.seo?.h1Text ?? []), key, loc)),
        napVisible: pages.some((page) => normalizeText(`${page.seo?.title ?? ""} ${page.seo?.metaDescription ?? ""}`).includes(phone) || normalizeText(`${page.seo?.title ?? ""} ${page.seo?.metaDescription ?? ""}`).includes(address)),
        localSchema: schemaTypes.some((type) => /localbusiness|organization|professionalservice/i.test(type)),
        technicalPass: (crawl.siteScore ?? 0) >= 70,
      },
      contentCoverage: {
        servicePage: matchingPages.some((page) => normalizeText(page.url).includes(key.split(" ")[0] ?? key)),
        cityPage: matchingPages.some((page) => normalizeText(page.url).includes(loc) || textHas(page.seo?.title, "", loc)),
        articleCoverage: matchingPages.some((page) => /blog|article|guide|faq/i.test(page.url)),
        competitorDepth: pages.filter((page) => page.wordCount && page.wordCount >= 900).length >= 3,
      },
    };
  };
}

function latestKnownReviewAggregate(scores: Array<{ evidenceJson: unknown }>) {
  for (const score of scores) {
    const evidence = score.evidenceJson && typeof score.evidenceJson === "object" && !Array.isArray(score.evidenceJson) ? score.evidenceJson as Record<string, unknown> : {};
    const rating = numberOrNull(evidence.averageRating);
    const reviewCount = numberOrNull(evidence.reviewCount);
    if (rating != null || reviewCount != null) return { rating, reviewCount };
  }
  return { rating: null, reviewCount: null };
}

function summarizeReviews(reviews: Array<{ rating: number | null; reviewDate: Date | null; sentiment: string | null }>) {
  const ratings = reviews.map((review) => review.rating).filter((rating): rating is number => typeof rating === "number");
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  return {
    averageRating: ratings.length ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10 : null,
    reviewCount: ratings.length,
    recentReviewCount: reviews.filter((review) => review.reviewDate && review.reviewDate.getTime() >= cutoff).length,
    negativeThemeCount: reviews.filter((review) => review.sentiment === "negative").length,
  };
}

function summarizeCitations(citations: Array<{ source: string; found: boolean; nameMatch: boolean; phoneMatch: boolean; addressMatch: boolean; websiteMatch: boolean; status: string }>) {
  const consistent = (source: string) => citations.some((citation) => normalizeText(citation.source).includes(source) && citation.found && citation.nameMatch && citation.phoneMatch && citation.addressMatch && citation.websiteMatch);
  const directories = citations.filter((citation) => citation.found && citation.nameMatch && citation.phoneMatch && citation.addressMatch && !/(google|bing|apple|facebook)/i.test(citation.source)).length;
  return {
    google: consistent("google"),
    bing: consistent("bing") || consistent("microsoft"),
    apple: consistent("apple"),
    facebook: consistent("facebook"),
    directories,
    noDuplicates: !citations.some((citation) => /duplicate|conflict/i.test(citation.status)),
  };
}

async function replaceRecommendations(businessId: string, scores: Array<{ totalScore: number; organicScore: number; mapsScore: number; packScore: number; reviewScore: number; napScore: number; websiteScore: number; contentScore: number }>) {
  const latest = scores[0];
  if (!latest) return;
  const recs: Array<{ priority: string; category: string; recommendation: string; expectedImpact: string }> = [];
  if (latest.organicScore === 0) recs.push({ priority: "critical", category: "Organic visibility", recommendation: "Create or optimize a dedicated service plus city page and support it with internally linked SEO articles.", expectedImpact: "Improves discoverability when the domain is not found in the top 100 organic results." });
  if (latest.mapsScore < 10) recs.push({ priority: "high", category: "Google Maps", recommendation: "Improve Google Business Profile category, services, photos, reviews, citations, and location-specific content.", expectedImpact: "Targets Maps rank and entity confidence signals." });
  if (latest.packScore < 8) recs.push({ priority: "high", category: "Local pack", recommendation: "Prioritize GBP completeness, review growth, citation consistency, and a stronger local landing page.", expectedImpact: "Increases the chance of appearing in the local pack." });
  if (latest.reviewScore < 10) recs.push({ priority: "medium", category: "Reviews", recommendation: "Run a review campaign and set a monthly review goal based on the competitor median.", expectedImpact: "Closes reputation and conversion gaps." });
  if (latest.napScore < 10) recs.push({ priority: "medium", category: "NAP consistency", recommendation: "Fix missing or inconsistent Google, Bing, Apple Maps, Facebook, Yelp, BBB, and industry directory listings.", expectedImpact: "Improves entity trust and listing consistency." });
  if (latest.websiteScore < 8) recs.push({ priority: "medium", category: "Website local SEO", recommendation: "Add service plus city title/meta/H1 copy, visible NAP, LocalBusiness schema, and technical fixes from the latest crawl.", expectedImpact: "Strengthens organic and local entity signals." });
  if (latest.contentScore < 4) recs.push({ priority: "low", category: "Content coverage", recommendation: "Build service pages, city pages, FAQs, and local SEO articles around competitor content gaps.", expectedImpact: "Creates more local ranking surfaces." });
  if (latest.totalScore < 50) recs.push({ priority: "critical", category: "Action plan", recommendation: "Your local visibility is weak. Start with GBP, citations, reviews, and dedicated service plus city content.", expectedImpact: "Focuses the first sprint on the highest-impact local presence gaps." });
  await prisma.$transaction([
    prisma.localRecommendation.updateMany({ where: { businessId, status: "open" }, data: { status: "replaced" } }),
    ...recs.map((rec) => prisma.localRecommendation.create({ data: { businessId, ...rec } })),
  ]);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

function pageMatches(url: string, title: string | null | undefined, keyword: string, city: string) {
  const text = normalizeText(`${url} ${title ?? ""}`);
  return keyword.split(" ").filter(Boolean).some((token) => text.includes(token)) && (!city || text.includes(city));
}

function textHas(value: string | null | undefined, keyword: string, city: string) {
  const text = normalizeText(value);
  return (!keyword || keyword.split(" ").filter(Boolean).some((token) => text.includes(token))) && (!city || text.includes(city));
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
