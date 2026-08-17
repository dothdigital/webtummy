import { describe, expect, it } from "vitest";
import { keywordMarketKey, keywordMarketOptions, keywordOpportunityScore, keywordRunsForProjectLocations, latestSuccessfulKeywordRuns, uniqueSerpDomains } from "./keyword-runs.js";

describe("keyword report scope", () => {
  it("uses only the latest completed run for each keyword, location, device and website", () => {
    const runs = [
      { websiteId: "site", seedKeyword: "CRM", locationName: "Toronto", device: "desktop", status: "completed", createdAt: "2026-07-15T10:00:00Z" },
      { websiteId: "site", seedKeyword: "crm", locationName: "Toronto", device: "desktop", status: "completed", createdAt: "2026-07-15T11:00:00Z" },
      { websiteId: "site", seedKeyword: "CRM", locationName: "Toronto", device: "desktop", status: "failed", createdAt: "2026-07-15T12:00:00Z" },
    ];
    expect(latestSuccessfulKeywordRuns(runs)).toEqual([runs[1]]);
  });

  it("never presents a country fallback as a successful local result", () => {
    const exact = { websiteId: "site", seedKeyword: "CRM", locationName: "Toronto,Ontario,Canada", device: "desktop", status: "completed", createdAt: "2026-07-15T10:00:00Z", ideas: [{ rawJson: { metricSource: "selected_location" } }] };
    const fallback = { ...exact, createdAt: "2026-07-15T11:00:00Z", ideas: [{ rawJson: { metricSource: "country_fallback" } }] };
    expect(latestSuccessfulKeywordRuns([exact, fallback])).toEqual([exact]);
  });

  it("counts unique SERP domains and excludes the project domain", () => {
    const domains = uniqueSerpDomains([
      { competitors: [{ domain: "www.example.com" }, { domain: "competitor.com" }] },
      { competitors: [{ domain: "competitor.com" }, { domain: "other.com" }] },
    ], "example.com");
    expect([...domains]).toEqual(["competitor.com", "other.com"]);
  });

  it("normalizes provider locations into reusable market filter options", () => {
    expect(keywordMarketKey("Toronto,Ontario,Canada")).toBe("toronto");
    expect(keywordMarketOptions([{ locationName: "Toronto,Ontario,Canada" }, { locationName: "Toronto, Ontario, Canada" }, { locationName: "Oakville, Ontario, Canada" }])).toEqual([
      { value: "oakville", label: "Oakville" },
      { value: "toronto", label: "Toronto" },
    ]);
  });

  it("does not retry a failed run from a location outside the current project markets", () => {
    const runs = [
      { locationName: "Mississauga, Ontario, Canada" },
      { locationName: "Edmonton, Alberta, Canada" },
      { locationName: "Calgary, Alberta, Canada" },
    ];
    expect(keywordRunsForProjectLocations(runs, ["Edmonton, Alberta, Canada", "Calgary, Alberta, Canada"])).toEqual([runs[1], runs[2]]);
    expect(keywordRunsForProjectLocations(runs, [])).toEqual([]);
  });

  it("does not invent an opportunity score from incomplete provider metrics", () => {
    expect(keywordOpportunityScore(10, null)).toBeNull();
    expect(keywordOpportunityScore(null, 20)).toBeNull();
    expect(keywordOpportunityScore(100, 20)).toBeTypeOf("number");
  });
});
