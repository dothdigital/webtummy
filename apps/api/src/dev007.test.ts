import { describe, expect, it } from "vitest";
import { buildKeywordGroups, isCustomerSearchKeyword, keywordIntakeSufficient, normalizeKeywordList } from "./dev007.js";

describe("DEV-007 Keyword Intelligence", () => {
  const project = { name: "Acme SEO", niche: "Roofing", primaryGoal: "Generate More Leads", businessLocation: "Toronto", targetLocations: ["Toronto", "Mississauga"], businessProfile: { offerSummary: "Roof repair", targetAudience: "Homeowners" }, opportunities: [{ status: "selected", name: "Local lead growth" }] };
  it("uses intake rather than requiring a manual seed", () => expect(keywordIntakeSufficient(project)).toBe(true));
  it("creates distinct standard groups with local markets and goal explanations", () => {
    const groups = buildKeywordGroups(project);
    expect(new Set(groups.map((group) => group.category)).size).toBe(7);
    expect(groups.find((group) => group.category === "local")?.keywords).toContain("roof repair Toronto");
    expect(groups[0].goalSupport).toContain("Generate More Leads");
  });
  it("suggests comma-separated niche terms individually only when intake has no offer", () => {
    const groups = buildKeywordGroups({ ...project, niche: "Insurtech, Insurance CRM", businessProfile: { offerSummary: null, targetAudience: "Insurance agencies" }, opportunities: [] });
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
  it("keeps the confirmed intake offer authoritative over niche and AI direction text", () => {
    const groups = buildKeywordGroups({
      ...project,
      niche: "Insurance, Build a trustworthy brand and lead-generation website",
      businessProfile: { offerSummary: "Life insurance, critical illness coverage", targetAudience: "Families" },
      opportunities: [{ status: "confirmed", name: "Build a trustworthy insurance website", recommendedOffer: "Website lead generation" }],
    });
    expect(groups.find((group) => group.category === "primary")?.keywords).toEqual(["life insurance", "critical illness coverage"]);
  });
  it("does not turn a website-build objective into customer keywords", () => {
    const groups = buildKeywordGroups({
      name: "Insurance website project",
      niche: "Insurance, Financial planning and registered investment products, Build a trustworthy insurance brand and lead-generation website",
      primaryGoal: "Build New Website",
      businessLocation: "Edmonton",
      targetLocations: ["Edmonton"],
      businessProfile: {
        offerSummary: "Insurance, financial planning and registered investment products",
        targetAudience: "Edmonton-area families",
      },
      opportunities: [{ status: "selected", name: "Build a trustworthy insurance brand and lead-generation website" }],
    });
    const keywords = groups.flatMap((group) => group.keywords);
    expect(groups.find((group) => group.category === "primary")?.keywords).toEqual(["insurance", "financial planning", "registered investment products"]);
    expect(groups.find((group) => group.category === "buyer_intent")?.keywords).toEqual(expect.arrayContaining(["insurance quotes", "insurance broker", "financial planning advisor"]));
    expect(keywords.some((keyword) => /build a|lead-generation website|hire insurance|buy insurance|insurance pricing/.test(keyword))).toBe(false);
    expect(isCustomerSearchKeyword("Build a trustworthy insurance brand and lead-generation website")).toBe(false);
  });
  it("uses the complete insurance and investment service list from intake", () => {
    const groups = buildKeywordGroups({
      name: "Insurance project",
      primaryGoal: "Build New Website",
      targetLocations: ["Alberta"],
      businessProfile: {
        offerSummary: "Life Insurance, Critical Illness Insurance, Income Protection Insurance, RRSPs, TFSAs, FHSAs, RRIF, Open Investment Accounts, Key Person Insurance, Buy/Sell Agreements, Business Interruption Insurance, Group Health Benefits, Group Investment Benefits",
        targetAudience: "Alberta individuals and business owners",
      },
      opportunities: [{ status: "confirmed", name: "Create service-specific pages with educational explanations and structured follow-up", recommendedOffer: "Consultation request" }],
    });
    const primary = groups.find((group) => group.category === "primary")?.keywords ?? [];
    expect(primary).toEqual(expect.arrayContaining(["life insurance", "critical illness insurance", "income protection insurance", "rrsp", "tfsa", "fhsa", "rrif", "open investment accounts", "key person insurance", "buy/sell agreements", "business interruption insurance", "group health benefits", "group investment benefits"]));
    expect(groups.flatMap((group) => group.keywords).some((keyword) => /service-specific pages|educational explanations|consultation request|structured follow-up/.test(keyword))).toBe(false);
  });
  it("understands labelled multiline services and does not treat audience or location as services", () => {
    const groups = buildKeywordGroups({
      name: "Insurance project",
      targetLocations: ["Alberta"],
      businessProfile: {
        offerSummary: "Services you are offering to your clients\nLife Insurance\nCritical Illness Insurance\nBusiness: Key Person Insurance\nTarget audience: Alberta families and business owners\nLocation: Alberta",
        targetAudience: "Alberta families and business owners",
      },
    });
    const primary = groups.find((group) => group.category === "primary")?.keywords ?? [];
    expect(primary).toEqual(expect.arrayContaining(["life insurance", "critical illness insurance", "key person insurance"]));
    expect(primary.some((keyword) => /target audience|alberta families|location/.test(keyword))).toBe(false);
  });
  it("does not strip the word service from a real service name", () => {
    const groups = buildKeywordGroups({ name: "Consulting project", businessProfile: { offerSummary: "Service design", targetAudience: "Product teams" } });
    expect(groups.find((group) => group.category === "primary")?.keywords).toContain("service design");
  });
  it("requires a real customer-facing offer rather than a generic growth direction", () => {
    expect(keywordIntakeSufficient({ name: "Acme", opportunities: [{ status: "selected", name: "Local lead growth" }] })).toBe(false);
  });
});
