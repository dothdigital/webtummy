import { describe, expect, it } from "vitest";
import { buildExtendedStrategyAnalysis } from "./dev014.js";

const base = { existingWebsite: true, businessName: "Acme", niche: "CRM software", goals: ["Generate More Leads"], markets: ["Toronto"], competitors: ["Example CRM"], keywordGroups: [{ title: "Buyer Intent", category: "buyer_intent", keywords: ["insurance crm", "best insurance crm"], gaps: ["insurance crm implementation"] }], pages: [{ url: "https://acme.test/", title: "Insurance CRM", wordCount: 500, inlinks: 0, brokenLinks: 2, weakAnchors: 1, orphan: true, indexable: true }], issues: [{ category: "links", severity: "high", message: "Broken internal links found" }] };

describe("DEV-014 extended Strategy Engine", () => {
  it("returns explainable, impact-ranked, applicable recommendations", () => {
    const result = buildExtendedStrategyAnalysis(base);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.every((item) => item.why && item.evidence.length && item.impact > 0)).toBe(true);
    expect(result.recommendations[0].impact).toBeGreaterThanOrEqual(result.recommendations.at(-1)!.impact);
  });

  it("does not recommend crawl budget optimization for a small healthy site", () => {
    const result = buildExtendedStrategyAnalysis(base);
    expect(result.analyses.find((item) => item.key === "crawl_budget")?.applicable).toBe(false);
    expect(result.recommendations.some((item) => item.analysisKey === "crawl_budget")).toBe(false);
  });

  it("detects cannibalization and internal-link equity signals", () => {
    const result = buildExtendedStrategyAnalysis({ ...base, keywordGroups: [...base.keywordGroups, { title: "Primary", category: "primary", keywords: ["insurance crm"], gaps: [] }] });
    expect(result.analyses.find((item) => item.key === "cannibalization")?.applicable).toBe(true);
    expect(result.analyses.find((item) => item.key === "internal_link_equity")?.applicable).toBe(true);
  });
});
