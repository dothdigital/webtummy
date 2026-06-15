import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { parseHtml } from "@webtummy/core";
import { requireAuth, tenantScope } from "../middleware.js";
import "../config.js";

export const keywordResearchRouter = Router();
keywordResearchRouter.use(requireAuth);

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

async function scopedRun(req: Request, id: string) {
  const scope = tenantScope(req);
  return prisma.keywordResearchRun.findFirst({
    where: { id, ...(scope.clientId ? { clientId: scope.clientId } : {}) },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 100 },
      competitors: { orderBy: { rank: "asc" }, take: 120 },
    },
  });
}

keywordResearchRouter.post("/keyword-research", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const scope = tenantScope(req);

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
    const [ideas, serpResults] = await Promise.all([
      fetchKeywordIdeas(input.seedKeyword, location, input.languageCode, input.keywordLimit),
      fetchSerpResults(input.seedKeyword, location, input.languageCode, input.device, input.serpDepth),
    ]);
    const ranking = targetDomain ? findDomainRank(serpResults, targetDomain) : null;
    const competitorsAbove = buildCompetitorsAbove(serpResults, ranking?.rank ?? null);
    const targetProfile = input.targetUrl ? await fetchCompetitorProfile(input.targetUrl, null) : null;
    const competitorProfiles = await Promise.all(
      serpResults.slice(0, input.serpDepth).map(async (result) => ({
        result,
        profile: await fetchCompetitorProfile(result.url, targetProfile),
      })),
    );

    await prisma.keywordIdea.createMany({
      data: ideas.map((idea) => ({
        runId: run.id,
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
          runId: run.id,
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
    const updated = await prisma.keywordResearchRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        keywordCount: ideas.length,
        competitorCount: competitorProfiles.length,
        averageVolume: volumes.length ? Math.round(volumes.reduce((sum, value) => sum + value, 0) / volumes.length) : null,
        targetRank: ranking?.rank ?? null,
        rankingUrl: ranking?.url ?? null,
        rankFoundDepth: input.serpDepth,
        competitorsAboveJson: competitorsAbove as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
      include: {
        website: { select: { id: true, domain: true, rootUrl: true } },
        ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 100 },
        competitors: { orderBy: { rank: "asc" }, take: 50 },
      },
    });

    res.status(201).json({ run: updated });
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
  res.json({ runs });
});

keywordResearchRouter.get("/keyword-research/:id", async (req, res) => {
  const run = await scopedRun(req, req.params.id);
  if (!run) return res.status(404).json({ error: "keyword research run not found" });
  res.json({ run });
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
  res.json({ run });
});

async function dataForSeoRequest(path: string, body: unknown): Promise<DataForSeoPayload> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  const auth = process.env.DATAFORSEO_AUTH_BASE64 || (login && password ? Buffer.from(`${login}:${password}`).toString("base64") : null);
  if (!auth) throw new Error("DataForSEO credentials are not configured.");
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
    throw new Error(`DataForSEO ${path}: ${payload.status_message || `returned ${response.status}`}`);
  }
  const taskError = payload.tasks?.find((task) => task.status_code && task.status_code >= 40000);
  if (taskError) throw new Error(`DataForSEO ${path}: ${taskError.status_message || "task failed."}`);
  return payload;
}

async function fetchKeywordIdeas(keyword: string, location: DataForSeoLocation, languageCode: string, limit: number): Promise<KeywordIdeaInput[]> {
  const payload = await dataForSeoRequest("/v3/dataforseo_labs/google/keyword_ideas/live", [{
    keywords: [keyword],
    ...location.labs,
    language_code: languageCode,
    include_seed_keyword: true,
    limit,
  }]);
  const items = extractDataForSeoItems(payload);
  const ideas = items.map(parseKeywordIdea).filter((idea): idea is KeywordIdeaInput => Boolean(idea?.keyword));
  return ideas.length ? ideas.slice(0, limit) : [{ keyword, avgMonthlySearches: null, competition: null, competitionIndex: null, cpc: null, lowTopOfPageBid: null, highTopOfPageBid: null, currency: null, rawJson: {} }];
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
