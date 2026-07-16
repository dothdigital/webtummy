type SuccessfulKeywordRun = {
  websiteId?: string | null;
  seedKeyword: string;
  locationName: string;
  device: string;
  status: string;
  createdAt: string;
};

export function latestSuccessfulKeywordRuns<T extends SuccessfulKeywordRun>(runs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const key = [run.websiteId ?? "", run.seedKeyword.trim().toLowerCase(), run.locationName.trim().toLowerCase(), run.device].join("|");
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
