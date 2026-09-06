import { describe, expect, it } from "vitest";
import { backlinkRiskFinding, buildAuthorityOpportunityDrafts, scoreAuthorityOpportunity } from "./authority-growth-engine.js";

describe("authority growth engine", () => {
  it("scores legitimate relevance-led opportunities without volume incentives", () => {
    const result = scoreAuthorityOpportunity({
      opportunityType: "research_asset",
      title: "Original benchmark",
      description: "Create cited original research.",
      valueExchange: "Useful evidence",
      sourceType: "project_research",
      topicalRelevanceScore: 95,
      businessRelevanceScore: 90,
      sourceQualityScore: 90,
      earningLikelihoodScore: 75,
      businessValueScore: 90,
      effortScore: 65,
      riskScore: 5,
      outreachRequired: true,
      estimatedValue: "high",
      evidence: {},
    });
    expect(result.priorityScore).toBeGreaterThan(75);
    expect(result.riskLabel).toBe("low_risk");
    expect(result.scoreReason).toContain("Priority");
  });

  it("keeps competitor gaps explicitly unconfirmed until sources are researched", () => {
    const results = buildAuthorityOpportunityDrafts({
      businessName: "Acme",
      niche: "insurance",
      audience: "Canadian visitors",
      primaryGoal: "qualified leads",
      targetMarkets: ["Canada"],
      competitors: ["Example Competitor"],
      approvedKeywords: ["visitor insurance"],
    });
    const gap = results.find((item) => item.opportunityType === "competitor_gap");
    expect(gap?.evidence.confirmedGap).toBe(false);
    expect(gap?.evidence.verificationRequired).toBe(true);
  });

  it("creates a review finding without declaring a backlink toxic or harmful", () => {
    const finding = backlinkRiskFinding({
      sourceUrl: "https://example.test/page",
      sourceDomain: "example.test",
      targetUrl: "https://business.test",
      providerRiskScore: 88,
    });
    expect(finding?.summary).toContain("not a declaration");
    expect(finding?.recommendedAction).toContain("Do not remove or disavow");
    expect(JSON.stringify(finding)).not.toMatch(/\btoxic\b/i);
  });
});
