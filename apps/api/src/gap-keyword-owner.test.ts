import { describe, expect, it } from "vitest";
import { isUtilityKeywordOwnerUrl, meaningfulKeywordOverlap } from "./gap-keyword-owner.js";

describe("Gap Analysis keyword owner safeguards", () => {
  it("excludes legal and transactional utility pages from inferred keyword ownership", () => {
    expect(isUtilityKeywordOwnerUrl("https://www.simahi.com/privacy-policy.html")).toBe(true);
    expect(isUtilityKeywordOwnerUrl("https://www.simahi.com/term-condition.html")).toBe(true);
    expect(isUtilityKeywordOwnerUrl("https://www.simahi.com/checkout/")).toBe(true);
    expect(isUtilityKeywordOwnerUrl("https://www.simahi.com/policy-management.html")).toBe(false);
  });

  it("does not treat one shared word as credible multi-term intent", () => {
    const overlap = meaningfulKeywordOverlap(
      ["policy", "management"],
      ["Privacy Policy", "Privacy Policy", "/privacy-policy.html"],
    );
    expect(overlap.matchedTerms).toEqual(["policy"]);
    expect(overlap.requiredMatches).toBe(2);
    expect(overlap.credible).toBe(false);
  });

  it("accepts a page that matches the complete two-term intent", () => {
    expect(meaningfulKeywordOverlap(
      ["policy", "management"],
      ["Insurance Policy Management", "Manage policies in one workspace"],
    ).credible).toBe(true);
  });
});
