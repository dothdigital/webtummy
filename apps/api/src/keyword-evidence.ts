/** Evidence contract for the existing Keyword Intelligence flow. */
export const KEYWORD_EVIDENCE_VERSION = 5;
export const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
export function isNaturalKeyword(value: string): boolean {
  const words = value.trim().split(/\s+/u);
  return value.length >= 2 && value.length <= 160 && words.length <= 12
    && !/[<>\n\r{}]|https?:|www\./iu.test(value)
    && /[\p{L}\p{N}]/u.test(value)
    && !/\b(?:projects|guides)\s+(?:services|company|provider)\b/iu.test(value)
    && !/\b(\w+)\s+\1\b/iu.test(value);
}
export function isUnverifiedBrandServiceLocation(keyword: string, businessName: string | null | undefined, markets: string[], volume: number | null): boolean {
  if (!businessName || (volume != null && volume > 0)) return false;
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const phrase = normalize(keyword), brand = normalize(businessName);
  return Boolean(brand && phrase.startsWith(`${brand} `) && /\bservices?\b/.test(phrase.slice(brand.length))
    && markets.flatMap(market => market.split(",")).some(market => { const place = normalize(market); return place.length > 2 && phrase.endsWith(` ${place}`); }));
}

export function keywordIntent(keyword: string): string {
  if (/\b(buy|quote|book|hire|order|pricing|price|cost)\b/i.test(keyword)) return "Transactional";
  if (/\b(best|review|reviews|compare|comparison|vs|alternative)\b/i.test(keyword)) return "Commercial investigation";
  if (/\b(how|what|why|guide|tutorial|learn)\b/i.test(keyword)) return "Informational";
  return "Unclassified";
}
export function keywordEvidence<T extends { keyword: string; avgMonthlySearches: number | null; rawJson?: unknown; competitionIndex?: number | null }>(idea: T) {
  const evidence = record(idea.rawJson);
  const response = record(evidence.locationMetric);
  const info = record(response.keyword_info ?? record(response.keyword_data).keyword_info ?? response);
  const providerKeyword = response.keyword ?? record(response.keyword_data).keyword;
  const responseVolume = info.search_volume ?? info.avg_monthly_searches;
  const verified = evidence.metricVersion === KEYWORD_EVIDENCE_VERSION && evidence.provider === "dataforseo"
    && typeof evidence.checkedAt === "string" && Number.isFinite(Date.parse(evidence.checkedAt))
    && typeof evidence.languageCode === "string" && typeof evidence.metricScope === "string"
    && typeof providerKeyword === "string" && providerKeyword.trim().toLowerCase() === idea.keyword.trim().toLowerCase()
    && typeof responseVolume === "number" && Number.isInteger(responseVolume) && responseVolume >= 0
    && responseVolume === idea.avgMonthlySearches;
  const volume = verified ? idea.avgMonthlySearches : null;
  const discovery = record(evidence.keywordIdea);
  const properties = record(discovery.keyword_properties ?? record(discovery.keyword_data).keyword_properties);
  const difficulty = typeof properties.keyword_difficulty === "number" && properties.keyword_difficulty >= 0 && properties.keyword_difficulty <= 100 && properties.keyword_difficulty === idea.competitionIndex ? idea.competitionIndex : null;
  const classification = record(evidence.gsc).impressions > 0 ? "Existing Google Search Console Opportunity"
    : volume != null && volume > 0 ? "Verified Search Demand Keyword" : "Strategic Supporting Topic";
  return { ...idea, avgMonthlySearches: volume, competitionIndex: difficulty, classification, intent: evidence.intent ?? keywordIntent(idea.keyword),
    relevance: evidence.relevance ?? "Needs review", recommendedUse: evidence.recommendedUse ?? "Review as a supporting topic before planning",
    growthOpportunity: volume != null && volume > 0 && difficulty != null ? Math.round((Math.min(100, Math.log10(volume + 1) * 32) + Math.max(0, 100 - difficulty)) / 2) : null,
    currentRanking: record(evidence.gsc).position ?? null,
    trend: Array.isArray(info.monthly_searches) ? info.monthly_searches : null,
    evidence: { provider: evidence.provider ?? null, market: evidence.metricScope ?? null, language: evidence.languageCode ?? null, checkedAt: evidence.checkedAt ?? null, sourceFetchedAt: evidence.sourceFetchedAt ?? null, difficultyMarket: evidence.seoDifficultyScope ?? null, gsc: evidence.gsc ?? null },
  };
}
export function keywordEvidenceList<T extends { keyword: string; avgMonthlySearches: number | null; rawJson?: unknown; competitionIndex?: number | null }>(ideas: T[]) {
  const seen = new Set<string>();
  return ideas.filter(idea => {
    const key = idea.keyword.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    if (!isNaturalKeyword(idea.keyword) || seen.has(key) || record(idea.rawJson).synthetic || record(record(idea.rawJson).keywordIdea).synthetic) return false;
    seen.add(key);
    return true;
  }).map(keywordEvidence);
}
