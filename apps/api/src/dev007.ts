import { splitKeywordEntries } from "@webtummy/core";

export const KEYWORD_GROUP_DEFINITIONS = [
  ["primary", "Primary Keywords"],
  ["buyer_intent", "Buyer Intent"],
  ["local", "Local Keywords"],
  ["informational", "Informational Keywords"],
  ["supporting", "Supporting Topics"],
  ["questions", "Question Keywords"],
  ["long_tail", "Long-Tail Keywords"],
] as const;

export type KeywordProjectInput = {
  name: string; businessName?: string | null; projectType?: string | null; niche?: string | null; primaryGoal?: string | null; secondaryGoals?: unknown;
  businessLocation?: string | null; targetLocations?: unknown; competitors?: unknown; websiteStatus?: string | null;
  businessProfile?: { offerSummary?: string | null; targetAudience?: string | null; businessSummary?: string | null } | null;
  opportunities?: Array<{ status: string; name: string; recommendedOffer?: string | null }>;
};

const list = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
const clean = (value?: string | null) => value?.trim().replace(/\s+/g, " ") ?? "";
const cleanTopic = (value: string) => clean(value).replace(/^(?:and|or|plus)\s+/i, "");
const monetizationMechanic = (value: string) => /\b(?:fee|commission|paid (?:seller |buyer )?package|success fee|transaction charge|revenue share)\b/i.test(value);
const projectDirectionLanguage = (value: string) => {
  const normalized = clean(value).toLowerCase();
  return /\b(?:build|create|develop|launch|redesign|improve|grow)\b.*\b(?:website|web site|brand|lead[ -]generation|marketing campaign|seo campaign)\b/.test(normalized)
    || /\b(?:business growth|local (?:lead )?growth|revenue growth|brand awareness|customer acquisition|selected direction|project goal|service-specific pages?|educational explanations?|consultation requests?|structured follow-up|website pages?|content pages?|contact forms?|follow-up workflows?)\b/.test(normalized);
};
const canonicalServiceTopic = (value: string) => cleanTopic(value).replace(/\b(rrsp|tfsa|fhsa|rrif)s\b/gi, "$1");
const nonOfferIntakeLabel = (value: string) => /^(?:target audience|ideal customers?|audience|location|target markets?|project name|project goal|primary goal)\s*:/i.test(value);
const stripOfferLabel = (value: string) => value.replace(/^(?:(?:products?(?:\s+(?:and|or)\s+services?)?|services?|offerings?)\s*:|services?\s+(?:(?:you|we|the business)\s+(?:are\s+)?(?:offering|offer|provide)(?:\s+to\s+(?:your|our|the)\s+clients?)?|offered|offering)\s*:?)\s*/i, "").replace(/^(?:business|personal|individual|group benefits?)\s*:\s*/i, "");
const splitOfferTopics = (value: string) => value.split(/[,;|\n\r]+/).filter((part) => !nonOfferIntakeLabel(part.trim())).flatMap((part) => {
  const normalized = canonicalServiceTopic(stripOfferLabel(part));
  const compound = normalized.split(/\s+and\s+/i).map(canonicalServiceTopic).filter(Boolean);
  return compound.length === 2 && compound.every((item) => item.split(/\s+/).length >= 2) ? compound : [normalized];
}).filter(Boolean);
const isInstruction = (value: string) => /^(find|explore|create|suggest|expand|generate)\b/i.test(value) && /\b(keywords?|topics?|ideas?)\b/i.test(value) && value.split(/\s+/).length > 6;
const unique = (values: string[], limit = 10) => [...new Map(splitKeywordEntries(values).map((value) => [value.toLowerCase(), value])).values()].filter((value) => value.length >= 3 && !isInstruction(value)).slice(0, limit);

export function isCustomerSearchKeyword(value: string) {
  const normalized = cleanTopic(value);
  if (!normalized || normalized.length > 120 || projectDirectionLanguage(normalized) || isInstruction(normalized)) return false;
  if (/\b(?:trustworthy|successful|high-converting)\b.*\b(?:website|brand|lead[ -]generation)\b/i.test(normalized)) return false;
  return true;
}

function customerFacingTopics(project: KeywordProjectInput, extraTopic?: string | null) {
  const direction = project.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status));
  const validTopics = (source?: string | null) => unique(splitOfferTopics(source ?? "").filter((item) => !monetizationMechanic(item) && isCustomerSearchKeyword(item)), 20);
  if (extraTopic) return validTopics(extraTopic);

  // A confirmed intake offer is authoritative. Do not blend the project goal,
  // AI idea title, or broad niche into it and turn those into keyword seeds.
  const intakeOffer = validTopics(project.businessProfile?.offerSummary);
  if (intakeOffer.length) return intakeOffer;
  const recommendedOffer = validTopics(direction?.recommendedOffer);
  if (recommendedOffer.length) return recommendedOffer;
  const selectedDirection = validTopics(direction?.name);
  if (selectedDirection.length) return selectedDirection;
  return validTopics(project.niche);
}

export function keywordIntakeSufficient(project: KeywordProjectInput) {
  return customerFacingTopics(project).length > 0;
}

export function buildKeywordGroups(project: KeywordProjectInput, extraTopic?: string | null) {
  // Industry/niche terms are discovery suggestions only. They enter the
  // governed keyword groups for user review; they do not become Website Plan
  // page owners unless the user approves them and runs Keyword Analysis.
  const offerTerms = customerFacingTopics(project, extraTopic).map((item) => item.toLowerCase());
  if (!offerTerms.length) return [];
  return [{
    category: "primary", title: "Primary Keywords", keywords: unique(offerTerms, 20),
    explanation: "Strategic Supporting Topics — intake seeds for provider research, not verified search-demand keywords.",
    expectedValue: "Research these topics in the selected markets before using demand to prioritize them.",
    goalSupport: `Supports the primary goal: ${clean(project.primaryGoal) || "business growth"}.`,
  }];
}

export function normalizeKeywordList(value: unknown) {
  return unique(splitKeywordEntries(value));
}
