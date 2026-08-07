type SuccessfulKeywordRun = {
  projectId?: string | null;
  websiteId?: string | null;
  seedKeyword: string;
  locationName: string;
  device: string;
  status: string;
  createdAt: string;
  ideas?: Array<{ rawJson?: unknown }>;
};

function usesCountryFallback(run: SuccessfulKeywordRun): boolean {
  return Boolean(run.ideas?.some((idea) => {
    if (!idea.rawJson || typeof idea.rawJson !== "object" || Array.isArray(idea.rawJson)) return false;
    return (idea.rawJson as Record<string, unknown>).metricSource === "country_fallback";
  }));
}

export function latestSuccessfulKeywordRuns<T extends SuccessfulKeywordRun>(runs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const run of runs) {
    if (run.status !== "completed" || usesCountryFallback(run)) continue;
    // DataForSEO-normalized and legacy locations may represent the same market
    // as "Toronto, ON, Canada" and "Toronto,Ontario,Canada". The first segment
    // is the selected project market, so use it as the stable display identity.
    const market = run.locationName.split(",")[0]?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
    const key = [run.projectId ?? "", run.websiteId ?? "", run.seedKeyword.trim().toLowerCase(), market, run.device].join("|");
    const existing = latest.get(key);
    if (!existing || new Date(run.createdAt).getTime() > new Date(existing.createdAt).getTime()) latest.set(key, run);
  }
  return [...latest.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function uniqueSerpDomains<T extends { competitors?: Array<{ domain: string }> }>(runs: T[], ownDomain?: string | null) {
  const own = (ownDomain ?? "").replace(/^www\./, "").toLowerCase();
  return new Set(runs.flatMap((run) => (run.competitors ?? []).map((competitor) => competitor.domain.replace(/^www\./, "").toLowerCase()).filter((domain) => domain && domain !== own)));
}

export function keywordMarketKey(locationName: string) {
  return locationName.split(",")[0]?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

export function keywordMarketOptions<T extends { locationName: string }>(runs: T[]) {
  const options = new Map<string, string>();
  for (const run of runs) {
    const label = run.locationName.split(",")[0]?.replace(/\s+/g, " ").trim() ?? "";
    const key = keywordMarketKey(run.locationName);
    if (key && label && !options.has(key)) options.set(key, label);
  }
  return [...options.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function keywordOpportunityScore(volume: number | null | undefined, difficulty: number | null | undefined): number | null {
  if (volume == null || difficulty == null) return null;
  const volumeSignal = Math.min(100, Math.log10(volume + 1) * 32);
  const difficultySignal = Math.max(0, 100 - difficulty);
  return Math.round((volumeSignal + difficultySignal) / 2);
}
