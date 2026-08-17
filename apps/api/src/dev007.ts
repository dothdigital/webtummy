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
const shortAudience = (value: string) => {
  const first = value.split(/[,;|]/)[0]?.split(/\b(?:who|that|plus)\b/i)[0]?.trim() || "customers";
  const commonAudience = first.match(/\b(homeowners?|buyers?|sellers?|agencies|agents?|business owners?|consumers?|customers?|patients?|students?|professionals?)\b/i)?.[0];
  return commonAudience || first.split(/\s+/).slice(0, 6).join(" ");
};
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

const pluralTopic = (topic: string) => /\b(?:accounts|benefits|options|products|services|solutions)$/.test(topic);
const informationalKeywords = (topic: string) => [
  `${pluralTopic(topic) ? "how do" : "how does"} ${topic} work`,
  `${topic} guide`,
  `${topic} benefits`,
];
const buyerKeywords = (topic: string) => {
  if (/\binsurance\b/.test(topic)) return [`${topic} quotes`, `${topic} broker`, `${topic} advisor`, `compare ${topic} options`];
  if (/\b(?:financial planning|investment|rrsp|tfsa|fhsa)\b/.test(topic)) return [`${topic} services`, `${topic} advisor`, `best ${topic} advisor`, `${topic} consultation`];
  return [`best ${topic}`, `${topic} services`, `${topic} company`, `${topic} cost`];
};
const supportingKeywords = (topic: string) => {
  if (/\binsurance\b/.test(topic)) return [`${topic} options`, `${topic} coverage`, `${topic} eligibility`, `${topic} comparison`];
  if (/\b(?:financial planning|investment|rrsp|tfsa|fhsa)\b/.test(topic)) return [`${topic} options`, `${topic} fees`, `${topic} process`, `${topic} comparison`];
  return [`${topic} options`, `${topic} process`, `${topic} requirements`, `${topic} comparison`];
};
const questionKeywords = (topic: string) => [
  `${pluralTopic(topic) ? "what are" : "what is"} ${topic}`,
  pluralTopic(topic) ? `${topic} fees` : `how much does ${topic} cost`,
  `what to look for in ${topic}`,
];

export function keywordIntakeSufficient(project: KeywordProjectInput) {
  return customerFacingTopics(project).length > 0;
}

export function buildKeywordGroups(project: KeywordProjectInput, extraTopic?: string | null) {
  // Industry/niche terms are discovery suggestions only. They enter the
  // governed keyword groups for user review; they do not become Website Plan
  // page owners unless the user approves them and runs Keyword Analysis.
  const offerTerms = customerFacingTopics(project, extraTopic).map((item) => item.toLowerCase());
  if (!offerTerms.length) return [];
  const audience = clean(project.businessProfile?.targetAudience) || "customers";
  const audienceTerm = shortAudience(audience).toLowerCase();
  const markets = list(project.targetLocations);
  const locations = unique([...markets, clean(project.businessLocation)].filter(Boolean));
  const goal = clean(project.primaryGoal) || "business growth";
  const secondaryGoals = list(project.secondaryGoals);
  const competitors = list(project.competitors);
  const businessType = clean(project.projectType);
  const topics = offerTerms;
  const topic = topics[0];
  const softwareLike = /\b(?:software|platform|app|application|saas|marketplace|portal|tool)\b/i.test(topic);
  const rows: Record<string, string[]> = {
    primary: unique([...topics, ...(softwareLike ? [`${topic} platform`] : [])], 20),
    buyer_intent: unique(softwareLike
      ? [`best ${topic}`, `${topic} pricing`, `${topic} demo`, `${topic} reviews`, `${topic} for ${audienceTerm}`, `compare ${topic}`]
      : topics.flatMap(buyerKeywords)).slice(0, 10),
    local: unique(topics.flatMap((item) => locations.flatMap((location) => [`${item} ${location}`, `${item} near me ${location}`]))),
    informational: unique(topics.flatMap(informationalKeywords)),
    supporting: softwareLike ? [`${topic} features`, `${topic} solutions`, `${topic} examples`, `${topic} alternatives`, ...competitors.map((competitor) => `${topic} vs ${competitor}`)] : unique([...topics.flatMap(supportingKeywords), ...secondaryGoals.flatMap((secondaryGoal) => topics.map((item) => `${item} ${secondaryGoal.toLowerCase()}`)), ...competitors.flatMap((competitor) => topics.map((item) => `${item} vs ${competitor}`)), businessType ? `${businessType.replaceAll("_", " ")} ${topic}` : ""]),
    questions: unique(topics.flatMap(questionKeywords)),
    long_tail: unique(topics.flatMap((item) => [`${item} for ${audienceTerm}`, locations[0] ? `best ${item} in ${locations[0]}` : "", `how to choose ${item} provider`])),
  };
  return KEYWORD_GROUP_DEFINITIONS.map(([category, title]) => ({
    category, title, keywords: unique(rows[category], category === "primary" ? 20 : 10),
    explanation: `${title} are recommended from the confirmed intake products/services, audience, and target markets.`,
    expectedValue: category === "buyer_intent" ? "Prioritizes searches closest to a purchase or enquiry." : category === "local" ? "Connects the offer to the markets where customers are being targeted." : "Builds relevant search coverage around the project direction.",
    goalSupport: `Supports the primary goal: ${goal}.`,
  })).filter((group) => group.keywords.length > 0);
}

export function normalizeKeywordList(value: unknown) {
  return unique(splitKeywordEntries(value));
}
