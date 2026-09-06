import { describe, expect, it } from "vitest";
import { displaySearchProviderLocation, keywordIdeaRelevance, matchSearchProviderLocation, parseKeywordIdea, resolveExactSearchLocation, resolveSearchLocation, retryableSearchProviderError } from "./routes/keyword-research.js";

describe("keyword provider resilience", () => {
  it("retries transient provider and network failures", () => {
    expect(retryableSearchProviderError("Internal SE Server Error.")).toBe(true);
    expect(retryableSearchProviderError("request timed out")).toBe(true);
    expect(retryableSearchProviderError("fetch failed")).toBe(true);
  });

  it("does not retry invalid user input", () => {
    expect(retryableSearchProviderError("Invalid Field: location_name")).toBe(false);
    expect(retryableSearchProviderError("credentials are not configured")).toBe(false);
  });
});

describe("keyword metric normalization", () => {
  it("uses organic keyword difficulty rather than paid competition as SEO difficulty", () => {
    const idea = parseKeywordIdea({
      keyword: "insurance quoting tool",
      keyword_info: { search_volume: 70, competition: 0.61, competition_level: "HIGH", competition_index: 72, cpc: 4.25 },
      keyword_properties: { keyword_difficulty: 19 },
    });
    expect(idea).toMatchObject({ avgMonthlySearches: 70, competition: "HIGH", competitionIndex: 19, cpc: 4.25 });
  });

  it("keeps unavailable metrics null instead of converting them into zero values", () => {
    expect(parseKeywordIdea({ keyword: "insurance broker workflow" })).toMatchObject({
      avgMonthlySearches: null,
      competition: null,
      competitionIndex: null,
      cpc: null,
    });
  });

  it("rejects unrelated modifiers that only happen to contain a two-word seed", () => {
    expect(keywordIdeaRelevance("policy management", ["policy", "management"], "group policy management")).toBe(0);
    expect(keywordIdeaRelevance("policy management", ["policy", "management"], "policy management software")).toBeGreaterThan(0);
  });

  it("canonicalizes mixed Canadian city and province labels to provider metric codes", () => {
    expect(resolveSearchLocation("Edmonton, ON, Canada")).toMatchObject({
      displayName: "Edmonton,Alberta,Canada",
      locationType: "City",
      keywordMetrics: { location_code: 1001808 },
    });
    expect(resolveSearchLocation("Ontario, ON, Canada")).toMatchObject({
      displayName: "Ontario,Canada",
      locationType: "State",
      keywordMetrics: { location_code: 20121 },
    });
  });

  it("resolves arbitrary worldwide markets from the provider directory without guessing ambiguous cities", () => {
    const locations = [
      { location_code: 101, location_name: "London,England,United Kingdom", country_iso_code: "GB", location_type: "City" },
      { location_code: 102, location_name: "London,Ontario,Canada", country_iso_code: "CA", location_type: "City" },
      { location_code: 103, location_name: "Paris,Texas,United States", country_iso_code: "US", location_type: "City" },
      { location_code: 104, location_name: "Paris,Ile-de-France,France", country_iso_code: "FR", location_type: "City" },
    ];
    expect(matchSearchProviderLocation("London, United Kingdom", locations)?.location_code).toBe(101);
    expect(matchSearchProviderLocation("Paris", locations)).toBeNull();
    expect(matchSearchProviderLocation("Paris, France", locations)?.location_code).toBe(104);
  });

  it("prefers an exact city when the provider also returns municipality aliases", () => {
    const locations = [
      { location_code: 1002347, location_name: "Milton,Milton,Ontario,Canada", country_iso_code: "CA", location_type: "City" },
      { location_code: 9198780, location_name: "Milton,Ontario,Canada", country_iso_code: "CA", location_type: "Municipality" },
      { location_code: 1002371, location_name: "Oakville,Ontario,Canada", country_iso_code: "CA", location_type: "City" },
      { location_code: 9247889, location_name: "Oakville,Oakville,Ontario,Canada", country_iso_code: "CA", location_type: "Municipality" },
    ];
    expect(matchSearchProviderLocation("Milton, Ontario, Canada", locations)?.location_code).toBe(1002347);
    expect(matchSearchProviderLocation("Oakville, Ontario, Canada", locations)?.location_code).toBe(1002371);
  });

  it("removes repeated adjacent administrative labels from display names", () => {
    expect(displaySearchProviderLocation("Milton,Milton,Ontario,Canada")).toBe("Milton, Ontario, Canada");
    expect(displaySearchProviderLocation("Oakville,Ontario,Canada")).toBe("Oakville, Ontario, Canada");
  });

  it("rejects vague AI market labels before a provider request is queued", async () => {
    await expect(resolveExactSearchLocation("nearby neighbourhoods, Canada")).rejects.toThrow(/unambiguous provider location/i);
    await expect(resolveExactSearchLocation("surrounding areas")).rejects.toThrow(/unambiguous provider location/i);
  });
});
