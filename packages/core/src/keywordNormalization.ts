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
    .replace(/([a-z0-9])\.(?=\s+[a-z0-9])/gi, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
    .trim();
}

/**
 * Converts keyword form values into individual search phrases. Commas,
 * semicolons, and line breaks are entry separators; spaces remain part of a
 * phrase, so "Insurance CRM" stays intact while
 * "insurtech, Insurance CRM" becomes two keywords.
 */
export function splitKeywordEntries(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value.flatMap((item) => splitKeywordEntries(item))
    : typeof value === "string"
      ? value.split(/[,;\r\n]+/)
      : [];
  const unique = new Map<string, string>();
  for (const entry of entries) {
    const cleaned = cleanKeywordPhrase(entry);
    const key = cleaned.toLocaleLowerCase();
    if (cleaned && !unique.has(key)) unique.set(key, cleaned);
  }
  return [...unique.values()];
}

export type KeywordGroupEvidenceInput = {
  status?: string | null;
  keywords?: unknown;
};

export type KeywordResearchEvidenceInput = {
  id?: string | null;
  seedKeyword?: string | null;
  status?: string | null;
  locationName?: string | null;
  languageCode?: string | null;
  device?: string | null;
  createdAt?: Date | string | null;
};

/**
 * Freezes readiness to the keyword set that was actually submitted once a
 * research batch exists. Later suggestions remain available for a separate
 * batch, but cannot silently enlarge a completed batch or block progression.
 */
export function keywordResearchScopeKeywords(
  groups: KeywordGroupEvidenceInput[],
  runs: KeywordResearchEvidenceInput[],
): string[] {
  const approved = approvedKeywordEntries(groups);
  const submitted = new Set(runs
    .map((run) => normalizeKeywordPhrase(run.seedKeyword ?? ""))
    .filter(Boolean));
  if (!submitted.size) return approved;
  const fixedScope = approved.filter((keyword) => submitted.has(normalizeKeywordPhrase(keyword)));
  return fixedScope.length ? fixedScope : approved;
}

export type KeywordResearchCheck = {
  keyword: string;
  location: string;
  languageCode: string;
  device: string;
  identity: string;
};

/**
 * The only keyword phrases permitted to govern downstream modules. Suggested,
 * rejected, ignored, and niche-only phrases are deliberately excluded.
 */
export function approvedKeywordEntries(groups: KeywordGroupEvidenceInput[]): string[] {
  return splitKeywordEntries(groups
    .filter((group) => group.status === "approved")
    .flatMap((group) => splitKeywordEntries(group.keywords)));
}

/**
 * Returns the latest failed/cancelled checks for approved keyword-location
 * pairs. A later successful retry replaces the older failure for that exact
 * pair; success in another market does not hide the unresolved check.
 */
export function unresolvedApprovedKeywordResearchChecks(
  groups: KeywordGroupEvidenceInput[],
  runs: KeywordResearchEvidenceInput[],
): KeywordResearchEvidenceInput[] {
  const approved = new Set(approvedKeywordEntries(groups).map(normalizeKeywordPhrase));
  const latest = [...runs]
    .filter((run) => approved.has(normalizeKeywordPhrase(run.seedKeyword ?? "")))
    .sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightTime - leftTime;
    })
    .reduce((checks, run) => {
      const identity = [
        normalizeKeywordPhrase(run.seedKeyword ?? ""),
        normalizeKeywordPhrase(run.locationName ?? ""),
        (run.languageCode ?? "").trim().toLowerCase(),
        (run.device ?? "").trim().toLowerCase(),
      ].join("::");
      if (!checks.has(identity)) checks.set(identity, run);
      return checks;
    }, new Map<string, KeywordResearchEvidenceInput>());
  return [...latest.values()].filter((run) => ["failed", "cancelled", "canceled"].includes((run.status ?? "").toLowerCase()));
}

/** Returns approved keywords that do not yet have complete governed analysis. */
export function missingApprovedKeywordResearch(
  groups: KeywordGroupEvidenceInput[],
  runs: KeywordResearchEvidenceInput[],
  locations: string[] = [],
): string[] {
  const requiredKeywords = keywordResearchScopeKeywords(groups, runs);
  const requiredGroups: KeywordGroupEvidenceInput[] = [{ status: "approved", keywords: requiredKeywords }];
  if (locations.length) {
    const latest = latestKeywordResearchChecks(runs);
    const incompleteKeywords = new Set(expectedApprovedKeywordResearchChecks(requiredGroups, locations)
      .filter((check) => latest.get(check.identity)?.status?.toLowerCase() !== "completed")
      .map((check) => normalizeKeywordPhrase(check.keyword)));
    return requiredKeywords.filter((keyword) => incompleteKeywords.has(normalizeKeywordPhrase(keyword)));
  }
  const completed = new Set(runs
    .filter((run) => !run.status || run.status === "completed")
    .map((run) => normalizeKeywordPhrase(run.seedKeyword ?? ""))
    .filter(Boolean));
  const unresolved = new Set(unresolvedApprovedKeywordResearchChecks(groups, runs)
    .map((run) => normalizeKeywordPhrase(run.seedKeyword ?? ""))
    .filter(Boolean));
  return requiredKeywords
    .filter((keyword) => {
      const normalized = normalizeKeywordPhrase(keyword);
      return !completed.has(normalized) || unresolved.has(normalized);
    });
}

export function expectedApprovedKeywordResearchChecks(
  groups: KeywordGroupEvidenceInput[],
  locations: string[],
  languageCode = "en",
  device = "desktop",
): KeywordResearchCheck[] {
  const canonicalLocations = [...new Map(locations
    .map(cleanKeywordPhrase)
    .filter(Boolean)
    .map((location) => [normalizeKeywordPhrase(location.split(",")[0] ?? location), location])).values()];
  return approvedKeywordEntries(groups).flatMap((keyword) =>
    selectKeywordAnalysisLocations(keyword, canonicalLocations).map((location) => ({
      keyword,
      location,
      languageCode,
      device,
      identity: keywordResearchRequestIdentity({ keyword, location, languageCode, device }),
    })),
  );
}

export function latestKeywordResearchChecks(runs: KeywordResearchEvidenceInput[]): Map<string, KeywordResearchEvidenceInput> {
  return [...runs]
    .sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightTime - leftTime;
    })
    .reduce((checks, run) => {
      const identity = keywordResearchRequestIdentity({
        keyword: run.seedKeyword ?? "",
        location: run.locationName ?? "",
        languageCode: run.languageCode ?? "en",
        device: run.device ?? "desktop",
      });
      if (!checks.has(identity)) checks.set(identity, run);
      return checks;
    }, new Map<string, KeywordResearchEvidenceInput>());
}

export function incompleteApprovedKeywordResearchChecks(
  groups: KeywordGroupEvidenceInput[],
  runs: KeywordResearchEvidenceInput[],
  locations: string[],
): KeywordResearchCheck[] {
  const latest = latestKeywordResearchChecks(runs);
  const requiredGroups: KeywordGroupEvidenceInput[] = [{ status: "approved", keywords: keywordResearchScopeKeywords(groups, runs) }];
  return expectedApprovedKeywordResearchChecks(requiredGroups, locations)
    .filter((check) => latest.get(check.identity)?.status?.toLowerCase() !== "completed");
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

function removableLocationPhrases(locations: Array<string | KeywordLocationInput>): string[] {
  const phrases = locations.flatMap((location) => {
    const values = typeof location === "string" ? [location] : [location.name, ...(location.aliases ?? [])];
    return values.flatMap((value) => {
      const cleaned = cleanKeywordPhrase(value);
      return [cleaned, ...cleaned.split(",").map((part) => cleanKeywordPhrase(part))];
    });
  });
  return [...new Set(phrases
    .map(normalizeKeywordPhrase)
    // Avoid stripping ambiguous two-character words such as "on" from a
    // normal phrase. Full city, province/state and country names remain safe.
    .filter((phrase) => phrase.length >= 3))]
    .sort((left, right) => right.length - left.length);
}

/**
 * Removes project geography from the human-facing keyword text while keeping
 * the service/search intent intact. Geography remains a separate research
 * dimension and is applied when Keyword Intelligence builds market requests.
 */
export function stripKeywordLocationQualifiers(
  keyword: string,
  locations: Array<string | KeywordLocationInput>,
): string {
  let cleaned = cleanKeywordPhrase(keyword);
  for (const phrase of removableLocationPhrases(locations)) {
    const escaped = phrase
      .split(" ")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    cleaned = cleaned.replace(
      new RegExp(`(?:\\b(?:in|near|around|for|serving|across|throughout)\\s+)?\\b${escaped}\\b`, "gi"),
      " ",
    );
  }
  return cleanKeywordPhrase(cleaned
    .replace(/\s*[,|/]+\s*/g, " ")
    .replace(/\s*[-–—:]\s*/g, " ")
    .replace(/^(?:(?:in|near|around|for|serving|across|throughout|and|or)\b\s*)+/i, "")
    .replace(/\s*\b(?:(?:in|near|around|for|serving|across|throughout|and|or))$/i, "")
    .replace(/\s+/g, " "));
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
  return normalizeKeywordPhrase(stripKeywordLocationQualifiers(keyword, locations)) || normalizeKeywordPhrase(keyword);
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
