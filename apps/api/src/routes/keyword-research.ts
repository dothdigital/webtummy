import { createHash } from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import { Worker } from "bullmq";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { parseHtml } from "@webtummy/core";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config, KEYWORD_RESEARCH_QUEUE } from "../config.js";
import { keywordResearchQueue, queueConnection, type KeywordResearchQueueJobData } from "../queue.js";

export const keywordResearchRouter = Router();
keywordResearchRouter.use(requireAuth);

const SEARCH_PROVIDER_KEY = "data" + "forseo";

const KEYWORD_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const UNRESTRICTED_REFRESH_EMAILS = new Set(["manishjetly@gmail.com"]);
const refreshableStatuses = ["queued", "running", "completed"];

const createSchema = z.object({
  websiteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  seedKeyword: z.string().min(2),
  targetUrl: z.string().url().optional().nullable(),
  targetDomain: z.string().min(2).optional().nullable(),
  locationName: z.string().min(2).default("Mississauga"),
  languageCode: z.string().min(2).max(8).default("en"),
  device: z.enum(["desktop", "mobile"]).default("desktop"),
  serpDepth: z.number().int().min(1).max(100).default(20),
  keywordLimit: z.number().int().min(1).max(100).default(25),
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
        select: { strategySummary: true, audienceProfile: true, offerRecommendation: true, seoStrategy: true },
      },
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

async function scopedRun(req: Request, id: string) {
  const clientId = await projectClientIdForRequest(req);
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  const run = await prisma.keywordResearchRun.findFirst({
    where: { id, ...(clientId ? { clientId } : {}) },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 100 },
      competitors: { orderBy: { rank: "asc" }, take: 120 },
    },
  });
  return run ? withRefreshState(withRelevantIdeas(run), bypassRefreshLimit) : null;
}

function publicKeywordResearchError(message: string): { status: number; message: string } {
  const normalized = message.toLowerCase();
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

  let clientId = await projectClientIdForRequest(req, input.clientId);
  let website: ScopedKeywordWebsite | null = null;
  if (input.websiteId) {
    const scoped = await keywordWebsiteForRequest(req, input.websiteId, clientId);
    website = scoped.website;
    if (!website) {
      if (scoped.mismatch) {
        return res.status(403).json({
          error: "website belongs to another client context",
          domain: scoped.mismatch.domain,
          websiteId: scoped.mismatch.id,
        });
      }
      return res.status(404).json({ error: "website not found" });
    }
    clientId = website.clientId;
  }
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  const targetDomain = normalizeDomain(input.targetDomain) || domainFromUrl(input.targetUrl) || normalizeDomain(website?.domain) || domainFromUrl(website?.rootUrl);
  const location = resolveSearchLocation(input.locationName, input.seedKeyword);

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
      status: "queued",
    },
  });
  const executionInput: KeywordResearchExecutionInput = {
    seedKeyword: input.seedKeyword,
    targetUrl: input.targetUrl || null,
    targetDomain,
    location,
    languageCode: input.languageCode,
    device: input.device,
    serpDepth: input.serpDepth,
    keywordLimit: input.keywordLimit,
  };

  // Return the persisted run immediately. The shared background-job center can
  // now track it globally while provider and competitor work continues.
  await enqueueKeywordResearchCompletion(run.id, executionInput);
  res.status(202).json({ run: withRefreshState(run, bypassRefreshLimit) });
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
  const bypassRefreshLimit = await canBypassKeywordRefreshLimit(req);
  const runs = await prisma.keywordResearchRun.findMany({
    where: clientId ? { clientId } : {},
    orderBy: { createdAt: "desc" },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 3 },
      competitors: { orderBy: { rank: "asc" }, take: 3 },
    },
    take: 100,
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

  try {
    const summary = await fetchBacklinkSummary(target, parsed.data.refresh === "true", parsed.data.cacheOnly === "true");
    res.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backlink summary failed";
    res.status(502).json({ error: message });
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

  try {
    const backlinks = await fetchBacklinkLinks(target, parsed.data.limit, parsed.data.refresh === "true", parsed.data.cacheOnly === "true");
    res.json({ backlinks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backlink links failed";
    res.status(502).json({ error: message });
  }
});

keywordResearchRouter.get("/keyword-research/:id", async (req, res) => {
  const run = await scopedRun(req, req.params.id);
  if (!run) return res.status(404).json({ error: "keyword research run not found" });
  res.json({ run });
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

  const location = resolveSearchLocation(existing.locationName, existing.seedKeyword);
  const keywordLimit = Math.min(100, Math.max(1, existing.keywordCount || existing.ideas?.length || 25));
  const run = await prisma.keywordResearchRun.create({
    data: {
      clientId: existing.clientId,
      websiteId: existing.websiteId,
      seedKeyword: existing.seedKeyword,
      targetUrl: existing.targetUrl,
      targetDomain: existing.targetDomain,
      locationName: location.displayName,
      languageCode: existing.languageCode,
      device: existing.device === "mobile" ? "mobile" : "desktop",
      serpDepth: existing.serpDepth,
      status: "queued",
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
  await enqueueKeywordResearchCompletion(run.id, executionInput);
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

async function completeKeywordResearchRun(runId: string, input: KeywordResearchExecutionInput) {
  const serpKeyword = localizedSerpKeyword(input.seedKeyword, input.location.displayName);
  const [ideas, serpResults] = await Promise.all([
    fetchKeywordIdeas(input.seedKeyword, input.location, input.languageCode, input.keywordLimit),
    fetchSerpResults(serpKeyword, input.location, input.languageCode, input.device, input.serpDepth),
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

const KEYWORD_RESEARCH_CONCURRENCY = 3;
let keywordResearchWorker: Worker<KeywordResearchQueueJobData> | null = null;

async function enqueueKeywordResearchCompletion(runId: string, input: KeywordResearchExecutionInput) {
  const existing = await keywordResearchQueue.getJob(runId);
  if (existing) {
    const state = await existing.getState();
    if (!["completed", "failed", "unknown"].includes(state)) return;
    await existing.remove().catch(() => undefined);
  }
  await keywordResearchQueue.add("keyword:run", { runId, input }, {
    jobId: runId,
    removeOnComplete: 500,
    removeOnFail: 500,
  });
}

async function executeKeywordResearchWork(work: { runId: string; input: KeywordResearchExecutionInput }) {
  try {
    await prisma.keywordResearchRun.update({ where: { id: work.runId }, data: { status: "running", error: null } });
    await completeKeywordResearchRun(work.runId, work.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Keyword research failed";
    const publicError = publicKeywordResearchError(message);
    await prisma.keywordResearchRun.update({
      where: { id: work.runId },
      data: { status: "failed", error: publicError.message, completedAt: new Date() },
    }).catch(() => undefined);
  }
}

function executionInputFromRun(run: {
  seedKeyword: string;
  targetUrl: string | null;
  targetDomain: string | null;
  locationName: string;
  languageCode: string;
  device: string;
  serpDepth: number;
  keywordCount: number;
}) {
  return {
    seedKeyword: run.seedKeyword,
    targetUrl: run.targetUrl,
    targetDomain: run.targetDomain,
    location: resolveSearchLocation(run.locationName, run.seedKeyword),
    languageCode: run.languageCode,
    device: run.device === "mobile" ? "mobile" as const : "desktop" as const,
    serpDepth: run.serpDepth,
    keywordLimit: Math.min(100, Math.max(1, run.keywordCount || 25)),
  };
}

async function recoverQueuedKeywordResearchRuns() {
  const runs = await prisma.keywordResearchRun.findMany({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, seedKeyword: true, targetUrl: true, targetDomain: true, locationName: true, languageCode: true, device: true, serpDepth: true, keywordCount: true },
  });
  for (const run of runs) {
    await prisma.keywordResearchRun.update({ where: { id: run.id }, data: { status: "queued", error: null, completedAt: null } });
    await enqueueKeywordResearchCompletion(run.id, executionInputFromRun(run));
  }
  if (runs.length) console.log(`[api] recovered ${runs.length} queued keyword research run(s)`);
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
    : "Run page mapping so SEnuke AI can connect this keyword to the best crawled page before generating changes.";
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
  if (action === "map_pages") return "Run page mapping, then let SEnuke AI choose the page to improve or confirm that a new page is needed.";
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
  };
}

async function searchDataRequest(path: string, body: unknown): Promise<SearchDataPayload> {
  const legacyPrefix = "DATA" + "FOR" + "SEO";
  const login = process.env.SEARCH_DATA_PROVIDER_LOGIN || process.env[`${legacyPrefix}_LOGIN`];
  const password = process.env.SEARCH_DATA_PROVIDER_PASSWORD || process.env[`${legacyPrefix}_PASSWORD`];
  const auth = process.env.SEARCH_DATA_PROVIDER_AUTH_BASE64 || process.env[`${legacyPrefix}_AUTH_BASE64`] || (login && password ? Buffer.from(`${login}:${password}`).toString("base64") : null);
  if (!auth) throw new Error("Keyword data provider credentials are not configured.");
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.${SEARCH_PROVIDER_KEY}.com${path}`, {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json() as SearchDataPayload;
      if (!response.ok || (payload.status_code && payload.status_code > 40000)) {
        throw new Error(`Keyword data provider ${path}: ${payload.status_message || `returned ${response.status}`}`);
      }
      const taskError = payload.tasks?.find((task) => task.status_code && task.status_code > 40000);
      if (taskError) throw new Error(`Keyword data provider ${path}: ${taskError.status_message || "task failed."}`);
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Keyword data provider request failed.");
      if (attempt === 2 || !retryableSearchProviderError(lastError.message)) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError ?? new Error("Keyword data provider request failed.");
}

export function retryableSearchProviderError(message: string) {
  return /internal se server error|internal server error|temporar|timeout|timed out|rate limit|too many requests|returned 5\d\d|fetch failed|network/i.test(message);
}

async function fetchKeywordIdeas(keyword: string, location: SearchLocation, languageCode: string, limit: number): Promise<KeywordIdeaInput[]> {
  const seeds = keywordIdeaSeeds(keyword);
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
  let payload: SearchDataPayload;
  try {
    payload = await request(location);
  } catch (error) {
    const countryFallback = location.locationType === "City" && location.countryIsoCode === "CA"
      ? countryLocation("Canada", 2124, "CA")
      : location.locationType === "City" && location.countryIsoCode === "US"
        ? countryLocation("United States", 2840, "US")
        : null;
    if (!countryFallback || !retryableSearchProviderError(error instanceof Error ? error.message : "")) throw error;
    // Keep the city in the keyword while broadening only the provider's SERP location.
    payload = await request(countryFallback);
  }
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
  } as unknown as T, ...ideas];
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

function resolveSearchLocation(value: string, keyword = ""): SearchLocation {
  const trimmed = value.trim();
  const normalized = normalizeText(trimmed);
  const normalizedKeyword = normalizeText(keyword);
  const aliases: Record<string, SearchLocation> = {
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
    edmonton: canadianCityLocation("Edmonton,Alberta,Canada", "53.546124,-113.493823,20000"),
    "edmonton canada": canadianCityLocation("Edmonton,Alberta,Canada", "53.546124,-113.493823,20000"),
    "edmonton alberta canada": canadianCityLocation("Edmonton,Alberta,Canada", "53.546124,-113.493823,20000"),
    calgary: canadianCityLocation("Calgary,Alberta,Canada", "51.044733,-114.071883,20000"),
    "calgary canada": canadianCityLocation("Calgary,Alberta,Canada", "51.044733,-114.071883,20000"),
    "calgary alberta canada": canadianCityLocation("Calgary,Alberta,Canada", "51.044733,-114.071883,20000"),
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
  const country = searchCountryLocationInfo(trimmed);
  return aliases[normalized] ?? (country ? countryLocation(country.name, country.locationCode, country.isoCode, country.locationType) : customLocation(trimmed));
}

function countryLocation(displayName: string, locationCode: number, isoCode?: string, locationType: "Country" | "Region" = "Country"): SearchLocation {
  return {
    displayName,
    countryIsoCode: isoCode ?? countryIsoCode(displayName),
    locationType,
    labs: { location_code: locationCode },
    serp: { location_code: locationCode },
  };
}

function canadianCityLocation(displayName: string, locationCoordinate: string): SearchLocation {
  return {
    displayName,
    countryIsoCode: "CA",
    locationType: "City",
    labs: { location_code: 2124 },
    serp: { location_coordinate: locationCoordinate },
  };
}

function usCityLocation(displayName: string, locationCoordinate: string): SearchLocation {
  return {
    displayName,
    countryIsoCode: "US",
    locationType: "City",
    labs: { location_code: 2840 },
    serp: { location_coordinate: locationCoordinate },
  };
}

function customLocation(displayName: string): SearchLocation {
  const country = inferCountryLocationInfo(displayName) ?? searchCountryLocationInfo("Canada")!;
  return {
    displayName,
    countryIsoCode: country.isoCode,
    locationType: locationTypeFromName(displayName),
    labs: { location_code: country.locationCode },
    serp: { location_code: country.locationCode },
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
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SEnukeAIBot/0.1; +https://senuke-ai.local)",
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
