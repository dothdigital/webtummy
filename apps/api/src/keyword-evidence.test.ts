import { describe, expect, it } from "vitest";
import { keywordEvidence, keywordEvidenceList, keywordIntent, isNaturalKeyword, isUnverifiedBrandServiceLocation } from "./keyword-evidence.js";
const idea = (volume: number | null = 20) => ({ keyword: "roof repair", avgMonthlySearches: volume, competitionIndex: 24, rawJson: {
  metricVersion: 5, provider: "dataforseo", languageCode: "en", metricScope: "Australia", checkedAt: "2026-09-12T00:00:00Z",
  keywordIdea: { keyword_properties: { keyword_difficulty: 24 } },
  locationMetric: { keyword: "roof repair", search_volume: volume },
} });
describe("keyword evidence contract", () => {
  it("traces each positive volume and verified zero to the matching provider response", () => {
    expect(keywordEvidence(idea())).toMatchObject({ avgMonthlySearches: 20, classification: "Verified Search Demand Keyword" });
    expect(keywordEvidence(idea(0))).toMatchObject({ avgMonthlySearches: 0, classification: "Strategic Supporting Topic" });
  });
  it("does not promote legacy, mismatched, empty or missing provider data to volume", () => {
    expect(keywordEvidence({ ...idea(), rawJson: {} }).avgMonthlySearches).toBeNull();
    expect(keywordEvidence({ ...idea(), avgMonthlySearches: 99 }).avgMonthlySearches).toBeNull();
    expect(keywordEvidence({ ...idea(), keyword: "roof repair Sydney" }).avgMonthlySearches).toBeNull();
    expect(keywordEvidence(idea(null))).toMatchObject({ avgMonthlySearches: null, growthOpportunity: null });
    expect(keywordEvidence({ ...idea(), rawJson: { ...idea().rawJson, locationMetric: { keyword: "roof repair", search_volume: "" } } }).avgMonthlySearches).toBeNull();
  });
  it("removes duplicates, synthetic seeds, URLs and malformed phrases", () => {
    const results = keywordEvidenceList([idea(), { ...idea(), keyword: "ROOF REPAIR" }, { ...idea(), keyword: "https://example.com" }, { ...idea(), keyword: "roof roof repair" }, { ...idea(), keyword: "synthetic seed", rawJson: { synthetic: true } }]);
    expect(results).toHaveLength(1);
    expect(isNaturalKeyword("réparation toiture")).toBe(true);
    expect(isNaturalKeyword("re-roofing projects services")).toBe(false);
    expect(isNaturalKeyword("digital marketing courses and guides company")).toBe(false);
  });
  it("keeps GSC impressions distinct from market search volume", () => {
    const result = keywordEvidence({ ...idea(null), rawJson: { ...idea(null).rawJson, gsc: { impressions: 350, position: 8.2 } } });
    expect(result).toMatchObject({ classification: "Existing Google Search Console Opportunity", avgMonthlySearches: null, currentRanking: 8.2 });
  });
  it("never derives search intent from paid competition", () => {
    expect(keywordIntent("how to repair a roof")).toBe("Informational");
    expect(keywordIntent("roof repair")).toBe("Unclassified");
  });
});

it("does not relabel a legacy paid competition index as organic difficulty", () => {
  expect(keywordEvidence({ ...idea(), rawJson: { ...idea().rawJson, keywordIdea: { keyword_info: { competition_index: 24 } } } }).competitionIndex).toBeNull();
});

it("blocks the reported brand/service/location assembly without blocking independently verified demand", () => {
  expect(isUnverifiedBrandServiceLocation("SEnuke AI Review Services in Australia", "SEnuke AI", ["Australia"], null)).toBe(true);
  expect(isUnverifiedBrandServiceLocation("SEnuke AI Review Services in Australia", "SEnuke AI", ["Australia"], 0)).toBe(true);
  expect(isUnverifiedBrandServiceLocation("roof repair Australia", "Roof Co", ["Australia"], 40)).toBe(false);
});
