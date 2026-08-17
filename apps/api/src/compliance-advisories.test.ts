import { describe, expect, it } from "vitest";
import { normalizeComplianceAdvisories } from "./compliance-advisories.js";

describe("compliance advisories", () => {
  it("keeps launch checks visible without treating AI blocking flags as gates", () => {
    expect(normalizeComplianceAdvisories([{
      area: "Insurance licensing and permitted activities",
      whyItMatters: "Published services must match the owner's authorization.",
      action: "Verify licence class and required disclosures.",
      blocking: true,
    }])).toEqual([{
      area: "Insurance licensing and permitted activities",
      whyItMatters: "Published services must match the owner's authorization.",
      action: "Verify licence class and required disclosures.",
      blocking: false,
    }]);
  });
});
