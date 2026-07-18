import { describe, expect, it } from "vitest";
import { leadFunnelOptimizationRecommendations } from "./routes/lead-magnets.js";

describe("DEV-011C lead funnel optimization", () => {
  it("does not overstate performance before a useful traffic sample exists", () => {
    const rows = leadFunnelOptimizationRecommendations({ views: 20, optIns: 3, conversionRate: 15, openRate: 0, clickRate: 0 }, 5);
    expect(rows.some((row) => row.title.includes("reliable traffic sample"))).toBe(true);
  });

  it("recommends a conversion test when performance is below target", () => {
    const rows = leadFunnelOptimizationRecommendations({ views: 200, optIns: 4, conversionRate: 2, openRate: 40, clickRate: 1 }, 5);
    expect(rows.map((row) => row.title)).toContain("Test the headline and form friction");
    expect(rows.map((row) => row.title)).toContain("Strengthen the email next step");
  });

  it("keeps a healthy funnel stable and changes one variable at a time", () => {
    const rows = leadFunnelOptimizationRecommendations({ views: 500, optIns: 45, conversionRate: 9, openRate: 48, clickRate: 8 }, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toContain("one headline, CTA, or form variation");
  });
});
