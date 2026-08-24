import { describe, expect, it } from "vitest";
import {
  approvedKeywordEntries,
  clusterKeywordDirections,
  expectedApprovedKeywordResearchChecks,
  incompleteApprovedKeywordResearchChecks,
  keywordResearchRequestIdentity,
  keywordResearchScopeKeywords,
  keywordTopicSimilarity,
  missingApprovedKeywordResearch,
  normalizeKeywordDirection,
  normalizeKeywordTopic,
  selectKeywordAnalysisLocations,
  splitKeywordEntries,
  stripKeywordLocationQualifiers,
  stripKeywordLocations,
  unresolvedApprovedKeywordResearchChecks,
} from "./keywordNormalization.js";

const markets = ["Brampton", "Mississauga", "Toronto", "Ontario"];

describe("shared keyword normalization", () => {
  it("uses only approved groups as governed downstream keyword evidence", () => {
    expect(approvedKeywordEntries([
      { status: "approved", keywords: ["Insurance CRM, Insurtech", "Policy Reminders."] },
      { status: "suggested", keywords: ["Niche-only suggestion"] },
      { status: "rejected", keywords: ["Rejected keyword"] },
    ])).toEqual(["Insurance CRM", "Insurtech", "Policy Reminders"]);
  });

  it("requires completed research for every approved keyword", () => {
    expect(missingApprovedKeywordResearch([
      { status: "approved", keywords: ["Insurance CRM", "Policy Reminders."] },
      { status: "suggested", keywords: ["Insurtech"] },
    ], [
      { status: "completed", seedKeyword: "insurance crm" },
      { status: "failed", seedKeyword: "Policy Reminders" },
    ])).toEqual(["Policy Reminders"]);
  });

  it("keeps an approved keyword incomplete while one market check is unresolved", () => {
    const groups = [{ status: "approved", keywords: ["physiotherapy clinic"] }];
    const runs = [
      { id: "done", status: "completed", seedKeyword: "physiotherapy clinic", locationName: "Mississauga, Ontario, Canada", languageCode: "en", device: "desktop", createdAt: "2026-08-04T10:00:00.000Z" },
      { id: "failed", status: "failed", seedKeyword: "physiotherapy clinic", locationName: "Milton, Ontario, Canada", languageCode: "en", device: "desktop", createdAt: "2026-08-04T10:01:00.000Z" },
    ];
    expect(unresolvedApprovedKeywordResearchChecks(groups, runs).map((run) => run.id)).toEqual(["failed"]);
    expect(missingApprovedKeywordResearch(groups, runs)).toEqual(["physiotherapy clinic"]);
  });

  it("clears an unresolved market check after a successful retry of the same pair", () => {
    const groups = [{ status: "approved", keywords: ["physiotherapy clinic"] }];
    const runs = [
      { id: "retry", status: "completed", seedKeyword: "physiotherapy clinic", locationName: "Milton, Ontario, Canada", languageCode: "en", device: "desktop", createdAt: "2026-08-04T10:02:00.000Z" },
      { id: "failed", status: "failed", seedKeyword: "physiotherapy clinic", locationName: "Milton, Ontario, Canada", languageCode: "en", device: "desktop", createdAt: "2026-08-04T10:01:00.000Z" },
    ];
    expect(unresolvedApprovedKeywordResearchChecks(groups, runs)).toEqual([]);
    expect(missingApprovedKeywordResearch(groups, runs)).toEqual([]);
  });

  it("keeps every approved keyword in the required analysis denominator", () => {
    const groups = [{ status: "approved", keywords: ["life insurance", "family financial planning"] }];
    const runs = [{ status: "completed", seedKeyword: "life insurance", locationName: "Edmonton, Alberta, Canada", languageCode: "en", device: "desktop" }];
    expect(keywordResearchScopeKeywords(groups, runs)).toEqual(["life insurance"]);
    expect(incompleteApprovedKeywordResearchChecks(groups, runs, ["Edmonton, Alberta, Canada"]).map((check) => check.keyword)).toEqual(["family financial planning"]);
    expect(missingApprovedKeywordResearch(groups, runs, ["Edmonton, Alberta, Canada"])).toEqual(["family financial planning"]);
  });

  it("requires the complete selected keyword-location matrix", () => {
    const groups = [{ status: "approved", keywords: ["physiotherapy clinic", "massage therapy Mississauga"] }];
    const locations = ["Mississauga, Ontario, Canada", "Brampton, Ontario, Canada"];
    const runs = [
      { status: "completed", seedKeyword: "physiotherapy clinic", locationName: "Mississauga, Ontario, Canada", languageCode: "en", device: "desktop", createdAt: "2026-08-04T10:00:00.000Z" },
      { status: "completed", seedKeyword: "massage therapy Mississauga", locationName: "Mississauga, Ontario, Canada", languageCode: "en", device: "desktop", createdAt: "2026-08-04T10:00:00.000Z" },
    ];
    expect(expectedApprovedKeywordResearchChecks(groups, locations).map((check) => `${check.keyword}|${check.location}`)).toEqual([
      "physiotherapy clinic|Mississauga, Ontario, Canada",
      "physiotherapy clinic|Brampton, Ontario, Canada",
      "massage therapy Mississauga|Mississauga, Ontario, Canada",
    ]);
    expect(incompleteApprovedKeywordResearchChecks(groups, runs, locations).map((check) => check.location)).toEqual(["Brampton, Ontario, Canada"]);
    expect(missingApprovedKeywordResearch(groups, runs, locations)).toEqual(["physiotherapy clinic"]);
  });

  it("treats each comma-separated value as a distinct keyword", () => {
    expect(splitKeywordEntries(["insurtech, Insurance CRM", "INSURTECH\nPolicy management", "Policy Reminders. services"])).toEqual([
      "insurtech",
      "Insurance CRM",
      "Policy management",
      "Policy Reminders services",
    ]);
  });

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

  it("keeps Big Idea seed keywords location-neutral while preserving their intent", () => {
    expect([
      "Mississauga physiotherapy clinic",
      "physiotherapy and rehabilitation clinic Mississauga",
      "registered massage therapist Mississauga",
      "custom orthotics Mississauga",
      "custom braces clinic Mississauga",
      "life insurance broker in Brampton",
    ].map((keyword) => stripKeywordLocationQualifiers(keyword, markets))).toEqual([
      "physiotherapy clinic",
      "physiotherapy and rehabilitation clinic",
      "registered massage therapist",
      "custom orthotics",
      "custom braces clinic",
      "life insurance broker",
    ]);
  });

  it("does not change a keyword when it contains no approved project geography", () => {
    expect(stripKeywordLocationQualifiers("sports injury rehabilitation", markets)).toBe("sports injury rehabilitation");
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
