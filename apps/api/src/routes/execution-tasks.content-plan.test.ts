import { describe, expect, it, vi } from "vitest";

vi.mock("../queue.js", () => ({
  websiteBuilderQueue: { add: vi.fn() },
  crawlQueue: { add: vi.fn() },
  keywordResearchQueue: { add: vi.fn() },
}));

import { contentPlanFor, repairContentPlanPageIdentities } from "./execution-tasks.js";

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
    expect(plan.pagePlanningIntelligence.maximumCombinations).toBeGreaterThan(100);
    expect(plan.pagePlanningIntelligence.rejectedCandidates.filter((page) => page.pageType === "local_service").length).toBe(plan.pagePlanningIntelligence.maximumCombinations);
    expect(plan.pagePlanningIntelligence.missingInputs).toContain("Verified service availability by location");
  });
});
