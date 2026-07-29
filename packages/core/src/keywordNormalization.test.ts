import { describe, expect, it } from "vitest";
import {
  clusterKeywordDirections,
  keywordResearchRequestIdentity,
  keywordTopicSimilarity,
  normalizeKeywordDirection,
  normalizeKeywordTopic,
  selectKeywordAnalysisLocations,
  stripKeywordLocations,
} from "./keywordNormalization.js";

const markets = ["Brampton", "Mississauga", "Toronto", "Ontario"];

describe("shared keyword normalization", () => {
  it("maps provider and modifier variants to the same page topic", () => {
    expect(normalizeKeywordTopic("Insurance Agent and Broker", markets)).toBe("insurance provider");
    expect(normalizeKeywordTopic("Best Insurance professional", markets)).toBe("insurance provider");
    expect(normalizeKeywordTopic("Insurance Agency Near me", markets)).toBe("insurance provider");
    expect(keywordTopicSimilarity("Insurance Agent and Broker", "Best Insurance professional", markets)).toBe(100);
  });

  it("applies the same normalization rules outside the test industry", () => {
    expect(keywordTopicSimilarity(
      "Affordable custom software development company Toronto",
      "custom software development services",
      ["Toronto"],
    )).toBe(100);
    expect(keywordTopicSimilarity(
      "top emergency plumber near me",
      "emergency plumber services",
    )).toBe(100);
    expect(keywordTopicSimilarity(
      "emergency plumber",
      "drain cleaning",
    )).toBe(0);
  });

  it("keeps the original phrase and records why it is supporting", () => {
    expect(normalizeKeywordDirection("Best Insurance professional", markets)).toMatchObject({
      original: "Best Insurance professional",
      normalizedTopic: "insurance provider",
      detectedLocations: [],
      supportingModifiers: ["best", "professional"],
    });
  });

  it("presents raw approved phrases as primary topics with supporting variants", () => {
    expect(clusterKeywordDirections([
      "Insurance Agent and Broker",
      "Best Insurance professional",
      "Insurance Agency Near me",
      "Life Insurance",
      "life insurance provider",
      "Supervisa insurance",
      "supervisa services in Ontario",
    ], markets)).toEqual([
      {
        primaryKeyword: "Insurance Agent and Broker",
        normalizedTopic: "insurance provider",
        supportingKeywords: ["Best Insurance professional", "Insurance Agency Near me"],
        detectedLocations: [],
      },
      {
        primaryKeyword: "Life Insurance",
        normalizedTopic: "life insurance",
        supportingKeywords: ["life insurance provider"],
        detectedLocations: [],
      },
      {
        primaryKeyword: "super visa insurance",
        normalizedTopic: "super visa insurance",
        supportingKeywords: ["super visa services in Ontario"],
        detectedLocations: ["Ontario"],
      },
    ]);
  });

  it("removes only the selected geography from a provider seed", () => {
    expect(stripKeywordLocations("supervisa insurance in Brampton", markets)).toBe("super visa insurance");
    expect(stripKeywordLocations("life insurance provider", markets)).toBe("life insurance provider");
  });

  it("does not multiply a localized phrase across every selected market", () => {
    expect(selectKeywordAnalysisLocations("super visa insurance Brampton", markets)).toEqual(["Brampton"]);
    expect(selectKeywordAnalysisLocations("super visa insurance", markets)).toEqual(markets);
  });

  it("keeps non-geographic audience qualifiers as supporting phrases instead of page owners", () => {
    expect(normalizeKeywordTopic("AI technology startup in Tech startups", ["Uttarakhand"])).toBe("ai technology startup");
    expect(normalizeKeywordTopic("AI Solutions for growing businesses", ["Uttarakhand"])).toBe("ai solution");
    expect(clusterKeywordDirections([
      "AI technology startup",
      "best AI technology startup",
      "AI technology startup in Tech startups",
      "AI technology startup services",
    ], ["Uttarakhand"])).toEqual([{
      primaryKeyword: "AI technology startup",
      normalizedTopic: "ai technology startup",
      supportingKeywords: [
        "best AI technology startup",
        "AI technology startup in Tech startups",
        "AI technology startup services",
      ],
      detectedLocations: [],
    }]);
  });

  it("deduplicates formatting aliases without collapsing meaningful supporting phrases", () => {
    expect(keywordResearchRequestIdentity({
      keyword: "Supervisa Insurance",
      location: "Brampton, ON, Canada",
      languageCode: "EN",
      device: "desktop",
    })).toBe(keywordResearchRequestIdentity({
      keyword: "super visa insurance",
      location: "Brampton,Ontario,Canada",
      languageCode: "en",
      device: "Desktop",
    }));
    expect(keywordResearchRequestIdentity({
      keyword: "best super visa insurance",
      location: "Brampton",
    })).not.toBe(keywordResearchRequestIdentity({
      keyword: "super visa insurance",
      location: "Brampton",
    }));
  });
});
