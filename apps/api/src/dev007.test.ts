import { describe, expect, it } from "vitest";
import { buildKeywordGroups, keywordIntakeSufficient, normalizeKeywordList } from "./dev007.js";

describe("DEV-007 Keyword Intelligence", () => {
  const project = { name: "Acme SEO", niche: "Roofing", primaryGoal: "Generate More Leads", businessLocation: "Toronto", targetLocations: ["Toronto", "Mississauga"], businessProfile: { offerSummary: "Roof repair", targetAudience: "Homeowners" }, opportunities: [{ status: "selected", name: "Local lead growth" }] };
  it("uses intake rather than requiring a manual seed", () => expect(keywordIntakeSufficient(project)).toBe(true));
  it("creates distinct standard groups with local markets and goal explanations", () => {
    const groups = buildKeywordGroups(project);
    expect(new Set(groups.map((group) => group.category)).size).toBe(7);
    expect(groups.find((group) => group.category === "local")?.keywords).toContain("roof repair Toronto");
    expect(groups[0].goalSupport).toContain("Generate More Leads");
  });
  it("deduplicates manual keywords case-insensitively", () => expect(normalizeKeywordList(["Roof Repair", "roof repair", "Toronto roofer"])).toEqual(["roof repair", "Toronto roofer"]));
  it("treats every comma as a separate keyword", () => expect(normalizeKeywordList(["insurance crm, software, saas"])).toEqual(["insurance crm", "software", "saas"]));
  it("requests fallback input only when direction data is insufficient", () => expect(keywordIntakeSufficient({ name: "Untitled" })).toBe(false));
});
