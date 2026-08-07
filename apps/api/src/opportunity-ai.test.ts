import { beforeEach, describe, expect, it, vi } from "vitest";

const { centralAiJson } = vi.hoisted(() => ({ centralAiJson: vi.fn() }));
vi.mock("./central-ai-service.js", () => ({ centralAiJson }));

import { aiOpportunityRecommendationSchema, generateAiOpportunityRecommendations } from "./opportunity-ai.js";

function recommendation(index: number) {
  return {
    name: `Business-specific opportunity ${index}`,
    businessModel: "Lead generation",
    targetAudience: "Verified buyers evaluating the supplied service",
    problemSolved: "Connects the verified audience need to a practical business outcome",
    recommendedOffer: `A focused service and conversion path ${index} grounded in the intake`,
    summary: "A distinct project direction with a clear reason, expected path, and validation requirement.",
    seoScore: 80 - index,
    competitionScore: 45 + index,
    monetizationScore: 82 - index,
    executionScore: 75 - index,
    userFitScore: 90 - index,
    opportunityScore: 84 - index,
    evidence: ["Verified business goal", "Verified target audience"],
    assumptions: ["Search demand will be validated during Keyword Intelligence"],
  };
}

describe("AI Opportunity Decision Engine", () => {
  beforeEach(() => centralAiJson.mockReset());

  it("uses AI as the generator while supplying rule candidates only as guardrails", async () => {
    centralAiJson.mockResolvedValue({
      result: aiOpportunityRecommendationSchema.parse({ analysisSummary: "The first direction has the strongest fit with the verified goal and audience.", recommendations: [recommendation(1), recommendation(2), recommendation(3)] }),
      model: "test-model",
      inputTokens: 100,
      outputTokens: 200,
    });

    const generated = await generateAiOpportunityRecommendations({
      businessBrain: { primaryGoal: "Generate leads", audience: "Insurance brokers" },
      projectContext: { location: "Canada" },
      ruleGuardrails: [{ name: "Rule reference" }],
      mode: "recommendation",
      model: "test-model",
    });

    expect(generated.result.recommendations).toHaveLength(3);
    const request = centralAiJson.mock.calls[0]?.[0];
    expect(request.system).toContain("Independently analyze");
    expect(request.prompt).toContain("avoid imitating them");
    expect(request.prompt).not.toContain('{"name":"Rule reference"}');
    expect(request.prompt).toContain("do not claim provider-backed keyword");
  });

  it("rejects an incomplete AI recommendation set", async () => {
    expect(() => aiOpportunityRecommendationSchema.parse({
      analysisSummary: "There is enough intake context to compare the initial business directions.",
      recommendations: [recommendation(1), recommendation(2)],
    })).toThrow();
  });

  it("normalizes an explanatory business model without discarding valid AI recommendations", () => {
    const recommendations = [recommendation(1), recommendation(2), recommendation(3)];
    recommendations[0].businessModel = "A productized lead-generation and workflow-improvement service for insurance brokerages that combines quoting automation, CRM adoption, and measurable sales enablement into one commercial engagement.";
    const parsed = aiOpportunityRecommendationSchema.parse({
      analysisSummary: "The recommendations use distinct offers and conversion mechanisms grounded in the supplied project evidence.",
      recommendations,
    });
    expect(parsed.recommendations[0].businessModel.length).toBeLessThanOrEqual(120);
    expect(parsed.recommendations[0].businessModel).toContain("productized lead-generation");
  });
});
