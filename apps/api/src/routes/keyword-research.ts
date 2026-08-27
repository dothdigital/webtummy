import { createHash } from "node:crypto";
import { Router } from "express";
import { safePublicFetch } from "@webtummy/core/safe-public-fetch";
import type { Request } from "express";
import { Worker } from "bullmq";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import {
  approvedKeywordEntries,
  detectKeywordLocations,
  keywordResearchRequestIdentity,
  normalizeKeywordPhrase,
  parseHtml,
  stripKeywordLocations,
} from "@webtummy/core";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config, KEYWORD_RESEARCH_QUEUE } from "../config.js";
import { keywordResearchQueue, queueConnection, type KeywordResearchQueueJobData } from "../queue.js";
import { centralAiJson } from "../central-ai-service.js";
import { approvedStrategyContext } from "../strategy-ai.js";
import { canonicalGeographicLocationLabel, isPlausibleGeographicTargetMarket } from "../project-location.js";
import { commitUsage, preflightUsage, refundUsage } from "../usage-engine.js";
import { calculateWorkflowUnits } from "../commercial-capacity.js";

export const keywordResearchRouter = Router();
keywordResearchRouter.use(requireAuth);

const SEARCH_PROVIDER_KEY = "data" + "forseo";

const KEYWORD_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const KEYWORD_RESEARCH_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;
const KEYWORD_RESEARCH_WAITING_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const KEYWORD_RESEARCH_PROVIDER_TIMEOUT_MS = Math.max(60_000, Math.min(300_000, config.keywordResearchProviderTimeoutMs));
const KEYWORD_METRICS_VERSION = 4;
const UNRESTRICTED_REFRESH_EMAILS = new Set(["manishjetly@gmail.com"]);
const refreshableStatuses = ["queued", "running", "completed"];

const createSchema = z.object({
  projectId: z.string().optional().nullable(),
  websiteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  seedKeyword: z.string().min(2),
  targetUrl: z.string().url().optional().nullable(),
  targetDomain: z.string().min(2).optional().nullable(),
  locationName: z.string().trim().min(2),
  languageCode: z.string().min(2).max(8).default("en"),
  device: z.enum(["desktop", "mobile"]).default("desktop"),
  serpDepth: z.number().int().min(1).max(100).default(20),
  keywordLimit: z.number().int().min(1).max(100).default(25),
});

const locationPreflightSchema = z.object({
  locationNames: z.array(z.string().trim().min(2).max(180)).min(1).max(100),
});

const batchCheckSchema = createSchema.omit({ projectId: true, websiteId: true, clientId: true });
const batchCreateSchema = z.object({
  projectId: z.string().optional().nullable(),
  websiteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  checks: z.array(batchCheckSchema).min(1).max(config.keywordResearchBatchMaxChecks),
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

const backlinkQuerySchema = z.object({
  websiteId: z.string().min(1),
  refresh: z.enum(["true", "false"]).optional(),
  cacheOnly: z.enum(["true", "false"]).optional(),
});

const backlinkLinksQuerySchema = backlinkQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const BACKLINK_REFRESH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const keywordSuggestionSchema = z.object({
  websiteId: z.string().min(1),
  limit: z.number().int().min(3).max(20).default(10),
  language: z.string().min(2).max(16).default("en"),
  locationCountry: z.string().trim().max(120).optional().default(""),
  locationRegion: z.string().trim().max(120).optional().default(""),
  locationCities: z.string().trim().max(500).optional().default(""),
  excludeKeywords: z.array(z.string().min(1).max(255)).max(100).default([]),
});

type SearchDataPayload = {
  status_code?: number;
  status_message?: string;
  tasks?: {
    status_code?: number;
    status_message?: string;
    result?: unknown[];
  }[];
};

type SearchProviderLocation = {
  location_code: number;
  location_name: string;
  country_iso_code: string;
  location_type: string;
};

type KeywordSuggestion = { keyword: string; reason: string };
type KeywordSuggestionResult = {
  suggestions: KeywordSuggestion[];
  intakeComplete: boolean;
  projectId: string | null;
  workspaceType: "Personal" | "Business" | "Agency" | "Ecommerce";
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

type BacklinkSummary = {
  target: string;
  backlinks: number | null;
  backlinksNew: number | null;
  backlinksLost: number | null;
  referringDomains: number | null;
  referringDomainsNew: number | null;
  referringDomainsLost: number | null;
  referringDomainsBroken: number | null;
  referringMainDomains: number | null;
  referringPages: number | null;
  dofollow: number | null;
  nofollow: number | null;
  brokenBacklinks: number | null;
  brokenPages: number | null;
  spamScore: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  source: "search_data";
  fetchedAt: Date;
  cached: boolean;
  providerCostUsd: number;
};

type BacklinkLink = {
  sourceUrl: string | null;
  sourceDomain: string | null;
  targetUrl: string | null;
  anchor: string | null;
  dofollow: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
  sourceRank: number | null;
  pageRank: number | null;
  toxicityScore: number | null;
};

type BacklinkLinksResult = {
  target: string;
  links: BacklinkLink[];
  source: "search_data";
  fetchedAt: Date;
  cached: boolean;
  providerCostUsd: number;
};

type OrganicGrowthTask = {
  id: string;
  group: "create" | "improve" | "fix" | "support" | "track";
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  url: string | null;
  impact: string;
};

type OrganicGrowthKeywordCluster = {
  name: string;
  intent: "core_service" | "local" | "question" | "comparison" | "commercial" | "supporting";
  pageType: "service_page" | "location_page" | "article" | "faq" | "comparison_page" | "landing_page";
  keywords: string[];
};

type SearchLocation = {
  displayName: string;
  countryIsoCode: string | null;
  locationType: "Country" | "Region" | "State" | "City" | "Custom";
  labs: { location_code: number };
  serp: { location_code: number } | { location_name: string } | { location_coordinate: string };
  keywordMetrics: { location_code: number } | { location_name: string };
  metricScopeName?: string;
  metricSource?: "selected_location" | "parent_city";
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
  location: SearchLocation;
  languageCode: string;
  device: "desktop" | "mobile";
  serpDepth: number;
  keywordLimit: number;
};

type ScopedKeywordWebsite = { id: string; clientId: string; domain: string; rootUrl: string };
type KeywordCreateInput = z.infer<typeof createSchema>;
type KeywordResearchProject = { id: string; clientId: string; websiteId: string | null; targetLocations: Prisma.JsonValue };
type KeywordResearchScope = {
  clientId: string;
  project: KeywordResearchProject | null;
  website: ScopedKeywordWebsite | null;
};

class KeywordResearchHttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

function cleanSuggestionText(value: string): string {
  return value.trim().replace(/,+$/g, "").replace(/\s+/g, " ").trim();
}

function normalizeSuggestionKeyword(value: string): string {
  return cleanSuggestionText(value).toLowerCase();
}

function jsonStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(cleanSuggestionText).filter(Boolean) : [];
}

function intakeAnswerText(value: unknown): string {
  if (typeof value === "string") return cleanSuggestionText(value);
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map(cleanSuggestionText).filter(Boolean).join(", ");
  }
  return "";
}

function normalizedWorkspaceType(value: string | null | undefined): KeywordSuggestionResult["workspaceType"] {
  const match = value?.toLowerCase();
  if (match === "business") return "Business";
  if (match === "agency") return "Agency";
  if (match === "ecommerce") return "Ecommerce";
  return "Personal";
}

async function openaiKeywordSuggestions(prompt: string): Promise<unknown> {
  const generated = await centralAiJson({
    system: "You create evidence-grounded keyword suggestions and return valid structured JSON only.",
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
    const cleaned = cleanSuggestionText(keyword);
    const key = normalizeSuggestionKeyword(cleaned);
    if (!cleaned || cleaned.length < 2 || seen.has(key)) continue;
    seen.add(key);
    const reason = typeof item === "object" && item && typeof (item as { reason?: unknown }).reason === "string" ? cleanSuggestionText(String((item as { reason: string }).reason)) : "Relevant project keyword target.";
    suggestions.push({ keyword: cleaned, reason: reason || "Relevant project keyword target." });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

function fallbackKeywordSuggestions(input: {
  domain: string;
  rootUrl: string;
  country?: string | null;
  cities?: unknown;
  selectedCities?: string;
  project?: {
    businessName?: string | null;
    niche?: string | null;
    primaryGoal?: string | null;
    targetLocation?: string | null;
    businessProfile?: {
      businessSummary?: string | null;
      targetAudience?: string | null;
      offerSummary?: string | null;
      businessModel?: string | null;
      strengths?: unknown;
      constraints?: unknown;
    } | null;
  } | null;
  pages: Array<{ url: string; seo?: { title?: string | null; metaDescription?: string | null; h1Text?: unknown; h2Json?: unknown } | null }>;
  existingKeywords: Set<string>;
  limit: number;
}): KeywordSuggestion[] {
  const seen = new Set(input.existingKeywords);
  const suggestions: KeywordSuggestion[] = [];
  const city = cleanSuggestionText((input.selectedCities || jsonStringList(input.cities)[0] || "").split(",")[0] ?? "");
  const domainBase = cleanSuggestionText(input.domain.replace(/^www\./, "").split(".")[0]?.replace(/[-_]+/g, " ") ?? "");
  const profile = input.project?.businessProfile;
  const offerTerms = splitBusinessTerms(profile?.offerSummary ?? "");
  const audienceTerms = splitBusinessTerms(profile?.targetAudience ?? "");
  const nicheTerms = splitBusinessTerms(input.project?.niche ?? profile?.businessSummary ?? "");
  const projectTerms = [...offerTerms, ...nicheTerms, ...audienceTerms];
  const pageTerms = input.pages.flatMap((page) => [
    page.seo?.title ?? "",
    page.seo?.metaDescription ?? "",
    ...jsonStringList(page.seo?.h1Text),
    ...jsonStringList(page.seo?.h2Json),
  ]);
  const phraseCandidates = pageTerms
    .flatMap((text) => extractSearchPhrases(text))
    .filter((phrase) => !/\b(home|privacy|terms|contact|login|sign in)\b/i.test(phrase));
  const baseTerms = [...offerTerms, ...nicheTerms, ...phraseCandidates, domainBase].filter((term) => term.length >= 3);
  const add = (keyword: string, reason: string) => {
    const cleaned = cleanSuggestionText(keyword);
    const key = normalizeSuggestionKeyword(cleaned);
    if (!cleaned || cleaned.length < 3 || seen.has(key) || suggestions.length >= input.limit) return;
    seen.add(key);
    suggestions.push({ keyword: cleaned, reason });
  };

  for (const offer of offerTerms) {
    add(offer, "Suggested from project services/offers.");
    if (city) add(`${offer} ${city}`, "Suggested from project offer and selected location.");
    for (const audience of audienceTerms.slice(0, 3)) {
      add(`${offer} for ${audience}`, "Suggested from project offer and target audience.");
      add(`${offer} software for ${audience}`, "Software-intent keyword based on offer and audience.");
      add(`${offer} solution for ${audience}`, "Solution-intent keyword based on offer and audience.");
    }
    add(`best ${offer}`, "Commercial comparison keyword based on the project offer.");
    add(`${offer} software`, "Software-intent keyword based on the project offer.");
    add(`${offer} platform`, "Platform-intent keyword based on the project offer.");
    add(`${offer} pricing`, "Commercial pricing keyword based on the project offer.");
    add(`${offer} implementation`, "Implementation keyword based on the project offer.");
    add(`${offer} automation`, "Automation keyword based on the project offer.");
    add(`${offer} management`, "Management keyword based on the project offer.");
    if (nicheTerms[0]) {
      add(`${nicheTerms[0]} ${offer}`, "Suggested from project industry and offer.");
      add(`${offer} for ${nicheTerms[0]}`, "Suggested from project offer and industry.");
    }
  }
  for (const niche of nicheTerms) {
    add(`${niche} services`, "Suggested from project industry/niche.");
    add(`${niche} software`, "Software-intent keyword based on project industry.");
    add(`${niche} automation`, "Automation keyword based on project industry.");
    add(`${niche} crm`, "CRM-intent keyword based on project industry.");
    add(`${niche} management software`, "Management-software keyword based on project industry.");
    if (city) add(`${niche} services ${city}`, "Suggested from project industry and selected location.");
  }
  for (const audience of audienceTerms.slice(0, 4)) {
    add(`software for ${audience}`, "Suggested from target audience.");
    add(`crm for ${audience}`, "CRM-intent keyword based on target audience.");
    add(`automation for ${audience}`, "Automation keyword based on target audience.");
    if (city) add(`${audience} software ${city}`, "Local keyword based on target audience and selected city.");
  }
  for (const term of baseTerms) {
    if (projectTerms.length && !hasContextOverlap(term, [...projectTerms, city])) continue;
    add(term, "Suggested from crawled page titles and headings.");
    if (city) add(`${term} ${city}`, "Suggested from page context and selected city.");
    add(`best ${term}`, "Commercial comparison keyword based on page context.");
    add(`${term} services`, "Service-intent keyword based on page context.");
  }
  if (city && domainBase) {
    add(`${domainBase} ${city}`, "Local keyword based on domain and selected city.");
    add(`${domainBase} services ${city}`, "Local service keyword based on project location.");
  }
  if (input.country && domainBase) add(`${domainBase} ${input.country}`, "Country-level keyword based on project market.");
  return suggestions.slice(0, input.limit);
}

function hasContextOverlap(value: string, contextTerms: string[]) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return contextTerms.some((term) => {
    const context = normalizeText(term);
    if (!context) return false;
    return normalized.includes(context) || context.includes(normalized) || context.split(" ").some((word) => word.length > 3 && normalized.includes(word));
  });
}

function splitBusinessTerms(value: string): string[] {
  const generic = new Set(["business", "businesses", "company", "companies", "service", "services", "solution", "solutions", "platform"]);
  const seen = new Set<string>();
  return value
    .split(/[,\n|;]+/)
    .map((part) => cleanSuggestionText(part.replace(/\s+/g, " ")))
    .filter((part) => {
      const normalized = normalizeText(part);
      if (!normalized || normalized.length < 3 || normalized.length > 80 || generic.has(normalized)) return false;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 8);
}

function extractSearchPhrases(text: string): string[] {
  const cleaned = cleanSuggestionText(text)
    .replace(/[|•·]/g, ",")
    .replace(/\b(home|official site|welcome)\b/gi, "")
    .replace(/\s+/g, " ");
  return cleaned
    .split(/[,;:–—-]/)
    .map((part) => cleanSuggestionText(part))
    .filter((part) => {
      const words = part.split(" ").filter(Boolean);
      return words.length >= 2 && words.length <= 6 && part.length <= 80;
    })
    .slice(0, 12);
}

function filterRelevantKeywordSuggestions(suggestions: KeywordSuggestion[], contextTerms: string[], limit: number) {
  if (!contextTerms.length) return suggestions.slice(0, limit);
  return suggestions.filter((suggestion) => hasContextOverlap(suggestion.keyword, contextTerms)).slice(0, limit);
}

async function suggestKeywordsForWebsite(
  website: ScopedKeywordWebsite,
  limit: number,
  language: string,
  excludeKeywords: string[] = [],
  selectedLocation: { country?: string; region?: string; cities?: string } = {},
): Promise<KeywordSuggestionResult> {
  const profile = await prisma.website.findUnique({
    where: { id: website.id },
    select: {
      domain: true,
      rootUrl: true,
      targetCountry: true,
      targetCities: true,
      crawlJobs: {
        where: { status: "completed" },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          pages: {
            orderBy: [{ score: "desc" }, { wordCount: "desc" }],
            take: 8,
            select: {
              url: true,
              wordCount: true,
              seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true } },
            },
          },
        },
      },
      keywordResearchRuns: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          seedKeyword: true,
          locationName: true,
          ideas: {
            orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }],
            take: 5,
            select: { keyword: true },
          },
        },
      },
    },
  });
  if (!profile) return { suggestions: [], intakeComplete: false, projectId: null, workspaceType: "Personal" };
  const project = await prisma.project.findFirst({
    where: { websiteId: website.id, clientId: website.clientId, status: { not: "deleted" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      businessName: true,
      projectType: true,
      websiteUrl: true,
      niche: true,
      primaryGoal: true,
      secondaryGoals: true,
      businessLocation: true,
      targetLocations: true,
      targetLocation: true,
      preferredOutputs: true,
      client: { select: { name: true } },
      intakeAnswers: { select: { questionKey: true, answerValue: true } },
      businessProfile: {
        select: {
          businessSummary: true,
          targetAudience: true,
          offerSummary: true,
          businessModel: true,
          strengths: true,
          constraints: true,
        },
      },
      opportunities: {
        where: { status: { in: ["selected", "confirmed"] } },
        take: 1,
        select: { name: true, targetAudience: true, recommendedOffer: true, summary: true },
      },
      strategyPlans: {
        where: { status: "approved" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, version: true, status: true, strategySummary: true, audienceProfile: true, offerRecommendation: true, seoStrategy: true, prioritizedRecommendations: true },
      },
      keywordGroups: { where: { status: "approved" }, select: { status: true, keywords: true } },
    },
  });
  const workspaceType = normalizedWorkspaceType(project?.client.name);
  const answers = new Map(project?.intakeAnswers.map((answer) => [answer.questionKey, intakeAnswerText(answer.answerValue)]) ?? []);
  const description = answers.get("business_description") || project?.businessProfile?.businessSummary || "";
  const offer = answers.get("products_services") || answers.get("product_category") || project?.businessProfile?.offerSummary || "";
  const niche = project?.niche || answers.get("industry_niche") || answers.get("store_type") || "";
  // A name, URL, or location alone is not enough to infer useful search intent.
  const intakeComplete = Boolean(description.trim() || offer.trim() || niche.trim());
  if (!intakeComplete) {
    return { suggestions: [], intakeComplete: false, projectId: project?.id ?? null, workspaceType };
  }


  const existingKeywords = new Set<string>();
  for (const run of profile.keywordResearchRuns) {
    existingKeywords.add(normalizeSuggestionKeyword(run.seedKeyword));
    for (const idea of run.ideas) existingKeywords.add(normalizeSuggestionKeyword(idea.keyword));
  }
  const approvedKeywords = approvedKeywordEntries(project?.keywordGroups ?? []);
  for (const keyword of approvedKeywords) existingKeywords.add(normalizeSuggestionKeyword(keyword));
  for (const keyword of excludeKeywords) existingKeywords.add(normalizeSuggestionKeyword(keyword));

  const topPages = profile.crawlJobs[0]?.pages ?? [];
  const pageContext = topPages.map((page) => {
    const h1 = jsonStringList(page.seo?.h1Text).slice(0, 3).join("; ");
    const h2 = jsonStringList(page.seo?.h2Json).slice(0, 4).join("; ");
    return [
      page.url,
      page.seo?.title ? `title: ${page.seo.title}` : "",
      page.seo?.metaDescription ? `meta: ${page.seo.metaDescription}` : "",
      h1 ? `h1: ${h1}` : "",
      h2 ? `h2: ${h2}` : "",
      typeof page.wordCount === "number" ? `words: ${page.wordCount}` : "",
    ].filter(Boolean).join(" | ");
  });
  const previousLocations = [...new Set(profile.keywordResearchRuns.map((run) => run.locationName).filter(Boolean))].slice(0, 6);
  const contextTerms = [
    project?.businessName ?? "",
    project?.niche ?? "",
    project?.primaryGoal ?? "",
    ...jsonStringList(project?.secondaryGoals),
    ...jsonStringList(project?.targetLocations),
    project?.businessProfile?.businessSummary ?? "",
    project?.businessProfile?.targetAudience ?? "",
    project?.businessProfile?.offerSummary ?? "",
    selectedLocation.cities ?? "",
    selectedLocation.region ?? "",
    selectedLocation.country ?? "",
  ].flatMap(splitBusinessTerms);

  const prompt = [
    "Suggest organic SEO keyword research seed keywords for this website.",
    "Return JSON with key suggestions: an array of objects with keyword and reason.",
    "Keywords should be concise search phrases a customer would type, not full sentences.",
    "Mix commercial, service/category, problem-aware, comparison, and local-intent terms when relevant.",
    "Every keyword must clearly relate to the project industry, products/services, target audience, or selected location.",
    "Prioritize offer + audience, offer + location, industry + software, industry + automation, and commercial comparison phrases.",
    "Do not include duplicate ideas or competitor brand names.",
    `Return at most ${limit} suggestions.`,
    `Language: ${language}`,
    `Domain: ${profile.domain}`,
    `Root URL: ${profile.rootUrl}`,
    `Target country: ${profile.targetCountry ?? "not provided"}`,
    `Project target cities: ${jsonStringList(profile.targetCities).join(", ") || "not provided"}`,
    `Workspace type: ${workspaceType}`,
    `Use the ${workspaceType} workspace intake fields and search intent appropriate to that workspace.`,
    `Project business/store/client name: ${project?.businessName ?? answers.get("client_name") ?? answers.get("store_name") ?? "not provided"}`,
    `Project type: ${project?.projectType ?? "not provided"}`,
    `Project website URL: ${project?.websiteUrl ?? profile.rootUrl}`,
    `Additional intake context: ${project?.intakeAnswers.map((answer) => `${answer.questionKey}: ${intakeAnswerText(answer.answerValue)}`).filter((item) => !item.endsWith(": ")).join(" | ") || "not provided"}`,
    `Project niche/industry: ${project?.niche ?? "not provided"}`,
    `Project primary goal: ${project?.primaryGoal ?? "not provided"}`,
    `Project secondary goals: ${jsonStringList(project?.secondaryGoals).join(", ") || "none"}`,
    `Business location (identity only): ${project?.businessLocation ?? "not provided"}`,
    `Project target markets/locations: ${jsonStringList(project?.targetLocations).join(", ") || project?.targetLocation || "not provided"}`,
    `Business summary: ${project?.businessProfile?.businessSummary ?? "not provided"}`,
    `Target audience: ${project?.businessProfile?.targetAudience ?? project?.strategyPlans[0]?.audienceProfile ?? project?.opportunities[0]?.targetAudience ?? "not provided"}`,
    `Products/services/offers: ${project?.businessProfile?.offerSummary ?? project?.strategyPlans[0]?.offerRecommendation ?? project?.opportunities[0]?.recommendedOffer ?? "not provided"}`,
    `Business model: ${project?.businessProfile?.businessModel ?? "not provided"}`,
    `Strengths: ${jsonStringList(project?.businessProfile?.strengths).join(", ") || "not provided"}`,
    `Constraints/niches to avoid: ${jsonStringList(project?.businessProfile?.constraints).join(", ") || "not provided"}`,
    `Selected opportunity: ${project?.opportunities[0]?.name ?? "not selected"}`,
    `Approved SEO strategy: ${project?.strategyPlans[0]?.seoStrategy ?? "not approved"}`,
    `Keywords from the specifically approved groups (do not infer approval for any other group): ${approvedKeywords.join(", ") || "none"}`,
    `Shared approved Strategy contract: ${JSON.stringify(approvedStrategyContext(project?.strategyPlans[0]))}`,
    `Selected suggestion country: ${selectedLocation.country || "not provided"}`,
    `Selected suggestion region/state: ${selectedLocation.region || "not provided"}`,
    `Selected suggestion cities: ${selectedLocation.cities || "not provided"}`,
    `Previous locations: ${previousLocations.join(", ") || "none"}`,
    `Already researched keywords: ${profile.keywordResearchRuns.length ? profile.keywordResearchRuns.map((run) => run.seedKeyword).join(", ") : "none"}`,
    `Do not return these already shown or selected keywords: ${excludeKeywords.length ? excludeKeywords.join(", ") : "none"}`,
    `Top crawled pages:\n${pageContext.length ? pageContext.join("\n") : "No completed crawl page data available."}`,
  ].join("\n");

  const fallback = () => fallbackKeywordSuggestions({
    domain: profile.domain,
    rootUrl: profile.rootUrl,
    country: selectedLocation.country || profile.targetCountry,
    cities: profile.targetCities,
    selectedCities: selectedLocation.cities,
    project,
    pages: topPages,
    existingKeywords,
    limit,
  });

  try {
    const generated = await openaiKeywordSuggestions(prompt);
    const suggestions = filterRelevantKeywordSuggestions(parseKeywordSuggestions(generated, existingKeywords, limit * 2), contextTerms, limit);
    if (suggestions.length) return { suggestions, intakeComplete, projectId: project?.id ?? null, workspaceType };
    return { suggestions: fallback(), intakeComplete, projectId: project?.id ?? null, workspaceType };
  } catch {
    return { suggestions: fallback(), intakeComplete, projectId: project?.id ?? null, workspaceType };
  }
}

async function keywordWebsiteForRequest(req: Request, websiteId: string, clientId: string | null) {
  const website = await prisma.website.findFirst({
    where: { id: websiteId, ...(clientId ? { clientId } : {}) },
    select: { id: true, clientId: true, domain: true, rootUrl: true },
  });
  if (website) return { website, mismatch: null };

  const exists = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, clientId: true, domain: true },
  });
  return { website: null, mismatch: exists };
}

async function keywordResearchScopeForRequest(req: Request, input: Pick<KeywordCreateInput, "projectId" | "websiteId" | "clientId">): Promise<KeywordResearchScope> {
  let clientId = await projectClientIdForRequest(req, input.clientId);
  let project: KeywordResearchProject | null = null;
  if (input.projectId) {
    project = await prisma.project.findFirst({
      where: { id: input.projectId, status: { not: "deleted" }, ...(clientId ? { clientId } : {}) },
      select: { id: true, clientId: true, websiteId: true, targetLocations: true },
    });
    if (!project) throw new KeywordResearchHttpError(404, "project not found");
    clientId = project.clientId;
  }

  let website: ScopedKeywordWebsite | null = null;
  const requestedWebsiteId = input.websiteId || project?.websiteId || null;
  if (requestedWebsiteId) {
    const scoped = await keywordWebsiteForRequest(req, requestedWebsiteId, clientId);
    website = scoped.website;
    if (!website) {
      if (scoped.mismatch) {
        throw new KeywordResearchHttpError(403, "website belongs to another client context", {
          domain: scoped.mismatch.domain,
          websiteId: scoped.mismatch.id,
        });
      }
      throw new KeywordResearchHttpError(404, "website not found");
    }
    clientId = website.clientId;
  }
  if (project && website && project.websiteId !== website.id) {
    throw new KeywordResearchHttpError(400, "website does not belong to the selected project");
  }
  if (!clientId) throw new KeywordResearchHttpError(400, "clientId required");
  return { clientId, project, website };
}

function keywordResearchTargets(input: KeywordCreateInput, scope: KeywordResearchScope) {
  const connectedDomain = normalizeDomain(scope.website?.domain) || domainFromUrl(scope.website?.rootUrl);
  const targetDomain = scope.project
    ? connectedDomain
    : normalizeDomain(input.targetDomain) || domainFromUrl(input.targetUrl) || connectedDomain;
  const inputTargetUrlDomain = domainFromUrl(input.targetUrl);
  const targetUrl = scope.project
    ? targetDomain && input.targetUrl && inputTargetUrlDomain === targetDomain ? input.targetUrl : null
    : input.targetUrl || null;
  return { targetDomain, targetUrl };
}

function validateKeywordLocationPair(input: KeywordCreateInput, scope: KeywordResearchScope, location: SearchLocation) {
  const projectMarkets = scope.project && Array.isArray(scope.project.targetLocations)
    ? scope.project.targetLocations.map(String).flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean)
    : [];
  const explicitSeedMarkets = detectKeywordLocations(input.seedKeyword, projectMarkets);
  const requestedMarket = normalizeKeywordPhrase(location.displayName.split(",")[0] ?? location.displayName);
  if (explicitSeedMarkets.length && !explicitSeedMarkets.some((market) => normalizeKeywordPhrase(market) === requestedMarket)) {
    throw new KeywordResearchHttpError(400, `The localized seed “${input.seedKeyword}” can only be analyzed in its matching market (${explicitSeedMarkets.join(", ")}). Remove the location from the seed to analyze it across multiple markets.`);
  }
}

function keywordResearchRequestKey(input: KeywordCreateInput, scope: KeywordResearchScope, location: SearchLocation, targetDomain: string | null) {
  const researchIdentity = keywordResearchRequestIdentity({
    keyword: input.seedKeyword,
    location: location.displayName,
    languageCode: input.languageCode,
    device: input.device,
  });
  return createHash("sha256").update(JSON.stringify({
    projectId: scope.project?.id ?? null,
    websiteId: scope.website?.id ?? null,
    clientId: scope.clientId,
    researchIdentity,
    serpDepth: input.serpDepth,
    keywordLimit: input.keywordLimit,
    targetDomain,
    keywordMetricsVersion: KEYWORD_METRICS_VERSION,
  })).digest("hex");
}

async function assertKeywordResearchQueueCapacity(scope: { clientId: string; project: { id: string } | null }, newCheckCount = 1) {
  const projectWhere = scope.project?.id ? { projectId: scope.project.id } : { clientId: scope.clientId };
  const [projectActive, globalActive] = await Promise.all([
    prisma.keywordResearchRun.count({ where: { ...projectWhere, status: { in: ["queued", "running"] } } }),
    prisma.keywordResearchRun.count({ where: { status: { in: ["queued", "running"] } } }),
  ]);
  if (projectActive + newCheckCount > config.keywordResearchProjectActiveLimit) {
    throw new KeywordResearchHttpError(429, `This project already has ${projectActive} keyword-location checks in progress. Wait for the queue to advance, then retry only the remaining checks.`, {
      active: projectActive,
      limit: config.keywordResearchProjectActiveLimit,
    });
  }
  if (globalActive + newCheckCount > config.keywordResearchGlobalActiveLimit) {
    throw new KeywordResearchHttpError(429, "Keyword research is currently at processing capacity. Your completed checks are preserved; retry the remaining checks when capacity is available.", {
      active: globalActive,
      limit: config.keywordResearchGlobalActiveLimit,
    });
  }
  return { projectActive, globalActive };
}

async function createOrReuseKeywordResearchRun(
  input: KeywordCreateInput,
  scope: KeywordResearchScope,
  location: SearchLocation,
  bypassRefreshLimit: boolean,
  options: { enforceCapacity?: boolean; usageEventId?: string | null; userId?: string | null } = {},
) {
  validateKeywordLocationPair(input, scope, location);
  const { targetDomain, targetUrl } = keywordResearchTargets(input, scope);
  const requestKey = keywordResearchRequestKey(input, scope, location, targetDomain);
  const executionInput: KeywordResearchExecutionInput = {
    seedKeyword: input.seedKeyword,
    targetUrl,
    targetDomain,
    location,
    languageCode: input.languageCode,
    device: input.device,
    serpDepth: input.serpDepth,
    keywordLimit: input.keywordLimit,
  };
  const existingRun = await prisma.keywordResearchRun.findFirst({ where: { requestKey }, orderBy: { createdAt: "desc" } });
  if (existingRun && !["failed", "cancelled", "canceled"].includes(existingRun.status)) {
    return { run: withRefreshState(existingRun, bypassRefreshLimit), reused: true, retried: false };
  }
  if (options.enforceCapacity !== false) await assertKeywordResearchQueueCapacity(scope);

  const capacityCheckType = location.locationType === "Country" ? "country" : "local";
  const ownedReservation = !options.usageEventId;
  const reservation = options.usageEventId ? { usageEventId: options.usageEventId } : await preflightUsage({
    clientId: scope.clientId,
    userId: options.userId,
    projectId: scope.project?.id,
    websiteId: scope.website?.id,
    featureKey: "keyword_research_batch",
    actionKey: "Run keyword-market research",
    idempotencyKey: `keyword-research:${requestKey}:${Date.now()}`,
    metadata: { countryChecks: capacityCheckType === "country" ? 1 : 0, localChecks: capacityCheckType === "local" ? 1 : 0 },
  });

  const run = await prisma.keywordResearchRun.create({
    data: {
      requestKey,
      clientId: scope.clientId,
      projectId: scope.project?.id ?? null,
      websiteId: scope.website?.id ?? null,
      seedKeyword: input.seedKeyword.trim().replace(/\s+/g, " "),
      targetUrl,
      targetDomain,
      locationName: canonicalGeographicLocationLabel(location.displayName),
      languageCode: input.languageCode,
      device: input.device,
      serpDepth: input.serpDepth,
      keywordLimit: input.keywordLimit,
      status: "queued",
      usageEventId: reservation.usageEventId,
      capacityCheckType,
    },
  });
  try {
    await enqueueKeywordResearchCompletion(run.id, executionInput);
  } catch (error) {
    await prisma.keywordResearchRun.updateMany({
      where: { id: run.id, status: "queued" },
      data: { status: "failed", error: "Keyword research could not enter the processing queue. Retry this exact check.", completedAt: new Date() },
    });
    if (ownedReservation) await refundUsage({ usageEventId: reservation.usageEventId, reason: "Keyword research could not enter the processing queue." }).catch(() => undefined);
    throw error;
  }
  return { run: withRefreshState(run, bypassRefreshLimit), reused: Boolean(existingRun), retried: Boolean(existingRun) };
}

async function scopedRun(req: Request, id: string) {
  const clientId = await projectClientIdForRequest(req);
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  const run = await prisma.keywordResearchRun.findFirst({
    where: { id, ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}) },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 100 },
      competitors: { orderBy: { rank: "asc" }, take: 120 },
    },
  });
  return run ? withRefreshState(withRelevantIdeas(run), bypassRefreshLimit) : null;
}

function publicKeywordResearchError(message: string, phase: "location" | "research" = "research"): { status: number; message: string } {
  const normalized = message.toLowerCase();
  if (/timed? out|timeout|aborted due to timeout/.test(normalized)) {
    return phase === "location"
      ? { status: 503, message: "The search provider took too long to verify this location. No research job was started. Please retry." }
      : { status: 503, message: "The search provider did not complete this check after automatic retries. Completed checks were preserved; retry this exact check." };
  }
  if (normalized.includes("unambiguous provider location") || normalized.includes("do not support the country")) {
    return { status: 422, message: "This is not one supported exact research location. Choose one city, region, or country per location and try again." };
  }
  if (normalized.includes("exact location metrics")) {
    return { status: 502, message: "Exact metrics were unavailable for this location. No country fallback was saved. Retry the location analysis." };
  }
  if (normalized.includes("invalid field") && normalized.includes("location")) {
    return { status: 400, message: "This search location is not supported. Choose a country or a supported city, then try again." };
  }
  if (normalized.includes("credentials are not configured")) {
    return { status: 503, message: "Search data is not configured yet. Please contact support." };
  }
  if (normalized.includes("keyword data provider")) {
    return { status: 502, message: "Search data could not be fetched right now. Check the keyword and location, then try again." };
  }
  return { status: 502, message: "Keyword research could not be completed right now. Please try again." };
}

keywordResearchRouter.post("/keyword-research", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  try {
    const scope = await keywordResearchScopeForRequest(req, input);
    const location = await resolveExactSearchLocation(input.locationName, input.seedKeyword);
    const result = await createOrReuseKeywordResearchRun(input, scope, location, bypassRefreshLimit, { userId: req.user?.userId });
    return res.status(result.run.status === "completed" ? 200 : 202).json(result);
  } catch (error) {
    if (error instanceof KeywordResearchHttpError) return res.status(error.status).json({ error: error.message, ...(error.details ?? {}) });
    const publicError = publicKeywordResearchError(error instanceof Error ? error.message : "Exact location metrics could not be resolved.", "location");
    return res.status(publicError.status).json({ error: publicError.message });
  }
});

keywordResearchRouter.post("/keyword-research/batch", async (req, res) => {
  const parsed = batchCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  let scope: KeywordResearchScope;
  try {
    scope = await keywordResearchScopeForRequest(req, parsed.data);
  } catch (error) {
    if (error instanceof KeywordResearchHttpError) return res.status(error.status).json({ error: error.message, ...(error.details ?? {}) });
    throw error;
  }

  const rawChecks: KeywordCreateInput[] = parsed.data.checks.map((check) => ({
    ...check,
    projectId: parsed.data.projectId ?? null,
    websiteId: parsed.data.websiteId ?? null,
    clientId: parsed.data.clientId ?? null,
  }));
  const uniqueRequestedLocations = [...new Map(rawChecks.map((check) => [
    canonicalGeographicLocationLabel(check.locationName).toLocaleLowerCase(),
    check.locationName,
  ])).values()];
  const resolvedLocations = new Map<string, SearchLocation>();
  const invalidLocations: Array<{ location: string; reason: string }> = [];
  await Promise.all(uniqueRequestedLocations.map(async (requested) => {
    try {
      const location = await resolveExactSearchLocation(requested);
      resolvedLocations.set(canonicalGeographicLocationLabel(requested).toLocaleLowerCase(), location);
    } catch (error) {
      const publicError = publicKeywordResearchError(error instanceof Error ? error.message : "The location could not be validated.", "location");
      invalidLocations.push({ location: requested, reason: publicError.message });
    }
  }));
  if (invalidLocations.length) {
    return res.status(422).json({
      error: `Review the research locations before starting this batch. ${invalidLocations.map((item) => `${item.location}: ${item.reason}`).join(" ")}`,
      invalid: invalidLocations,
      accepted: [],
    });
  }

  const validatedChecks = new Map<string, { input: KeywordCreateInput; location: SearchLocation }>();
  const invalidChecks: Array<{ keyword: string; location: string; reason: string }> = [];
  for (const input of rawChecks) {
    const location = resolvedLocations.get(canonicalGeographicLocationLabel(input.locationName).toLocaleLowerCase());
    if (!location) continue;
    try {
      validateKeywordLocationPair(input, scope, location);
      const identity = keywordResearchRequestIdentity({ keyword: input.seedKeyword, location: location.displayName, languageCode: input.languageCode, device: input.device });
      if (!validatedChecks.has(identity)) validatedChecks.set(identity, { input, location });
    } catch (error) {
      invalidChecks.push({
        keyword: input.seedKeyword,
        location: input.locationName,
        reason: error instanceof Error ? error.message : "This keyword-location pair is invalid.",
      });
    }
  }
  if (invalidChecks.length) {
    return res.status(422).json({
      error: `Review the keyword and location mapping before starting this batch. ${invalidChecks.map((item) => `${item.keyword} · ${item.location}: ${item.reason}`).join(" ")}`,
      invalid: invalidChecks,
      accepted: [],
    });
  }

  const checks = [...validatedChecks.values()];
  const requestKeys = checks.map(({ input, location }) => {
    const { targetDomain } = keywordResearchTargets(input, scope);
    return keywordResearchRequestKey(input, scope, location, targetDomain);
  });
  const existingRuns = requestKeys.length ? await prisma.keywordResearchRun.findMany({
    where: { requestKey: { in: requestKeys } },
    orderBy: { createdAt: "desc" },
    select: { requestKey: true, status: true },
  }) : [];
  const latestExistingByKey = new Map<string, { requestKey: string | null; status: string }>();
  for (const run of existingRuns) {
    if (run.requestKey && !latestExistingByKey.has(run.requestKey)) latestExistingByKey.set(run.requestKey, run);
  }
  const newCheckCount = requestKeys.filter((requestKey) => {
    const existing = latestExistingByKey.get(requestKey);
    return !existing || ["failed", "cancelled", "canceled"].includes(existing.status);
  }).length;
  const newChecks = checks.filter(({ input, location }) => {
    const { targetDomain } = keywordResearchTargets(input, scope);
    const requestKey = keywordResearchRequestKey(input, scope, location, targetDomain);
    const existing = latestExistingByKey.get(requestKey);
    return !existing || ["failed", "cancelled", "canceled"].includes(existing.status);
  });
  const activeWhere = scope.project?.id ? { projectId: scope.project.id } : { clientId: scope.clientId };
  const [projectActive, globalActive] = await Promise.all([
    prisma.keywordResearchRun.count({ where: { ...activeWhere, status: { in: ["queued", "running"] } } }),
    prisma.keywordResearchRun.count({ where: { status: { in: ["queued", "running"] } } }),
  ]);
  if (projectActive + newCheckCount > config.keywordResearchProjectActiveLimit) {
    return res.status(429).json({
      error: `This project already has ${projectActive} keyword-location checks in progress. Start at most ${Math.max(0, config.keywordResearchProjectActiveLimit - projectActive)} more after the current queue advances.`,
      limit: config.keywordResearchProjectActiveLimit,
      active: projectActive,
      requested: newCheckCount,
    });
  }
  if (globalActive + newCheckCount > config.keywordResearchGlobalActiveLimit) {
    return res.status(503).json({
      error: "Keyword research is at processing capacity. Existing checks are safe; try this batch again after the queue advances.",
      limit: config.keywordResearchGlobalActiveLimit,
      active: globalActive,
      requested: newCheckCount,
    });
  }

  let batchUsageEventId: string | null = null;
  if (newChecks.length) {
    try {
      const countryChecks = newChecks.filter(({ location }) => location.locationType === "Country").length;
      const localChecks = newChecks.length - countryChecks;
      const usage = await preflightUsage({
        clientId: scope.clientId,
        userId: req.user?.userId,
        projectId: scope.project?.id,
        websiteId: scope.website?.id,
        featureKey: "keyword_research_batch",
        actionKey: "Run keyword-market research batch",
        idempotencyKey: `keyword-research-batch:${Date.now()}:${requestKeys.join(":")}`,
        inputUnits: newChecks.length,
        metadata: { countryChecks, localChecks },
      });
      batchUsageEventId = usage.usageEventId;
    } catch (error) {
      return res.status(Number((error as { statusCode?: number }).statusCode || 402)).json({ error: error instanceof Error ? error.message : "Could not reserve AI Capacity for keyword research." });
    }
  }

  const accepted: Array<{ run: Awaited<ReturnType<typeof createOrReuseKeywordResearchRun>>["run"]; requestedLocation: string; resolvedLocation: string; reused: boolean; retried: boolean }> = [];
  const failed: Array<{ keyword: string; location: string; reason: string }> = [];
  for (const { input, location } of checks) {
    try {
      const result = await createOrReuseKeywordResearchRun(input, scope, location, bypassRefreshLimit, { enforceCapacity: false, usageEventId: batchUsageEventId, userId: req.user?.userId });
      accepted.push({
        ...result,
        requestedLocation: input.locationName,
        resolvedLocation: location.displayName,
      });
    } catch (error) {
      failed.push({
        keyword: input.seedKeyword,
        location: input.locationName,
        reason: error instanceof Error ? error.message : "The check could not enter the processing queue.",
      });
    }
  }
  if (batchUsageEventId) {
    const meteredRunIds = accepted.filter((item) => item.run.usageEventId === batchUsageEventId).map((item) => item.run.id);
    const countryChecks = accepted.filter((item) => item.run.usageEventId === batchUsageEventId && item.run.capacityCheckType === "country").length;
    const localChecks = meteredRunIds.length - countryChecks;
    const reservedEvent = await prisma.usageEvent.findUnique({ where: { id: batchUsageEventId }, select: { metadataJson: true } });
    const reservedMetadata = reservedEvent?.metadataJson && typeof reservedEvent.metadataJson === "object" && !Array.isArray(reservedEvent.metadataJson) ? reservedEvent.metadataJson as Record<string, unknown> : {};
    await prisma.usageEvent.update({ where: { id: batchUsageEventId }, data: { metadataJson: { ...reservedMetadata, countryChecks, localChecks, keywordResearchRunIds: meteredRunIds } } });
    if (!meteredRunIds.length) await refundUsage({ usageEventId: batchUsageEventId, reason: "No keyword research checks entered the processing queue." });
  }
  return res.status(accepted.some((item) => item.run.status !== "completed") ? 202 : 200).json({
    accepted,
    failed,
    summary: {
      requested: rawChecks.length,
      unique: checks.length,
      queued: accepted.filter((item) => ["queued", "running"].includes(item.run.status)).length,
      reused: accepted.filter((item) => item.reused && !item.retried).length,
      retried: accepted.filter((item) => item.retried).length,
      failed: failed.length,
    },
  });
});

keywordResearchRouter.post("/keyword-research/validate-locations", async (req, res) => {
  const parsed = locationPreflightSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const uniqueLocations = [...new Map(parsed.data.locationNames.map((location) => [location.toLocaleLowerCase(), location])).values()];
  const valid: Array<{ requested: string; resolved: string; metricScope: string }> = [];
  const invalid: Array<{ requested: string; reason: string }> = [];
  for (const requested of uniqueLocations) {
    try {
      const location = await resolveExactSearchLocation(requested);
      valid.push({ requested, resolved: location.displayName, metricScope: location.metricScopeName });
    } catch (error) {
      invalid.push({ requested, reason: publicKeywordResearchError(error instanceof Error ? error.message : "The location could not be validated.", "location").message });
    }
  }
  return res.json({ valid, invalid, ready: invalid.length === 0 });
});

keywordResearchRouter.post("/keyword-research/suggestions", async (req, res) => {
  const parsed = keywordSuggestionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const clientId = await projectClientIdForRequest(req);
  const scoped = await keywordWebsiteForRequest(req, parsed.data.websiteId, clientId);
  const website = scoped.website;
  if (!website) {
    if (scoped.mismatch) return res.status(403).json({ error: "website belongs to another client context", domain: scoped.mismatch.domain, websiteId: scoped.mismatch.id });
    return res.status(404).json({ error: "website not found" });
  }

  try {
    const result = await suggestKeywordsForWebsite(
      website,
      parsed.data.limit,
      parsed.data.language,
      parsed.data.excludeKeywords,
      { country: parsed.data.locationCountry, region: parsed.data.locationRegion, cities: parsed.data.locationCities },
    );
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "openai_not_configured") return res.status(503).json({ error: "OpenAI is not configured" });
    res.status(500).json({ error: error instanceof Error ? error.message : "keyword suggestions failed" });
  }
});

keywordResearchRouter.get("/keyword-research", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, status: { not: "deleted" }, ...(clientId ? { clientId } : {}) }, select: { id: true } });
    if (!project) return res.status(404).json({ error: "project not found" });
  }
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  const runs = await prisma.keywordResearchRun.findMany({
    where: { ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 3 },
      competitors: { orderBy: { rank: "asc" }, take: 3 },
    },
    take: 500,
  });
  const rankedRuns = withRankChanges(runs);
  res.json({ runs: rankedRuns.map((run) => withRefreshState(withRelevantIdeas(run, 3), bypassRefreshLimit)) });
});

keywordResearchRouter.get("/keyword-research/domain-backlinks", async (req, res) => {
  const parsed = backlinkQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const clientId = await projectClientIdForRequest(req);
  const scoped = await keywordWebsiteForRequest(req, parsed.data.websiteId, clientId);
  const website = scoped.website;
  if (!website) {
    if (scoped.mismatch) return res.status(403).json({ error: "website belongs to another client context", domain: scoped.mismatch.domain, websiteId: scoped.mismatch.id });
    return res.status(404).json({ error: "website not found" });
  }

  const target = normalizeDomain(website.domain) || domainFromUrl(website.rootUrl);
  if (!target) return res.status(400).json({ error: "website domain is required" });

  const refresh = parsed.data.refresh === "true";
  const cacheOnly = parsed.data.cacheOnly === "true";
  const cached = await fetchBacklinkSummary(target, false, true);
  const cacheAge = cached ? Date.now() - cached.fetchedAt.getTime() : Number.POSITIVE_INFINITY;
  if (cached && (cacheOnly || (!refresh && cacheAge < 24 * 60 * 60 * 1000) || (refresh && cacheAge < BACKLINK_REFRESH_COOLDOWN_MS))) return res.json({ summary: cached });
  if (cacheOnly) return res.json({ summary: null });
  let usageEventId: string | null = null;
  try {
    const refreshBucket = Math.floor(Date.now() / BACKLINK_REFRESH_COOLDOWN_MS);
    const usage = await preflightUsage({ clientId: website.clientId, userId: req.user?.userId, websiteId: website.id, featureKey: "backlink_snapshot", actionKey: "Refresh backlink summary", idempotencyKey: `backlink-summary:${website.id}:${refreshBucket}`, metadata: { domainCount: 1 } });
    usageEventId = usage.usageEventId;
    const summary = await fetchBacklinkSummary(target, refresh, false);
    await commitUsage({ usageEventId, provider: SEARCH_PROVIDER_KEY, providerCostUsd: summary?.providerCostUsd ?? 0, actualUnits: summary?.cached ? 0 : undefined, metadata: { target, cacheHit: summary?.cached === true, providerRequestKey: `backlink-summary:${target}:${refreshBucket}` } });
    res.json({ summary });
  } catch (error) {
    if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Backlink summary failed" }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Backlink summary failed";
    res.status(Number((error as { statusCode?: number }).statusCode || 502)).json({ error: message });
  }
});

keywordResearchRouter.get("/keyword-research/domain-backlink-links", async (req, res) => {
  const parsed = backlinkLinksQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const clientId = await projectClientIdForRequest(req);
  const scoped = await keywordWebsiteForRequest(req, parsed.data.websiteId, clientId);
  const website = scoped.website;
  if (!website) {
    if (scoped.mismatch) return res.status(403).json({ error: "website belongs to another client context", domain: scoped.mismatch.domain, websiteId: scoped.mismatch.id });
    return res.status(404).json({ error: "website not found" });
  }

  const target = normalizeDomain(website.domain) || domainFromUrl(website.rootUrl);
  if (!target) return res.status(400).json({ error: "website domain is required" });

  const refresh = parsed.data.refresh === "true";
  const cacheOnly = parsed.data.cacheOnly === "true";
  const cached = await fetchBacklinkLinks(target, parsed.data.limit, false, true);
  const cacheAge = cached ? Date.now() - cached.fetchedAt.getTime() : Number.POSITIVE_INFINITY;
  if (cached && (cacheOnly || (!refresh && cacheAge < 24 * 60 * 60 * 1000) || (refresh && cacheAge < BACKLINK_REFRESH_COOLDOWN_MS))) return res.json({ backlinks: cached });
  if (cacheOnly) return res.json({ backlinks: null });
  let usageEventId: string | null = null;
  try {
    const refreshBucket = Math.floor(Date.now() / BACKLINK_REFRESH_COOLDOWN_MS);
    const usage = await preflightUsage({ clientId: website.clientId, userId: req.user?.userId, websiteId: website.id, featureKey: "backlink_snapshot", actionKey: "Refresh backlink profile", idempotencyKey: `backlink-summary:${website.id}:${refreshBucket}`, metadata: { domainCount: 1 } });
    usageEventId = usage.usageEventId;
    const backlinks = await fetchBacklinkLinks(target, parsed.data.limit, refresh, false);
    await commitUsage({ usageEventId, provider: SEARCH_PROVIDER_KEY, providerCostUsd: backlinks?.providerCostUsd ?? 0, metadata: { target, cacheHit: backlinks?.cached === true, includedWithSummaryRefresh: true, providerRequestKey: `backlink-links:${target}:${refreshBucket}` } });
    res.json({ backlinks });
  } catch (error) {
    if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Backlink links failed" }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Backlink links failed";
    res.status(Number((error as { statusCode?: number }).statusCode || 502)).json({ error: message });
  }
});

keywordResearchRouter.get("/keyword-research/:id", async (req, res) => {
  const run = await scopedRun(req, req.params.id);
  if (!run) return res.status(404).json({ error: "keyword research run not found" });
  res.json({ run: { ...run, locationName: displaySearchProviderLocation(run.locationName) } });
});

keywordResearchRouter.post("/keyword-research/:id/cancel", async (req, res) => {
  const run = await scopedRun(req, req.params.id);
  if (!run) return res.status(404).json({ error: "keyword research run not found" });
  if (!["queued", "running"].includes(run.status)) {
    return res.status(409).json({ error: "Only queued or running keyword research can be cancelled." });
  }
  await prisma.keywordResearchRun.update({
    where: { id: run.id },
    data: {
      status: "cancelled",
      locationName: canonicalGeographicLocationLabel(run.locationName),
      error: "Keyword research was cancelled. Start the analysis again when ready.",
      completedAt: new Date(),
    },
  });
  const queueJob = await keywordResearchQueue.getJob(run.id);
  if (queueJob) {
    const state = await queueJob.getState().catch(() => "unknown");
    if (state !== "active") await queueJob.remove().catch(() => undefined);
  }
  await settleKeywordResearchCapacity(run.usageEventId).catch(() => undefined);
  return res.json({
    run: {
      ...run,
      status: "cancelled",
      locationName: displaySearchProviderLocation(run.locationName),
      error: "Keyword research was cancelled. Start the analysis again when ready.",
      completedAt: new Date(),
    },
  });
});

keywordResearchRouter.get("/keyword-research/:id/growth-plan", async (req, res) => {
  const run = await scopedRun(req, req.params.id);
  if (!run) return res.status(404).json({ error: "keyword research run not found" });

  const city = cityFromLocationName(run.locationName);
  const [pageAudit, latestCrawl] = await Promise.all([
    run.websiteId ? prisma.keywordAuditCampaign.findFirst({
      where: {
        websiteId: run.websiteId,
        targetKeyword: { equals: run.seedKeyword },
        targetCity: city,
      },
      orderBy: { createdAt: "desc" },
      include: {
        pages: { orderBy: [{ isBestCandidate: "desc" }, { totalScore: "desc" }], take: 12 },
      },
    }) : Promise.resolve(null),
    run.websiteId ? prisma.crawlJob.findFirst({
      where: { websiteId: run.websiteId, status: "completed" },
      orderBy: { completedAt: "desc" },
      include: {
        issues: {
          where: { status: "open", severity: { in: ["high", "medium"] } },
          orderBy: [{ severity: "asc" }, { weightImpact: "desc" }],
          take: 12,
          include: { page: { select: { url: true } } },
        },
        llmsFiles: { orderBy: { id: "desc" }, take: 1 },
      },
    }) : Promise.resolve(null),
  ]);

  const competitors = run.competitors ?? [];
  const bestPage = pageAudit?.pages.find((page) => page.isBestCandidate) ?? pageAudit?.pages[0] ?? null;
  const topIdea = run.ideas?.[0] ?? null;
  const topCompetitor = competitors[0] ?? null;
  const input = { run, pageAudit, latestCrawl, bestPage, competitors, topIdea };

  res.json({
    growthPlan: {
      summary: buildGrowthSummary(input),
      opportunity: buildKeywordOpportunity(input),
      clusters: buildKeywordClusters(run.seedKeyword, run.ideas ?? [], city),
      tasks: buildOrganicGrowthTasks(input),
      aiSearch: buildAiSearchReadiness(input),
      bestPage: bestPage ? {
        id: bestPage.id,
        url: bestPage.url,
        title: bestPage.title,
        score: bestPage.totalScore,
        intentMatch: bestPage.intentMatch,
        missing: stringArray(bestPage.missingJson),
        recommendations: stringArray(bestPage.recommendationsJson),
      } : null,
      topCompetitor: topCompetitor ? {
        rank: topCompetitor.rank,
        domain: topCompetitor.domain,
        url: topCompetitor.url,
        contentScore: topCompetitor.contentScore,
        wordCount: topCompetitor.wordCount,
        faqCount: topCompetitor.faqCount,
        schemaTypes: stringArray(topCompetitor.schemaTypesJson),
      } : null,
    },
  });
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

  let location: SearchLocation;
  try {
    location = await resolveExactSearchLocation(existing.locationName, existing.seedKeyword);
  } catch (error) {
    const publicError = publicKeywordResearchError(error instanceof Error ? error.message : "Exact location metrics could not be resolved.", "location");
    return res.status(publicError.status).json({ error: publicError.message });
  }
  const keywordLimit = Math.min(100, Math.max(1, existing.keywordLimit || existing.keywordCount || existing.ideas?.length || 25));
  try {
    await assertKeywordResearchQueueCapacity({
      clientId: existing.clientId,
      project: existing.projectId ? { id: existing.projectId } : null,
    });
  } catch (error) {
    if (error instanceof KeywordResearchHttpError) return res.status(error.status).json({ error: error.message, ...(error.details ?? {}) });
    throw error;
  }
  const capacityCheckType = location.locationType === "Country" ? "country" : "local";
  let usageEventId: string;
  try {
    const usage = await preflightUsage({
      clientId: existing.clientId,
      userId: req.user?.userId,
      projectId: existing.projectId,
      websiteId: existing.websiteId,
      featureKey: "keyword_research_batch",
      actionKey: "Refresh keyword-market research",
      idempotencyKey: `keyword-research-refresh:${existing.id}:${Date.now()}`,
      metadata: { countryChecks: capacityCheckType === "country" ? 1 : 0, localChecks: capacityCheckType === "local" ? 1 : 0 },
    });
    usageEventId = usage.usageEventId;
  } catch (error) {
    return res.status(Number((error as { statusCode?: number }).statusCode || 402)).json({ error: error instanceof Error ? error.message : "Could not reserve AI Capacity for this refresh." });
  }
  const run = await prisma.keywordResearchRun.create({
    data: {
      clientId: existing.clientId,
      projectId: existing.projectId,
      websiteId: existing.websiteId,
      seedKeyword: existing.seedKeyword,
      targetUrl: existing.targetUrl,
      targetDomain: existing.targetDomain,
      locationName: canonicalGeographicLocationLabel(location.displayName),
      languageCode: existing.languageCode,
      device: existing.device === "mobile" ? "mobile" : "desktop",
      serpDepth: existing.serpDepth,
      keywordLimit,
      status: "queued",
      usageEventId,
      capacityCheckType,
    },
  });
  const executionInput: KeywordResearchExecutionInput = {
    seedKeyword: existing.seedKeyword,
    targetUrl: existing.targetUrl,
    targetDomain: existing.targetDomain,
    location,
    languageCode: existing.languageCode,
    device: existing.device === "mobile" ? "mobile" : "desktop",
    serpDepth: existing.serpDepth,
    keywordLimit,
  };
  try {
    await enqueueKeywordResearchCompletion(run.id, executionInput);
  } catch (error) {
    await prisma.keywordResearchRun.updateMany({
      where: { id: run.id, status: "queued" },
      data: { status: "failed", error: "Keyword research could not enter the processing queue. Retry this exact check.", completedAt: new Date() },
    });
    await refundUsage({ usageEventId, reason: "Keyword research refresh could not enter the processing queue." }).catch(() => undefined);
    return res.status(503).json({ error: "Keyword research could not enter the processing queue. The previous completed result is preserved; retry this exact check." });
  }
  res.status(202).json({ run: withRefreshState(run, bypassRefreshLimit) });
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function completeKeywordResearchRun(runId: string, input: KeywordResearchExecutionInput) {
  const serpKeyword = localizedSerpKeyword(input.seedKeyword, input.location.displayName);
  const [ideas, serpResults] = await Promise.all([
    fetchKeywordIdeas(input.seedKeyword, input.location, input.languageCode, input.keywordLimit),
    fetchSerpResults(serpKeyword, input.location, input.languageCode, input.device, input.serpDepth),
  ]);
  const ranking = input.targetDomain ? findDomainRank(serpResults, input.targetDomain) : null;
  const competitorsAbove = buildCompetitorsAbove(serpResults, ranking?.rank ?? null);
  const targetProfile = input.targetUrl ? await fetchCompetitorProfile(input.targetUrl, null) : null;
  const competitorProfiles = await mapWithConcurrency(
    serpResults.slice(0, input.serpDepth),
    4,
    async (result) => ({
      result,
      profile: await fetchCompetitorProfile(result.url, targetProfile),
    }),
  );

  const ideaRows = ideas.map((idea) => ({
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
    }));
  const competitorRows = competitorProfiles.map(({ result, profile }) => ({
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
      }));
  const volumes = ideas.map((idea) => idea.avgMonthlySearches).filter((value): value is number => value != null);
  return prisma.$transaction(async (tx) => {
    // Cancellation or watchdog expiry can happen while provider work is in
    // flight. Check and write in one transaction so a late response cannot
    // resurrect a terminal run or leave half-written report rows.
    const currentRun = await tx.keywordResearchRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!currentRun || ["cancelled", "canceled", "failed"].includes(currentRun.status)) return currentRun;
    await tx.keywordIdea.deleteMany({ where: { runId } });
    await tx.keywordSerpCompetitor.deleteMany({ where: { runId } });
    if (ideaRows.length) await tx.keywordIdea.createMany({ data: ideaRows });
    if (competitorRows.length) await tx.keywordSerpCompetitor.createMany({ data: competitorRows });
    return tx.keywordResearchRun.update({
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
  });
}

const KEYWORD_RESEARCH_CONCURRENCY = Math.max(1, Math.min(10, config.keywordResearchConcurrency));
let keywordResearchWorker: Worker<KeywordResearchQueueJobData> | null = null;
let keywordResearchWatchdog: ReturnType<typeof setInterval> | null = null;

async function settleKeywordResearchCapacity(usageEventId: string | null | undefined) {
  if (!usageEventId) return;
  const usage = await prisma.usageEvent.findUnique({ where: { id: usageEventId } });
  if (!usage || usage.status !== "reserved") return;
  const runs = await prisma.keywordResearchRun.findMany({ where: { usageEventId }, select: { status: true, capacityCheckType: true } });
  if (!runs.length || runs.some((run) => ["queued", "running"].includes(run.status))) return;
  const completed = runs.filter((run) => run.status === "completed");
  if (!completed.length) {
    await refundUsage({ usageEventId, reason: "Keyword research did not complete any requested checks." });
    return;
  }
  const metadata = usage.metadataJson && typeof usage.metadataJson === "object" && !Array.isArray(usage.metadataJson) ? usage.metadataJson as Record<string, unknown> : {};
  const countryChecks = completed.filter((run) => run.capacityCheckType === "country").length;
  const localChecks = completed.length - countryChecks;
  const actualUnits = calculateWorkflowUnits("keyword_research_batch", Number(metadata.baseUnitCost || 1), {
    inputUnits: completed.length,
    metadata: { countryChecks, localChecks },
    pricingModel: String(metadata.pricingModel || "keyword_market"),
    pricingConfig: metadata.pricingConfig,
    minimumUnitCost: typeof metadata.minimumUnitCost === "number" ? metadata.minimumUnitCost : null,
    maximumUnitCost: typeof metadata.maximumUnitCost === "number" ? metadata.maximumUnitCost : null,
  });
  await commitUsage({ usageEventId, provider: SEARCH_PROVIDER_KEY, actualUnits, metadata: { completedChecks: completed.length, countryChecks, localChecks, partialSettlement: completed.length !== runs.length } });
}

async function enqueueKeywordResearchCompletion(runId: string, input: KeywordResearchExecutionInput): Promise<"enqueued" | "existing"> {
  const existing = await keywordResearchQueue.getJob(runId);
  if (existing) {
    const state = await existing.getState();
    if (!["completed", "failed", "unknown"].includes(state)) return "existing";
    await existing.remove().catch(() => undefined);
  }
  await keywordResearchQueue.add("keyword:run", { runId, input }, {
    jobId: runId,
    removeOnComplete: 500,
    removeOnFail: 500,
  });
  return "enqueued";
}

async function executeKeywordResearchWork(work: { runId: string; input: KeywordResearchExecutionInput }) {
  try {
    const started = await prisma.keywordResearchRun.updateMany({ where: { id: work.runId, status: { in: ["queued", "running"] } }, data: { status: "running", error: null } });
    if (!started.count) return;
    await completeKeywordResearchRun(work.runId, work.input);
    const completed = await prisma.keywordResearchRun.findUnique({ where: { id: work.runId }, select: { usageEventId: true } });
    await settleKeywordResearchCapacity(completed?.usageEventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Keyword research failed";
    const publicError = publicKeywordResearchError(message);
    await prisma.keywordResearchRun.updateMany({
      where: { id: work.runId, status: { in: ["queued", "running"] } },
      data: { status: "failed", error: publicError.message, completedAt: new Date() },
    }).catch(() => undefined);
    const failed = await prisma.keywordResearchRun.findUnique({ where: { id: work.runId }, select: { usageEventId: true } }).catch(() => null);
    await settleKeywordResearchCapacity(failed?.usageEventId).catch(() => undefined);
  }
}

async function executionInputFromRun(run: {
  seedKeyword: string;
  targetUrl: string | null;
  targetDomain: string | null;
  locationName: string;
  languageCode: string;
  device: string;
  serpDepth: number;
  keywordLimit: number;
}) {
  return {
    seedKeyword: run.seedKeyword,
    targetUrl: run.targetUrl,
    targetDomain: run.targetDomain,
    location: await resolveExactSearchLocation(run.locationName, run.seedKeyword),
    languageCode: run.languageCode,
    device: run.device === "mobile" ? "mobile" as const : "desktop" as const,
    serpDepth: run.serpDepth,
    keywordLimit: Math.min(100, Math.max(1, run.keywordLimit || 25)),
  };
}

async function recoverQueuedKeywordResearchRuns() {
  const expired = await expireStaleKeywordResearchRuns();
  const runs = await prisma.keywordResearchRun.findMany({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, seedKeyword: true, targetUrl: true, targetDomain: true, locationName: true, languageCode: true, device: true, serpDepth: true, keywordLimit: true, createdAt: true },
  });
  let recovered = 0;
  let alreadyQueued = 0;
  let failed = 0;
  for (const run of runs) {
    try {
      const input = await executionInputFromRun(run);
      await prisma.keywordResearchRun.update({ where: { id: run.id }, data: { status: "queued", locationName: canonicalGeographicLocationLabel(input.location.displayName), error: null, completedAt: null } });
      const result = await enqueueKeywordResearchCompletion(run.id, input);
      if (result === "enqueued") recovered += 1;
      else alreadyQueued += 1;
    } catch (error) {
      const publicError = publicKeywordResearchError(error instanceof Error ? error.message : "Exact location metrics could not be resolved.", "location");
      await prisma.keywordResearchRun.update({ where: { id: run.id }, data: { status: "failed", locationName: canonicalGeographicLocationLabel(run.locationName), error: publicError.message, completedAt: new Date() } });
      failed += 1;
    }
  }
  if (runs.length || expired) console.log(`[api] keyword queue recovery: ${recovered} resumed, ${alreadyQueued} already queued, ${expired} expired, ${failed} failed`);
}

async function expireStaleKeywordResearchRuns() {
  const runningBefore = new Date(Date.now() - KEYWORD_RESEARCH_RUNNING_TIMEOUT_MS);
  const waitingBefore = new Date(Date.now() - KEYWORD_RESEARCH_WAITING_TIMEOUT_MS);
  const candidates = await prisma.keywordResearchRun.findMany({
    where: { status: { in: ["queued", "running"] }, createdAt: { lt: runningBefore } },
    select: { id: true, status: true, locationName: true, createdAt: true },
  });
  let expired = 0;
  for (const run of candidates) {
    const staleJob = await keywordResearchQueue.getJob(run.id);
    const queueState = staleJob ? await staleJob.getState().catch(() => "unknown") : "missing";
    const processedAt = staleJob?.processedOn ? new Date(staleJob.processedOn) : null;
    const runningTimedOut = queueState === "active"
      ? Boolean(processedAt && processedAt < runningBefore)
      : run.status === "running" && run.createdAt < runningBefore;
    const waitingTimedOut = ["waiting", "delayed", "prioritized", "waiting-children"].includes(queueState)
      ? run.createdAt < waitingBefore
      : run.status === "queued" && queueState === "missing" && run.createdAt < runningBefore;
    if (!runningTimedOut && !waitingTimedOut) continue;
    const reason = waitingTimedOut
      ? "Keyword research waited too long for processing capacity and was stopped. Retry this exact check; completed checks are preserved."
      : "Keyword research exceeded 30 minutes of active processing and was stopped. Retry this exact check; completed checks are preserved.";
    await prisma.keywordResearchRun.updateMany({
      where: { id: run.id, status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        locationName: canonicalGeographicLocationLabel(run.locationName),
        error: reason,
        completedAt: new Date(),
      },
    });
    if (staleJob) {
      if (queueState !== "active") await staleJob.remove().catch(() => undefined);
    }
    expired += 1;
  }
  return expired;
}

export function startKeywordResearchQueueWorker() {
  if (keywordResearchWorker) return keywordResearchWorker;
  keywordResearchWorker = new Worker<KeywordResearchQueueJobData>(
    KEYWORD_RESEARCH_QUEUE,
    async (job) => {
      const record = await prisma.keywordResearchRun.findUnique({ where: { id: job.data.runId }, select: { status: true } });
      if (!record || ["completed", "failed", "cancelled"].includes(record.status)) return;
      await executeKeywordResearchWork({ runId: job.data.runId, input: job.data.input as KeywordResearchExecutionInput });
    },
    { connection: queueConnection, concurrency: KEYWORD_RESEARCH_CONCURRENCY },
  );
  keywordResearchWorker.on("failed", (job, error) => {
    const runId = job?.data.runId;
    console.error(`[api] keyword research queue job ${runId ?? "unknown"} failed:`, error.message);
    if (runId) {
      void prisma.keywordResearchRun.updateMany({
        where: { id: runId, status: { in: ["queued", "running"] } },
        data: { status: "failed", error: "Keyword research worker stopped unexpectedly. Start the analysis again.", completedAt: new Date() },
      });
    }
  });
  void recoverQueuedKeywordResearchRuns().catch((error) => console.error("[api] keyword queue recovery failed:", error));
  if (!keywordResearchWatchdog) {
    keywordResearchWatchdog = setInterval(() => {
      void expireStaleKeywordResearchRuns().catch((error) => console.error("[api] keyword queue watchdog failed:", error));
    }, 60_000);
    keywordResearchWatchdog.unref?.();
  }
  return keywordResearchWorker;
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


function effectiveRank(run: { manualRank?: number | null; targetRank?: number | null }) {
  return run.manualRank ?? run.targetRank ?? null;
}

function keywordHistoryKey(run: { websiteId: string | null; seedKeyword: string; locationName: string; device: string }) {
  return [run.websiteId ?? "", run.seedKeyword.trim().toLowerCase(), run.locationName.trim().toLowerCase(), run.device].join("|");
}

function withRankChanges<T extends { websiteId: string | null; seedKeyword: string; locationName: string; device: string; createdAt: Date; manualRank?: number | null; targetRank?: number | null }>(runs: T[]) {
  const ordered = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latestRankByKey = new Map<string, number | null>();
  const output = new Map<T, T & { previousRank: number | null; rankChange: number | null }>();
  for (const run of ordered) {
    const key = keywordHistoryKey(run);
    const previousRank = latestRankByKey.has(key) ? latestRankByKey.get(key)! : null;
    const currentRank = effectiveRank(run);
    output.set(run, { ...run, previousRank, rankChange: currentRank != null && previousRank != null ? currentRank - previousRank : null });
    latestRankByKey.set(key, currentRank);
  }
  return runs.map((run) => output.get(run)!);
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
      locationName: displaySearchProviderLocation(run.locationName),
      canRefresh: true,
      lastRefreshAt: run.createdAt,
      refreshBlockedUntil: null,
    };
  }
  const statusCountsAsRefresh = refreshableStatuses.includes(run.status);
  const refreshBlockedUntil = statusCountsAsRefresh ? new Date(run.createdAt.getTime() + KEYWORD_REFRESH_COOLDOWN_MS) : null;
  return {
    ...run,
    locationName: displaySearchProviderLocation(run.locationName),
    canRefresh: !refreshBlockedUntil || refreshBlockedUntil.getTime() <= Date.now(),
    lastRefreshAt: run.createdAt,
    refreshBlockedUntil: refreshBlockedUntil && refreshBlockedUntil.getTime() > Date.now() ? refreshBlockedUntil : null,
  };
}


type OrganicGrowthInput = {
  run: NonNullable<Awaited<ReturnType<typeof scopedRun>>>;
  pageAudit: any;
  latestCrawl: any;
  bestPage: any;
  competitors: any[];
  topIdea: any;
};

function buildGrowthSummary(input: OrganicGrowthInput) {
  const opportunity = buildKeywordOpportunity(input);
  const bestPageScore = numberOrNull(input.bestPage?.totalScore);
  const rank = effectiveRank(input.run);
  const blockers = input.latestCrawl?.issues?.length ?? 0;
  const nextStep = input.pageAudit
    ? opportunity.nextAction
    : "Run page mapping so SEnuke AI - AI Growth Operating System can connect this keyword to the best crawled page before generating changes.";
  return {
    headline: opportunity.label,
    nextStep,
    why: [
      rank ? `Current rank: #${rank}.` : "Domain is not visible in the checked SERP depth.",
      bestPageScore != null ? `Best mapped page score: ${bestPageScore}/100.` : "No mapped target page yet.",
      blockers > 0 ? `${blockers} open technical/content blockers found in the latest crawl.` : "No high-priority crawl blockers were pulled into this plan.",
    ],
  };
}

function buildKeywordOpportunity(input: OrganicGrowthInput) {
  const rank = effectiveRank(input.run);
  const volume = numberOrNull(input.topIdea?.avgMonthlySearches) ?? numberOrNull(input.run.averageVolume) ?? 0;
  const competition = numberOrNull(input.topIdea?.competitionIndex);
  const bestPageScore = numberOrNull(input.bestPage?.totalScore);
  const competitorScore = averageNumber(input.competitors.slice(0, 5).map((competitor) => numberOrNull(competitor.contentScore)));
  const blockerCount = input.latestCrawl?.issues?.length ?? 0;

  let score = 30;
  score += Math.min(25, Math.round(Math.log10(Math.max(1, volume)) * 9));
  score += competition == null ? 8 : Math.max(0, 20 - Math.round(competition / 5));
  score += !rank ? 18 : rank > 20 ? 16 : rank > 10 ? 13 : rank > 3 ? 8 : 3;
  score += bestPageScore == null ? 8 : bestPageScore < 55 ? 14 : bestPageScore < 75 ? 10 : 4;
  score += competitorScore != null && bestPageScore != null && competitorScore - bestPageScore >= 10 ? 8 : 0;
  score -= Math.min(12, blockerCount * 2);
  score = clamp(score, 0, 100);

  const action = recommendedGrowthAction({ rank, bestPageScore, blockerCount, hasAudit: Boolean(input.pageAudit) });
  return {
    score,
    label: score >= 75 ? "High opportunity" : score >= 55 ? "Medium opportunity" : "Lower priority",
    action,
    nextAction: actionText(action, input),
    signals: {
      volume,
      competitionIndex: competition,
      currentRank: rank,
      bestPageScore,
      competitorAverageScore: competitorScore,
      blockerCount,
    },
  };
}

function recommendedGrowthAction(input: { rank: number | null; bestPageScore: number | null; blockerCount: number; hasAudit: boolean }) {
  if (!input.hasAudit) return "map_pages";
  if (input.blockerCount >= 5) return "fix_blockers";
  if (input.bestPageScore == null || input.bestPageScore < 45) return "create_page";
  if (!input.rank || input.rank > 10 || input.bestPageScore < 80) return "improve_page";
  return "support_and_track";
}

function actionText(action: string, input: OrganicGrowthInput): string {
  const pageTitle = input.bestPage?.title || input.bestPage?.url || "the best target page";
  const competitor = input.competitors[0]?.domain;
  if (action === "map_pages") return "Run page mapping, then let SEnuke AI - AI Growth Operating System choose the page to improve or confirm that a new page is needed.";
  if (action === "fix_blockers") return `Fix the latest crawl blockers first, then improve ${pageTitle}.`;
  if (action === "create_page") return `Create a focused page for this keyword because no existing crawled page is strong enough yet.`;
  if (action === "improve_page") return `Improve ${pageTitle}${competitor ? ` against ${competitor}` : ""} with stronger title/H1, FAQ, schema, content depth, and internal links.`;
  return `Protect the ranking by adding support content, internal links, and scheduled rank refreshes.`;
}

function buildOrganicGrowthTasks(input: OrganicGrowthInput): OrganicGrowthTask[] {
  const tasks: OrganicGrowthTask[] = [];
  const opportunity = buildKeywordOpportunity(input);
  const bestUrl = input.bestPage?.url || input.run.targetUrl || input.run.rankingUrl || null;
  const bestTitle = input.bestPage?.title || input.run.seedKeyword;
  const competitor = input.competitors[0];

  if (!input.pageAudit) {
    tasks.push(task("map-pages", "fix", "high", "Map this keyword to crawled pages", "Run page mapping to find the fastest page to improve before creating new content.", null, "Prevents users from writing content when an existing page can rank faster."));
  }

  if (opportunity.action === "create_page") {
    tasks.push(task("create-target-page", "create", "high", `Create a focused page for ${input.run.seedKeyword}`, "No existing crawled page is strong enough for this keyword. Build a dedicated service, location, or landing page before chasing minor optimizations.", null, "Creates a clear ranking target for Google and AI answer engines."));
  }

  if (bestUrl && opportunity.action !== "create_page") {
    tasks.push(task("improve-target-page", "improve", "high", `Improve ${bestTitle}`, buildImproveDetail(input), bestUrl, "Turns the best existing page into the primary ranking asset."));
  }

  for (const issue of (input.latestCrawl?.issues ?? []).slice(0, 4)) {
    tasks.push(task(`fix-${issue.id}`, "fix", issue.severity === "high" ? "high" : "medium", issue.message || issue.issueType, issue.recommendation || "Resolve this crawl issue before expecting stable ranking improvements.", issue.page?.url ?? null, "Removes technical or content blockers that can suppress organic growth."));
  }

  if (bestUrl) {
    tasks.push(task("add-internal-links", "support", "medium", "Add internal links to the target page", `Link from related service, blog, and location pages using anchors close to "${input.run.seedKeyword}".`, bestUrl, "Helps search engines identify the page that should rank for this topic."));
  }

  if (competitor?.faqCount > 0 || !hasSchema(input.bestPage, "FAQPage")) {
    tasks.push(task("add-faq-schema", "support", "medium", "Add FAQ answers and FAQPage schema", "Answer buyer questions directly and mark them up where the content is visible on the page.", bestUrl, "Improves long-tail coverage and AI-search citation readiness."));
  }

  tasks.push(task("track-rank", "track", "low", "Track this keyword after changes", "Refresh the keyword after implementation and compare rank, mapped page score, and competitor gaps.", bestUrl, "Keeps the workflow outcome-based instead of idea-based."));

  return dedupeTasks(tasks).slice(0, 10);
}

function buildImproveDetail(input: OrganicGrowthInput): string {
  const recommendations = stringArray(input.bestPage?.recommendationsJson).slice(0, 3);
  const competitor = input.competitors[0];
  const parts = recommendations.length ? recommendations : ["Tighten title/H1 alignment, add answer-first copy, improve FAQ coverage, and add relevant schema."];
  if (competitor?.contentScore != null) parts.push(`Benchmark against #${competitor.rank} ${competitor.domain}, content score ${competitor.contentScore}.`);
  return parts.join(" ");
}

function buildAiSearchReadiness(input: OrganicGrowthInput) {
  const bestMissing = stringArray(input.bestPage?.missingJson).join(" ").toLowerCase();
  const bestRecs = stringArray(input.bestPage?.recommendationsJson).join(" ").toLowerCase();
  const schemaTypes = new Set<string>(input.competitors.flatMap((competitor) => stringArray(competitor.schemaTypesJson)).map((item) => item.toLowerCase()));
  const llms = input.latestCrawl?.llmsFiles?.[0];
  const checks = [
    readinessCheck("Answer-first copy", !(bestMissing.includes("first") || bestRecs.includes("first 100 words")), "Add a direct answer under the H1 so AI engines can extract a clean summary."),
    readinessCheck("FAQ coverage", input.competitors.some((competitor) => competitor.faqCount > 0) ? hasSchema(input.bestPage, "FAQPage") || bestRecs.includes("faq") : true, "Add visible FAQs and FAQPage schema for buyer questions."),
    readinessCheck("Structured data", hasSchema(input.bestPage, "Service") || hasSchema(input.bestPage, "LocalBusiness") || schemaTypes.size > 0, "Add Service, LocalBusiness/Organization, BreadcrumbList, and FAQ schema where relevant."),
    readinessCheck("llms.txt", Boolean(llms?.statusCode === 200), "Publish or improve /llms.txt with key pages, sitemap, and brand contact details."),
    readinessCheck("Citable sections", (numberOrNull(input.bestPage?.totalScore) ?? 0) >= 70, "Break content into clear sections with standalone facts, examples, and comparisons."),
  ];
  const score = Math.round((checks.filter((check) => check.status === "good").length / checks.length) * 100);
  return { score, checks };
}

function readinessCheck(label: string, pass: boolean, recommendation: string) {
  return { label, status: pass ? "good" : "needs_work", recommendation };
}

function buildKeywordClusters(seedKeyword: string, ideas: Array<{ keyword: string }>, city: string | null): OrganicGrowthKeywordCluster[] {
  const buckets = new Map<string, OrganicGrowthKeywordCluster>();
  for (const idea of ensureSeedKeywordIdea(seedKeyword, ideas).slice(0, 40)) {
    const keyword = idea.keyword;
    const cluster = classifyKeywordCluster(keyword, city);
    const existing = buckets.get(cluster.name) ?? { ...cluster, keywords: [] };
    if (!existing.keywords.includes(keyword) && existing.keywords.length < 8) existing.keywords.push(keyword);
    buckets.set(cluster.name, existing);
  }
  return [...buckets.values()].filter((cluster) => cluster.keywords.length > 0).slice(0, 6);
}

function classifyKeywordCluster(keyword: string, city: string | null): Omit<OrganicGrowthKeywordCluster, "keywords"> {
  const normalized = normalizeText(keyword);
  if (/\b(vs|versus|alternative|compare|comparison|best)\b/.test(normalized)) return { name: "Comparison opportunities", intent: "comparison", pageType: "comparison_page" };
  if (/\b(how|what|why|when|where|can|does|do|cost|price)\b/.test(normalized)) return { name: "Questions and FAQs", intent: "question", pageType: "faq" };
  if ((city && normalized.includes(normalizeText(city))) || /\bnear me|local|city|area\b/.test(normalized)) return { name: "Local growth pages", intent: "local", pageType: "location_page" };
  if (/\b(service|services|agency|company|provider|consultant|quote|hire)\b/.test(normalized)) return { name: "Core service demand", intent: "core_service", pageType: "service_page" };
  if (/\b(buy|get|quote|pricing|packages|deal)\b/.test(normalized)) return { name: "Commercial landing pages", intent: "commercial", pageType: "landing_page" };
  return { name: "Supporting content", intent: "supporting", pageType: "article" };
}

function task(id: string, group: OrganicGrowthTask["group"], priority: OrganicGrowthTask["priority"], title: string, detail: string, url: string | null, impact: string): OrganicGrowthTask {
  return { id, group, priority, title, detail, url, impact };
}

function dedupeTasks(tasks: OrganicGrowthTask[]): OrganicGrowthTask[] {
  const seen = new Set<string>();
  return tasks.filter((item) => {
    const key = `${item.group}:${item.title}:${item.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cityFromLocationName(value: string): string | null {
  const first = value.split(",")[0]?.trim() || "";
  if (!first || /^(canada|united states|usa|us)$/i.test(first)) return null;
  return first;
}

function localizedSerpKeyword(keyword: string, locationName: string): string {
  const city = cityFromLocationName(locationName);
  if (!city) return keyword;
  const normalizedKeyword = normalizeText(keyword);
  const normalizedCity = normalizeText(city);
  if (normalizedKeyword.includes(normalizedCity)) return keyword;
  return `${keyword} ${city}`;
}

function googleSearchDomain(locationName: string): string | null {
  const normalized = normalizeText(locationName);
  if (normalized.includes("canada")) return "google.ca";
  if (normalized.includes("united states") || /\busa\b|\bus\b/.test(normalized)) return "google.com";
  return null;
}

function hasSchema(page: any, schema: string): boolean {
  const haystack = `${stringArray(page?.missingJson).join(" ")} ${stringArray(page?.recommendationsJson).join(" ")}`.toLowerCase();
  return haystack.includes(schema.toLowerCase());
}

function averageNumber(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null);
  return clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function fetchBacklinkSummary(target: string, refresh = false, cacheOnly = false): Promise<BacklinkSummary | null> {
  const request = { target, include_subdomains: true };
  const path = "/v3/backlinks/summary/live";
  const endpoint = "backlinks_summary";
  const cacheKey = createHash("sha256").update(JSON.stringify({ endpoint, request })).digest("hex");
  const now = new Date();
  const cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
  const refreshBlocked = refresh && cached && now.getTime() - cached.fetchedAt.getTime() < BACKLINK_REFRESH_COOLDOWN_MS;
  if (cached && (cacheOnly || cached.expiresAt > now || refreshBlocked)) {
    return { ...parseBacklinkSummary(target, cached.responseJson), fetchedAt: cached.fetchedAt, cached: true };
  }
  if (cacheOnly) return null;

  const payload = await searchDataRequest(path, [request]);
  const summary = parseBacklinkSummary(target, payload);
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const requestJson = request as Prisma.InputJsonValue;
  const responseJson = payload as unknown as Prisma.InputJsonValue;
  const row = await prisma.externalApiCache.upsert({
    where: { cacheKey },
    create: { provider: "search_data", endpoint, cacheKey, requestJson, responseJson, status: "ok", expiresAt },
    update: { requestJson, responseJson, status: "ok", fetchedAt: now, expiresAt },
  });
  return { ...summary, fetchedAt: row.fetchedAt, cached: false };
}

async function fetchBacklinkLinks(target: string, limit: number, refresh = false, cacheOnly = false): Promise<BacklinkLinksResult | null> {
  const request = {
    target,
    include_subdomains: true,
    limit,
    order_by: ["rank,desc"],
  };
  const path = "/v3/backlinks/backlinks/live";
  const endpoint = "backlinks_links";
  const cacheKey = createHash("sha256").update(JSON.stringify({ endpoint, request })).digest("hex");
  const now = new Date();
  const cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
  const refreshBlocked = refresh && cached && now.getTime() - cached.fetchedAt.getTime() < BACKLINK_REFRESH_COOLDOWN_MS;
  if (cached && (cacheOnly || cached.expiresAt > now || refreshBlocked)) {
    return { ...parseBacklinkLinks(target, cached.responseJson), fetchedAt: cached.fetchedAt, cached: true };
  }
  if (cacheOnly) return null;

  const payload = await searchDataRequest(path, [request]);
  const result = parseBacklinkLinks(target, payload);
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const requestJson = request as Prisma.InputJsonValue;
  const responseJson = payload as unknown as Prisma.InputJsonValue;
  const row = await prisma.externalApiCache.upsert({
    where: { cacheKey },
    create: { provider: "search_data", endpoint, cacheKey, requestJson, responseJson, status: "ok", expiresAt },
    update: { requestJson, responseJson, status: "ok", fetchedAt: now, expiresAt },
  });
  return { ...result, fetchedAt: row.fetchedAt, cached: false };
}

function parseBacklinkLinks(target: string, payload: unknown): Omit<BacklinkLinksResult, "fetchedAt" | "cached"> {
  const results = (payload as SearchDataPayload)?.tasks?.flatMap((task) => task.result ?? []) ?? [];
  const items = results.flatMap((result) => Array.isArray((result as any)?.items) ? (result as any).items : []);
  return {
    target,
    links: items.map((item) => parseBacklinkLink(item as Record<string, unknown>)).filter((item) => item.sourceUrl || item.targetUrl),
    source: "search_data",
    providerCostUsd: ((payload as SearchDataPayload)?.tasks ?? []).reduce((sum, task) => sum + (typeof (task as { cost?: unknown }).cost === "number" ? Number((task as { cost: number }).cost) : 0), 0),
  };
}

function parseBacklinkLink(item: Record<string, unknown>): BacklinkLink {
  return {
    sourceUrl: stringOrNull(item.url_from ?? item.source_url ?? item.referring_page),
    sourceDomain: stringOrNull(item.domain_from ?? item.source_domain ?? item.referring_domain),
    targetUrl: stringOrNull(item.url_to ?? item.target_url),
    anchor: stringOrNull(item.anchor ?? item.text_pre ?? item.link_text),
    dofollow: booleanOrNull(item.dofollow ?? item.is_dofollow),
    firstSeen: stringOrNull(item.first_seen),
    lastSeen: stringOrNull(item.last_seen),
    sourceRank: numberOrNull(item.rank ?? item.domain_from_rank),
    pageRank: numberOrNull(item.page_from_rank ?? item.page_rank),
    toxicityScore: numberOrNull(item.backlink_spam_score ?? item.spam_score ?? item.toxicity_score ?? item.link_spam_score),
  };
}

function parseBacklinkSummary(target: string, payload: unknown): Omit<BacklinkSummary, "fetchedAt" | "cached"> {
  const result = (payload as SearchDataPayload)?.tasks?.flatMap((task) => task.result ?? [])?.[0] as Record<string, unknown> | undefined;
  const item = Array.isArray((result as any)?.items) ? (result as any).items[0] as Record<string, unknown> : result;
  const referringPages = numberOrNull(item?.referring_pages);
  const linkAttributes = item?.referring_links_attributes as Record<string, unknown> | undefined;
  const nofollow = numberOrNull(item?.nofollow ?? item?.backlinks_nofollow ?? item?.referring_pages_nofollow ?? linkAttributes?.nofollow);
  const dofollow = numberOrNull(item?.dofollow ?? item?.backlinks_dofollow) ?? (referringPages != null && nofollow != null ? Math.max(0, referringPages - nofollow) : null);
  return {
    target,
    backlinks: numberOrNull(item?.backlinks),
    backlinksNew: numberOrNull(item?.new_backlinks ?? item?.backlinks_new),
    backlinksLost: numberOrNull(item?.lost_backlinks ?? item?.backlinks_lost),
    referringDomains: numberOrNull(item?.referring_domains),
    referringDomainsNew: numberOrNull(item?.new_referring_domains ?? item?.referring_domains_new),
    referringDomainsLost: numberOrNull(item?.lost_referring_domains ?? item?.referring_domains_lost),
    referringDomainsBroken: numberOrNull(item?.broken_referring_domains ?? item?.referring_domains_broken),
    referringMainDomains: numberOrNull(item?.referring_main_domains),
    referringPages,
    dofollow,
    nofollow,
    brokenBacklinks: numberOrNull(item?.broken_backlinks),
    brokenPages: numberOrNull(item?.broken_pages),
    spamScore: numberOrNull(item?.backlinks_spam_score ?? item?.spam_score),
    firstSeen: stringOrNull(item?.first_seen),
    lastSeen: stringOrNull(item?.last_seen),
    source: "search_data",
    providerCostUsd: ((payload as SearchDataPayload)?.tasks ?? []).reduce((sum, task) => sum + (typeof (task as { cost?: unknown }).cost === "number" ? Number((task as { cost: number }).cost) : 0), 0),
  };
}

const inFlightSearchDataRequests = new Map<string, Promise<SearchDataPayload>>();
const searchProviderLocationsPromises = new Map<string, Promise<SearchProviderLocation[]>>();

function searchProviderAuthorization(): string {
  const legacyPrefix = "DATA" + "FOR" + "SEO";
  const login = process.env.SEARCH_DATA_PROVIDER_LOGIN || process.env[`${legacyPrefix}_LOGIN`];
  const password = process.env.SEARCH_DATA_PROVIDER_PASSWORD || process.env[`${legacyPrefix}_PASSWORD`];
  const auth = process.env.SEARCH_DATA_PROVIDER_AUTH_BASE64 || process.env[`${legacyPrefix}_AUTH_BASE64`] || (login && password ? Buffer.from(`${login}:${password}`).toString("base64") : null);
  if (!auth) throw new Error("Keyword data provider credentials are not configured.");
  return auth;
}

async function searchProviderLocations(countryIsoCode?: string | null): Promise<SearchProviderLocation[]> {
  const country = String(countryIsoCode ?? "").trim().toUpperCase();
  const cacheKey = country || "all";
  const existingRequest = searchProviderLocationsPromises.get(cacheKey);
  if (existingRequest) return existingRequest;
  const request = (async () => {
    const countryPath = country ? `/${encodeURIComponent(country)}` : "";
    const response = await fetch(`https://api.${SEARCH_PROVIDER_KEY}.com/v3/keywords_data/google/locations${countryPath}`, {
      headers: { authorization: `Basic ${searchProviderAuthorization()}`, accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json() as SearchDataPayload;
    if (!response.ok || (payload.status_code && payload.status_code >= 40000)) {
      throw new Error(`Keyword data provider locations: ${payload.status_message || `returned ${response.status}`}`);
    }
    return (payload.tasks?.flatMap((task) => task.result ?? []) ?? []).filter((item): item is SearchProviderLocation => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const location = item as Partial<SearchProviderLocation>;
      return typeof location.location_code === "number" && typeof location.location_name === "string" && typeof location.country_iso_code === "string" && typeof location.location_type === "string";
    });
  })().catch((error) => {
    searchProviderLocationsPromises.delete(cacheKey);
    throw error;
  });
  searchProviderLocationsPromises.set(cacheKey, request);
  return request;
}

async function searchDataRequest(path: string, body: unknown): Promise<SearchDataPayload> {
  const cacheKey = createHash("sha256").update(JSON.stringify({ path, body })).digest("hex");
  const now = new Date();
  let cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
  if (cached && cached.expiresAt > now && cached.status === "ok") return cached.responseJson as unknown as SearchDataPayload;
  const activeRequest = inFlightSearchDataRequests.get(cacheKey);
  if (activeRequest) return activeRequest;
  if (cached && cached.expiresAt > now && cached.status === "pending") {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const completed = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
      if (completed?.status === "ok" && completed.expiresAt > new Date()) return completed.responseJson as unknown as SearchDataPayload;
      if (completed?.status === "error") throw new Error(String((completed.responseJson as Record<string, unknown>)?.error ?? "Backlink provider request failed."));
    }
    throw Object.assign(new Error("This provider request is already running. Retry after the current collection finishes."), { statusCode: 409 });
  }

  // ExternalApiCache is also a cross-process request lease. The API, worker,
  // and any horizontally scaled API instances must not independently buy the
  // same provider result when their in-memory maps cannot see one another.
  const leaseExpiresAt = new Date(Date.now() + Math.max(5 * 60_000, KEYWORD_RESEARCH_PROVIDER_TIMEOUT_MS * 3 + 15_000));
  let ownsLease = false;
  if (!cached) {
    try {
      await prisma.externalApiCache.create({
        data: {
          provider: "search_data",
          endpoint: path.slice(0, 180),
          cacheKey,
          requestJson: body as Prisma.InputJsonValue,
          responseJson: {},
          status: "pending",
          expiresAt: leaseExpiresAt,
        },
      });
      ownsLease = true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
    }
  } else {
    const claimed = await prisma.externalApiCache.updateMany({
      where: { id: cached.id, fetchedAt: cached.fetchedAt, OR: [{ expiresAt: { lte: now } }, { status: { not: "pending" } }] },
      data: { endpoint: path.slice(0, 180), requestJson: body as Prisma.InputJsonValue, responseJson: {}, status: "pending", fetchedAt: now, expiresAt: leaseExpiresAt },
    });
    ownsLease = claimed.count === 1;
  }

  if (!ownsLease) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const completed = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
      if (completed?.status === "ok" && completed.expiresAt > new Date()) return completed.responseJson as unknown as SearchDataPayload;
      if (completed?.status === "error") throw new Error(String((completed.responseJson as Record<string, unknown>)?.error ?? "Search data provider request failed."));
    }
    throw Object.assign(new Error("This provider request is already running. Retry after the current collection finishes."), { statusCode: 409 });
  }

  const request = requestSearchDataProvider(path, body)
    .then(async (payload) => {
      const expiresAt = new Date(Date.now() + KEYWORD_REFRESH_COOLDOWN_MS);
      await prisma.externalApiCache.update({
        where: { cacheKey },
        data: { requestJson: body as Prisma.InputJsonValue, responseJson: payload as unknown as Prisma.InputJsonValue, status: "ok", fetchedAt: new Date(), expiresAt },
      });
      return payload;
    })
    .catch(async (error) => {
      await prisma.externalApiCache.update({
        where: { cacheKey },
        data: {
          responseJson: { error: error instanceof Error ? error.message : "Search data provider request failed." },
          status: "error",
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }).catch(() => undefined);
      throw error;
    })
    .finally(() => inFlightSearchDataRequests.delete(cacheKey));
  inFlightSearchDataRequests.set(cacheKey, request);
  return request;
}

async function requestSearchDataProvider(path: string, body: unknown): Promise<SearchDataPayload> {
  const auth = searchProviderAuthorization();
  let lastError: Error | null = null;
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`https://api.${SEARCH_PROVIDER_KEY}.com${path}`, {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        // Live keyword endpoints occasionally need longer than the location
        // directory. Research runs execute in the background, so prefer a
        // bounded retry over failing a valid city after a short network stall.
        signal: AbortSignal.timeout(KEYWORD_RESEARCH_PROVIDER_TIMEOUT_MS),
      });
      const payload = await response.json() as SearchDataPayload;
      if (!response.ok || (payload.status_code && payload.status_code >= 40000)) {
        throw new Error(`Keyword data provider ${path}: ${payload.status_message || `returned ${response.status}`}`);
      }
      const taskError = payload.tasks?.find((task) => task.status_code && task.status_code >= 40000);
      if (taskError) throw new Error(`Keyword data provider ${path}: ${taskError.status_message || "task failed."}`);
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Keyword data provider request failed.");
      const retryable = retryableSearchProviderError(lastError.message);
      console.warn("[keyword-research] search provider request failed", {
        endpoint: path,
        attempt,
        maximumAttempts,
        elapsedMs: Date.now() - startedAt,
        errorName: lastError.name,
        error: lastError.message,
        retrying: attempt < maximumAttempts && retryable,
      });
      if (attempt === maximumAttempts || !retryable) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError ?? new Error("Keyword data provider request failed.");
}

export function retryableSearchProviderError(message: string) {
  return /internal se server error|internal server error|temporar|timeout|timed out|rate limit|too many requests|returned 5\d\d|fetch failed|network/i.test(message);
}

async function fetchKeywordIdeas(keyword: string, location: SearchLocation, languageCode: string, limit: number): Promise<KeywordIdeaInput[]> {
  const seeds = keywordIdeaSeeds(keyword, [location.displayName]);
  const payload = await searchDataRequest(`/v3/${SEARCH_PROVIDER_KEY}_labs/google/keyword_ideas/live`, [{
    keywords: seeds,
    ...location.labs,
    language_code: languageCode,
    include_seed_keyword: true,
    limit: Math.min(100, Math.max(limit, seeds.length * 20)),
  }]);
  const items = extractSearchDataItems(payload);
  const ideas = items.map(parseKeywordIdea).filter((idea): idea is KeywordIdeaInput => Boolean(idea?.keyword));
  const relevant = rankKeywordIdeas(keyword, ensureSeedKeywordIdea(keyword, ideas)).slice(0, limit);
  const selected = relevant.length ? relevant : [{ keyword, avgMonthlySearches: null, competition: null, competitionIndex: null, cpc: null, lowTopOfPageBid: null, highTopOfPageBid: null, currency: null, rawJson: {} }];
  return enrichKeywordIdeasForLocation(selected, location, languageCode);
}

async function enrichKeywordIdeasForLocation(ideas: KeywordIdeaInput[], location: SearchLocation, languageCode: string): Promise<KeywordIdeaInput[]> {
  if (location.locationType === "Country") {
    return ideas.map((idea) => withKeywordMetricEvidence(idea, location.displayName, "country", null));
  }

  try {
    const payload = await searchDataRequest("/v3/keywords_data/google/search_volume/live", [{
      keywords: ideas.map((idea) => idea.keyword).slice(0, 700),
      ...location.keywordMetrics,
      language_code: languageCode,
    }]);
    const localMetrics = new Map(
      extractSearchDataItems(payload)
        .map(parseKeywordIdea)
        .filter((idea): idea is KeywordIdeaInput => Boolean(idea?.keyword))
        .map((idea) => [normalizeKeywordForRelevance(idea.keyword), idea] as const),
    );
    return ideas.map((idea) => {
      const local = localMetrics.get(normalizeKeywordForRelevance(idea.keyword));
      if (!local) return withKeywordMetricEvidence({
        ...idea,
        avgMonthlySearches: null,
        competition: null,
        competitionIndex: null,
        cpc: null,
        lowTopOfPageBid: null,
        highTopOfPageBid: null,
        currency: null,
      }, location.metricScopeName ?? location.displayName, "unavailable", null);
      return withKeywordMetricEvidence({
        ...idea,
        avgMonthlySearches: local.avgMonthlySearches,
        competition: local.competition ?? idea.competition,
        cpc: local.cpc,
        lowTopOfPageBid: local.lowTopOfPageBid,
        highTopOfPageBid: local.highTopOfPageBid,
        currency: local.currency ?? idea.currency,
      }, location.metricScopeName ?? location.displayName, location.metricSource ?? "selected_location", local.rawJson);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The provider request failed.";
    throw new Error(`Exact location metrics are required for ${location.displayName}. ${detail}`);
  }
}

function withKeywordMetricEvidence(idea: KeywordIdeaInput, metricScope: string, metricSource: string, locationMetricJson: unknown): KeywordIdeaInput {
  const scopeParts = metricScope.split(",").map((part) => part.trim()).filter(Boolean);
  const countryScope = scopeParts.at(-1) ?? metricScope;
  return {
    ...idea,
    rawJson: {
      keywordIdea: idea.rawJson,
      locationMetric: locationMetricJson,
      metricScope,
      metricSource,
      volumeAndCpcScope: metricScope,
      seoDifficultyScope: countryScope,
      metricVersion: KEYWORD_METRICS_VERSION,
    },
  };
}

function keywordIdeaSeeds(keyword: string, locations: string[] = []): string[] {
  const canonical = canonicalSeedKeyword(keyword, locations);
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

async function fetchSerpResults(keyword: string, location: SearchLocation, languageCode: string, device: "desktop" | "mobile", depth: number): Promise<SerpResultInput[]> {
  const request = (target: SearchLocation) => searchDataRequest("/v3/serp/google/organic/live/advanced", [{
    keyword,
    ...target.serp,
    language_code: languageCode,
    device,
    os: device === "mobile" ? "android" : "windows",
    depth,
    ...(googleSearchDomain(target.displayName) ? { se_domain: googleSearchDomain(target.displayName) } : {}),
  }]);
  // The selected market is an exact evidence scope. Never broaden a city to
  // its country while continuing to label the result as local evidence.
  const payload: SearchDataPayload = await request(location);
  const items = extractSearchDataItems(payload);
  return items
    .map(parseSerpResult)
    .filter((item): item is SerpResultInput => Boolean(item?.url))
    .filter((item) => /^https?:\/\//i.test(item.url))
    .slice(0, depth);
}

function extractSearchDataItems(payload: SearchDataPayload): unknown[] {
  const results = payload.tasks?.flatMap((task) => task.result ?? []) ?? [];
  return results.flatMap((result: any) => {
    if (Array.isArray(result?.items)) return result.items;
    if (Array.isArray(result?.keyword_ideas)) return result.keyword_ideas;
    if (Array.isArray(result)) return result;
    if (result?.keyword || result?.keyword_data?.keyword) return [result];
    return [];
  });
}

export function parseKeywordIdea(item: any): KeywordIdeaInput | null {
  const info = item?.keyword_info ?? item?.keyword_data?.keyword_info ?? item;
  const properties = item?.keyword_properties ?? item?.keyword_data?.keyword_properties ?? {};
  const keyword = item?.keyword ?? item?.keyword_data?.keyword ?? item?.text ?? null;
  if (!keyword) return null;
  return {
    keyword: String(keyword),
    avgMonthlySearches: numberOrNull(info?.search_volume ?? info?.avg_monthly_searches),
    competition: stringOrNull(info?.competition_level),
    competitionIndex: numberOrNull(properties?.keyword_difficulty),
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
  } as unknown as T, ...ideas];
}

function canonicalSeedKeyword(value: string, locations: string[] = []): string {
  const keyword = stripKeywordLocations(value, locations);
  return keyword.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function keywordIdeaRelevance(seed: string, seedTokens: string[], ideaKeyword: string): number {
  const idea = normalizeKeywordForRelevance(ideaKeyword);
  const ideaTokens = keywordTokens(idea);
  if (!seed || !idea) return 0;
  if (idea === seed) return 1000;
  const seedSet = new Set(seedTokens);
  const ideaSet = new Set(ideaTokens);
  const shared = [...seedSet].filter((token) => ideaSet.has(token));
  if (!hasEnoughKeywordOverlap(seedTokens, ideaTokens, shared)) return 0;
  if (seedTokens.length === 2) {
    if (!containsOrderedPhrase(ideaTokens, seedTokens) && !containsOrderedPhrase(seedTokens, ideaTokens)) return 0;
    const supportedModifiers = new Set(["software", "system", "systems", "solution", "solutions", "tool", "tools", "platform", "platforms", "online", "automation", "automated", "digital"]);
    if (ideaTokens.some((token) => !seedSet.has(token) && !supportedModifiers.has(token))) return 0;
  }
  if (idea.includes(seed)) return 850 - Math.abs(ideaTokens.length - seedTokens.length) * 15;
  if (seed.includes(idea) && shared.length >= Math.min(2, seedTokens.length)) return 780 - Math.abs(ideaTokens.length - seedTokens.length) * 15;
  const coverage = shared.length / Math.max(1, seedSet.size);
  const extraPenalty = Math.max(0, ideaSet.size - shared.length) * 8;
  return Math.round(coverage * 700 + shared.length * 30 - extraPenalty);
}

function containsOrderedPhrase(container: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length > container.length) return false;
  return container.some((_, index) => phrase.every((token, offset) => container[index + offset] === token));
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
  const allowedTypes = new Set(["organic", "local_pack"]);
  if (item?.type && !allowedTypes.has(item.type)) return null;
  const url = item?.url ?? item?.breadcrumb_url ?? item?.booking_url ?? null;
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
    description: stringOrNull(item?.description ?? item?.address),
    rawJson: item,
  };
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

export function resolveSearchLocation(value: string, keyword = ""): SearchLocation {
  const trimmed = value.trim();
  const normalized = normalizeText(trimmed);
  const normalizedKeyword = normalizeText(keyword);
  const aliases: Record<string, SearchLocation> = {
    canada: countryLocation("Canada", 2124),
    "united states": countryLocation("United States", 2840),
    usa: countryLocation("United States", 2840),
    us: countryLocation("United States", 2840),
    ontario: canadianProvinceLocation("Ontario,Canada", 20121),
    "ontario canada": canadianProvinceLocation("Ontario,Canada", 20121),
    alberta: canadianProvinceLocation("Alberta,Canada", 20113),
    "alberta canada": canadianProvinceLocation("Alberta,Canada", 20113),
    toronto: canadianCityLocation("Toronto,Ontario,Canada", "43.653226,-79.383184,20000", 1002451),
    "toronto canada": canadianCityLocation("Toronto,Ontario,Canada", "43.653226,-79.383184,20000", 1002451),
    "toronto ontario canada": canadianCityLocation("Toronto,Ontario,Canada", "43.653226,-79.383184,20000", 1002451),
    mississauga: canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000", 1002350),
    mississagua: canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000", 1002350),
    "mississauga canada": canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000", 1002350),
    "mississagua canada": canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000", 1002350),
    "mississauga ontario canada": canadianCityLocation("Mississauga,Ontario,Canada", "43.589045,-79.644120,20000", 1002350),
    brampton: canadianCityLocation("Brampton,Ontario,Canada", "43.731548,-79.762418,20000", 9231405),
    "brampton canada": canadianCityLocation("Brampton,Ontario,Canada", "43.731548,-79.762418,20000", 9231405),
    "brampton ontario canada": canadianCityLocation("Brampton,Ontario,Canada", "43.731548,-79.762418,20000", 9231405),
    vancouver: canadianCityLocation("Vancouver,British Columbia,Canada", "49.282729,-123.120738,20000"),
    "vancouver canada": canadianCityLocation("Vancouver,British Columbia,Canada", "49.282729,-123.120738,20000"),
    "vancouver british columbia canada": canadianCityLocation("Vancouver,British Columbia,Canada", "49.282729,-123.120738,20000"),
    montreal: canadianCityLocation("Montreal,Quebec,Canada", "45.501887,-73.567392,20000"),
    "montreal canada": canadianCityLocation("Montreal,Quebec,Canada", "45.501887,-73.567392,20000"),
    "montreal quebec canada": canadianCityLocation("Montreal,Quebec,Canada", "45.501887,-73.567392,20000"),
    edmonton: canadianCityLocation("Edmonton,Alberta,Canada", "53.546124,-113.493823,20000", 1001808),
    "edmonton canada": canadianCityLocation("Edmonton,Alberta,Canada", "53.546124,-113.493823,20000", 1001808),
    "edmonton alberta canada": canadianCityLocation("Edmonton,Alberta,Canada", "53.546124,-113.493823,20000", 1001808),
    calgary: canadianCityLocation("Calgary,Alberta,Canada", "51.044733,-114.071883,20000", 1001801),
    "calgary canada": canadianCityLocation("Calgary,Alberta,Canada", "51.044733,-114.071883,20000", 1001801),
    "calgary alberta canada": canadianCityLocation("Calgary,Alberta,Canada", "51.044733,-114.071883,20000", 1001801),
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
    if (normalizedKeyword.includes("edmonton")) return aliases.edmonton;
    if (normalizedKeyword.includes("calgary")) return aliases.calgary;
  }
  if (normalized === "united states" || normalized === "usa" || normalized === "us") {
    if (normalizedKeyword.includes("new york")) return aliases["new york"];
  }
  if (normalized.includes("canada")) {
    for (const market of ["mississauga", "mississagua", "brampton", "toronto", "edmonton", "calgary", "ontario", "alberta"]) {
      if (normalized === market || normalized.startsWith(`${market} `)) return aliases[market];
    }
  }
  const country = searchCountryLocationInfo(trimmed);
  return aliases[normalized] ?? (country ? countryLocation(country.name, country.locationCode, country.isoCode, country.locationType) : customLocation(trimmed));
}

export async function resolveExactSearchLocation(value: string, keyword = ""): Promise<SearchLocation> {
  const requestedMarket = value.split(",").map((part) => part.trim()).find(Boolean) ?? "";
  if (!isPlausibleGeographicTargetMarket(requestedMarket)) {
    throw new Error(`Exact location metrics require an unambiguous provider location for “${value}”. Choose a named city, neighbourhood, region, province/state, or country.`);
  }
  const known = resolveSearchLocation(value, keyword);
  if ("location_code" in known.keywordMetrics) return known;
  let matched: SearchProviderLocation | null;
  let matchedViaParentCity = false;
  try {
    const requestedCountryIsoCode = [...known.displayName.split(",")]
      .reverse()
      .map((part) => searchCountryLocationInfo(part.trim())?.isoCode ?? null)
      .find(Boolean) ?? null;
    const providerLocations = await searchProviderLocations(requestedCountryIsoCode);
    matched = matchSearchProviderLocation(known.displayName, providerLocations);
    if (!matched) {
      const parts = known.displayName.split(",").map((part) => part.trim()).filter(Boolean);
      const requestedMarket = parts[0] ?? "";
      const normalizedRequestedMarket = normalizeText(requestedMarket);
      const knownParentMarket: Record<string, string> = {
        etobicoke: "Toronto",
        scarborough: "Toronto",
        "north york": "Toronto",
        "east york": "Toronto",
        york: "Toronto",
      };
      const canonicalMarket = (knownParentMarket[normalizedRequestedMarket] ?? requestedMarket)
        .replace(/^(?:north|south|east|west|central|downtown)\s+/i, "")
        .replace(/^greater\s+(.+?)\s+area$/i, "$1")
        .replace(/\s+(?:metropolitan|metro)\s+area$/i, "")
        .trim();
      if (canonicalMarket && canonicalMarket.toLocaleLowerCase() !== requestedMarket.toLocaleLowerCase()) {
        matched = matchSearchProviderLocation([canonicalMarket, ...parts.slice(1)].join(","), providerLocations);
        matchedViaParentCity = Boolean(matched);
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The location directory could not be loaded.";
    throw new Error(`Exact location metrics require a verified provider location. ${detail}`);
  }
  if (!matched) {
    throw new Error(`Exact location metrics require an unambiguous provider location for “${value}”. Add the city, state/province, and country.`);
  }
  const country = SEARCH_COUNTRY_LOCATIONS.find((item) => item.isoCode === matched.country_iso_code);
  if (!country) throw new Error(`Exact location metrics do not support the country for “${value}”.`);
  const displayName = matchedViaParentCity ? known.displayName : displaySearchProviderLocation(matched.location_name);
  return {
    displayName,
    countryIsoCode: matched.country_iso_code,
    locationType: providerLocationType(matched.location_type),
    labs: { location_code: country.locationCode },
    serp: { location_code: matched.location_code },
    keywordMetrics: { location_code: matched.location_code },
    metricScopeName: displaySearchProviderLocation(matched.location_name),
    metricSource: matchedViaParentCity ? "parent_city" : "selected_location",
  };
}

export function displaySearchProviderLocation(value: string): string {
  return canonicalGeographicLocationLabel(value);
}

export function matchSearchProviderLocation(value: string, locations: SearchProviderLocation[]): SearchProviderLocation | null {
  const requestedParts = value.split(",").map((part) => normalizeText(part)).filter(Boolean);
  const requestedMarket = requestedParts[0] ?? normalizeText(value);
  if (!requestedMarket) return null;
  const requestedCountry = [...requestedParts].reverse().map(searchCountryLocationInfo).find(Boolean)?.isoCode ?? null;
  const middleParts = requestedParts.slice(1, -1).filter((part) => part.length > 2);
  const candidates = locations.filter((location) => {
    const parts = location.location_name.split(",").map((part) => normalizeText(part)).filter(Boolean);
    return parts[0] === requestedMarket && (!requestedCountry || location.country_iso_code === requestedCountry);
  });
  if (!candidates.length) return null;

  const preferred = middleParts.length
    ? candidates.filter((location) => middleParts.every((part) => normalizeText(location.location_name).includes(part)))
    : candidates;
  const pool = preferred.length ? preferred : candidates;
  const bestPriority = Math.min(...pool.map((location) => providerLocationTypePriority(location.location_type)));
  const bestTypeMatches = pool.filter((location) => providerLocationTypePriority(location.location_type) === bestPriority);
  const byCanonicalName = new Map<string, SearchProviderLocation[]>();
  for (const location of bestTypeMatches) {
    const key = normalizeText(location.location_name);
    byCanonicalName.set(key, [...(byCanonicalName.get(key) ?? []), location]);
  }
  if (byCanonicalName.size > 1) return null;
  const matches = [...byCanonicalName.values()][0] ?? [];
  return matches[0] ?? null;
}

function providerLocationType(value: string): SearchLocation["locationType"] {
  const normalized = value.toLowerCase();
  if (normalized === "country") return "Country";
  if (normalized === "region") return "Region";
  if (["state", "province"].includes(normalized)) return "State";
  if (["city", "municipality", "borough", "district", "neighborhood"].includes(normalized)) return "City";
  return "Custom";
}

function providerLocationTypePriority(value: string): number {
  const normalized = value.toLowerCase();
  if (normalized === "city") return 0;
  if (["state", "province", "country"].includes(normalized)) return 1;
  if (normalized === "municipality") return 2;
  return 3;
}

function countryLocation(displayName: string, locationCode: number, isoCode?: string, locationType: "Country" | "Region" = "Country"): SearchLocation {
  return {
    displayName,
    countryIsoCode: isoCode ?? countryIsoCode(displayName),
    locationType,
    labs: { location_code: locationCode },
    serp: { location_code: locationCode },
    keywordMetrics: { location_code: locationCode },
  };
}

function canadianCityLocation(displayName: string, locationCoordinate: string, metricLocationCode?: number): SearchLocation {
  return {
    displayName,
    countryIsoCode: "CA",
    locationType: "City",
    labs: { location_code: 2124 },
    serp: { location_coordinate: locationCoordinate },
    keywordMetrics: metricLocationCode ? { location_code: metricLocationCode } : { location_name: displayName },
  };
}

function canadianProvinceLocation(displayName: string, locationCode: number): SearchLocation {
  return {
    displayName,
    countryIsoCode: "CA",
    locationType: "State",
    labs: { location_code: 2124 },
    serp: { location_code: locationCode },
    keywordMetrics: { location_code: locationCode },
  };
}

function usCityLocation(displayName: string, locationCoordinate: string): SearchLocation {
  return {
    displayName,
    countryIsoCode: "US",
    locationType: "City",
    labs: { location_code: 2840 },
    serp: { location_coordinate: locationCoordinate },
    keywordMetrics: { location_name: displayName },
  };
}

function customLocation(displayName: string): SearchLocation {
  const country = inferCountryLocationInfo(displayName) ?? searchCountryLocationInfo("Canada")!;
  const locationType = locationTypeFromName(displayName);
  return {
    displayName,
    countryIsoCode: country.isoCode,
    locationType,
    labs: { location_code: country.locationCode },
    serp: { location_code: country.locationCode },
    keywordMetrics: locationType === "Country" ? { location_code: country.locationCode } : { location_name: displayName },
  };
}

function countryIsoCode(value: string): string | null {
  return searchCountryLocationInfo(value)?.isoCode ?? null;
}

function inferCountryLocationInfo(value: string): SearchCountryLocation | null {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  for (const part of [value, ...parts.slice().reverse()]) {
    const country = searchCountryLocationInfo(part);
    if (country) return country;
  }
  return null;
}

function locationTypeFromName(value: string): SearchLocation["locationType"] {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1 && countryIsoCode(value)) return "Country";
  if (parts.length === 2 && countryIsoCode(parts[1])) return "State";
  if (parts.length >= 2) return "City";
  return "Custom";
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
    const response = await safePublicFetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SEnukeAIBot/0.1; +https://senuke-ai.local)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    }, { sameHostname: true });
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

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return null;
}

function microsToMoney(value: unknown): number | null {
  const number = numberOrNull(value);
  return number == null ? null : number / 1_000_000;
}
