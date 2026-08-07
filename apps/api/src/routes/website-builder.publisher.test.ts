import { describe, expect, it } from "vitest";
import { SENUKE_COMPONENT_REGISTRY_V1 } from "@webtummy/core/website-model";
import { combinedPageSchema, effectiveExistingPageRequirements, generatedPageSchema, importedWebsiteRouteAssignment, pageIsImportedExistingWebsite, publishingAssetMatchesWebsitePage, websiteSettingsWithVerifiedLocalEvidence } from "./website-builder.js";

const project = {
  businessName: "Example Financial",
  name: "Example Financial Website",
  websiteUrl: "https://example.com",
  targetLocations: ["Ontario"],
  businessLocationJson: {
    city: "Brampton",
    stateProvince: "Ontario",
    country: "Canada",
  },
};

describe("ongoing WordPress publishing schema", () => {
  it("synchronizes verified local evidence into the matching Website Plan page", () => {
    const evidence = {
      id: "verified-local-evidence-1",
      type: "user_confirmed_local_service_evidence" as const,
      location: "Toronto",
      detail: "Remote onboarding and implementation support are genuinely available to Toronto customers.",
      serviceAvailable: true as const,
      confirmedById: "user-1",
      confirmedAt: "2026-08-07T12:00:00.000Z",
    };
    const result = websiteSettingsWithVerifiedLocalEvidence({
      seoPlan: {
        pageAssignments: [{
          pageKey: "page-toronto-location-hub",
          pageName: "Insurance CRM Services In Toronto",
          targetUrl: "/locations/toronto",
          canonicalKeyword: "Insurance CRM services in Toronto",
          serviceAvailabilityVerified: false,
          localEvidenceIds: [],
        }],
      },
    }, {
      title: "Insurance CRM Services In Toronto",
      slug: "locations/toronto",
      targetUrl: "/locations/toronto",
      primaryKeyword: "Insurance CRM services in Toronto",
      secondaryKeywords: [],
      briefJson: { authorityCluster: { pageKey: "page-toronto-location-hub" } },
    }, evidence);

    expect(result.matchedAssignments).toBe(1);
    expect((result.settings.seoPlan as { pageAssignments: Array<Record<string, unknown>> }).pageAssignments[0]).toMatchObject({
      serviceAvailabilityVerified: true,
      localEvidenceIds: [evidence.id],
      localEvidenceRecords: [evidence],
    });
  });

  it("matches a Publishing asset for / to the existing Home page", () => {
    expect(publishingAssetMatchesWebsitePage(
      { keyword: "physiotherapy rehabilitation", topic: "Home", targetUrl: "/" },
      { targetUrl: "/", slug: "", primaryKeyword: "Physiotherapy clinic", secondaryKeywords: [] },
    )).toBe(true);
  });

  it("requires verified live-page evidence before classifying a URL as an existing page", () => {
    expect(pageIsImportedExistingWebsite({ briefJson: {
      importSource: { type: "existing_crawl", importedFromExistingWebsite: true, crawlPageId: null },
    } })).toBe(false);
    expect(pageIsImportedExistingWebsite({ briefJson: {
      importSource: { type: "existing_sitemap", importedFromExistingWebsite: true, statusCode: 404 },
    } })).toBe(false);
    expect(pageIsImportedExistingWebsite({ briefJson: {
      importSource: { type: "existing_crawl", importedFromExistingWebsite: true, crawlPageId: "crawl-page-1" },
    } })).toBe(true);
  });

  it("uses the same Website Plan requirements for the content screen and its queue action", () => {
    const requirements = effectiveExistingPageRequirements({
      id: "about-page",
      title: "About Us",
      targetUrl: "/about-us.html",
      remoteUrl: "https://example.com/about-us.html",
      slug: "about-us.html",
      pageType: "about",
      primaryKeyword: "Example Financial team",
      briefJson: {
        importSource: {
          importedFromExistingWebsite: true,
          currentWebsiteSnapshot: {
            title: "About",
            metaDescription: "",
            h1: ["About"],
            h2: [],
            canonicalUrl: "https://example.com/about-us.html",
          },
        },
        seoPlan: {},
      },
    }, [{
      pageName: "About Us",
      targetUrl: "/about-us.html",
      canonicalKeyword: "Example Financial team",
      seoTitle: "About the Example Financial Team",
      metaDescription: "Learn about the verified Example Financial team and its customer approach.",
    }]);

    expect(requirements.map((item) => item.issueType)).toEqual(expect.arrayContaining([
      "seo_title_update",
      "meta_description_update",
      "h1_alignment",
    ]));
  });

  it("prefers persisted gap requirements over newly inferred Website Plan differences", () => {
    const requirements = effectiveExistingPageRequirements({
      id: "contact-page",
      title: "Contact Us",
      targetUrl: "/contact-us.html",
      remoteUrl: "https://example.com/contact-us.html",
      slug: "contact-us.html",
      pageType: "contact",
      primaryKeyword: "Example Financial contact",
      briefJson: {
        importSource: { importedFromExistingWebsite: true, currentWebsiteSnapshot: {} },
        seoPlan: {
          gapRequirements: [{ findingKey: "saved:contact", issueType: "contact_details", recommendedFix: "Use verified intake details." }],
        },
      },
    }, [{ targetUrl: "/contact-us.html", seoTitle: "Different title" }]);

    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({ findingKey: "saved:contact", issueType: "contact_details" });
  });

  it("keeps imported utility and trust pages out of a duplicated service intent", () => {
    expect(importedWebsiteRouteAssignment({ targetUrl: "/contact-us.html", pageName: "Physiotherapy", primaryKeyword: "Physiotherapy", searchIntent: "commercial", businessName: "Procare Physio" })).toMatchObject({
      pageName: "Contact Us",
      canonicalKeyword: "Procare Physio contact",
      searchIntent: "transactional",
      pageType: "conversion",
    });
    expect(importedWebsiteRouteAssignment({ targetUrl: "/our-team.html", pageName: "Physiotherapy", primaryKeyword: "Physiotherapy", searchIntent: "commercial", businessName: "Procare Physio" })).toMatchObject({
      pageName: "Our Team",
      canonicalKeyword: "Procare Physio team",
      searchIntent: "navigational",
      pageType: "trust",
    });
    expect(importedWebsiteRouteAssignment({ targetUrl: "/faq.html", pageName: "Physiotherapy", primaryKeyword: "Physiotherapy", searchIntent: "commercial", businessName: "Procare Physio" })).toMatchObject({
      pageName: "Frequently Asked Questions",
      canonicalKeyword: "Procare Physio frequently asked questions",
      searchIntent: "informational",
      pageType: "faq",
    });
  });

  it("accepts component-only page content and strips duplicate compatibility fields", () => {
    const parsed = generatedPageSchema.parse({
      brief: {
        pageGoal: "Explain the business and help visitors make contact.",
        audience: "Prospective customers",
        outline: ["Introduction", "Business information", "Next step"],
        conversionPlan: "Contact the team",
      },
      content: {
        heroTitle: "This duplicate field must not enter the canonical model",
        sections: [{
          heading: "About the team",
          headingLevel: "h2",
          bodyHtml: "<p>Approved business information.</p>",
        }],
        components: [{
          instanceId: "about-overview",
          componentId: "content.rich_text",
          componentVersion: "1.0.0",
          variant: "answer_first",
          props: {
            heading: "About the team",
            body: "Approved business information and a clear explanation of the customer experience.",
          },
        }],
        componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
      },
      seo: {
        metaTitle: "About Example Financial",
        metaDescription: "Learn about Example Financial, its customer approach, and how to contact the team for help evaluating suitable options.",
      },
    });

    expect(parsed.content).toEqual({
      components: expect.any(Array),
      componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
    });
  });

  it("uses BlogPosting and FAQPage for a generated WordPress post", () => {
    const schema = combinedPageSchema(
      {
        title: "How Much Does Super Visa Insurance Cost in Ontario?",
        pageType: "post",
        slug: "super-visa-insurance-cost-ontario",
        primaryKeyword: "super visa insurance cost Ontario",
      },
      project,
      [{ question: "What affects the cost?", answer: "Age, coverage, duration, and policy terms can affect the premium." }],
    ) as { "@graph": Array<Record<string, unknown>> };

    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("BlogPosting");
    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("FAQPage");
    expect(schema["@graph"].map((entity) => entity["@type"])).not.toContain("Service");
  });

  it("uses FAQPage rather than Service schema for a dedicated FAQ page", () => {
    const schema = combinedPageSchema(
      { title: "Frequently Asked Questions", pageType: "faq", slug: "faq", primaryKeyword: "Example Financial frequently asked questions" },
      project,
      [{ question: "How can I contact the team?", answer: "Use the verified contact options shown on the Contact page." }],
    ) as { "@graph": Array<Record<string, unknown>> };

    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("FAQPage");
    expect(schema["@graph"].map((entity) => entity["@type"])).not.toContain("Service");
  });

  it("uses ContactPage rather than Service schema for a transactional Contact page", () => {
    const schema = combinedPageSchema(
      { title: "Contact Us", pageType: "conversion", slug: "contact-us", primaryKeyword: "contact Example Financial" },
      project,
      [],
    ) as { "@graph": Array<Record<string, unknown>> };

    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("ContactPage");
    expect(schema["@graph"].map((entity) => entity["@type"])).not.toContain("Service");
  });

  it("does not invent Service schema for utility pages", () => {
    const schema = combinedPageSchema(
      { title: "Privacy Policy", pageType: "legal", slug: "privacy-policy", primaryKeyword: "privacy policy" },
      project,
      [],
    ) as { "@graph": Array<Record<string, unknown>> };

    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("WebPage");
    expect(schema["@graph"].map((entity) => entity["@type"])).not.toContain("Service");
  });

  it("retains Service schema for an ongoing service or location page", () => {
    const schema = combinedPageSchema(
      {
        title: "Super Visa Insurance in Hamilton",
        pageType: "location",
        slug: "super-visa-insurance-hamilton",
        primaryKeyword: "super visa insurance Hamilton",
      },
      project,
      [],
    ) as { "@graph": Array<Record<string, unknown>> };

    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("Service");
    expect(schema["@graph"].map((entity) => entity["@type"])).not.toContain("BlogPosting");
  });
});
