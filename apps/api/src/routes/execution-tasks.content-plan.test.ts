import { describe, expect, it, vi } from "vitest";

vi.mock("../queue.js", () => ({
  websiteBuilderQueue: { add: vi.fn() },
  crawlQueue: { add: vi.fn() },
  keywordResearchQueue: { add: vi.fn() },
}));

import { aiPageSuggestionIssueSummary, aiWebsitePlanDecisionIssueSummary, contentPlanFor, includeEveryCrawledPageInContentPlan, inspectAiPageFaqPlanResponse, inspectAiUnifiedWebsitePlanResponse, normalizeAiPageCtaSuggestion, normalizeAiWebsitePlanCtaSuggestion, normalizeContentPlanCompatibility, normalizeGeneratedContentBrief, parseAiPageFaqPlanResponse, parseAiUnifiedWebsitePlanResponse, parseCompatibleContentPlan, reconcileAiWebsitePlanBatch, repairContentPlanPageIdentities, websitePlanEvidencePages } from "./execution-tasks.js";

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

  it("converts structured contentBrief objects for every decision into validated plain text", () => {
    const decisions = Array.from({ length: 5 }, (_, index) => ({
      ...decision(`/page-${index + 1}`),
      contentBrief: {
        objective: `Explain the approved intent for page ${index + 1}`,
        sections: ["Audience need and context", "Verified proof and differentiators", "Clear next action"],
        safeguards: { claims: "Use only verified business facts", outcome: "Do not promise rankings or conversions" },
      },
    }));
    const parsed = parseAiUnifiedWebsitePlanResponse({
      summary: "Five governed pages have complete evidence-grounded decisions and readable writing briefs.",
      decisions,
    });
    expect(parsed.decisions).toHaveLength(5);
    for (const item of parsed.decisions) {
      expect(typeof item.contentBrief).toBe("string");
      expect(item.contentBrief).toContain("Objective:");
      expect(item.contentBrief).toContain("Sections:");
      expect(item.contentBrief).toContain("Safeguards:");
      expect(item.contentBrief.length).toBeGreaterThanOrEqual(40);
      expect(item.contentBrief.length).toBeLessThanOrEqual(1500);
    }
  });

  it("normalizes the exact combined local commercial search intent before strict validation", () => {
    const parsed = parseAiUnifiedWebsitePlanResponse({
      summary: "The governed local page has one normalized intent and a complete evidence-backed decision.",
      decisions: [{ ...decision("/local-service"), searchIntent: "local commercial" }],
    });
    expect(parsed.decisions[0]?.searchIntent).toBe("local");
  });

  it("continues to reject search intent labels containing unknown values", () => {
    expect(() => parseAiUnifiedWebsitePlanResponse({
      summary: "The invalid page decision must remain blocked by the strict Website Plan contract.",
      decisions: [{ ...decision("/invalid-intent"), searchIntent: "regional purchase" }],
    })).toThrow();
  });

  it("inspects incomplete Website Plan decisions so only affected pages need focused repair", () => {
    const incomplete = { ...decision("/missing-evidence"), evidenceSources: undefined, requiredInternalLinks: undefined };
    const inspected = inspectAiUnifiedWebsitePlanResponse({
      summary: "The batch can be inspected without accepting incomplete governed page decisions.",
      decisions: [incomplete],
    });
    expect(inspected.decisions).toHaveLength(1);
    expect(aiWebsitePlanDecisionIssueSummary(inspected.decisions[0]).map((issue) => issue.field)).toEqual(expect.arrayContaining(["evidenceSources", "requiredInternalLinks"]));
    expect(() => parseAiUnifiedWebsitePlanResponse({
      summary: "The incomplete decision remains blocked by final strict validation.",
      decisions: [incomplete],
    })).toThrow();
  });

  it("shortens overlong Website Plan decision CTAs before the 160-character schema validation", () => {
    const longCta = "Schedule a personalized planning consultation with our experienced advisory team to review your goals, compare every available option, understand the relevant tradeoffs, identify the right coverage structure, and agree on a practical next step for your family or business today";
    const parsed = parseAiUnifiedWebsitePlanResponse({
      summary: "The governed Website Plan decision retains its useful CTA direction within the strict decision contract.",
      decisions: [{ ...decision("/services"), ctaSuggestion: longCta }],
    });
    const cta = parsed.decisions[0]?.ctaSuggestion ?? "";
    expect(cta.length).toBeLessThanOrEqual(160);
    expect(cta).toBe(normalizeAiWebsitePlanCtaSuggestion(longCta));
    expect(longCta.startsWith(cta)).toBe(true);
  });

  it("shortens overlong page CTA suggestions before the 120-character schema validation", () => {
    const longCta = "Schedule a personalized consultation with our experienced advisory team to review your goals, compare the available options, and choose the most appropriate next step today";
    const pageSuggestion = (index: number) => ({
      targetUrl: `/page-${index + 1}`,
      seoTitle: `Complete page-specific SEO title ${index + 1}`,
      metaDescription: `A complete search description for page ${index + 1} that provides useful context and a clear reason to continue.`,
      contentOutline: ["Introduction", "Available options", "Decision guidance", "Next steps"],
      contentBrief: `Write a complete page-specific brief for governed page ${index + 1}.`,
      supportingContentIdeas: ["Practical buyer checklist", "Common decision questions"],
      proofRequirements: ["Use only verified business evidence"],
      ctaSuggestion: [0, 3, 4].includes(index) ? longCta : "Request a consultation",
      faqTopics: ["What does this option include?", "Who is this option suitable for?", "How can someone get started?"],
    });

    const parsed = parseAiPageFaqPlanResponse({ pages: Array.from({ length: 5 }, (_, index) => pageSuggestion(index)) });
    expect(parsed.pages).toHaveLength(5);
    for (const index of [0, 3, 4]) {
      const cta = parsed.pages[index]?.ctaSuggestion ?? "";
      expect(cta.length).toBeLessThanOrEqual(120);
      expect(cta).toBe(normalizeAiPageCtaSuggestion(longCta));
      expect(longCta.startsWith(cta)).toBe(true);
    }
    expect(parsed.pages[1]?.ctaSuggestion).toBe("Request a consultation");
  });

  it("shortens oversized generated briefs before Website Plan validation", () => {
    const oversizedBriefs = Array.from({ length: 18 }, (_, index) =>
      `AI brief for “governed page ${index + 1}” · ${"Use approved evidence and page-specific buyer guidance. ".repeat(index >= 16 ? 30 : 3)}`,
    );
    const normalized = oversizedBriefs.map((brief) => normalizeGeneratedContentBrief(brief));
    expect(normalized).toHaveLength(18);
    expect(normalized[16]?.length).toBeLessThanOrEqual(1000);
    expect(normalized[17]?.length).toBeLessThanOrEqual(1000);
    expect(normalized[16]).toMatch(/^AI brief for “governed page 17”/);
    expect(normalized[17]).toMatch(/^AI brief for “governed page 18”/);
    expect(normalized[16]?.endsWith("…")).toBe(true);
    expect(normalizeGeneratedContentBrief("Keep this concise.")).toBe("Keep this concise.");
  });

  it("repairs retained Website Plan briefs when they are inspected or saved", () => {
    const retainedPlan = {
      summary: "Retained governed Website Plan",
      contentBriefs: Array.from({ length: 18 }, (_, index) => index >= 16
        ? `AI brief ${index + 1}: ${"Evidence-backed page direction. ".repeat(50)}`
        : `AI brief ${index + 1}: concise direction.`),
      pageAssignments: [{ targetUrl: "/page-18", contentBrief: "Detailed page direction. ".repeat(100) }],
    };
    const repaired = normalizeContentPlanCompatibility(retainedPlan) as typeof retainedPlan;
    expect(repaired.contentBriefs[16]?.length).toBeLessThanOrEqual(1000);
    expect(repaired.contentBriefs[17]?.length).toBeLessThanOrEqual(1000);
    expect(repaired.pageAssignments[0]?.contentBrief.length).toBeLessThanOrEqual(1500);
    expect(retainedPlan.contentBriefs[16]?.length).toBeGreaterThan(1000);
  });

  it("reconstructs empty derived arrays and removes incomplete retained local clusters", () => {
    const assignment = {
      canonicalKeyword: "life insurance",
      pageName: "Life Insurance",
      targetUrl: "/life-insurance",
      recommendedAction: "create_new",
      searchIntent: "commercial",
      gapAnalysis: "Create a complete evidence-backed service page.",
      contentBrief: "Use approved evidence and one clear consultation action.",
      proofRequirements: [],
    };
    const repaired = normalizeContentPlanCompatibility({
      pageAssignments: [assignment],
      pageUpdates: [], keywordMapping: [], pageMap: [], planningChecks: [], supportingContent: [], contentBriefs: [], publishingSequence: [], kpis: [], workflowStages: [],
      locationAuthorityClusters: [{ clusterKey: "edmonton", servicePageKeys: [] }],
    }) as Record<string, unknown>;
    for (const field of ["pageUpdates", "keywordMapping", "pageMap", "planningChecks", "supportingContent", "contentBriefs", "publishingSequence", "kpis", "workflowStages"]) {
      expect(Array.isArray(repaired[field]) && (repaired[field] as unknown[]).length > 0, field).toBe(true);
    }
    expect(repaired.locationAuthorityClusters).toEqual([]);
    expect((repaired.pageAssignments as Array<Record<string, unknown>>)[0]).not.toHaveProperty("proofRequirements");
  });

  it("repairs fresh generated plan arrays before the final governed schema", () => {
    const generated = contentPlanFor({ ...baseInput, websitePages: [] });
    const parsed = parseCompatibleContentPlan({
      ...generated,
      pageUpdates: [],
      keywordMapping: [],
      pageMap: [],
      planningChecks: [],
      supportingContent: [],
      contentBriefs: [],
      publishingSequence: [],
      kpis: [],
      workflowStages: [],
      locationAuthorityClusters: [{
        location: "Edmonton", clusterKey: "edmonton", authorityScore: 70, competitionLevel: "medium", demandLevel: "medium", evidenceConfidence: "moderate", requiredPageCount: 2, hubPageKey: "edmonton-hub", servicePageKeys: [], supportingPageKeys: [], neighbourhoodPageKeys: [], rationale: "Retained incomplete cluster awaiting a governed child service page.", schemaTypes: ["Organization"], internalLinkRules: ["Link the location owner to verified service pages."],
      }],
    });
    expect(parsed.pageAssignments.length).toBeGreaterThan(0);
    expect(parsed.pageUpdates.length).toBeGreaterThan(0);
    expect(parsed.contentBriefs.length).toBeGreaterThan(0);
    expect(parsed.workflowStages.length).toBeGreaterThan(0);
    expect(parsed.locationAuthorityClusters).toEqual([]);
  });

  it("reports the exact field when a generated plan remains invalid", () => {
    expect(() => parseCompatibleContentPlan({ summary: "Missing governed page assignments" })).toThrow(/pageUpdates|pageAssignments/);
  });

  it("inspects pages missing FAQ topics so only incomplete pages need focused repair", () => {
    const incompletePages = Array.from({ length: 3 }, (_, index) => ({
      targetUrl: `/missing-faq-${index + 1}`,
      seoTitle: `Complete page-specific SEO title ${index + 1}`,
      metaDescription: `A complete search description for page ${index + 1} that provides useful context and a clear reason to continue.`,
      contentOutline: ["Introduction", "Available options", "Decision guidance", "Next steps"],
      contentBrief: `Write a complete page-specific brief for governed page ${index + 1}.`,
      supportingContentIdeas: ["Practical buyer checklist", "Common decision questions"],
      proofRequirements: ["Use only verified business evidence"],
      ctaSuggestion: "Request a consultation",
    }));
    const inspected = inspectAiPageFaqPlanResponse({ pages: incompletePages });
    expect(inspected.pages).toHaveLength(3);
    for (const page of inspected.pages) {
      expect(aiPageSuggestionIssueSummary(page).map((issue) => issue.field)).toContain("faqTopics");
    }
    expect(() => parseAiPageFaqPlanResponse({ pages: incompletePages })).toThrow();
  });
});
