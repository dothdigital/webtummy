import { beforeEach, describe, expect, it, vi } from "vitest";

const { centralAiJson } = vi.hoisted(() => ({ centralAiJson: vi.fn() }));
vi.mock("./central-ai-service.js", () => ({ centralAiJson }));

import { normalizeKeywordsWithAi } from "./ai-keyword-normalization.js";

describe("hybrid AI keyword normalization", () => {
  beforeEach(() => centralAiJson.mockReset());

  it("accepts an AI clarification only when it matches the original or an approved service", async () => {
    centralAiJson.mockResolvedValue({
      result: {
        keywords: [
          {
            original: "Vista",
            canonicalTopic: "Visitor Insurance",
            searchIntent: "commercial_service",
            reason: "The approved service evidence clarifies the ambiguous transcription.",
          },
          {
            original: "best life insurance provider",
            canonicalTopic: "Life Insurance",
            searchIntent: "comparison",
            reason: "Best and provider are supporting commercial modifiers.",
          },
        ],
      },
    });
    const result = await normalizeKeywordsWithAi({
      keywords: ["Vista", "best life insurance provider"],
      locations: ["Brampton"],
      services: ["Visitor Insurance", "Life Insurance"],
      industry: "Insurance brokerage",
    });
    expect(result.acceptedCount).toBe(2);
    expect(result.semanticKeywords).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: "Vista", canonicalTopic: "visitor insurance" }),
      expect.objectContaining({ keyword: "best life insurance provider", canonicalTopic: "life insurance" }),
    ]));
  });

  it("keeps deterministic protection when AI proposes an unsupported topic", async () => {
    centralAiJson.mockResolvedValue({
      result: {
        keywords: [{
          original: "life insurance",
          canonicalTopic: "Cryptocurrency Trading",
          searchIntent: "transactional",
          reason: "Unsupported semantic rewrite for the test.",
        }],
      },
    });
    const result = await normalizeKeywordsWithAi({
      keywords: ["life insurance"],
      locations: [],
      services: ["Life Insurance"],
    });
    expect(result.semanticKeywords).toHaveLength(0);
    expect(result.deterministicProtectedCount).toBe(1);
  });

  it("fails instead of silently falling back when AI omits approved phrases", async () => {
    centralAiJson.mockResolvedValue({ result: { keywords: [] } });
    await expect(normalizeKeywordsWithAi({
      keywords: ["life insurance"],
      locations: [],
      services: ["Life Insurance"],
    })).rejects.toMatchObject({ code: "ai_keyword_normalization_incomplete" });
  });
});
