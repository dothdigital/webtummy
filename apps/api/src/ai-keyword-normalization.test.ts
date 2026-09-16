import { beforeEach, describe, expect, it, vi } from "vitest";

const { centralAiJson } = vi.hoisted(() => ({ centralAiJson: vi.fn() }));
vi.mock("./central-ai-service.js", () => ({ centralAiJson }));

import { normalizeKeywordsWithAi } from "./ai-keyword-normalization.js";

describe("hybrid AI keyword normalization", () => {
  beforeEach(() => { centralAiJson.mockReset(); });

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
  it("reviews more than 100 approved keywords in bounded batches without dropping any", async () => {
    const keywords = Array.from({ length: 121 }, (_, index) => `specialist service ${index}`);
    centralAiJson.mockImplementation(async ({ prompt }) => {
      const batch = JSON.parse(prompt.split("Approved phrases to interpret:\n")[1].split("\n\nRules:")[0]) as string[];
      return { result: { keywords: batch.map((original) => ({ original, canonicalTopic: original, searchIntent: "commercial_service", reason: "Preserves the approved service topic." })) } };
    });
    const result = await normalizeKeywordsWithAi({ keywords, locations: [], services: [] });
    expect(centralAiJson).toHaveBeenCalledTimes(3);
    expect(result.reviewedCount).toBe(121);
    expect(result.semanticKeywords.map((entry) => entry.keyword)).toEqual(keywords);
  });

  it("ignores repeated and unsolicited AI rows without the 100-element error", async () => {
    const row = { original: "life insurance", canonicalTopic: "life insurance", searchIntent: "commercial_service", reason: "Preserves the approved service topic." };
    centralAiJson.mockResolvedValue({ result: { keywords: [...Array.from({ length: 101 }, () => row), { ...row, original: "unsolicited keyword" }] } });
    const result = await normalizeKeywordsWithAi({ keywords: ["life insurance"], locations: [], services: [] });
    expect(result.reviewedCount).toBe(1);
    expect(result.semanticKeywords.map((entry) => entry.keyword)).toEqual(["life insurance"]);
  });

});
