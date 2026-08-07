import { describe, expect, it } from "vitest";
import { aiModelTierForFeature, defaultAiModelForFeature } from "./ai-model-policy.js";
import { config } from "./config.js";

describe("two-model AI policy", () => {
  it.each([
    "opportunity_refresh",
    "strategy_generate",
    "keyword_research_batch",
    "lead_magnet_research",
    "lead_magnet_generate",
    "growth_diagnosis",
    "ai_citation_scan",
  ])("routes %s to the research tier", (featureKey) => {
    expect(aiModelTierForFeature(featureKey)).toBe("research");
    expect(defaultAiModelForFeature(featureKey, "fallback-model")).toBe(config.openaiResearchModel);
  });

  it.each([
    "ai_content_generate",
    "website_page_generate",
    "social_calendar_generate",
    "execution_content_generate",
  ])("routes %s to the content tier", (featureKey) => {
    expect(aiModelTierForFeature(featureKey)).toBe("content");
    expect(defaultAiModelForFeature(featureKey, "fallback-model")).toBe(config.openaiContentModel);
  });

  it("preserves an explicit fallback for non-AI and future features", () => {
    expect(aiModelTierForFeature("future_provider_feature")).toBeNull();
    expect(defaultAiModelForFeature("future_provider_feature", "future-model")).toBe("future-model");
  });
});
