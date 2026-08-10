import { createHash } from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { Worker } from "bullmq";
import { approvedKeywordEntries, matchLocalBusinessEntity, missingApprovedKeywordResearch, normalizeDomain, normalizeKeywordPhrase, scoreLocalSeo, type LocalBusinessEntity, type LocalListingEntity } from "@webtummy/core";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config, LOCAL_GRID_SCAN_QUEUE, LOCAL_SEO_AUDIT_QUEUE } from "../config.js";
import { createWorkspaceNotification, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { localGridScanQueue, localSeoAuditQueue, queueConnection, type LocalGridScanQueueJobData, type LocalSeoAuditQueueJobData } from "../queue.js";
import { publishProjectWorkflowEvent } from "../project-workflow-controller.js";
import { centralAiJson } from "../central-ai-service.js";
import { cleanGeographicTargetMarkets, projectAnalysisLocationLabels } from "../project-location.js";

export const localSeoRouter = Router();
localSeoRouter.use(requireAuth);

const SEARCH_PROVIDER_KEY = "data" + "forseo";

const businessSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
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
  secondaryCategories: z.array(z.string().max(160)).optional(),
  services: z.array(z.string().max(120)).default([]),
  targetLocations: z.array(z.string().max(120)).default([]),
  serviceAreas: z.array(z.string().max(180)).optional(),
  businessHours: z.record(z.unknown()).optional(),
  locationName: z.string().max(180).optional().nullable(),
  locationType: z.enum(["physical", "service_area", "hybrid"]).optional(),
  googleBusinessProfileUrl: z.string().max(512).optional().nullable(),
  googleBusinessAccountRef: z.string().max(191).optional().nullable(),
  googleBusinessConnectionStatus: z.enum(["not_connected", "pending", "connected", "failed", "revoked"]).optional(),
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
  sync: z.boolean().default(false),
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

const gridConfigurationSchema = z.object({ keywordId: z.string(), name: z.string().trim().min(2).max(180), gridSize: z.number().int().min(3).max(21).refine((value) => value % 2 === 1, "Grid size must be an odd number."), radiusKm: z.number().positive().max(100), centerLatitude: z.number().min(-90).max(90), centerLongitude: z.number().min(-180).max(180), device: z.enum(["desktop", "mobile"]).default("mobile"), language: z.string().min(2).max(16).default("en"), engine: z.enum(["google_maps", "google_local_pack"]).default("google_maps"), resultDepth: z.number().int().min(3).max(100).default(20), schedule: z.enum(["manual", "weekly", "biweekly", "monthly"]).default("monthly"), movementThreshold: z.number().min(1).max(100).default(10) });
const gridScanResultSchema = z.object({ points: z.array(z.object({ rowIndex: z.number().int().min(0), columnIndex: z.number().int().min(0), latitude: z.number(), longitude: z.number(), rank: z.number().int().positive().optional().nullable(), found: z.boolean(), matchedName: z.string().max(180).optional().nullable(), confidence: z.number().int().min(0).max(100).default(0), evidence: z.record(z.unknown()).default({}) })).min(1).max(441), competitors: z.array(z.object({ businessName: z.string().min(2).max(180), domain: z.string().max(255).optional().nullable(), averageRank: z.number().positive().optional().nullable(), top3Share: z.number().min(0).max(100).optional().nullable(), top10Share: z.number().min(0).max(100).optional().nullable(), evidence: z.record(z.unknown()).default({}) })).max(50).default([]), summary: z.record(z.unknown()).default({}) });

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
  const generated = await centralAiJson({
    system: "You create evidence-grounded Local SEO keyword suggestions. Return valid JSON only and never invent a business location, service, demand metric, or ranking.",
    prompt,
    temperature: 0.35,
    maxInputBytes: 48_000,
    maxOutputTokens: 4_000,
  });
  return generated.result;
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
  const locations = cleanGeographicTargetMarkets(stringList(business.targetLocations));
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
      scores: { orderBy: { scoreDate: "desc" }, take: 500, include: { keyword: true } },
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
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const businesses = await prisma.localBusinessProfile.findMany({
    where: { ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}) },
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
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, clientId, websiteId: input.websiteId } });
    if (!project) return res.status(404).json({ error: "project not found" });
  }

  const data = {
    clientId,
    projectId: input.projectId,
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
    secondaryCategories: input.secondaryCategories,
    services: input.services,
    targetLocations: cleanGeographicTargetMarkets(input.targetLocations),
    serviceAreas: input.serviceAreas,
    businessHours: input.businessHours as Prisma.InputJsonValue | undefined,
    locationName: input.locationName ? cleanText(input.locationName) : null,
    locationType: input.locationType,
    googleBusinessProfileUrl: input.googleBusinessProfileUrl ?? null,
    googleBusinessAccountRef: input.googleBusinessAccountRef ?? null,
    googleBusinessConnectionStatus: input.googleBusinessConnectionStatus,
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
  const targetLocations = cleanGeographicTargetMarkets(input.targetLocations);
  if (!targetLocations.length) return res.status(400).json({
    error: "Choose at least one named city, neighbourhood, region, province or state, or country before saving Local SEO targets.",
  });
  if (business.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: business.projectId },
      select: {
        targetLocations: true,
        businessLocationJson: true,
        keywordGroups: { select: { status: true, keywords: true } },
        keywordResearchRuns: { select: { seedKeyword: true, status: true, locationName: true, languageCode: true, device: true, createdAt: true } },
      },
    });
    const approvedKeywords = approvedKeywordEntries(project?.keywordGroups ?? []);
    const missingKeywords = missingApprovedKeywordResearch(project?.keywordGroups ?? [], project?.keywordResearchRuns ?? [], projectAnalysisLocationLabels(project?.targetLocations, project?.businessLocationJson));
    if (!approvedKeywords.length || missingKeywords.length) return res.status(409).json({
      error: !approvedKeywords.length
        ? "Approve Primary or Secondary keywords and complete Keyword Analysis before adding Local SEO tracking targets."
        : `Complete Keyword Analysis for all approved Primary and Secondary keywords before adding Local SEO tracking targets. ${missingKeywords.length} still need analysis.`,
    });
    const approvedSet = new Set(approvedKeywords.map(normalizeKeywordPhrase));
    const unapproved = input.keywords.filter((keyword) => !approvedSet.has(normalizeKeywordPhrase(keyword)));
    if (unapproved.length) return res.status(409).json({ error: `Local SEO can track only approved Primary and Secondary keywords. Approve these first: ${unapproved.slice(0, 8).join(", ")}${unapproved.length > 8 ? "…" : ""}` });
  }
  const existing = await prisma.localKeyword.findMany({ where: { businessId: business.id } });
  const existingKeys = new Set(existing.map((item) => keywordKey(item.keyword, item.city, item.country, item.device, item.language)));
  const requestedRows = input.keywords.flatMap((keyword) => targetLocations.map((city) => ({
    businessId: business.id,
    keyword: keyword.trim(),
    city: city.trim(),
    country: input.country.trim(),
    device: input.device,
    language: input.language.trim().toLowerCase(),
  })));
  const requestedKeys = new Set<string>();
  const uniqueRequestedRows = requestedRows.filter((item) => {
    const key = keywordKey(item.keyword, item.city, item.country, item.device, item.language);
    if (requestedKeys.has(key)) return false;
    requestedKeys.add(key);
    return true;
  });
  const matchedIds = existing.filter((item) => requestedKeys.has(keywordKey(item.keyword, item.city, item.country, item.device, item.language))).map((item) => item.id);
  const rows = uniqueRequestedRows.filter((item) => !existingKeys.has(keywordKey(item.keyword, item.city, item.country, item.device, item.language)));
  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (input.sync) operations.push(prisma.localKeyword.updateMany({ where: { businessId: business.id }, data: { active: false } }));
  if (matchedIds.length) operations.push(prisma.localKeyword.updateMany({ where: { id: { in: matchedIds } }, data: { active: true } }));
  if (rows.length) operations.push(prisma.localKeyword.createMany({ data: rows, skipDuplicates: true }));
  if (operations.length) await prisma.$transaction(operations);
  const keywords = await prisma.localKeyword.findMany({ where: { businessId: business.id, active: true }, orderBy: { createdAt: "desc" } });
  res.status(201).json({ added: rows.length, synchronized: input.sync, targetCount: keywords.length, keywords });
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

async function auditBusiness(businessId: string) {
  return prisma.localBusinessProfile.findUnique({
    where: { id: businessId },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      keywords: { orderBy: { createdAt: "desc" } },
      scores: { orderBy: { scoreDate: "desc" }, take: 500, include: { keyword: true } },
      recommendations: { where: { status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 20 },
      citations: { orderBy: { source: "asc" } },
      reviews: { orderBy: { reviewDate: "desc" }, take: 20 },
      competitors: { orderBy: [{ mapsPosition: "asc" }, { reviewCount: "desc" }], take: 20 },
    },
  });
}

async function performLocalSeoAudit(jobId: string) {
  const job = await prisma.localSeoAuditJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Local SEO audit job not found.");
  const business = await auditBusiness(job.businessId);
  if (!business) throw new Error("Local SEO business profile not found.");
  const keywords = business.keywords.filter((keyword) => keyword.active);
  if (!keywords.length) throw new Error("Add at least one local keyword before running an audit.");

  const started = await prisma.localSeoAuditJob.updateMany({ where: { id: job.id, status: { in: ["queued", "running"] } }, data: { status: "running", stage: "checking_rankings", progress: 1, totalTargets: keywords.length, completedTargets: 0, startedAt: new Date(), error: null } });
  if (!started.count) return 0;

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

  // A project commonly has many keyword/location combinations. Process a
  // small number concurrently so the audit remains usable without flooding
  // the search provider or forcing every target to wait sequentially.
  const concurrency = 4;
  for (let index = 0; index < keywords.length; index += concurrency) {
    const liveJob = await prisma.localSeoAuditJob.findUnique({ where: { id: job.id }, select: { status: true } });
    if (!liveJob || !["queued", "running"].includes(liveJob.status)) throw new Error("Local SEO audit was stopped before completion.");
    const batch = keywords.slice(index, index + concurrency);
    const batchScores = await Promise.all(batch.map(async (keyword) => {
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

      return prisma.localScore.create({
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
    }));
    createdScores.push(...batchScores);
    const completedTargets = Math.min(keywords.length, index + batch.length);
    await prisma.localSeoAuditJob.update({ where: { id: job.id }, data: { completedTargets, progress: Math.max(1, Math.min(95, Math.round(completedTargets / keywords.length * 95))) } });
  }

  const jobBeforeSave = await prisma.localSeoAuditJob.findUnique({ where: { id: job.id }, select: { status: true } });
  if (!jobBeforeSave || !["queued", "running"].includes(jobBeforeSave.status)) throw new Error("Local SEO audit was stopped before completion.");
  await prisma.localSeoAuditJob.update({ where: { id: job.id }, data: { stage: "saving_results", progress: 97 } });
  await replaceRecommendations(business.id, createdScores);
  const project = await prisma.project.findFirst({
    where: {
      clientId: business.clientId,
      OR: [
        ...(business.projectId ? [{ id: business.projectId }] : []),
        ...(business.websiteId ? [{ websiteId: business.websiteId }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (project && createdScores.length) {
    const average = (key: "totalScore" | "organicScore" | "mapsScore" | "packScore" | "reviewScore" | "napScore" | "websiteScore" | "contentScore") => Math.round(createdScores.reduce((sum, item) => sum + item[key], 0) / createdScores.length);
    const scoreSummary = { total: average("totalScore"), organic: average("organicScore"), maps: average("mapsScore"), localPack: average("packScore"), reviews: average("reviewScore"), nap: average("napScore"), website: average("websiteScore"), content: average("contentScore") };
    const weakest = Object.entries(scoreSummary).filter(([key]) => key !== "total").sort((left, right) => left[1] - right[1])[0] ?? ["local visibility", scoreSummary.total];
    const fingerprint = `local-audit:${project.id}:${business.id}`;
    const dedupeKey = `local-audit:${business.id}`;
    await prisma.$transaction(async (tx) => {
      await tx.growthSignal.upsert({
        where: { fingerprint },
        create: { projectId: project.id, fingerprint, category: "local_seo", signalKey: "local_visibility_audit", sourceType: "local_seo_audit", sourceId: business.id, valueJson: scoreSummary, confidence: 90, collectedAt: new Date(), effectiveDate: new Date() },
        update: { valueJson: scoreSummary, confidence: 90, collectedAt: new Date(), effectiveDate: new Date(), freshnessStatus: "fresh" },
      });
      const existingNba = await tx.nextBestAction.findFirst({ where: { projectId: project.id, dedupeKey } });
      const nbaData = { projectId: project.id, sourceType: "local_seo_audit", sourceId: business.id, title: `Improve ${String(weakest[0]).replace(/([A-Z])/g, " $1")} local signals`, recommendation: `Review the new Local Growth Plan and approve the highest-confidence action addressing ${String(weakest[0])}.`, reasoningSummary: `The latest evidence-backed Local SEO audit scored ${scoreSummary.total}/100. ${String(weakest[0])} is currently the weakest measured area.`, expectedImpact: "Improve local relevance, trust and measurable search visibility without promising rankings.", confidence: 90, estimatedEffort: "medium", route: "local_seo", priorityScore: Math.max(45, 100 - scoreSummary.total), evidenceJson: { businessId: business.id, scores: scoreSummary, weakestArea: weakest[0] }, actionType: "local_seo", approvalType: "user_approval", riskLevel: "low", dedupeKey, status: "proposed" } as const;
      if (existingNba) await tx.nextBestAction.update({ where: { id: existingNba.id }, data: nbaData });
      else await tx.nextBestAction.create({ data: nbaData });
      if (job.workspaceId) await tx.workspaceActivity.create({ data: { workspaceId: job.workspaceId, actorUserId: job.requestedById, action: "local_seo.audit_completed", entityType: "local_business_profile", entityId: business.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { scores: scoreSummary, keywordTargets: createdScores.length, weakestArea: weakest[0] } } });
    });
  }
  await prisma.localSeoAuditJob.update({ where: { id: job.id }, data: { status: "completed", stage: "completed", progress: 100, completedTargets: keywords.length, resultCount: createdScores.length, completedAt: new Date(), error: null } });
  if (project?.id) await publishProjectWorkflowEvent({ projectId: project.id, eventType: "intelligence.local_seo_completed", sourceModule: "local_seo", sourceId: job.id, idempotencyKey: `local-seo.completed:${job.id}`, payload: { businessId: business.id, resultCount: createdScores.length } }).catch(() => undefined);
  if (job.workspaceId && job.requestedById) await prisma.workspaceNotification.create({ data: { workspaceId: job.workspaceId, userId: job.requestedById, type: "local_seo_audit_completed", title: "Local ranking check completed", body: `${business.businessName}: ${createdScores.length} keyword-location ranking checks are ready to review.`, actionUrl: `/local-seo?projectId=${project?.id ?? job.projectId ?? ""}&businessId=${business.id}`, projectId: project?.id ?? job.projectId, agencyClientId: project?.agencyClientId, emailEligible: false, emailStatus: "disabled" } }).catch(() => undefined);
  return createdScores.length;
}

async function enqueueLocalSeoAudit(jobId: string) {
  const existing = await localSeoAuditQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (!["completed", "failed", "unknown"].includes(state)) return;
    await existing.remove().catch(() => undefined);
  }
  await localSeoAuditQueue.add("local-seo:audit", { jobId }, { jobId, removeOnComplete: 200, removeOnFail: 200 });
}

localSeoRouter.post("/local/business/:id/audit", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const keywords = business.keywords.filter((keyword) => keyword.active);
  if (!keywords.length) return res.status(400).json({ error: "Add at least one local keyword before running an audit." });
  const active = await prisma.localSeoAuditJob.findFirst({ where: { businessId: business.id, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" } });
  if (active) return res.status(202).json({ job: active, reused: true });
  const context = await workspaceContext(req);
  const project = await prisma.project.findFirst({ where: { clientId: business.clientId, OR: [...(business.projectId ? [{ id: business.projectId }] : []), ...(business.websiteId ? [{ websiteId: business.websiteId }] : [])] }, orderBy: { updatedAt: "desc" } });
  const job = await prisma.localSeoAuditJob.create({ data: { clientId: business.clientId, projectId: project?.id ?? business.projectId, businessId: business.id, workspaceId: context.workspace.id, requestedById: context.membership.userId, totalTargets: keywords.length } });
  try { await enqueueLocalSeoAudit(job.id); }
  catch (error) {
    await prisma.localSeoAuditJob.update({ where: { id: job.id }, data: { status: "failed", stage: "queue_failed", error: error instanceof Error ? error.message : "Could not queue Local SEO audit", completedAt: new Date() } });
    throw error;
  }
  res.status(202).json({ job });
});

localSeoRouter.get("/local/audits/:jobId", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const job = await prisma.localSeoAuditJob.findFirst({ where: { id: req.params.jobId, ...(clientId ? { clientId } : {}) } });
  if (!job) return res.status(404).json({ error: "Local SEO audit job not found." });
  res.json({ job });
});

localSeoRouter.post("/local/audits/:jobId/manage", async (req, res) => {
  z.object({ action: z.literal("cancel") }).parse(req.body ?? {});
  const clientId = await projectClientIdForRequest(req);
  const job = await prisma.localSeoAuditJob.findFirst({ where: { id: req.params.jobId, ...(clientId ? { clientId } : {}) } });
  if (!job) return res.status(404).json({ error: "Local SEO audit job not found." });
  if (!["queued", "running"].includes(job.status)) return res.status(409).json({ error: "Only queued or running Local SEO work can be cancelled." });
  await prisma.localSeoAuditJob.update({
    where: { id: job.id },
    data: { status: "cancelled", stage: "cancelled_by_user", error: "Local SEO audit was cancelled. Run it again when ready.", completedAt: new Date() },
  });
  const queueJob = await localSeoAuditQueue.getJob(job.id);
  if (queueJob) {
    const state = await queueJob.getState().catch(() => "unknown");
    if (state !== "active") await queueJob.remove().catch(() => undefined);
  }
  return res.json({ job: await prisma.localSeoAuditJob.findUnique({ where: { id: job.id } }) });
});

localSeoRouter.get("/local/business/:id/audits/latest", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const job = await prisma.localSeoAuditJob.findFirst({ where: { businessId: business.id }, orderBy: { createdAt: "desc" } });
  res.json({ job });
});

let localSeoAuditWorker: Worker<LocalSeoAuditQueueJobData> | null = null;
let localSeoQueueWatchdog: ReturnType<typeof setInterval> | null = null;
const LOCAL_SEO_AUDIT_STALE_AFTER_MS = 60 * 60 * 1000;
const LOCAL_GRID_STALE_AFTER_MS = 60 * 60 * 1000;

async function expireStaleLocalSeoWork() {
  const auditCutoff = new Date(Date.now() - LOCAL_SEO_AUDIT_STALE_AFTER_MS);
  const gridCutoff = new Date(Date.now() - LOCAL_GRID_STALE_AFTER_MS);
  const [audits, grids] = await Promise.all([
    prisma.localSeoAuditJob.findMany({ where: { status: { in: ["queued", "running"] }, updatedAt: { lt: auditCutoff } }, select: { id: true } }),
    prisma.localGridScan.findMany({ where: { status: { in: ["queued", "running"] }, createdAt: { lt: gridCutoff } }, select: { id: true } }),
  ]);
  for (const audit of audits) {
    await prisma.localSeoAuditJob.updateMany({ where: { id: audit.id, status: { in: ["queued", "running"] } }, data: { status: "failed", stage: "timed_out", error: "Local SEO audit exceeded 60 minutes and was stopped. Retry the audit.", completedAt: new Date() } });
    const queueJob = await localSeoAuditQueue.getJob(audit.id);
    if (queueJob && await queueJob.getState().catch(() => "unknown") !== "active") await queueJob.remove().catch(() => undefined);
  }
  for (const grid of grids) {
    await prisma.localGridScan.updateMany({ where: { id: grid.id, status: { in: ["queued", "running"] } }, data: { status: "failed", errorMessage: "Local grid scan exceeded 60 minutes and was stopped. Retry the scan.", completedAt: new Date() } });
    const queueJob = await localGridScanQueue.getJob(grid.id);
    if (queueJob && await queueJob.getState().catch(() => "unknown") !== "active") await queueJob.remove().catch(() => undefined);
  }
  if (audits.length || grids.length) console.info(`[api] queue watchdog expired ${audits.length} Local SEO audit(s) and ${grids.length} local grid scan(s)`);
}
export function startLocalSeoAuditQueueWorker() {
  if (localSeoAuditWorker) return localSeoAuditWorker;
  localSeoAuditWorker = new Worker<LocalSeoAuditQueueJobData>(LOCAL_SEO_AUDIT_QUEUE, async (queueJob) => {
    const record = await prisma.localSeoAuditJob.findUnique({ where: { id: queueJob.data.jobId }, select: { status: true } });
    if (!record || ["completed", "failed", "cancelled"].includes(record.status)) return;
    try { await performLocalSeoAudit(queueJob.data.jobId); }
    catch (error) {
      await prisma.localSeoAuditJob.updateMany({ where: { id: queueJob.data.jobId, status: { in: ["queued", "running"] } }, data: { status: "failed", stage: "failed", error: error instanceof Error ? error.message : "Local ranking check failed.", completedAt: new Date() } });
    }
  }, { connection: queueConnection, concurrency: 1 });
  localSeoAuditWorker.on("failed", (queueJob, error) => console.error(`[api] local SEO audit ${queueJob?.data.jobId ?? "unknown"} failed:`, error.message));
  void expireStaleLocalSeoWork().then(() => prisma.localSeoAuditJob.findMany({ where: { status: { in: ["queued", "running"] }, updatedAt: { gte: new Date(Date.now() - LOCAL_SEO_AUDIT_STALE_AFTER_MS) } }, orderBy: { createdAt: "asc" }, select: { id: true } })).then(async (jobs) => {
    for (const job of jobs) {
      await prisma.localSeoAuditJob.update({ where: { id: job.id }, data: { status: "queued", stage: "queued_recovered", error: null } });
      await enqueueLocalSeoAudit(job.id);
    }
  }).catch((error) => console.error("[api] local SEO audit recovery failed:", error));
  if (!localSeoQueueWatchdog) {
    localSeoQueueWatchdog = setInterval(() => { void expireStaleLocalSeoWork().catch((error) => console.error("[api] Local SEO queue watchdog failed:", error)); }, 60_000);
    localSeoQueueWatchdog.unref?.();
  }
  return localSeoAuditWorker;
}

type GridPointInput = {
  rowIndex: number;
  columnIndex: number;
  latitude: number;
  longitude: number;
};

function gridPointsForConfiguration(configuration: { gridSize: number; radiusKm: number; centerLatitude: number; centerLongitude: number }): GridPointInput[] {
  const half = (configuration.gridSize - 1) / 2;
  const latStep = configuration.radiusKm / 111 / Math.max(1, half);
  const lonStep = configuration.radiusKm / (111 * Math.max(0.2, Math.cos(configuration.centerLatitude * Math.PI / 180))) / Math.max(1, half);
  return Array.from({ length: configuration.gridSize ** 2 }, (_, index) => {
    const rowIndex = Math.floor(index / configuration.gridSize);
    const columnIndex = index % configuration.gridSize;
    return {
      rowIndex,
      columnIndex,
      latitude: configuration.centerLatitude + (half - rowIndex) * latStep,
      longitude: configuration.centerLongitude + (columnIndex - half) * lonStep,
    };
  });
}

function gridZoom(radiusKm: number) {
  if (radiusKm <= 2) return 15;
  if (radiusKm <= 5) return 14;
  if (radiusKm <= 10) return 13;
  if (radiusKm <= 25) return 12;
  return 11;
}

async function performLocalGridScan(scanId: string) {
  const scan = await prisma.localGridScan.findUnique({
    where: { id: scanId },
    include: { configuration: { include: { keyword: { include: { business: true } } } } },
  });
  if (!scan) return;
  if (scan.status === "completed") return;
  if (!searchDataAuth()) throw new Error("Local grid ranking provider is not configured.");

  const configuration = scan.configuration;
  const keyword = configuration.keyword;
  const business = keyword.business;
  const requestedPoints = gridPointsForConfiguration(configuration);
  const started = await prisma.localGridScan.updateMany({
    where: { id: scan.id, status: { in: ["queued", "running"] } },
    data: {
      status: "running",
      errorMessage: null,
      summaryJson: { keyword: keyword.keyword, city: keyword.city, engine: configuration.engine, pointCount: requestedPoints.length, completedPoints: 0, progress: 1 },
    },
  });
  if (!started.count) return;

  const points: Array<GridPointInput & { rank: number | null; found: boolean; matchedName: string | null; confidence: number; evidence: Record<string, unknown> }> = [];
  const competitorRanks = new Map<string, { businessName: string; domain: string | null; ranks: number[]; evidence: Record<string, unknown> }>();

  for (let index = 0; index < requestedPoints.length; index += 1) {
    const liveScan = await prisma.localGridScan.findUnique({ where: { id: scan.id }, select: { status: true } });
    if (!liveScan || !["queued", "running"].includes(liveScan.status)) throw new Error("Local grid scan was stopped before completion.");
    const point = requestedPoints[index];
    const locationCoordinate = `${point.latitude.toFixed(7)},${point.longitude.toFixed(7)},${gridZoom(configuration.radiusKm)}z`;
    const payload = await cachedSearchData("google_maps_grid", {
      keyword: keyword.keyword,
      location_coordinate: locationCoordinate,
      language_code: configuration.language,
      device: configuration.device,
      os: configuration.device === "mobile" ? "android" : "windows",
      depth: configuration.resultDepth,
    }, "/v3/serp/google/maps/live/advanced");
    if (!payload) throw new Error(`The ranking provider did not return results for grid point ${index + 1}.`);

    const listings = extractItems(payload.response).map(parseListingItem).filter((item): item is LocalMapsListing => Boolean(item));
    const matches = listings
      .map((listing) => ({ listing, match: matchLocalBusinessEntity(businessEntity(business), listing) }))
      .filter((item) => item.match.confidence >= 40)
      .sort((left, right) => right.match.confidence - left.match.confidence || (left.listing.rank ?? 999) - (right.listing.rank ?? 999));
    const matched = matches[0];
    const rank = numberOrNull(matched?.listing.rank);
    points.push({
      ...point,
      rank,
      found: rank != null,
      matchedName: matched?.listing.name ?? null,
      confidence: matched?.match.confidence ?? 0,
      evidence: { cacheId: payload.cacheId, locationCoordinate, matchSignals: matched?.match.signals ?? [] },
    });

    for (const listing of listings) {
      if (matchLocalBusinessEntity(businessEntity(business), listing).confidence >= 40) continue;
      const listingRank = numberOrNull(listing.rank);
      if (listingRank == null) continue;
      const domain = normalizeDomain(listing.website ?? "") || null;
      const key = listing.placeId || domain || normalizeText(listing.name);
      const current = competitorRanks.get(key) ?? { businessName: listing.name, domain, ranks: [], evidence: { placeId: listing.placeId ?? null } };
      current.ranks.push(listingRank);
      competitorRanks.set(key, current);
    }

    if ((index + 1) % 3 === 0 || index === requestedPoints.length - 1) {
      await prisma.localGridScan.update({
        where: { id: scan.id },
        data: { summaryJson: { keyword: keyword.keyword, city: keyword.city, engine: configuration.engine, pointCount: requestedPoints.length, completedPoints: index + 1, progress: Math.max(1, Math.round((index + 1) / requestedPoints.length * 95)) } },
      });
    }
  }

  const competitors = [...competitorRanks.values()].map((competitor) => ({
    businessName: competitor.businessName,
    domain: competitor.domain,
    averageRank: competitor.ranks.reduce((sum, rank) => sum + rank, 0) / competitor.ranks.length,
    top3Share: competitor.ranks.filter((rank) => rank <= 3).length / requestedPoints.length * 100,
    top10Share: competitor.ranks.filter((rank) => rank <= 10).length / requestedPoints.length * 100,
    evidence: { ...competitor.evidence, observedPoints: competitor.ranks.length },
  })).sort((left, right) => left.averageRank - right.averageRank).slice(0, 20);
  const ranks = points.flatMap((point) => point.rank ?? []);
  const averageRank = ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null;
  const top3Share = points.filter((point) => point.rank != null && point.rank <= 3).length / points.length * 100;
  const top10Share = points.filter((point) => point.rank != null && point.rank <= 10).length / points.length * 100;
  const weakAreaCount = points.filter((point) => point.rank == null || point.rank > 10).length;
  const previous = await prisma.localGridScan.findFirst({ where: { configurationId: configuration.id, status: "completed", id: { not: scan.id } }, orderBy: { scanDate: "desc" } });
  const deltaTop10Share = previous?.top10Share != null ? top10Share - previous.top10Share : null;

  const scanBeforeSave = await prisma.localGridScan.findUnique({ where: { id: scan.id }, select: { status: true } });
  if (!scanBeforeSave || !["queued", "running"].includes(scanBeforeSave.status)) throw new Error("Local grid scan was stopped before completion.");
  await prisma.$transaction(async (tx) => {
    await tx.localGridPoint.deleteMany({ where: { scanId: scan.id } });
    await tx.localGridCompetitor.deleteMany({ where: { scanId: scan.id } });
    await tx.localGridPoint.createMany({ data: points.map((point) => ({ scanId: scan.id, rowIndex: point.rowIndex, columnIndex: point.columnIndex, latitude: point.latitude, longitude: point.longitude, rank: point.rank, found: point.found, matchedName: point.matchedName, confidence: point.confidence, evidenceJson: point.evidence as Prisma.InputJsonValue })) });
    if (competitors.length) await tx.localGridCompetitor.createMany({ data: competitors.map((competitor) => ({ scanId: scan.id, businessName: competitor.businessName, domain: competitor.domain, averageRank: competitor.averageRank, top3Share: competitor.top3Share, top10Share: competitor.top10Share, evidenceJson: competitor.evidence as Prisma.InputJsonValue })) });
    await tx.localGridScan.update({ where: { id: scan.id }, data: { status: "completed", averageRank, top3Share, top10Share, weakAreaCount, summaryJson: { keyword: keyword.keyword, city: keyword.city, engine: configuration.engine, pointCount: points.length, completedPoints: points.length, progress: 100, deltaTop10Share }, completedAt: new Date(), errorMessage: null } });
  });

  const project = business.projectId
    ? await prisma.project.findFirst({ where: { id: business.projectId, status: { not: "deleted" } } })
    : business.websiteId
      ? await prisma.project.findFirst({ where: { websiteId: business.websiteId, status: { not: "deleted" } }, orderBy: { updatedAt: "desc" } })
      : null;
  if (project && weakAreaCount > 0) {
    const dedupeKey = `local-grid:${configuration.id}`;
    const existing = await prisma.nextBestAction.findFirst({ where: { projectId: project.id, dedupeKey } });
    const data = {
      projectId: project.id,
      sourceType: "local_grid_scan",
      sourceId: scan.id,
      title: `Improve weak local visibility for “${keyword.keyword}”`,
      recommendation: `Review the ${weakAreaCount} weak geographic points and route the fix to the relevant location page, Google Business Profile, citation, review, technical SEO, or authority workflow.`,
      reasoningSummary: `The ${configuration.gridSize}×${configuration.gridSize} scan found ${top3Share.toFixed(1)}% top-3 coverage and ${top10Share.toFixed(1)}% top-10 coverage across ${points.length} measured points.`,
      expectedImpact: "Improve measurable local-pack coverage across the selected service area without promising rankings.",
      confidence: ranks.length ? 85 : 55,
      estimatedEffort: "medium",
      route: "local_seo",
      priorityScore: weakAreaCount / points.length >= 0.5 ? 85 : 65,
      evidenceJson: { gridScanId: scan.id, configurationId: configuration.id, averageRank, top3Share, top10Share, weakAreaCount, deltaTop10Share, competitors } as Prisma.InputJsonValue,
      actionType: "local_seo",
      approvalType: "user_approval",
      riskLevel: "low",
      dedupeKey,
      status: "proposed",
    };
    if (existing) await prisma.nextBestAction.update({ where: { id: existing.id }, data });
    else await prisma.nextBestAction.create({ data });
  }
}

async function enqueueLocalGridScan(scanId: string) {
  const existing = await localGridScanQueue.getJob(scanId);
  if (existing) {
    const state = await existing.getState();
    if (!["completed", "failed", "unknown"].includes(state)) return;
    await existing.remove().catch(() => undefined);
  }
  await localGridScanQueue.add("local-grid:scan", { scanId }, { jobId: scanId, removeOnComplete: 200, removeOnFail: 200 });
}

let localGridScanWorker: Worker<LocalGridScanQueueJobData> | null = null;
let localGridScheduleTimer: ReturnType<typeof setInterval> | null = null;

async function enqueueDueLocalGridScans() {
  if (!searchDataAuth()) return;
  const configurations = await prisma.localGridConfiguration.findMany({
    where: { active: true, schedule: { in: ["weekly", "biweekly", "monthly"] } },
    include: { keyword: true, scans: { orderBy: { scanDate: "desc" }, take: 1 } },
  });
  const now = Date.now();
  const intervalDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
  for (const configuration of configurations) {
    const latest = configuration.scans[0];
    if (!latest || activeStatusForGrid(latest.status)) continue;
    const days = intervalDays[configuration.schedule] ?? 30;
    if (now - latest.scanDate.getTime() < days * 24 * 60 * 60 * 1000) continue;
    const requestedPoints = gridPointsForConfiguration(configuration);
    const scan = await prisma.localGridScan.create({ data: { configurationId: configuration.id, status: "queued", summaryJson: { requestedPoints, keyword: configuration.keyword.keyword, city: configuration.keyword.city, engine: configuration.engine, resultDepth: configuration.resultDepth, scheduled: true } } });
    await enqueueLocalGridScan(scan.id);
  }
}

function activeStatusForGrid(status: string) {
  return status === "queued" || status === "running";
}

export function startLocalGridScanQueueWorker() {
  if (localGridScanWorker) return localGridScanWorker;
  localGridScanWorker = new Worker<LocalGridScanQueueJobData>(LOCAL_GRID_SCAN_QUEUE, async (queueJob) => {
    const record = await prisma.localGridScan.findUnique({ where: { id: queueJob.data.scanId }, select: { status: true } });
    if (!record || ["completed", "failed", "cancelled"].includes(record.status)) return;
    try { await performLocalGridScan(queueJob.data.scanId); }
    catch (error) {
      await prisma.localGridScan.updateMany({ where: { id: queueJob.data.scanId, status: { in: ["queued", "running"] } }, data: { status: "failed", errorMessage: error instanceof Error ? error.message : "Local grid scan failed.", completedAt: new Date() } });
      throw error;
    }
  }, { connection: queueConnection, concurrency: 1 });
  localGridScanWorker.on("failed", (queueJob, error) => console.error(`[api] local grid scan ${queueJob?.data.scanId ?? "unknown"} failed:`, error.message));
  void expireStaleLocalSeoWork().then(() => prisma.localGridScan.findMany({ where: { status: { in: ["queued", "running"] }, createdAt: { gte: new Date(Date.now() - LOCAL_GRID_STALE_AFTER_MS) } }, orderBy: { scanDate: "asc" }, select: { id: true } })).then(async (scans) => {
    for (const scan of scans) {
      await prisma.localGridScan.update({ where: { id: scan.id }, data: { status: "queued", errorMessage: null } });
      await enqueueLocalGridScan(scan.id);
    }
  }).catch((error) => console.error("[api] local grid scan recovery failed:", error));
  void enqueueDueLocalGridScans().catch((error) => console.error("[api] scheduled local grid scan check failed:", error));
  if (!localGridScheduleTimer) {
    localGridScheduleTimer = setInterval(() => { void enqueueDueLocalGridScans().catch((error) => console.error("[api] scheduled local grid scan check failed:", error)); }, 15 * 60 * 1000);
    localGridScheduleTimer.unref?.();
  }
  return localGridScanWorker;
}

localSeoRouter.post("/local/business/:id/recommendations/generate", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  await replaceRecommendations(business.id, business.scores);
  res.json({ recommendations: await prisma.localRecommendation.findMany({ where: { businessId: business.id, status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }] }) });
});

localSeoRouter.post("/local/business/:id/grid-center", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (business.latitude != null && business.longitude != null) return res.json({ latitude: business.latitude, longitude: business.longitude, source: "saved_profile" });
  const keyword = business.keywords.find((item) => item.active) ?? business.keywords[0];
  const payload = await cachedSearchData("google_maps_grid_center", {
    keyword: [business.businessName, business.address, business.city].filter(Boolean).join(" "),
    location_name: searchLocationName(business, keyword?.city || business.city, keyword?.country || business.country),
    language_code: keyword?.language || "en",
    device: "desktop",
    os: "windows",
    depth: 20,
  }, "/v3/serp/google/maps/live/advanced");
  if (!payload) return res.status(503).json({ error: "Business-location lookup is unavailable. Confirm the search-data provider or enter coordinates manually." });
  const matches = extractItems(payload.response)
    .map(parseListingItem)
    .filter((item): item is LocalMapsListing => Boolean(item?.latitude != null && item?.longitude != null))
    .map((listing) => ({ listing, match: matchLocalBusinessEntity(businessEntity(business), listing) }))
    .filter((item) => item.match.confidence >= 40)
    .sort((left, right) => right.match.confidence - left.match.confidence);
  const best = matches[0];
  if (best?.listing.latitude == null || best.listing.longitude == null) return res.status(422).json({ error: "We could not confidently match this business to map coordinates. Confirm the business name, address and phone, or enter coordinates manually." });
  await prisma.localBusinessProfile.update({ where: { id: business.id }, data: { latitude: best.listing.latitude, longitude: best.listing.longitude } });
  res.json({ latitude: best.listing.latitude, longitude: best.listing.longitude, source: "google_maps", matchedBusinessName: best.listing.name, confidence: best.match.confidence });
});

localSeoRouter.get("/local/business/:id/grids", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const configurations = await prisma.localGridConfiguration.findMany({ where: { keyword: { businessId: business.id } }, orderBy: { updatedAt: "desc" }, include: { keyword: true, scans: { orderBy: { scanDate: "desc" }, take: 12, include: { points: { orderBy: [{ rowIndex: "asc" }, { columnIndex: "asc" }] }, competitors: { orderBy: { averageRank: "asc" } } } } } });
  res.json({ configurations });
});

localSeoRouter.post("/local/business/:id/grids", async (req, res) => {
  const parsed = gridConfigurationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (!business.keywords.some((keyword) => keyword.id === parsed.data.keywordId)) return res.status(404).json({ error: "tracked keyword not found" });
  const configuration = await prisma.localGridConfiguration.create({ data: parsed.data });
  res.status(201).json({ configuration });
});

localSeoRouter.patch("/local/business/:id/grids/:configurationId", async (req, res) => {
  const parsed = gridConfigurationSchema.partial().omit({ keywordId: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const existing = await prisma.localGridConfiguration.findFirst({ where: { id: req.params.configurationId, keyword: { businessId: business.id } } });
  if (!existing) return res.status(404).json({ error: "grid configuration not found" });
  const configuration = await prisma.localGridConfiguration.update({ where: { id: existing.id }, data: parsed.data });
  res.json({ configuration });
});

localSeoRouter.post("/local/business/:id/grids/:configurationId/scans", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const configuration = await prisma.localGridConfiguration.findFirst({ where: { id: req.params.configurationId, active: true, keyword: { businessId: business.id } }, include: { keyword: true } });
  if (!configuration) return res.status(404).json({ error: "active grid configuration not found" });
  const activeScan = await prisma.localGridScan.findFirst({ where: { configurationId: configuration.id, status: { in: ["queued", "running"] } }, orderBy: { scanDate: "desc" } });
  if (activeScan) return res.status(202).json({ scan: activeScan, reused: true });
  const requestedPoints = gridPointsForConfiguration(configuration);
  const scan = await prisma.localGridScan.create({ data: { configurationId: configuration.id, status: "queued", summaryJson: { requestedPoints, keyword: configuration.keyword.keyword, city: configuration.keyword.city, engine: configuration.engine, resultDepth: configuration.resultDepth } } });
  try { await enqueueLocalGridScan(scan.id); }
  catch (error) {
    await prisma.localGridScan.update({ where: { id: scan.id }, data: { status: "failed", errorMessage: error instanceof Error ? error.message : "Could not queue local grid scan.", completedAt: new Date() } });
    throw error;
  }
  res.status(202).json({ scan, requestedPoints });
});

localSeoRouter.post("/local/business/:id/grids/:configurationId/scans/:scanId/manage", async (req, res) => {
  z.object({ action: z.literal("cancel") }).parse(req.body ?? {});
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const scan = await prisma.localGridScan.findFirst({ where: { id: req.params.scanId, configurationId: req.params.configurationId, configuration: { keyword: { businessId: business.id } } } });
  if (!scan) return res.status(404).json({ error: "grid scan not found" });
  if (!["queued", "running"].includes(scan.status)) return res.status(409).json({ error: "Only queued or running grid scans can be cancelled." });
  await prisma.localGridScan.update({ where: { id: scan.id }, data: { status: "cancelled", errorMessage: "Local grid scan was cancelled. Run it again when ready.", completedAt: new Date() } });
  const queueJob = await localGridScanQueue.getJob(scan.id);
  if (queueJob) {
    const state = await queueJob.getState().catch(() => "unknown");
    if (state !== "active") await queueJob.remove().catch(() => undefined);
  }
  return res.json({ scan: await prisma.localGridScan.findUnique({ where: { id: scan.id } }) });
});

localSeoRouter.post("/local/business/:id/grids/:configurationId/scans/:scanId/complete", async (req, res) => {
  const parsed = gridScanResultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const scan = await prisma.localGridScan.findFirst({ where: { id: req.params.scanId, configurationId: req.params.configurationId, configuration: { keyword: { businessId: business.id } } }, include: { configuration: { include: { keyword: true } } } });
  if (!scan) return res.status(404).json({ error: "grid scan not found" });
  const ranks = parsed.data.points.flatMap((point) => point.rank ?? []);
  const averageRank = ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null;
  const top3Share = parsed.data.points.length ? parsed.data.points.filter((point) => point.rank != null && point.rank <= 3).length / parsed.data.points.length * 100 : 0;
  const top10Share = parsed.data.points.length ? parsed.data.points.filter((point) => point.rank != null && point.rank <= 10).length / parsed.data.points.length * 100 : 0;
  const weakAreaCount = parsed.data.points.filter((point) => point.rank == null || point.rank > 10).length;
  const previous = await prisma.localGridScan.findFirst({ where: { configurationId: scan.configurationId, status: "completed", id: { not: scan.id } }, orderBy: { scanDate: "desc" } });
  const delta = previous?.top10Share != null ? top10Share - previous.top10Share : null;
  const project = business.projectId
    ? await prisma.project.findFirst({ where: { id: business.projectId, status: { not: "deleted" } } })
    : business.websiteId
      ? await prisma.project.findFirst({ where: { websiteId: business.websiteId, status: { not: "deleted" } }, orderBy: { updatedAt: "desc" } })
      : null;
  const context = await workspaceContext(req);
  const completed = await prisma.$transaction(async (tx) => {
    await tx.localGridPoint.deleteMany({ where: { scanId: scan.id } });
    await tx.localGridCompetitor.deleteMany({ where: { scanId: scan.id } });
    await tx.localGridPoint.createMany({ data: parsed.data.points.map((point) => ({ scanId: scan.id, rowIndex: point.rowIndex, columnIndex: point.columnIndex, latitude: point.latitude, longitude: point.longitude, rank: point.rank, found: point.found, matchedName: point.matchedName, confidence: point.confidence, evidenceJson: point.evidence })) });
    if (parsed.data.competitors.length) await tx.localGridCompetitor.createMany({ data: parsed.data.competitors.map((competitor) => ({ scanId: scan.id, businessName: competitor.businessName, domain: competitor.domain, averageRank: competitor.averageRank, top3Share: competitor.top3Share, top10Share: competitor.top10Share, evidenceJson: competitor.evidence })) });
    const row = await tx.localGridScan.update({ where: { id: scan.id }, data: { status: "completed", averageRank, top3Share, top10Share, weakAreaCount, summaryJson: { ...parsed.data.summary, deltaTop10Share: delta, pointCount: parsed.data.points.length }, completedAt: new Date() } });
    if (project && weakAreaCount > 0) await tx.nextBestAction.create({ data: { projectId: project.id, sourceType: "local_grid_scan", sourceId: scan.id, title: `Improve weak local visibility for “${scan.configuration.keyword.keyword}”`, recommendation: `Review the ${weakAreaCount} weak grid areas and route the highest-confidence cause to location content, Google Business Profile, citations/reviews, technical SEO, or authority work.`, reasoningSummary: `The completed ${scan.configuration.gridSize}×${scan.configuration.gridSize} scan has ${top3Share.toFixed(1)}% top-3 coverage, ${top10Share.toFixed(1)}% top-10 coverage, and ${weakAreaCount} weak points${delta == null ? "" : `; top-10 coverage changed ${delta.toFixed(1)} points`}.`, expectedImpact: "Increase local-pack coverage and qualified local visibility across the configured service area.", confidence: ranks.length ? 85 : 55, estimatedEffort: "medium", route: "local_seo", priorityScore: weakAreaCount / parsed.data.points.length >= .5 ? 85 : 65, evidenceJson: { gridScanId: scan.id, configurationId: scan.configurationId, averageRank, top3Share, top10Share, weakAreaCount, deltaTop10Share: delta, competitors: parsed.data.competitors } } });
    if (project) await recordWorkspaceActivity(tx, { context, action: "local_grid.scan_completed", entityType: "local_grid_scan", entityId: scan.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { averageRank, top3Share, top10Share, weakAreaCount, delta } });
    if (project && delta != null && Math.abs(delta) >= scan.configuration.movementThreshold) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: delta < 0 ? "local_grid_decline" : "local_grid_improvement", title: delta < 0 ? "Local grid visibility declined" : "Local grid visibility improved", body: `${scan.configuration.keyword.keyword}: top-10 grid coverage changed ${delta.toFixed(1)} percentage points.`, actionUrl: `/local-seo?projectId=${project.id}&businessId=${business.id}&gridId=${scan.configurationId}&scanId=${scan.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
    return row;
  });
  res.json({ scan: completed, summary: { averageRank, top3Share, top10Share, weakAreaCount, deltaTop10Share: delta } });
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
