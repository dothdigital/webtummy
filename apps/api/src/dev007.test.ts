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
  it("suggests comma-separated niche terms individually for user approval", () => {
    const groups = buildKeywordGroups({ ...project, niche: "Insurtech, Insurance CRM" });
    expect(groups.find((group) => group.category === "primary")?.keywords).toEqual(expect.arrayContaining(["insurtech", "insurance crm"]));
    expect(groups.find((group) => group.category === "primary")?.keywords).not.toContain("insurtech, insurance crm");
  });
  it("deduplicates manual keywords case-insensitively", () => expect(normalizeKeywordList(["Roof Repair", "roof repair", "Toronto roofer"])).toEqual(["Roof Repair", "Toronto roofer"]));
  it("splits comma-separated keyword entries", () => expect(normalizeKeywordList(["insurance crm, software, saas"])).toEqual(["insurance crm", "software", "saas"]));
  it("requests fallback input only when direction data is insufficient", () => expect(keywordIntakeSufficient({ name: "Untitled" })).toBe(false));
  it("uses the selected customer-facing direction instead of monetization mechanics", () => {
    const groups = buildKeywordGroups({ ...project, niche: "Real estate technology, online auctions", businessProfile: { offerSummary: "Per-listing fee, paid seller package, success fee", targetAudience: "Homeowners who want to manage the sale themselves" }, opportunities: [{ status: "confirmed", name: "Self-serve homeowner auction software", recommendedOffer: "Per-listing fee" }] });
    const primary = groups.find((group) => group.category === "primary")?.keywords ?? [];
    const buyerIntent = groups.find((group) => group.category === "buyer_intent")?.keywords ?? [];
    expect(primary).toContain("self-serve homeowner auction software");
    expect(primary.join(" ")).not.toContain("per-listing fee");
    expect(buyerIntent).toContain("self-serve homeowner auction software pricing");
    expect(buyerIntent.join(" ")).not.toContain("hire self-serve homeowner auction software expert");
  });
});
