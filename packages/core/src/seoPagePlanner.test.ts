import { describe, expect, it } from "vitest";
import { bestExistingSeoPageMatch, classifySeoSearchIntent, planSeoPages } from "./seoPagePlanner.js";

const base = {
  businessName: "Example Insurance",
  businessType: "Insurance brokerage",
  services: ["Life Insurance", "Super Visa Insurance"],
  keywords: [
    "Life Insurance",
    "best life insurance provider",
    "Life Insurance Brampton",
    "Super Visa Insurance",
    "super visa insurance near me",
    "Super Visa Insurance Toronto",
  ],
  targetCountry: "Canada",
  targetStateProvince: "Ontario",
  locations: [
    { name: "Brampton", level: "city" as const, serviceArea: true },
    { name: "Toronto", level: "city" as const, serviceArea: true },
  ],
  conversionGoal: "Request an insurance consultation",
  competitors: ["Competitor A"],
};

describe("SEO page planning intelligence", () => {
  it("matches service-location URL combinations in either order and without separators", () => {
    for (const url of [
      "https://example.com/mississauga-web-development.html",
      "https://example.com/web-development-mississauga/",
      "https://example.com/mississaugawebdevelopment",
    ]) {
      const match = bestExistingSeoPageMatch([{ url, title: null, h1: null }], {
        primaryKeyword: "web development Mississauga",
        pageType: "local_service",
        searchIntent: "local_service",
        businessName: "Example Business",
      });
      expect(match?.page.url).toBe(url);
      expect(match?.similarity).toBe(100);
    }
  });

  it("classifies the required search-intent families", () => {
    expect(classifySeoSearchIntent("life insurance Brampton", "", base.locations)).toBe("local_service");
    expect(classifySeoSearchIntent("life insurance vs term insurance")).toBe("comparison");
    expect(classifySeoSearchIntent("how does life insurance work")).toBe("informational");
    expect(classifySeoSearchIntent("book an insurance consultation")).toBe("transactional");
  });

  it("does not use keyword count multiplied by location count as the sitemap", () => {
    const plan = planSeoPages(base);
    expect(plan.maximumCombinations).toBeGreaterThan(0);
    expect(plan.approvedCandidates.filter((page) => page.pageType === "location_hub")).toHaveLength(0);
    expect(plan.approvedCandidates.filter((page) => page.pageType === "local_service")).toHaveLength(0);
    expect(plan.humanReviewCandidates.some((page) => page.pageType === "location_hub" && page.targetLocation === "Brampton")).toBe(true);
    expect(plan.rejectedCandidates.some((page) => page.pageType === "local_service")).toBe(true);
    expect(plan.recommendedTotalPages).toBeLessThan(plan.keywordClusters.length + plan.maximumCombinations + plan.locationHierarchy.length);
    expect(plan.missingInputs).toContain("Verified service availability by location");
  });

  it("keeps a high-demand target-market hub in additional ideas until service availability is verified", () => {
    const plan = planSeoPages({
      businessName: "Procare Physio",
      businessType: "Physiotherapy clinic",
      services: ["Physiotherapy"],
      keywords: ["physiotherapy clinic"],
      locations: [{ name: "Brampton", level: "city", serviceArea: true }],
      keywordSignals: Array.from({ length: 8 }, (_, index) => ({
        keyword: `physiotherapy clinic ${index + 1}`,
        location: "Brampton",
        searchVolume: 500,
        competitorCount: 10,
        localResultRatio: 0.7,
      })),
      conversionGoal: "Book an appointment",
      serviceAvailability: [],
      localEvidence: [],
    });
    expect(plan.approvedCandidates.some((page) => page.pageType === "location_hub" && page.targetLocation === "Brampton")).toBe(false);
    expect(plan.humanReviewCandidates.find((page) => page.pageType === "location_hub" && page.targetLocation === "Brampton")).toMatchObject({
      indexingDirective: "noindex",
      serviceAvailabilityVerified: false,
    });
  });

  it("approves a service-city page only with verified availability and useful local evidence", () => {
    const plan = planSeoPages({
      ...base,
      serviceAvailability: [
        { service: "Life Insurance", location: "Brampton", available: true, verified: true },
        { service: "Super Visa Insurance", location: "Brampton", available: false, verified: true },
      ],
      localEvidence: [
        { id: "proof-1", location: "Brampton", service: "Life Insurance", type: "verified local delivery detail", verified: true },
        { id: "proof-2", location: "Brampton", service: "Life Insurance", type: "approved local FAQ evidence", verified: true },
      ],
      keywordSignals: [
        { keyword: "Life Insurance Brampton", location: "Brampton", searchVolume: 700, competitorCount: 9, localResultRatio: 0.7 },
      ],
    });
    const approvedLife = plan.approvedCandidates.find((page) => ["local_service", "location_hub"].includes(page.pageType) && /life insurance/i.test(page.primaryKeyword) && page.targetLocation === "Brampton");
    expect(approvedLife?.serviceAvailabilityVerified).toBe(true);
    expect(approvedLife?.score.total).toBeGreaterThanOrEqual(70);
    expect(plan.rejectedCandidates.some((page) => /super visa/i.test(page.primaryKeyword) && page.targetLocation === "Brampton")).toBe(true);
  });

  it("prioritizes verified pages for the physical business city over surrounding service areas", () => {
    const plan = planSeoPages({
      businessName: "Procare Physio",
      businessType: "Physiotherapy and rehabilitation",
      homepagePrimaryTopic: "Physiotherapy and Rehabilitation Services",
      services: ["Physiotherapy Clinic"],
      keywords: ["physiotherapy clinic"],
      targetCountry: "Canada",
      targetStateProvince: "Ontario",
      locations: [
        { name: "Mississauga", level: "city", physical: true, serviceArea: true },
        { name: "Etobicoke", level: "city", physical: false, serviceArea: true },
      ],
      conversionGoal: "Book an appointment",
      serviceAvailability: [
        { service: "Physiotherapy Clinic", location: "Mississauga", available: true, verified: true },
      ],
      localEvidence: [
        { id: "physical-location", location: "Mississauga", type: "verified physical business location", verified: true },
      ],
    });
    expect(plan.approvedCandidates.some((candidate) => candidate.pageType === "location_hub" && candidate.targetLocation === "Mississauga")).toBe(true);
    expect(plan.approvedCandidates.some((candidate) => candidate.pageType === "local_service" && candidate.targetLocation === "Mississauga")).toBe(true);
    expect(plan.approvedCandidates.some((candidate) => candidate.pageType === "local_service" && candidate.targetLocation === "Etobicoke")).toBe(false);
  });

  it("reuses matching crawled keyword and location pages regardless of html or routed URL style", () => {
    const plan = planSeoPages({
      businessName: "Procare Physio",
      businessType: "Physiotherapy and rehabilitation",
      homepagePrimaryTopic: "Physiotherapy and Rehabilitation Services",
      services: ["Physiotherapy", "Massage Therapy"],
      keywords: ["Physiotherapy", "Massage Therapy"],
      targetCountry: "Canada",
      targetStateProvince: "Ontario",
      locations: [{ name: "Mississauga", level: "city", physical: true, serviceArea: true }],
      conversionGoal: "Book an appointment",
      serviceAvailability: [
        { service: "Physiotherapy", location: "Mississauga", available: true, verified: true },
        { service: "Massage Therapy", location: "Mississauga", available: true, verified: true },
      ],
      localEvidence: [{ id: "physical-location", location: "Mississauga", type: "verified physical business location", verified: true }],
      existingPages: [
        { url: "https://www.procarephysioandrehab.com/massage-therapy.html", title: "Massage Therapy | Procare Physio", h1: "Massage Therapy" },
        { url: "https://www.procarephysioandrehab.com/mississaugaphysiotherapy", title: "Physiotherapy in Mississauga", h1: "Physiotherapy in Mississauga" },
      ],
    });
    const globalPage = plan.approvedCandidates.find((candidate) => candidate.pageType === "service" && candidate.primaryKeyword === "Massage Therapy");
    const localPage = plan.approvedCandidates.find((candidate) => candidate.pageType === "local_service" && candidate.targetLocation === "Mississauga" && /physiotherapy/i.test(candidate.primaryKeyword));
    expect(globalPage?.slug).toBe("https://www.procarephysioandrehab.com/massage-therapy.html");
    expect(localPage?.slug).toBe("https://www.procarephysioandrehab.com/mississaugaphysiotherapy");
    expect(localPage?.decisionReason).toContain("Reuse the crawled page");
  });

  it("assigns only one indexable owner to the same intent and scope", () => {
    const plan = planSeoPages({
      ...base,
      keywords: ["Life Insurance", "best life insurance", "top life insurance provider", "life insurance services"],
      locations: [],
    });
    const globalLifeOwners = plan.ownerMap.filter((owner) => owner.location === null && /life insurance/i.test(owner.primaryKeyword));
    expect(globalLifeOwners).toHaveLength(1);
    expect(plan.keywordClusters.filter((cluster) => /life insurance/i.test(cluster.primaryKeyword))).toHaveLength(1);
    expect(plan.keywordClusters.some((cluster) => /super visa insurance/i.test(cluster.primaryKeyword))).toBe(false);
  });

  it("does not treat utility pages, supporting articles, or hostname aliases as service-page owners", () => {
    const plan = planSeoPages({
      businessName: "Procare Physio",
      businessType: "Massage therapy clinic",
      homepagePrimaryTopic: "Massage Therapy",
      services: ["Physiotherapy", "Massage Therapy"],
      keywords: ["Physiotherapy", "Massage Therapy"],
      locations: [],
      existingPages: [
        { url: "https://www.procarephysioandrehab.com/about-us.html", title: "About Procare Physio" },
        { url: "https://www.procarephysioandrehab.com/contact-us.html", title: "Contact Procare Physio" },
        { url: "https://procarephysioandrehab.com/contact-us.html", title: "Contact Procare Physio" },
        { url: "https://www.procarephysioandrehab.com/faq.html", title: "Physiotherapy FAQ | Procare Physio" },
        { url: "https://procarephysioandrehab.com/our-team.html", title: "Our Physiotherapy Team | Procare Physio" },
        { url: "https://www.procarephysioandrehab.com/payment-insurance.html", title: "Physiotherapy Payment and Insurance" },
        { url: "https://procarephysioandrehab.com/blog/how-physiotherapy-and-massage-therapy-can-help-with-chronic-pain.html", title: "How Physiotherapy Can Help With Chronic Pain" },
      ],
    });
    const servicePage = plan.approvedCandidates.find((candidate) => candidate.pageType === "service" && candidate.primaryKeyword === "Physiotherapy");
    const aboutPage = plan.approvedCandidates.find((candidate) => candidate.pageType === "trust");
    const contactPage = plan.approvedCandidates.find((candidate) => candidate.pageType === "conversion");
    expect(servicePage?.slug).toBe("/physiotherapy/");
    expect(aboutPage?.slug).toBe("https://www.procarephysioandrehab.com/about-us.html");
    expect(contactPage?.slug).toBe("https://www.procarephysioandrehab.com/contact-us.html");
    expect(aboutPage?.decisionReason).toContain("Reuse the crawled About page");
    expect(contactPage?.decisionReason).toContain("Reuse the crawled Contact page");
    expect(plan.conflicts.filter((conflict) => conflict.conflictType === "existing_page_overlap" && conflict.conflictingPageIds.includes(servicePage!.candidateId))).toHaveLength(0);
  });

  it("uses the broad business category for Home instead of the first specialty keyword", () => {
    const plan = planSeoPages({
      businessName: "Procare Physio & Rehab",
      businessType: "Physiotherapy and rehabilitation",
      homepagePrimaryTopic: "motor vehicle accident rehabilitation",
      services: ["Physiotherapy", "Registered Massage Therapy", "Motor Vehicle Accident Rehabilitation"],
      keywords: [
        "motor vehicle accident rehabilitation",
        "physiotherapy clinic",
        "registered massage therapy",
      ],
      locations: [],
    });
    const home = plan.approvedCandidates.find((candidate) => candidate.pageType === "home");
    expect(home?.primaryKeyword).toBe("physiotherapy clinic");
    expect(plan.approvedCandidates.some((candidate) => candidate.pageType === "service" && candidate.primaryKeyword.toLocaleLowerCase() === "motor vehicle accident rehabilitation")).toBe(true);
    expect(plan.approvedCandidates.some((candidate) => candidate.pageType === "service" && candidate.primaryKeyword.toLocaleLowerCase() === "physiotherapy clinic")).toBe(false);
  });

  it("reuses one canonical existing service page without creating alias conflicts", () => {
    const plan = planSeoPages({
      businessName: "Procare Physio",
      businessType: "Massage therapy clinic",
      homepagePrimaryTopic: "Massage Therapy",
      services: ["Physiotherapy", "Massage Therapy"],
      keywords: ["Physiotherapy", "Massage Therapy"],
      locations: [],
      existingPages: [
        { url: "https://www.procarephysioandrehab.com/physiotherapy.html", title: "Physiotherapy Services | Procare Physio", h1: "Physiotherapy Services" },
        { url: "https://procarephysioandrehab.com/physiotherapy.html", title: "Physiotherapy Services | Procare Physio", h1: "Physiotherapy Services" },
      ],
    });
    const servicePage = plan.approvedCandidates.find((candidate) => candidate.pageType === "service" && candidate.primaryKeyword === "Physiotherapy");
    expect(servicePage?.slug).toBe("https://www.procarephysioandrehab.com/physiotherapy.html");
    expect(plan.conflicts.filter((conflict) => conflict.conflictType === "existing_page_overlap" && conflict.conflictingPageIds.includes(servicePage!.candidateId))).toHaveLength(0);
  });

  it("keeps weak commercial modifiers as supporting keywords instead of page owners", () => {
    const plan = planSeoPages({
      ...base,
      services: ["Insurance Agent and Broker", "Life Insurance"],
      keywords: [
        "Insurance Agent and Broker",
        "Best Insurance professional",
        "Insurance Agency Near me",
        "Insurance agents near me",
        "life insurance provider",
      ],
      locations: [],
    });
    const insuranceProvider = plan.keywordClusters.find((cluster) => cluster.normalizedTopic === "insurance provider");
    expect(insuranceProvider?.secondaryKeywords).toEqual(expect.arrayContaining([
      "Best Insurance professional",
      "Insurance Agency Near me",
      "Insurance agents near me",
    ]));
    expect(plan.keywordClusters.filter((cluster) => cluster.normalizedTopic === "insurance provider")).toHaveLength(1);
    expect(plan.keywordClusters.filter((cluster) => /life insurance/.test(cluster.normalizedTopic))).toHaveLength(1);
  });

  it("normalizes startup audience phrases and weak modifiers before creating owner pages", () => {
    const plan = planSeoPages({
      businessName: "Heera Ji",
      businessType: "AI technology startup",
      homepagePrimaryTopic: "AI technology startup",
      services: ["AI Solutions"],
      keywords: [
        "AI technology startup",
        "best AI technology startup",
        "AI technology startup in Tech startups",
        "AI technology startup services",
        "AI Solutions",
        "AI Solutions in Tech startups",
        "AI Solutions services",
      ],
      targetCountry: "India",
      targetStateProvince: "Uttarakhand",
      locations: [{ name: "Uttarakhand", level: "state_province", serviceArea: true }],
      conversionGoal: "Generate leads",
      competitors: [],
    });
    expect(plan.keywordClusters.map((cluster) => cluster.normalizedTopic)).toEqual([
      "ai technology startup",
      "ai solution",
    ]);
    expect(plan.keywordClusters[0]?.secondaryKeywords).toEqual(expect.arrayContaining([
      "best AI technology startup",
      "AI technology startup in Tech startups",
      "AI technology startup services",
    ]));
    expect(plan.keywordClusters[1]?.secondaryKeywords).toEqual(expect.arrayContaining([
      "AI Solutions in Tech startups",
      "AI Solutions services",
    ]));
    expect(plan.approvedCandidates.some((candidate) => /\b(best|tech startups|solutions services|startup services)\b/i.test(candidate.primaryKeyword))).toBe(false);
  });

  it("uses validated AI semantics to clarify ambiguous phrases before deterministic owner selection", () => {
    const plan = planSeoPages({
      businessName: "Example Insurance",
      businessType: "Insurance brokerage",
      services: ["Super Visa Insurance"],
      keywords: ["supervisa coverage", "super visa insurance"],
      locations: [{ name: "Brampton", level: "city", serviceArea: true }],
      semanticKeywords: [
        {
          keyword: "supervisa coverage",
          canonicalTopic: "super visa insurance",
          searchIntent: "commercial_service",
          reason: "The phrase refers to the approved Super Visa Insurance service.",
        },
      ],
    });
    expect(plan.keywordClusters.filter((cluster) => cluster.normalizedTopic === "super visa insurance")).toHaveLength(1);
    expect(plan.keywordClusters[0]?.secondaryKeywords).toContain("super visa coverage");
    expect(plan.normalizedKeywords.find((keyword) => keyword.original === "super visa coverage")).toMatchObject({
      normalized: "super visa insurance",
      normalizationSource: "ai_assisted",
    });
  });

  it("builds country, province, and city hierarchy", () => {
    const plan = planSeoPages(base);
    const canada = plan.locationHierarchy.find((location) => location.name === "Canada");
    const ontario = plan.locationHierarchy.find((location) => location.name === "Ontario");
    const brampton = plan.locationHierarchy.find((location) => location.name === "Brampton");
    expect(ontario?.parentId).toBe(canada?.locationId);
    expect(brampton?.parentId).toBe(ontario?.locationId);
  });

  it("merges province abbreviations and uses service-led geographic owner labels", () => {
    const plan = planSeoPages({
      ...base,
      businessName: "Top Financial",
      businessType: "Insurance and financial services",
      targetStateProvince: "ON",
      locations: [
        { name: "Ontario", level: "state_province" as const, serviceArea: true },
        { name: "Brampton", level: "city" as const, serviceArea: true },
      ],
    });
    expect(plan.locationHierarchy.filter((location) => location.name === "Ontario")).toHaveLength(1);
    expect(plan.locationHierarchy.some((location) => location.name === "ON")).toBe(false);
    const hubs = [...plan.approvedCandidates, ...plan.humanReviewCandidates].filter((candidate) => candidate.pageType === "location_hub");
    expect(hubs.some((candidate) => candidate.primaryKeyword === "Life Insurance services in Ontario")).toBe(true);
    expect(hubs.every((candidate) => !candidate.primaryKeyword.includes("Top Financial services"))).toBe(true);
  });

  it("keeps the location hub distinct from its evidence-approved service pages", () => {
    const plan = planSeoPages({
      ...base,
      businessName: "Top Financial",
      services: ["Insurance Agent and Broker", "Life Insurance", "Super Visa Insurance"],
      keywords: ["Insurance Agent and Broker", "Insurance Agency Near me", "Life Insurance", "Super Visa Insurance"],
      locations: [{ name: "Brampton", level: "city" as const, serviceArea: true }],
    });
    const hub = [...plan.approvedCandidates, ...plan.humanReviewCandidates].find((candidate) => candidate.pageType === "location_hub" && candidate.targetLocation === "Brampton");
    expect(hub?.primaryKeyword).toBe("Insurance Agent and Broker services in Brampton");
    expect([...plan.approvedCandidates, ...plan.humanReviewCandidates, ...plan.rejectedCandidates].filter((candidate) =>
      candidate.pageType === "local_service"
      && candidate.targetLocation === "Brampton"
      && /insurance agent and broker/i.test(candidate.primaryKeyword),
    )).toHaveLength(1);
  });
});
