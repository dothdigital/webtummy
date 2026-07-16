import { describe, expect, it } from "vitest";
import { keywordMarketKey, keywordMarketOptions, latestSuccessfulKeywordRuns, uniqueSerpDomains } from "./keyword-runs.js";

describe("keyword report scope", () => {
  it("uses only the latest completed run for each keyword, location, device and website", () => {
    const runs = [
      { websiteId: "site", seedKeyword: "CRM", locationName: "Toronto", device: "desktop", status: "completed", createdAt: "2026-07-15T10:00:00Z" },
      { websiteId: "site", seedKeyword: "crm", locationName: "Toronto", device: "desktop", status: "completed", createdAt: "2026-07-15T11:00:00Z" },
      { websiteId: "site", seedKeyword: "CRM", locationName: "Toronto", device: "desktop", status: "failed", createdAt: "2026-07-15T12:00:00Z" },
    ];
    expect(latestSuccessfulKeywordRuns(runs)).toEqual([runs[1]]);
  });

  it("counts unique SERP domains and excludes the project domain", () => {
    const domains = uniqueSerpDomains([
      { competitors: [{ domain: "www.example.com" }, { domain: "competitor.com" }] },
      { competitors: [{ domain: "competitor.com" }, { domain: "other.com" }] },
    ], "example.com");
    expect([...domains]).toEqual(["competitor.com", "other.com"]);
  });

  it("normalizes provider locations into reusable market filter options", () => {
    expect(keywordMarketKey("Toronto,Ontario,Canada")).toBe("toronto");
    expect(keywordMarketOptions([{ locationName: "Toronto,Ontario,Canada" }, { locationName: "Toronto, Ontario, Canada" }, { locationName: "Oakville, Ontario, Canada" }])).toEqual([
      { value: "oakville", label: "Oakville" },
      { value: "toronto", label: "Toronto" },
    ]);
  });
});
