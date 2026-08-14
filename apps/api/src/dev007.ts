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
const shortAudience = (value: string) => {
  const first = value.split(/[,;|]/)[0]?.split(/\b(?:who|that|plus)\b/i)[0]?.trim() || "customers";
  const commonAudience = first.match(/\b(homeowners?|buyers?|sellers?|agencies|agents?|business owners?|consumers?|customers?|patients?|students?|professionals?)\b/i)?.[0];
  return commonAudience || first.split(/\s+/).slice(0, 6).join(" ");
};
const isInstruction = (value: string) => /^(find|explore|create|suggest|expand|generate)\b/i.test(value) && /\b(keywords?|topics?|ideas?)\b/i.test(value) && value.split(/\s+/).length > 6;
const unique = (values: string[]) => [...new Map(splitKeywordEntries(values).map((value) => [value.toLowerCase(), value])).values()].filter((value) => value.length >= 3 && !isInstruction(value)).slice(0, 10);

export function keywordIntakeSufficient(project: KeywordProjectInput) {
  const offer = clean(project.businessProfile?.offerSummary);
  const niche = clean(project.niche);
  const direction = project.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status));
  return Boolean(offer || niche || direction?.name);
}

export function buildKeywordGroups(project: KeywordProjectInput, extraTopic?: string | null) {
  const direction = project.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status));
  const profileOffer = clean(project.businessProfile?.offerSummary);
  const offerParts = profileOffer.split(/[,;|]/).map(cleanTopic).filter(Boolean);
  const profileIsOnlyMonetization = offerParts.length > 0 && offerParts.every(monetizationMechanic);
  const rawOffer = clean(extraTopic) || (profileIsOnlyMonetization ? clean(direction?.name) : profileOffer) || clean(direction?.recommendedOffer) || clean(direction?.name) || clean(project.name);
  // Industry/niche terms are discovery suggestions only. They enter the
  // governed keyword groups for user review; they do not become Website Plan
  // page owners unless the user approves them and runs Keyword Analysis.
  const offerTerms = unique([
    ...rawOffer.split(/[,;|]/),
    ...clean(project.niche).split(/[,;|]/),
  ].map(cleanTopic).filter(Boolean));
  const offer = offerTerms[0] || rawOffer;
  const audience = clean(project.businessProfile?.targetAudience) || "customers";
  const audienceTerm = shortAudience(audience).toLowerCase();
  const markets = list(project.targetLocations);
  const locations = unique([...markets, clean(project.businessLocation)].filter(Boolean));
  const goal = clean(project.primaryGoal) || "business growth";
  const secondaryGoals = list(project.secondaryGoals);
  const competitors = list(project.competitors);
  const businessType = clean(project.projectType);
  const topics = offerTerms.length ? offerTerms.map((item) => item.toLowerCase()) : [offer.toLowerCase()];
  const topic = topics[0];
  const softwareLike = /\b(?:software|platform|app|application|saas|marketplace|portal|tool)\b/i.test(topic);
  const rows: Record<string, string[]> = {
    primary: unique([...topics, `best ${topic}`, ...(softwareLike ? [`${topic} platform`] : [`${topic} services`])]),
    buyer_intent: unique(softwareLike
      ? [`best ${topic}`, `${topic} pricing`, `${topic} demo`, `${topic} reviews`, `${topic} for ${audienceTerm}`, `compare ${topic}`]
      : topics.flatMap((item) => [`buy ${item}`, `${item} company`, `${item} pricing`, `hire ${item}`])).slice(0, 10),
    local: locations.flatMap((location) => [`${topic} ${location}`, `${topic} near me ${location}`]),
    informational: [`how ${topic} works`, `${topic} guide`, `${topic} benefits`],
    supporting: softwareLike ? [`${topic} features`, `${topic} solutions`, `${topic} examples`, `${topic} alternatives`, ...competitors.map((competitor) => `${topic} vs ${competitor}`)] : [`${topic} strategy`, `${topic} solutions`, `${topic} examples`, ...secondaryGoals.map((secondaryGoal) => `${topic} ${secondaryGoal.toLowerCase()}`), ...competitors.map((competitor) => `${topic} vs ${competitor}`), businessType ? `${businessType.replaceAll("_", " ")} ${topic}` : ""],
    questions: [`what is ${topic}`, `how much does ${topic} cost`, `is ${topic} right for ${audienceTerm}`],
    long_tail: [`best ${topic} for ${audienceTerm}`, `${topic} pricing for ${audienceTerm}`, `how to choose ${topic}`],
  };
  return KEYWORD_GROUP_DEFINITIONS.map(([category, title]) => ({
    category, title, keywords: unique(rows[category]),
    explanation: `${title} are recommended from the project's offer, audience, selected direction, and target markets.`,
    expectedValue: category === "buyer_intent" ? "Prioritizes searches closest to a purchase or enquiry." : category === "local" ? "Connects the offer to the markets where customers are being targeted." : "Builds relevant search coverage around the project direction.",
    goalSupport: `Supports the primary goal: ${goal}.`,
  })).filter((group) => group.keywords.length > 0);
}

export function normalizeKeywordList(value: unknown) {
  return unique(splitKeywordEntries(value));
}
