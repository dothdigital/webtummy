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
const isInstruction = (value: string) => /^(find|explore|create|suggest|expand|generate)\b/i.test(value) && /\b(keywords?|topics?|ideas?)\b/i.test(value) && value.split(/\s+/).length > 6;
const unique = (values: string[]) => [...new Map(values.map((value) => [value.toLowerCase(), value])).values()].filter((value) => value.length >= 3 && !isInstruction(value)).slice(0, 10);

export function keywordIntakeSufficient(project: KeywordProjectInput) {
  const offer = clean(project.businessProfile?.offerSummary);
  const niche = clean(project.niche);
  const direction = project.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status));
  return Boolean(offer || niche || direction?.name);
}

export function buildKeywordGroups(project: KeywordProjectInput, extraTopic?: string | null) {
  const rawOffer = clean(extraTopic) || clean(project.businessProfile?.offerSummary) || clean(project.niche) || clean(project.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status))?.recommendedOffer) || clean(project.name);
  const offerTerms = unique(rawOffer.split(/[,;|]/).map((item) => clean(item)).filter(Boolean));
  const offer = offerTerms[0] || rawOffer;
  const audience = clean(project.businessProfile?.targetAudience) || "customers";
  const markets = list(project.targetLocations);
  const locations = unique([...markets, clean(project.businessLocation)].filter(Boolean));
  const goal = clean(project.primaryGoal) || "business growth";
  const secondaryGoals = list(project.secondaryGoals);
  const competitors = list(project.competitors);
  const businessType = clean(project.projectType);
  const topics = offerTerms.length ? offerTerms.map((item) => item.toLowerCase()) : [offer.toLowerCase()];
  const topic = topics[0];
  const rows: Record<string, string[]> = {
    primary: unique([...topics, `best ${topic}`, `${topic} services`]),
    buyer_intent: unique(topics.flatMap((item) => [`buy ${item}`, `${item} company`, `${item} pricing`, `hire ${item} expert`])).slice(0, 10),
    local: locations.flatMap((location) => [`${topic} ${location}`, `${topic} near me ${location}`]),
    informational: [`how does ${topic} work`, `${topic} guide`, `${topic} benefits`],
    supporting: [`${topic} strategy`, `${topic} solutions`, `${topic} examples`, ...secondaryGoals.map((secondaryGoal) => `${topic} ${secondaryGoal.toLowerCase()}`), ...competitors.map((competitor) => `${topic} vs ${competitor}`), businessType ? `${businessType.replaceAll("_", " ")} ${topic}` : ""],
    questions: [`what is ${topic}`, `how much does ${topic} cost`, `which ${topic} is best for ${audience.toLowerCase()}`],
    long_tail: [`best ${topic} for ${audience.toLowerCase()}`, `affordable ${topic} for ${audience.toLowerCase()}`, `${topic} to ${goal.toLowerCase()}`],
  };
  return KEYWORD_GROUP_DEFINITIONS.map(([category, title]) => ({
    category, title, keywords: unique(rows[category]),
    explanation: `${title} are recommended from the project's offer, audience, selected direction, and target markets.`,
    expectedValue: category === "buyer_intent" ? "Prioritizes searches closest to a purchase or enquiry." : category === "local" ? "Connects the offer to the markets where customers are being targeted." : "Builds relevant search coverage around the project direction.",
    goalSupport: `Supports the primary goal: ${goal}.`,
  })).filter((group) => group.keywords.length > 0);
}

export function normalizeKeywordList(value: unknown) {
  return unique(list(value).flatMap((item) => item.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean)));
}
