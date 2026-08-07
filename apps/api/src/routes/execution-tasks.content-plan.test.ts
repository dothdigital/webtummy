import { describe, expect, it, vi } from "vitest";

vi.mock("../queue.js", () => ({
  websiteBuilderQueue: { add: vi.fn() },
  crawlQueue: { add: vi.fn() },
  keywordResearchQueue: { add: vi.fn() },
}));

import { contentPlanFor, includeEveryCrawledPageInContentPlan, reconcileAiWebsitePlanBatch, repairContentPlanPageIdentities, websitePlanEvidencePages } from "./execution-tasks.js";

const baseInput = {
  projectName: "Growth Project",
  businessName: "Example Insurance",
  goal: "Generate qualified leads",
  markets: ["Brampton", "Toronto"],
  keywords: ["Super Visa Insurance", "Life Insurance"],
  offer: "Insurance services",
  audience: "Individuals and families comparing insurance options",
  contentStrategy: null,
  localSeoEnabled: true,
  keywordSignals: [
    { keyword: "Super Visa Insurance", location: "Brampton", searchVolume: 700, competitionIndex: 58, competitorCount: 8 },
    { keyword: "Life Insurance", location: "Brampton", searchVolume: 1200, competitionIndex: 64, competitorCount: 10 },
    { keyword: "Super Visa Insurance", location: "Toronto", searchVolume: 1800, competitionIndex: 72, competitorCount: 12 },
    { keyword: "Life Insurance", location: "Toronto", searchVolume: 2500, competitionIndex: 75, competitorCount: 14 },
  ],
  services: ["Super Visa Insurance", "Life Insurance"],
  serviceAvailability: [
    { service: "Super Visa Insurance", location: "Brampton", available: true, verified: true },
    { service: "Life Insurance", location: "Brampton", available: true, verified: true },
    { service: "Super Visa Insurance", location: "Toronto", available: true, verified: true },
    { service: "Life Insurance", location: "Toronto", available: true, verified: true },
  ],
  localEvidence: [
    { id: "brampton-proof", location: "Brampton", type: "approved local service evidence", verified: true },
    { id: "toronto-proof", location: "Toronto", type: "approved local service evidence", verified: true },
  ],
};

describe("AI Location Authority Planner", () => {
  it("does not expose old crawl pages to a New Website plan", () => {
    const oldCrawlPages = [{ url: "https://old.example.com/about.html" }];
    expect(websitePlanEvidencePages(true, oldCrawlPages)).toEqual([]);
    expect(websitePlanEvidencePages(false, oldCrawlPages)).toEqual(oldCrawlPages);
  });

  it("classifies every crawled canonical page in the SEO Page Map before Website Development", () => {
    const pages = [
      { url: "https://example.com/physiotherapy.html", title: "Physiotherapy", h1: "Physiotherapy" },
      { url: "https://example.com/contact-us.html", title: "Physiotherapy", h1: "Physiotherapy" },
      { url: "https://example.com/our-team.html", title: "Physiotherapy", h1: "Physiotherapy" },
      { url: "https://example.com/faq.html", title: "Physiotherapy", h1: "Physiotherapy" },
      { url: "https://example.com/payment-insurance.html", title: "Physiotherapy", h1: "Physiotherapy" },
    ];
    const basePlan = contentPlanFor({
      ...baseInput,
      businessName: "Procare Physio",
      markets: [],
      keywords: ["Physiotherapy"],
      services: ["Physiotherapy"],
      localSeoEnabled: false,
      websiteUrl: "https://example.com",
      websitePages: pages,
      keywordSignals: [],
      serviceAvailability: [],
      localEvidence: [],
    });
    const plan = includeEveryCrawledPageInContentPlan(basePlan, pages, "Procare Physio");
    expect(plan.pageAssignments.map((assignment) => assignment.targetUrl)).toEqual(expect.arrayContaining(pages.map((page) => page.url)));
    const contact = plan.pageAssignments.find((assignment) => assignment.targetUrl.endsWith("contact-us.html"));
    expect(contact?.pageName).toBe("Contact Us");
    expect(contact?.canonicalKeyword).not.toBe("Physiotherapy");
    expect(["navigational", "transactional"]).toContain(contact?.searchIntent);
    expect(plan.pageAssignments.find((assignment) => assignment.targetUrl.endsWith("our-team.html"))).toMatchObject({ canonicalKeyword: "Procare Physio team", searchIntent: "navigational" });
    expect(plan.pageAssignments.find((assignment) => assignment.targetUrl.endsWith("faq.html"))).toMatchObject({ canonicalKeyword: "Procare Physio frequently asked questions", searchIntent: "informational" });
    expect(plan.pageAssignments.find((assignment) => assignment.targetUrl.endsWith("payment-insurance.html"))).toMatchObject({ canonicalKeyword: "Procare Physio payment and insurance information", searchIntent: "informational" });
    expect(plan.pageAssignments.filter((assignment) => assignment.canonicalKeyword === "Physiotherapy")).toHaveLength(1);
  });

  it("creates a complete evidence-sized cluster for every location on a new website", () => {
    const plan = contentPlanFor({
      ...baseInput,
      websiteUrl: null,
      websitePages: [],
    });

    expect(plan.locationAuthorityClusters.map((cluster) => cluster.location)).toEqual(["Brampton", "Toronto"]);
    expect(plan.advancedSeoIntelligence.engines.find((engine) => engine.key === "local_authority")?.status).toBe("ready");
    expect(plan.advancedSeoIntelligence.engines.find((engine) => engine.key === "content_decay")?.status).toBe("awaiting_performance");
    for (const cluster of plan.locationAuthorityClusters) {
      const pages = plan.pageAssignments.filter((page) => page.clusterKey === cluster.clusterKey);
      expect(pages).toHaveLength(cluster.requiredPageCount);
      expect(pages.some((page) => page.clusterRole === "location_hub")).toBe(true);
      expect(pages.filter((page) => page.clusterRole === "service")).toHaveLength(2);
      expect(new Set(pages.map((page) => page.pageKey)).size).toBe(pages.length);
      expect(pages.filter((page) => page.clusterRole === "supporting")).toHaveLength(0);
      expect(pages.every((page) => page.source === "suggested")).toBe(true);
      expect(new Set(pages.map((page) => page.targetUrl)).size).toBe(pages.length);
    }
  });

  it("assigns every approved local service its own planner page key", () => {
    const plan = contentPlanFor({
      ...baseInput,
      markets: ["Ontario"],
      keywords: ["Insurance Agent and Broker", "Life Insurance", "Super Visa Insurance", "Business Insurance"],
      services: ["Insurance Agent and Broker", "Life Insurance", "Super Visa Insurance", "Business Insurance"],
      websiteUrl: null,
      websitePages: [],
      keywordSignals: [
        { keyword: "Insurance Agent and Broker", location: "Ontario", searchVolume: 800, competitionIndex: 50, competitorCount: 8 },
        { keyword: "Life Insurance", location: "Ontario", searchVolume: 1200, competitionIndex: 55, competitorCount: 9 },
        { keyword: "Super Visa Insurance", location: "Ontario", searchVolume: 900, competitionIndex: 52, competitorCount: 8 },
        { keyword: "Business Insurance", location: "Ontario", searchVolume: 700, competitionIndex: 48, competitorCount: 7 },
      ],
      serviceAvailability: [
        { service: "Insurance Agent and Broker", location: "Ontario", available: true, verified: true },
        { service: "Life Insurance", location: "Ontario", available: true, verified: true },
        { service: "Super Visa Insurance", location: "Ontario", available: true, verified: true },
        { service: "Business Insurance", location: "Ontario", available: true, verified: true },
      ],
      localEvidence: [
        { id: "ontario-proof", location: "Ontario", type: "approved local service evidence", verified: true },
      ],
    });
    const localServices = plan.pageAssignments.filter((page) => page.location === "Ontario" && page.clusterRole === "service");
    expect(localServices).toHaveLength(4);
    expect(new Set(localServices.map((page) => page.pageKey)).size).toBe(localServices.length);
    expect(localServices.map((page) => page.canonicalKeyword)).toEqual(expect.arrayContaining([
      "Insurance Agent and Broker Ontario",
      "Life Insurance Ontario",
      "Super Visa Insurance Ontario",
      "Business Insurance Ontario",
    ]));
  });

  it("uses approved keywords—not a comma-separated niche—to create Website Plan owners", () => {
    const plan = contentPlanFor({
      ...baseInput,
      markets: ["Toronto"],
      keywords: ["Insurance CRM"],
      offer: "Insurtech, Insurance CRM",
      businessType: "Insurtech, Insurance CRM",
      services: ["Insurance CRM", "Unapproved Automation Platform"],
      websiteUrl: null,
      websitePages: [],
      keywordSignals: [
        { keyword: "Insurance CRM", location: "Toronto", searchVolume: 500, competitionIndex: 45, competitorCount: 8 },
      ],
      serviceAvailability: [
        { service: "Insurance CRM", location: "Toronto", available: true, verified: true },
      ],
      localEvidence: [
        { id: "toronto-proof", location: "Toronto", type: "approved local service evidence", verified: true },
      ],
    });
    const suggestedOwners = plan.pageAssignments.filter((page) => page.source === "suggested");
    expect(suggestedOwners.every((page) => !page.canonicalKeyword.includes(","))).toBe(true);
    expect(suggestedOwners.some((page) => /unapproved automation/i.test(page.canonicalKeyword))).toBe(false);
    expect(plan.pageAssignments.find((page) => page.clusterRole === "location_hub")?.canonicalKeyword).toBe("Insurance CRM services in Toronto");
  });

  it("repairs duplicate page keys and intent owners in an older saved plan", () => {
    const plan = contentPlanFor({
      ...baseInput,
      markets: ["Brampton"],
      websiteUrl: null,
      websitePages: [],
    });
    const localServices = plan.pageAssignments.filter((page) => page.location === "Brampton" && page.clusterRole === "service");
    expect(localServices.length).toBeGreaterThan(1);
    const duplicateKey = localServices[0].pageKey!;
    const duplicateOwner = localServices[0].intentOwner!;
    const broken = {
      ...plan,
      pageAssignments: plan.pageAssignments.map((page) => (
        page.location === "Brampton" && page.clusterRole === "service"
          ? { ...page, pageKey: duplicateKey, intentOwner: duplicateOwner }
          : page
      )),
    };
    const repaired = repairContentPlanPageIdentities(broken);
    const repairedLocalServices = repaired.pageAssignments.filter((page) => page.location === "Brampton" && page.clusterRole === "service");
    expect(new Set(repairedLocalServices.map((page) => page.pageKey)).size).toBe(repairedLocalServices.length);
    expect(new Set(repairedLocalServices.map((page) => page.intentOwner)).size).toBe(repairedLocalServices.length);
    const cluster = repaired.locationAuthorityClusters.find((item) => item.location === "Brampton");
    expect(new Set(cluster?.servicePageKeys).size).toBe(repairedLocalServices.length);
  });

  it("reuses matched crawled pages but still plans missing authority pages for an existing website", () => {
    const plan = contentPlanFor({
      ...baseInput,
      websiteUrl: "https://example.com",
      websitePages: [
        { url: "https://example.com/locations/brampton", title: "Brampton Service Area" },
        { url: "https://example.com/brampton/super-visa-insurance", title: "Super Visa Insurance Brampton" },
      ],
    });
    const brampton = plan.locationAuthorityClusters.find((cluster) => cluster.location === "Brampton");
    expect(brampton).toBeTruthy();
    const pages = plan.pageAssignments.filter((page) => page.clusterKey === brampton?.clusterKey);
    expect(pages.some((page) => page.source === "existing_crawl" && page.clusterRole === "location_hub")).toBe(true);
    expect(pages.some((page) => page.source === "existing_crawl" && page.canonicalKeyword.toLowerCase().includes("super visa"))).toBe(true);
    expect(pages.some((page) => page.source === "suggested")).toBe(true);
    expect(pages).toHaveLength(brampton?.requiredPageCount ?? 0);
  });

  it("rejects unproven keyword-location multiplication instead of creating every possible page", () => {
    const markets = Array.from({ length: 20 }, (_, index) => `Market ${index + 1}`);
    const keywords = ["Plumbing Repair", "Roof Installation", "Furnace Maintenance", "Electrical Rewiring", "Basement Waterproofing", "Window Replacement", "Kitchen Renovation", "Bathroom Remodeling", "Garage Construction", "Landscape Design", "Pool Installation", "Solar Panel Setup"];
    const plan = contentPlanFor({
      ...baseInput,
      markets,
      keywords,
      websiteUrl: null,
      websitePages: [],
      keywordSignals: [],
      services: keywords,
      serviceAvailability: [],
      localEvidence: [],
    });
    expect(plan.locationAuthorityClusters).toHaveLength(0);
    expect(plan.pageAssignments.some((page) => page.clusterRole === "location_hub")).toBe(false);
    expect(plan.pagePlanningIntelligence.maximumCombinations).toBeGreaterThan(100);
    expect(plan.pagePlanningIntelligence.humanReviewCandidates.some((page) => page.pageType === "location_hub")).toBe(true);
    expect(plan.pagePlanningIntelligence.rejectedCandidates.filter((page) => page.pageType === "local_service").length).toBe(plan.pagePlanningIntelligence.maximumCombinations);
    expect(plan.pagePlanningIntelligence.missingInputs).toContain("Verified service availability by location");
  });
});

describe("AI Website Plan batch reconciliation", () => {
  const decision = (targetUrl: string) => ({
    targetUrl,
    pageName: "Service Page",
    canonicalKeyword: "service keyword",
    secondaryKeywords: [],
    searchIntent: "commercial" as const,
    pagePurpose: "Explain the approved service and guide qualified visitors toward the next step.",
    gapAnalysis: "The approved service needs one clear canonical page owner and conversion path.",
    recommendedAction: "update_existing" as const,
    intentOwner: targetUrl,
    decisionReason: "This existing page is the strongest evidence-backed owner for the approved intent.",
    funnelStage: "evaluate" as const,
    strategyRole: "Own the commercial service intent without competing with supporting content.",
    requiredInternalLinks: [],
    prohibitedCompetingKeywords: [],
    contentBrief: "Improve the existing page around the approved service intent, verified business facts, useful proof, and one clear conversion action.",
    ctaSuggestion: "Request an assessment",
    evidenceSources: ["Keyword Research"],
  });

  it("keeps all required decisions and ignores an unrequested AI page", () => {
    const result = reconcileAiWebsitePlanBatch(
      [{ targetUrl: "https://example.com/services.html" }],
      [decision("https://example.com/services.html"), decision("https://example.com/extra-page")],
    );
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual(["https://example.com/extra-page"]);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.targetUrl).toBe("https://example.com/services.html");
  });

  it("accepts an equivalent URL alias and restores the governed target URL", () => {
    const result = reconcileAiWebsitePlanBatch(
      [{ targetUrl: "https://www.example.com/about-us.html" }],
      [decision("https://example.com/about-us/")],
    );
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
    expect(result.decisions[0]).toMatchObject({
      targetUrl: "https://www.example.com/about-us.html",
      intentOwner: "https://www.example.com/about-us.html",
    });
  });

  it("still blocks a batch when a required governed page is missing", () => {
    const result = reconcileAiWebsitePlanBatch(
      [{ targetUrl: "/services" }, { targetUrl: "/contact" }],
      [decision("/services"), decision("/unrequested")],
    );
    expect(result.missing).toEqual(["/contact"]);
    expect(result.unexpected).toEqual(["/unrequested"]);
    expect(result.decisions.map((item) => item.targetUrl)).toEqual(["/services"]);
  });
});
