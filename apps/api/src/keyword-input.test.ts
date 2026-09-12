import { describe, expect, it } from "vitest";
import { keywordBatchCountSchema, keywordListSchema, keywordGroupUpdateSchema, keywordExclusionListSchema } from "./keyword-input.js";

describe("large keyword sets", () => {
  const keywords = Array.from({ length: 151 }, (_, index) => `service keyword ${index}`);
  it("preserves all keywords during intake, group review, and suggestions", () => {
    expect(keywordListSchema.parse(keywords)).toEqual(keywords);
    expect(keywordGroupUpdateSchema.parse({ keywords }).keywords).toEqual(keywords);
    expect(keywordExclusionListSchema.parse(keywords)).toEqual(keywords);
  });
  it("allows a user to remove a keyword from a group that still exceeds 100", () => {
    const edited = keywords.slice(1);
    expect(keywordGroupUpdateSchema.parse({ keywords: edited }).keywords).toEqual(edited);
  });
  it("still rejects an empty group or invalid phrases", () => {
    expect(keywordGroupUpdateSchema.safeParse({ keywords: [] }).success).toBe(false);
    expect(keywordGroupUpdateSchema.safeParse({ keywords: [...keywords, ""] }).success).toBe(false);
    expect(keywordListSchema.safeParse([...keywords, "x".repeat(256)]).success).toBe(false);
    expect(keywordExclusionListSchema.safeParse([42]).success).toBe(false);
  });
});


describe("keyword research batch selection limit", () => {
  it("accepts 100 checks and rejects a 101st check with the calculation explained", () => {
    expect(keywordBatchCountSchema.parse(Array.from({ length: 100 }, () => ({})))).toHaveLength(100);
    const rejected = keywordBatchCountSchema.safeParse(Array.from({ length: 101 }, () => ({})));
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues[0].message).toContain("20 keywords × 5 locations = 100 checks");
    expect(keywordBatchCountSchema.safeParse([]).success).toBe(false);
  });
});
