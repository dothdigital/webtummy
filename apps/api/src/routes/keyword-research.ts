import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { parseHtml } from "@webtummy/core";
import { requireAuth, tenantScope } from "../middleware.js";
import "../config.js";

export const keywordResearchRouter = Router();
keywordResearchRouter.use(requireAuth);

const KEYWORD_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const UNRESTRICTED_REFRESH_EMAILS = new Set(["manishjetly@gmail.com"]);
const refreshableStatuses = ["queued", "running", "completed"];

const createSchema = z.object({
  websiteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  seedKeyword: z.string().min(2),
  targetUrl: z.string().url().optional().nullable(),
  targetDomain: z.string().min(2).optional().nullable(),
  locationName: z.string().min(2).default("United States"),
  languageCode: z.string().min(2).max(8).default("en"),
  device: z.enum(["desktop", "mobile"]).default("desktop"),
  serpDepth: z.number().int().min(1).max(100).default(20),
  keywordLimit: z.number().int().min(1).max(100).default(50),
});

const manualRankSchema = z.object({
  manualRank: z.number().int().min(1).max(500).optional().nullable(),
  manualPage: z.number().int().min(1).max(50).optional().nullable(),
  manualPosition: z.number().int().min(1).max(20).optional().nullable(),
  manualUrl: z.string().url().optional().nullable(),
  manualNote: z.string().max(1000).optional().nullable(),
});

const compareSchema = z.object({
  targetUrl: z.string().url().optional().nullable(),
});

type DataForSeoPayload = {
  status_code?: number;
  status_message?: string;
  tasks?: {
    status_code?: number;
    status_message?: string;
    result?: unknown[];
  }[];
};

type KeywordIdeaInput = {
  keyword: string;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  cpc: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  currency: string | null;
  rawJson: unknown;
};

type SerpResultInput = {
  rank: number;
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  rawJson: unknown;
};

type CompetitorAbove = {
  rank: number;
  domain: string;
  url: string;
  title: string | null;
};

type DataForSeoLocation = {
  displayName: string;
  labs: { location_code: number } | { location_name: string };
  serp: { location_code: number } | { location_name: string } | { location_coordinate: string };
};

type ParsedCompetitor = {
  fetchStatus: number | null;
  contentTitle: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  schemaTypes: string[];
  wordCount: number | null;
  faqCount: number;
  contentScore: number;
  missingTopics: string[];
  recommendations: string[];
};

type KeywordResearchExecutionInput = {
  seedKeyword: string;
  targetUrl: string | null;
  targetDomain: string | null;
  location: DataForSeoLocation;
  languageCode: string;
  device: "desktop" | "mobile";
  serpDepth: number;
  keywordLimit: number;
};

async function scopedRun(req: Request, id: string) {
  const scope = tenantScope(req);
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  const run = await prisma.keywordResearchRun.findFirst({
    where: { id, ...(scope.clientId ? { clientId: scope.clientId } : {}) },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 100 },
      competitors: { orderBy: { rank: "asc" }, take: 120 },
    },
  });
  return run ? withRefreshState(withRelevantIdeas(run), bypassRefreshLimit) : null;
}

keywordResearchRouter.post("/keyword-research", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const scope = tenantScope(req);
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);

  let clientId = req.user!.role === "super_admin" ? input.clientId ?? null : scope.clientId ?? null;
  let website: { id: string; clientId: string; domain: string; rootUrl: string } | null = null;
  if (input.websiteId) {
    website = await prisma.website.findFirst({
      where: { id: input.websiteId, ...(scope.clientId ? { clientId: scope.clientId } : {}) },
      select: { id: true, clientId: true, domain: true, rootUrl: true },
    });
    if (!website) return res.status(404).json({ error: "website not found" });
    clientId = website.clientId;
  }
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  const targetDomain = normalizeDomain(input.targetDomain) || domainFromUrl(input.targetUrl) || normalizeDomain(website?.domain) || domainFromUrl(website?.rootUrl);
  const location = resolveDataForSeoLocation(input.locationName, input.seedKeyword);

  const run = await prisma.keywordResearchRun.create({
    data: {
      clientId,
      websiteId: website?.id ?? null,
      seedKeyword: input.seedKeyword,
      targetUrl: input.targetUrl || null,
      targetDomain,
      locationName: location.displayName,
      languageCode: input.languageCode,
      device: input.device,
      serpDepth: input.serpDepth,
      status: "running",
    },
  });

  try {
    const updated = await completeKeywordResearchRun(run.id, {
      seedKeyword: input.seedKeyword,
      targetUrl: input.targetUrl || null,
      targetDomain,
      location,
      languageCode: input.languageCode,
      device: input.device,
      serpDepth: input.serpDepth,
      keywordLimit: input.keywordLimit,
    });
    res.status(201).json({ run: withRefreshState(withRelevantIdeas(updated), bypassRefreshLimit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Keyword research failed";
    const failed = await prisma.keywordResearchRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
    res.status(502).json({ error: message, run: failed });
  }
});

keywordResearchRouter.get("/keyword-research", async (req, res) => {
  const scope = tenantScope(req);
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  const runs = await prisma.keywordResearchRun.findMany({
    where: scope.clientId ? { clientId: scope.clientId } : {},
    orderBy: { createdAt: "desc" },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 3 },
      competitors: { orderBy: { rank: "asc" }, take: 3 },
    },
    take: 100,
  });
  res.json({ runs: runs.map((run) => withRefreshState(withRelevantIdeas(run, 3), bypassRefreshLimit)) });
});

keywordResearchRouter.get("/keyword-research/:id", async (req, res) => {
  const run = await scopedRun(req, req.params.id);
  if (!run) return res.status(404).json({ error: "keyword research run not found" });
  res.json({ run });
});

keywordResearchRouter.post("/keyword-research/:id/refresh", async (req, res) => {
  const existing = await scopedRun(req, req.params.id);
  if (!existing) return res.status(404).json({ error: "keyword research run not found" });

  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  const refreshBlock = bypassRefreshLimit ? null : await findRecentKeywordRefresh(existing);
  if (refreshBlock) {
    const blockedUntil = new Date(refreshBlock.createdAt.getTime() + KEYWORD_REFRESH_COOLDOWN_MS);
    return res.status(429).json({
      error: "This keyword was already refreshed in the last 24 hours.",
      latestRunId: refreshBlock.id,
      lastRefreshAt: refreshBlock.createdAt,
      refreshBlockedUntil: blockedUntil,
    });
  }

  const location = resolveDataForSeoLocation(existing.locationName, existing.seedKeyword);
  const keywordLimit = Math.min(100, Math.max(1, existing.keywordCount || existing.ideas?.length || 50));
  const run = await prisma.keywordResearchRun.create({
    data: {
      clientId: existing.clientId,
      websiteId: existing.websiteId,
      seedKeyword: existing.seedKeyword,
      targetUrl: existing.targetUrl,
      targetDomain: existing.targetDomain,
      locationName: location.displayName,
      languageCode: existing.languageCode,
      device: existing.device,
      serpDepth: existing.serpDepth,
      status: "running",
    },
  });

  try {
    const updated = await completeKeywordResearchRun(run.id, {
      seedKeyword: existing.seedKeyword,
      targetUrl: existing.targetUrl,
      targetDomain: existing.targetDomain,
      location,
      languageCode: existing.languageCode,
      device: existing.device,
      serpDepth: existing.serpDepth,
      keywordLimit,
    });
    res.status(201).json({ run: withRefreshState(withRelevantIdeas(updated), bypassRefreshLimit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Keyword refresh failed";
    const failed = await prisma.keywordResearchRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
    res.status(502).json({ error: message, run: failed });
  }
});

keywordResearchRouter.patch("/keyword-research/:id/manual-rank", async (req, res) => {
  const parsed = manualRankSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await scopedRun(req, req.params.id);
  if (!existing) return res.status(404).json({ error: "keyword research run not found" });
  const input = parsed.data;
  const manualRank = input.manualRank ?? (input.manualPage && input.manualPosition ? (input.manualPage - 1) * 10 + input.manualPosition : null);
  const run = await prisma.keywordResearchRun.update({
    where: { id: existing.id },
    data: {
      manualRank,
      manualPage: input.manualPage ?? null,
      manualPosition: input.manualPosition ?? null,
      manualUrl: input.manualUrl ?? null,
      manualNote: input.manualNote ?? null,
      manualObservedAt: manualRank ? new Date() : null,
    },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 100 },
      competitors: { orderBy: { rank: "asc" }, take: 120 },
    },
  });
  res.json({ run: withRefreshState(withRelevantIdeas(run), await canBypassKeywordRefreshLimit(req)) });
});

keywordResearchRouter.post("/keyword-research/:id/competitors/:competitorId/compare", async (req, res) => {
  const parsed = compareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const run = await scopedRun(req, req.params.id);
  if (!run) return res.status(404).json({ error: "keyword research run not found" });

  const competitor = await prisma.keywordSerpCompetitor.findFirst({
    where: { id: req.params.competitorId, runId: run.id },
  });
  if (!competitor) return res.status(404).json({ error: "competitor not found" });

  const targetUrl = parsed.data.targetUrl || run.targetUrl;
  if (!targetUrl) return res.status(400).json({ error: "targetUrl is required for comparison" });

  const targetProfile = await fetchCompetitorProfile(targetUrl, null);
  const competitorProfile: ParsedCompetitor = {
    fetchStatus: competitor.fetchStatus,
    contentTitle: competitor.contentTitle,
    metaDescription: competitor.metaDescription,
    h1: stringArray(competitor.h1Json),
    h2: stringArray(competitor.h2Json),
    schemaTypes: stringArray(competitor.schemaTypesJson),
    wordCount: competitor.wordCount,
    faqCount: competitor.faqCount,
    contentScore: competitor.contentScore ?? 0,
    missingTopics: stringArray(competitor.missingTopicsJson),
    recommendations: stringArray(competitor.recommendationsJson),
  };

  res.json({
    comparison: buildPageCompetitorComparison(targetUrl, targetProfile, competitor, competitorProfile),
  });
});

async function completeKeywordResearchRun(runId: string, input: KeywordResearchExecutionInput) {
  const [ideas, serpResults] = await Promise.all([
    fetchKeywordIdeas(input.seedKeyword, input.location, input.languageCode, input.keywordLimit),
    fetchSerpResults(input.seedKeyword, input.location, input.languageCode, input.device, input.serpDepth),
  ]);
  const ranking = input.targetDomain ? findDomainRank(serpResults, input.targetDomain) : null;
  const competitorsAbove = buildCompetitorsAbove(serpResults, ranking?.rank ?? null);
  const targetProfile = input.targetUrl ? await fetchCompetitorProfile(input.targetUrl, null) : null;
  const competitorProfiles = await Promise.all(
    serpResults.slice(0, input.serpDepth).map(async (result) => ({
      result,
      profile: await fetchCompetitorProfile(result.url, targetProfile),
    })),
  );

  await prisma.keywordIdea.deleteMany({ where: { runId } });
  await prisma.keywordSerpCompetitor.deleteMany({ where: { runId } });

  await prisma.keywordIdea.createMany({
    data: ideas.map((idea) => ({
      runId,
      keyword: idea.keyword,
      avgMonthlySearches: idea.avgMonthlySearches,
      competition: idea.competition,
      competitionIndex: idea.competitionIndex,
      cpc: idea.cpc,
      lowTopOfPageBid: idea.lowTopOfPageBid,
      highTopOfPageBid: idea.highTopOfPageBid,
      currency: idea.currency,
      rawJson: idea.rawJson as Prisma.InputJsonValue,
    })),
  });

  if (competitorProfiles.length > 0) {
    await prisma.keywordSerpCompetitor.createMany({
      data: competitorProfiles.map(({ result, profile }) => ({
        runId,
        rank: result.rank,
        url: result.url,
        domain: result.domain,
        title: result.title,
        description: result.description,
        fetchStatus: profile.fetchStatus,
        contentTitle: profile.contentTitle,
        metaDescription: profile.metaDescription,
        h1Json: profile.h1 as Prisma.InputJsonValue,
        h2Json: profile.h2 as Prisma.InputJsonValue,
        schemaTypesJson: profile.schemaTypes as Prisma.InputJsonValue,
        wordCount: profile.wordCount,
        faqCount: profile.faqCount,
        contentScore: profile.contentScore,
        missingTopicsJson: profile.missingTopics as Prisma.InputJsonValue,
        recommendationsJson: profile.recommendations as Prisma.InputJsonValue,
        rawSerpJson: result.rawJson as Prisma.InputJsonValue,
        contentFetchedAt: new Date(),
      })),
    });
  }

  const volumes = ideas.map((idea) => idea.avgMonthlySearches).filter((value): value is number => value != null);
  return prisma.keywordResearchRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      keywordCount: ideas.length,
      competitorCount: competitorProfiles.length,
      averageVolume: volumes.length ? Math.round(volumes.reduce((sum, value) => sum + value, 0) / volumes.length) : null,
      targetRank: ranking?.rank ?? null,
      rankingUrl: ranking?.url ?? null,
      rankFoundDepth: input.serpDepth,
      competitorsAboveJson: competitorsAbove as Prisma.InputJsonValue,
      error: null,
      completedAt: new Date(),
    },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 100 },
      competitors: { orderBy: { rank: "asc" }, take: 120 },
    },
  });
}

async function findRecentKeywordRefresh(run: {
  id: string;
  clientId: string;
  websiteId: string | null;
  seedKeyword: string;
  locationName: string;
  languageCode: string;
  device: string;
  serpDepth: number;
}) {
  const cutoff = new Date(Date.now() - KEYWORD_REFRESH_COOLDOWN_MS);
  return prisma.keywordResearchRun.findFirst({
    where: {
      clientId: run.clientId,
      websiteId: run.websiteId,
      seedKeyword: run.seedKeyword,
      locationName: run.locationName,
      languageCode: run.languageCode,
      device: run.device,
      serpDepth: run.serpDepth,
      status: { in: refreshableStatuses },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
}

async function canBypassKeywordRefreshLimit(req: Request): Promise<boolean> {
  const user = req.user;
  if (!user) return false;
  if (user.role === "super_admin" || user.role === "client_admin") return true;
  const account = await prisma.user.findUnique({ where: { id: user.userId }, select: { email: true } });
  return account ? UNRESTRICTED_REFRESH_EMAILS.has(account.email.toLowerCase()) : false;
}

function withRefreshState<T extends {
  id: string;
  clientId?: string;
  websiteId: string | null;
  seedKeyword: string;
  locationName: string;
  languageCode: string;
  device: string;
  serpDepth: number;
  status: string;
  createdAt: Date;
}>(run: T, bypassRefreshLimit = false): T & { canRefresh: boolean; lastRefreshAt: Date; refreshBlockedUntil: Date | null } {
  if (bypassRefreshLimit) {
    return {
      ...run,
      canRefresh: true,
      lastRefreshAt: run.createdAt,
      refreshBlockedUntil: null,
    };
  }
  const statusCountsAsRefresh = refreshableStatuses.includes(run.status);
  const refreshBlockedUntil = statusCountsAsRefresh ? new Date(run.createdAt.getTime() + KEYWORD_REFRESH_COOLDOWN_MS) : null;
  return {
    ...run,
    canRefresh: !refreshBlockedUntil || refreshBlockedUntil.getTime() <= Date.now(),
    lastRefreshAt: run.createdAt,
    refreshBlockedUntil: refreshBlockedUntil && refreshBlockedUntil.getTime() > Date.now() ? refreshBlockedUntil : null,
  };
}

async function dataForSeoRequest(path: string, body: unknown): Promise<DataForSeoPayload> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  const auth = process.env.DATAFORSEO_AUTH_BASE64 || (login && password ? Buffer.from(`${login}:${password}`).toString("base64") : null);
  if (!auth) throw new Error("Keyword data provider credentials are not configured.");
  const response = await fetch(`https://api.dataforseo.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as DataForSeoPayload;
  if (!response.ok || (payload.status_code && payload.status_code >= 40000)) {
    throw new Error(`Keyword data provider ${path}: ${payload.status_message || `returned ${response.status}`}`);
  }
  const taskError = payload.tasks?.find((task) => task.status_code && task.status_code >= 40000);
  if (taskError) throw new Error(`Keyword data provider ${path}: ${taskError.status_message || "task failed."}`);
  return payload;
}

async function fetchKeywordIdeas(keyword: string, location: DataForSeoLocation, languageCode: string, limit: number): Promise<KeywordIdeaInput[]> {
  const seeds = keywordIdeaSeeds(keyword);
  const payload = await dataForSeoRequest("/v3/dataforseo_labs/google/keyword_ideas/live", [{
    keywords: seeds,
    ...location.labs,
    language_code: languageCode,
    include_seed_keyword: true,
    limit: Math.min(100, Math.max(limit, seeds.length * 20)),
  }]);
  const items = extractDataForSeoItems(payload);
  const ideas = items.map(parseKeywordIdea).filter((idea): idea is KeywordIdeaInput => Boolean(idea?.keyword));
  const relevant = rankKeywordIdeas(keyword, ensureSeedKeywordIdea(keyword, ideas)).slice(0, limit);
  return relevant.length ? relevant : [{ keyword, avgMonthlySearches: null, competition: null, competitionIndex: null, cpc: null, lowTopOfPageBid: null, highTopOfPageBid: null, currency: null, rawJson: {} }];
}

function keywordIdeaSeeds(keyword: string): string[] {
  const canonical = canonicalSeedKeyword(keyword);
  const normalized = normalizeKeywordForRelevance(canonical);
  const seeds = new Set([keyword.trim(), canonical].filter(Boolean));
  if (normalized.includes("super visa")) {
    seeds.add("super visa insurance");
    seeds.add("super visa insurance canada");
    seeds.add("super visa insurance quote");
    seeds.add("super visa insurance cost");
    seeds.add("super visa medical insurance");
    seeds.add("super visa health insurance");
  }
  return [...seeds].slice(0, 12);
}

async function fetchSerpResults(keyword: string, location: DataForSeoLocation, languageCode: string, device: "desktop" | "mobile", depth: number): Promise<SerpResultInput[]> {
  const payload = await dataForSeoRequest("/v3/serp/google/organic/live/advanced", [{
    keyword,
    ...location.serp,
    language_code: languageCode,
    device,
    os: device === "mobile" ? "android" : "windows",
    depth,
  }]);
  const items = extractDataForSeoItems(payload);
  return items
    .map(parseSerpResult)
    .filter((item): item is SerpResultInput => Boolean(item?.url))
    .filter((item) => /^https?:\/\//i.test(item.url))
    .slice(0, depth);
}

function extractDataForSeoItems(payload: DataForSeoPayload): unknown[] {
  const results = payload.tasks?.flatMap((task) => task.result ?? []) ?? [];
  return results.flatMap((result: any) => {
    if (Array.isArray(result?.items)) return result.items;
    if (Array.isArray(result?.keyword_ideas)) return result.keyword_ideas;
    if (Array.isArray(result)) return result;
    return [];
  });
}

function parseKeywordIdea(item: any): KeywordIdeaInput | null {
  const info = item?.keyword_info ?? item?.keyword_data?.keyword_info ?? item;
  const keyword = item?.keyword ?? item?.keyword_data?.keyword ?? item?.text ?? null;
  if (!keyword) return null;
  return {
    keyword: String(keyword),
    avgMonthlySearches: numberOrNull(info?.search_volume ?? info?.avg_monthly_searches),
    competition: stringOrNull(info?.competition_level ?? info?.competition),
    competitionIndex: numberOrNull(info?.competition_index),
    cpc: numberOrNull(info?.cpc),
    lowTopOfPageBid: numberOrNull(info?.low_top_of_page_bid ?? microsToMoney(info?.low_top_of_page_bid_micros)),
    highTopOfPageBid: numberOrNull(info?.high_top_of_page_bid ?? microsToMoney(info?.high_top_of_page_bid_micros)),
    currency: stringOrNull(info?.currency),
    rawJson: item,
  };
}

function rankKeywordIdeas(seedKeyword: string, ideas: KeywordIdeaInput[]): KeywordIdeaInput[] {
  const seed = normalizeKeywordForRelevance(canonicalSeedKeyword(seedKeyword));
  const seedTokens = keywordTokens(seed);
  const unique = new Map<string, KeywordIdeaInput>();
  for (const idea of ideas) {
    const normalized = normalizeKeywordForRelevance(idea.keyword);
    if (!unique.has(normalized)) unique.set(normalized, idea);
  }
  return [...unique.values()]
    .map((idea) => ({ idea, score: keywordIdeaRelevance(seed, seedTokens, idea.keyword) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.idea.avgMonthlySearches ?? 0) - (a.idea.avgMonthlySearches ?? 0))
    .map((item) => item.idea);
}

function withRelevantIdeas<T extends { id: string; seedKeyword: string; ideas?: Array<{ keyword: string; avgMonthlySearches: number | null }> }>(
  run: T,
  take?: number,
): T {
  if (!Array.isArray(run.ideas)) return run;
  const seed = normalizeKeywordForRelevance(canonicalSeedKeyword(run.seedKeyword));
  const seedTokens = keywordTokens(seed);
  const ideas = ensureSeedKeywordIdea(run.seedKeyword, run.ideas)
    .map((idea) => ({ idea, score: keywordIdeaRelevance(seed, seedTokens, idea.keyword) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.idea.avgMonthlySearches ?? 0) - (a.idea.avgMonthlySearches ?? 0))
    .map((item, index) => "id" in item.idea ? item.idea : { ...item.idea, id: `${run.id}:seed:${index}` });
  return {
    ...run,
    ideas: typeof take === "number" ? ideas.slice(0, take) : ideas,
  };
}

function ensureSeedKeywordIdea<T extends { keyword: string }>(seedKeyword: string, ideas: T[]): T[] {
  const canonical = canonicalSeedKeyword(seedKeyword);
  const hasCanonical = ideas.some((idea) => normalizeKeywordForRelevance(idea.keyword) === normalizeKeywordForRelevance(canonical));
  if (hasCanonical) return ideas;
  return [{
    keyword: canonical,
    avgMonthlySearches: null,
    competition: null,
    competitionIndex: null,
    cpc: null,
    lowTopOfPageBid: null,
    highTopOfPageBid: null,
    currency: null,
    rawJson: { synthetic: true, source: "seed_keyword" },
  } as T, ...ideas];
}

function canonicalSeedKeyword(value: string): string {
  const locationWords = new Set(["mississauga", "mississagua", "mississaunga", "ontario", "canada", "brampton", "toronto"]);
  const tokens = normalizeKeywordForRelevance(value)
    .split(" ")
    .filter((token) => token && !locationWords.has(token));
  const keyword = tokens.join(" ").trim() || normalizeKeywordForRelevance(value);
  return keyword.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function keywordIdeaRelevance(seed: string, seedTokens: string[], ideaKeyword: string): number {
  const idea = normalizeKeywordForRelevance(ideaKeyword);
  const ideaTokens = keywordTokens(idea);
  if (!seed || !idea) return 0;
  if (idea === seed) return 1000;
  const seedSet = new Set(seedTokens);
  const ideaSet = new Set(ideaTokens);
  const shared = [...seedSet].filter((token) => ideaSet.has(token));
  if (!hasEnoughKeywordOverlap(seedTokens, ideaTokens, shared)) return 0;
  if (idea.includes(seed)) return 850 - Math.abs(ideaTokens.length - seedTokens.length) * 15;
  if (seed.includes(idea) && shared.length >= Math.min(2, seedTokens.length)) return 780 - Math.abs(ideaTokens.length - seedTokens.length) * 15;
  const coverage = shared.length / Math.max(1, seedSet.size);
  const extraPenalty = Math.max(0, ideaSet.size - shared.length) * 8;
  return Math.round(coverage * 700 + shared.length * 30 - extraPenalty);
}

function hasEnoughKeywordOverlap(seedTokens: string[], ideaTokens: string[], shared: string[]): boolean {
  if (seedTokens.length === 0 || ideaTokens.length === 0) return false;
  if (seedTokens.length === 1) return shared.length === 1;
  if (seedTokens.length === 2) return shared.length >= 2;
  return shared.length >= 2;
}

function keywordTokens(value: string): string[] {
  const stop = new Set(["in", "near", "for", "and", "the", "a", "an", "of", "to", "best"]);
  const generic = new Set(["insurance", "company", "companies", "service", "services", "provider", "providers", "agency", "agencies"]);
  const tokens = normalizeKeywordForRelevance(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stop.has(token));
  const distinctive = tokens.filter((token) => !generic.has(token));
  return distinctive.length ? distinctive : tokens;
}

function normalizeKeywordForRelevance(value: string): string {
  return normalizeText(value)
    .replace(/\bsupervisa\b/g, "super visa")
    .replace(/\bmississagua\b/g, "mississauga")
    .trim();
}

function parseSerpResult(item: any): SerpResultInput | null {
  if (item?.type && item.type !== "organic") return null;
  const url = item?.url ?? item?.breadcrumb_url ?? null;
  if (!url) return null;
  let domain = "";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return {
    rank: numberOrNull(item?.rank_group ?? item?.rank_absolute) ?? 999,
    url,
    domain,
    title: stringOrNull(item?.title),
    description: stringOrNull(item?.description),
    rawJson: item,
  };
}

function resolveDataForSeoLocation(value: string, keyword = ""): DataForSeoLocation {
  const trimmed = value.trim();
  const normalized = normalizeText(trimmed);
  const normalizedKeyword = normalizeText(keyword);
  const aliases: Record<string, DataForSeoLocation> = {
    canada: countryLocation("Canada", 2124),
    "united states": countryLocation("United States", 2840),
    usa: countryLocation("United States", 2840),
    us: countryLocation("United States", 2840),
    toronto: canadianCityLocation("Toronto,Ontario,Canada", "43.653226,-79.383184,20000"),
    "toronto canada": canadianCityLocation("Toronto,Ontario,Canada", "43.653226,-79.383184,20000"),
    "toronto ontario canada": canadianCityLocation("Toronto,Ontario,Canada", "43.653226,-79.383184,20000"),
    mississauga: canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000"),
    mississagua: canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000"),
    "mississauga canada": canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000"),
    "mississagua canada": canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000"),
    "mississauga ontario canada": canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000"),
    brampton: canadianCityLocation("Brampton,Ontario,Canada", "43.731548,-79.762418,20000"),
    "brampton canada": canadianCityLocation("Brampton,Ontario,Canada", "43.731548,-79.762418,20000"),
    "brampton ontario canada": canadianCityLocation("Brampton,Ontario,Canada", "43.731548,-79.762418,20000"),
    vancouver: canadianCityLocation("Vancouver,British Columbia,Canada", "49.282729,-123.120738,20000"),
    "vancouver canada": canadianCityLocation("Vancouver,British Columbia,Canada", "49.282729,-123.120738,20000"),
    "vancouver british columbia canada": canadianCityLocation("Vancouver,British Columbia,Canada", "49.282729,-123.120738,20000"),
    montreal: canadianCityLocation("Montreal,Quebec,Canada", "45.501887,-73.567392,20000"),
    "montreal canada": canadianCityLocation("Montreal,Quebec,Canada", "45.501887,-73.567392,20000"),
    "montreal quebec canada": canadianCityLocation("Montreal,Quebec,Canada", "45.501887,-73.567392,20000"),
    "new york": usCityLocation("New York,New York,United States", "40.712776,-74.005974,20000"),
    "new york united states": usCityLocation("New York,New York,United States", "40.712776,-74.005974,20000"),
    "new york new york united states": usCityLocation("New York,New York,United States", "40.712776,-74.005974,20000"),
  };
  if (normalized === "canada" || normalized === "ca") {
    if (normalizedKeyword.includes("mississauga") || normalizedKeyword.includes("mississagua")) return aliases.mississauga;
    if (normalizedKeyword.includes("brampton")) return aliases.brampton;
    if (normalizedKeyword.includes("toronto")) return aliases.toronto;
    if (normalizedKeyword.includes("vancouver")) return aliases.vancouver;
    if (normalizedKeyword.includes("montreal")) return aliases.montreal;
  }
  if (normalized === "united states" || normalized === "usa" || normalized === "us") {
    if (normalizedKeyword.includes("new york")) return aliases["new york"];
  }
  return aliases[normalized] ?? { displayName: trimmed, labs: { location_name: trimmed }, serp: { location_name: trimmed } };
}

function countryLocation(displayName: string, locationCode: number): DataForSeoLocation {
  return {
    displayName,
    labs: { location_code: locationCode },
    serp: { location_code: locationCode },
  };
}

function canadianCityLocation(displayName: string, locationCoordinate: string): DataForSeoLocation {
  return {
    displayName,
    labs: { location_code: 2124 },
    serp: { location_coordinate: locationCoordinate },
  };
}

function usCityLocation(displayName: string, locationCoordinate: string): DataForSeoLocation {
  return {
    displayName,
    labs: { location_code: 2840 },
    serp: { location_coordinate: locationCoordinate },
  };
}

function domainFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return null;
  }
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0];
  return cleaned || null;
}

function domainsMatch(resultDomain: string, targetDomain: string): boolean {
  const result = normalizeDomain(resultDomain);
  const target = normalizeDomain(targetDomain);
  if (!result || !target) return false;
  return result === target || result.endsWith(`.${target}`);
}

function findDomainRank(results: SerpResultInput[], targetDomain: string): SerpResultInput | null {
  return results.find((result) => domainsMatch(result.domain, targetDomain)) ?? null;
}

function buildCompetitorsAbove(results: SerpResultInput[], targetRank: number | null): CompetitorAbove[] {
  if (!targetRank) return results.slice(0, 10).map(toCompetitorAbove);
  return results.filter((result) => result.rank < targetRank).slice(0, 20).map(toCompetitorAbove);
}

function toCompetitorAbove(result: SerpResultInput): CompetitorAbove {
  return {
    rank: result.rank,
    domain: result.domain,
    url: result.url,
    title: result.title,
  };
}

async function fetchCompetitorProfile(url: string, target: ParsedCompetitor | null): Promise<ParsedCompetitor> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; WebtummyBot/0.1; +https://webtummy.local)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return emptyProfile(response.status, target);
    const html = await response.text();
    const parsed = parseHtml(html, url);
    const h1 = parsed.h1.slice(0, 10);
    const h2 = parsed.h2.slice(0, 40);
    const schemaTypes = parsed.schemas.map((schema) => schema.schemaType).filter((type): type is string => Boolean(type));
    const faqCount = h2.filter((heading) => /\?|\b(how|what|why|when|where|can|do|does|is|are)\b/i.test(heading)).length + schemaTypes.filter((type) => type === "FAQPage").length;
    const missingTopics = target ? h2.filter((heading) => !textListContains(target.h2, heading)).slice(0, 12) : [];
    const recommendations = buildCompetitorRecommendations(parsed.wordCount, schemaTypes, faqCount, missingTopics);
    return {
      fetchStatus: response.status,
      contentTitle: parsed.title,
      metaDescription: parsed.metaDescription,
      h1,
      h2,
      schemaTypes,
      wordCount: parsed.wordCount,
      faqCount,
      contentScore: competitorContentScore(parsed.wordCount, schemaTypes, faqCount),
      missingTopics,
      recommendations,
    };
  } catch {
    return emptyProfile(null, target);
  } finally {
    clearTimeout(timeout);
  }
}

function emptyProfile(status: number | null, target: ParsedCompetitor | null): ParsedCompetitor {
  return {
    fetchStatus: status,
    contentTitle: null,
    metaDescription: null,
    h1: [],
    h2: [],
    schemaTypes: [],
    wordCount: null,
    faqCount: 0,
    contentScore: target ? 0 : 50,
    missingTopics: [],
    recommendations: ["Could not fetch or parse this competitor page for content comparison."],
  };
}

function buildCompetitorRecommendations(wordCount: number, schemaTypes: string[], faqCount: number, missingTopics: string[]): string[] {
  const recommendations: string[] = [];
  if (wordCount >= 1200) recommendations.push(`Competitor has deep content (${wordCount} words). Consider matching depth with clearer sections and examples.`);
  if (schemaTypes.length > 0) recommendations.push(`Competitor uses schema: ${[...new Set(schemaTypes)].join(", ")}.`);
  if (faqCount > 0) recommendations.push("Competitor appears to cover FAQ-style questions. Add relevant FAQ content and FAQPage schema where appropriate.");
  if (missingTopics.length > 0) recommendations.push(`Topic gaps to consider: ${missingTopics.slice(0, 5).join(", ")}.`);
  return recommendations.length ? recommendations : ["Review this competitor's headings, FAQs, and schema for content gaps."];
}

function buildPageCompetitorComparison(
  targetUrl: string,
  target: ParsedCompetitor,
  competitor: { rank: number; url: string; domain: string; title: string | null; description: string | null },
  competitorProfile: ParsedCompetitor,
) {
  const targetHeadings = target.h2.map(normalizeText);
  const missingHeadings = competitorProfile.h2
    .filter((heading) => !targetHeadings.some((targetHeading) => {
      const normalized = normalizeText(heading);
      return targetHeading.includes(normalized) || normalized.includes(targetHeading);
    }))
    .slice(0, 12);
  const targetSchema = new Set(target.schemaTypes.map((type) => type.toLowerCase()));
  const missingSchema = [...new Set(competitorProfile.schemaTypes)]
    .filter((type) => !targetSchema.has(type.toLowerCase()));
  const wordGap = Math.max(0, (competitorProfile.wordCount ?? 0) - (target.wordCount ?? 0));
  const faqGap = Math.max(0, competitorProfile.faqCount - target.faqCount);
  const scoreGap = Math.max(0, competitorProfile.contentScore - target.contentScore);
  const recommendations = buildComparisonRecommendations(target, competitorProfile, missingHeadings, missingSchema, wordGap, faqGap, scoreGap);

  return {
    target: {
      url: targetUrl,
      fetchStatus: target.fetchStatus,
      title: target.contentTitle,
      metaDescription: target.metaDescription,
      h1: target.h1,
      h2: target.h2,
      schemaTypes: target.schemaTypes,
      wordCount: target.wordCount,
      faqCount: target.faqCount,
      contentScore: target.contentScore,
    },
    competitor: {
      rank: competitor.rank,
      url: competitor.url,
      domain: competitor.domain,
      serpTitle: competitor.title,
      serpDescription: competitor.description,
      title: competitorProfile.contentTitle,
      metaDescription: competitorProfile.metaDescription,
      h1: competitorProfile.h1,
      h2: competitorProfile.h2,
      schemaTypes: competitorProfile.schemaTypes,
      wordCount: competitorProfile.wordCount,
      faqCount: competitorProfile.faqCount,
      contentScore: competitorProfile.contentScore,
    },
    gaps: {
      wordGap,
      faqGap,
      scoreGap,
      missingHeadings,
      missingSchema,
    },
    recommendations,
  };
}

function buildComparisonRecommendations(
  target: ParsedCompetitor,
  competitor: ParsedCompetitor,
  missingHeadings: string[],
  missingSchema: string[],
  wordGap: number,
  faqGap: number,
  scoreGap: number,
): string[] {
  const recommendations: string[] = [];
  if (scoreGap >= 10) recommendations.push(`Content score: Competitor is ${scoreGap} points stronger. Improve depth, structure, FAQ coverage, and schema before treating this page as fully competitive.`);
  if (wordGap >= 300) recommendations.push(`Content depth: Competitor has about ${wordGap} more words. Add useful sections rather than filler: process, use cases, pricing/cost, proof, comparison, and service details.`);
  if (faqGap > 0) recommendations.push(`FAQ/AEO: Competitor has ${faqGap} more FAQ-style signals. Add buyer questions with short direct answers and matching FAQPage schema where appropriate.`);
  if (missingHeadings.length > 0) recommendations.push(`Section gaps: Consider adding or adapting sections like ${missingHeadings.slice(0, 5).join(", ")}.`);
  if (missingSchema.length > 0) recommendations.push(`Schema: Competitor uses ${missingSchema.slice(0, 5).join(", ")}. Add relevant structured data if it matches visible page content.`);
  if (!target.contentTitle) recommendations.push("Title: Target page title could not be read. Make sure the page has a clear SEO title aligned to the keyword.");
  if (!target.metaDescription) recommendations.push("Meta description: Add a benefit-led meta description with the keyword, location when relevant, and a clear outcome.");
  if (target.h1.length === 0 && competitor.h1.length > 0) recommendations.push(`H1: Target page has no captured H1. Add one aligned with the search intent; competitor uses "${competitor.h1[0]}".`);
  return recommendations.length ? recommendations : ["Target page is broadly comparable. Review competitor headings and proof points for smaller copy and structure improvements."];
}

function competitorContentScore(wordCount: number, schemaTypes: string[], faqCount: number): number {
  let score = 45;
  if (wordCount >= 800) score += 20;
  else if (wordCount >= 400) score += 10;
  if (schemaTypes.length > 0) score += 15;
  if (schemaTypes.includes("FAQPage")) score += 8;
  if (schemaTypes.includes("BreadcrumbList")) score += 6;
  if (faqCount > 0) score += 6;
  return Math.min(100, score);
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function textListContains(list: string[], value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length < 8) return true;
  return list.some((item) => {
    const other = normalizeText(item);
    return other.includes(normalized) || normalized.includes(other);
  });
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function microsToMoney(value: unknown): number | null {
  const number = numberOrNull(value);
  return number == null ? null : number / 1_000_000;
}
