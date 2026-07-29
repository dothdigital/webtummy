export type KeywordLocationInput = {
  name: string;
  aliases?: string[];
};

export type NormalizedKeywordDirection = {
  original: string;
  normalizedPhrase: string;
  normalizedTopic: string;
  detectedLocations: string[];
  supportingModifiers: string[];
};

export type KeywordDirectionCluster = {
  primaryKeyword: string;
  normalizedTopic: string;
  supportingKeywords: string[];
  detectedLocations: string[];
};

const weakPageOwnerModifiers = new Set([
  "affordable", "best", "cheap", "cheapest", "closest", "leading", "local", "near", "nearby",
  "recommended", "review", "reviews", "top", "trusted",
]);

const providerModifiers = new Set([
  "agencies", "agency", "agent", "agents", "broker", "brokers", "companies", "company",
  "professional", "professionals", "provider", "providers",
]);

const topicStopWords = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "me", "my", "of", "on", "or", "the", "to", "with",
]);

const genericTopicTokens = new Set([
  "agency", "company", "professional", "provider", "service", "solution",
]);

const tokenAliases: Record<string, string> = {
  agencies: "provider",
  agency: "provider",
  agents: "provider",
  agent: "provider",
  advisers: "advisor",
  brokers: "provider",
  broker: "provider",
  companies: "provider",
  company: "provider",
  professionals: "provider",
  professional: "provider",
  providers: "provider",
  services: "service",
  solutions: "solution",
  supervisa: "super visa",
};

const nonGeographicAudienceQualifier = /\b(?:in|for|serving)\s+(?:(?:small|medium|large|local|growing|established|early[-\s]?stage|enterprise|tech|technology|saas|b2b|b2c)\s+){0,3}(?:startups?|business(?:es)?|companies|organizations|organisations|enterprises|teams|professionals|customers|clients|buyers|industries|agencies)\s*$/i;

/**
 * Audience and vertical phrases are valuable supporting context, but they do
 * not automatically deserve a separate indexable owner page. Geographic
 * qualifiers are removed separately using the approved project locations.
 */
export function stripNonGeographicAudienceQualifier(value: string): string {
  const cleaned = cleanKeywordPhrase(value);
  const stripped = cleaned.replace(nonGeographicAudienceQualifier, "").replace(/\s+/g, " ").trim();
  return stripped || cleaned;
}

export function cleanKeywordPhrase(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[“”]/g, "\"")
    .replace(/\bmississagua\b/gi, "Mississauga")
    .replace(/\bmississaunga\b/gi, "Mississauga")
    .replace(/\bsupervisa\b/gi, "super visa")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
    .trim();
}

export function normalizeKeywordPhrase(value: string): string {
  return cleanKeywordPhrase(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function locationNames(locations: Array<string | KeywordLocationInput>): Array<{ canonical: string; names: string[] }> {
  return locations
    .map((location) => typeof location === "string"
      ? { canonical: cleanKeywordPhrase(location.split(",")[0] ?? location), names: [location.split(",")[0] ?? location] }
      : { canonical: cleanKeywordPhrase(location.name), names: [location.name, ...(location.aliases ?? [])] })
    .filter((location) => location.canonical)
    .map((location) => ({
      canonical: location.canonical,
      names: [...new Set(location.names.map(normalizeKeywordPhrase).filter(Boolean))],
    }))
    .sort((left, right) => Math.max(...right.names.map((name) => name.length)) - Math.max(...left.names.map((name) => name.length)));
}

function containsWholePhrase(value: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "i").test(value);
}

export function detectKeywordLocations(
  keyword: string,
  locations: Array<string | KeywordLocationInput>,
): string[] {
  const normalized = normalizeKeywordPhrase(keyword);
  return locationNames(locations)
    .filter((location) => location.names.some((name) => containsWholePhrase(normalized, name)))
    .map((location) => location.canonical);
}

export function stripKeywordLocations(
  keyword: string,
  locations: Array<string | KeywordLocationInput>,
): string {
  let normalized = normalizeKeywordPhrase(keyword);
  for (const location of locationNames(locations)) {
    for (const name of location.names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      normalized = normalized.replace(new RegExp(`\\b(?:in|near|for|serving)?\\s*${escaped}\\b`, "gi"), " ");
    }
  }
  return normalized.replace(/\s+/g, " ").trim() || normalizeKeywordPhrase(keyword);
}

export function normalizeKeywordTopic(
  keyword: string,
  locations: Array<string | KeywordLocationInput> = [],
): string {
  let normalized = stripNonGeographicAudienceQualifier(stripKeywordLocations(keyword, locations))
    .replace(/\b(near me|around me|close to me|in my area)\b/g, " ");

  const output: string[] = [];
  for (const rawToken of normalized.split(/\s+/)) {
    if (!rawToken || topicStopWords.has(rawToken) || weakPageOwnerModifiers.has(rawToken)) continue;
    const aliased = tokenAliases[rawToken] ?? rawToken;
    for (const token of aliased.split(" ")) {
      if (!token || topicStopWords.has(token)) continue;
      // "Agency", "professional", and similar terms describe the provider.
      // Keep one canonical provider token so these variants can support the
      // same owner without erasing the underlying subject.
      if (providerModifiers.has(rawToken) && output.includes("provider")) continue;
      if (!output.includes(token)) output.push(token);
    }
  }
  return output.join(" ").trim() || normalized.trim() || normalizeKeywordPhrase(keyword);
}

export function keywordTopicTokens(
  keyword: string,
  locations: Array<string | KeywordLocationInput> = [],
): string[] {
  return normalizeKeywordTopic(keyword, locations).split(" ").filter(Boolean);
}

export function keywordTopicSimilarity(
  left: string,
  right: string,
  locations: Array<string | KeywordLocationInput> = [],
): number {
  const leftTokens = keywordTopicTokens(left, locations);
  const rightTokens = keywordTopicTokens(right, locations);
  const leftDistinctive = leftTokens.filter((token) => !genericTopicTokens.has(token));
  const rightDistinctive = rightTokens.filter((token) => !genericTopicTokens.has(token));
  // Generic words such as "insurance", "service", and "provider" should not
  // merge a broad category with a distinct product. If either side has a real
  // subject token, compare those subjects. Broad provider variants still fall
  // back to their full canonical token set.
  const a = new Set(leftDistinctive.length || rightDistinctive.length ? leftDistinctive : leftTokens);
  const b = new Set(leftDistinctive.length || rightDistinctive.length ? rightDistinctive : rightTokens);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return Math.round(intersection / new Set([...a, ...b]).size * 100);
}

export function normalizeKeywordDirection(
  keyword: string,
  locations: Array<string | KeywordLocationInput> = [],
): NormalizedKeywordDirection {
  const original = cleanKeywordPhrase(keyword);
  const normalizedPhrase = normalizeKeywordPhrase(original);
  const tokens = normalizedPhrase.split(" ");
  return {
    original,
    normalizedPhrase,
    normalizedTopic: normalizeKeywordTopic(original, locations),
    detectedLocations: detectKeywordLocations(original, locations),
    supportingModifiers: [...new Set(tokens.filter((token) =>
      weakPageOwnerModifiers.has(token) || providerModifiers.has(token) || token === "service" || token === "services",
    ))],
  };
}

/**
 * Produces the human-review view used before a page plan exists. Raw approved
 * phrases remain intact, but closely matching modifiers are placed beneath one
 * proposed owner topic. This is advisory grouping only; search-intent and SERP
 * evidence can still split a group during the full SEO page-planning pass.
 */
export function clusterKeywordDirections(
  keywords: string[],
  locations: Array<string | KeywordLocationInput> = [],
): KeywordDirectionCluster[] {
  const directions = [...new Map(keywords
    .map((keyword) => normalizeKeywordDirection(keyword, locations))
    .filter((direction) => direction.original)
    .map((direction) => [direction.normalizedPhrase, direction] as const)).values()];
  const groups: NormalizedKeywordDirection[][] = [];
  for (const direction of directions) {
    const group = groups.find((candidate) =>
      keywordTopicSimilarity(direction.normalizedTopic, candidate[0].normalizedTopic) >= 67,
    );
    if (group) group.push(direction);
    else groups.push([direction]);
  }
  return groups.map((group) => {
    const ranked = [...group].sort((left, right) =>
      left.supportingModifiers.length - right.supportingModifiers.length
      || left.detectedLocations.length - right.detectedLocations.length,
    );
    const primary = ranked[0];
    return {
      primaryKeyword: primary.original,
      normalizedTopic: primary.normalizedTopic,
      supportingKeywords: group
        .filter((direction) => direction.normalizedPhrase !== primary.normalizedPhrase)
        .map((direction) => direction.original),
      detectedLocations: [...new Set(group.flatMap((direction) => direction.detectedLocations))],
    };
  });
}

/**
 * A localized keyword is analyzed only in its named market. A non-localized
 * keyword is analyzed across the selected markets. This prevents a seed such
 * as "super visa insurance Brampton" from being cross-multiplied by Toronto,
 * Mississauga, and Brampton while keeping it available as a supporting phrase.
 */
export function selectKeywordAnalysisLocations(keyword: string, locations: string[]): string[] {
  const canonicalLocations = [...new Map(locations
    .map((location) => [normalizeKeywordPhrase(location.split(",")[0] ?? location), cleanKeywordPhrase(location)] as const)
    .filter(([key]) => Boolean(key))).values()];
  const detected = new Set(detectKeywordLocations(keyword, canonicalLocations).map(normalizeKeywordPhrase));
  if (!detected.size) return canonicalLocations;
  return canonicalLocations.filter((location) => detected.has(normalizeKeywordPhrase(location.split(",")[0] ?? location)));
}

export function keywordResearchRequestIdentity(input: {
  keyword: string;
  location: string;
  languageCode?: string;
  device?: string;
}): string {
  const market = normalizeKeywordPhrase(input.location.split(",")[0] ?? input.location);
  return [
    normalizeKeywordPhrase(input.keyword),
    market,
    normalizeKeywordPhrase(input.languageCode ?? "en"),
    normalizeKeywordPhrase(input.device ?? "desktop"),
  ].join("|");
}
