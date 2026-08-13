import { describe, expect, it } from "vitest";
import { SENUKE_COMPONENT_REGISTRY_V1 } from "@webtummy/core/website-model";
import { canonicalComponents, combinedPageSchema, compactWebsiteBuilderMediaAsset, compactWebsiteBuilderOverviewPage, effectiveExistingPageRequirements, generatedPageSchema, importedWebsiteRouteAssignment, logoPaletteAiPrompt, logoPalettePromptBrand, pageIsImportedExistingWebsite, parseWordPressJsonResponse, productionWebsiteUrl, publishingAssetMatchesWebsitePage, replaceWebsitePublicStatements, shouldDeployWordPressDesignPackage, websiteReleaseDeploymentScope, websiteSettingsWithVerifiedLocalEvidence, wordPressConnectorVersionAtLeast, wordpressConnectorSafeCss, wordpressMenuDestination, wordpressPageWritePayload, wordpressRemotePageIds } from "./website-builder.js";

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
  const releaseModel = (overrides: Record<string, unknown> = {}) => ({
    modelId: "model-1", websiteId: "website-1", projectId: "project-1", version: 1, status: "validated",
    componentRegistryVersion: "1.0.0", identity: { businessName: "Example" }, designSystem: { colors: { primary: "#000" } },
    pages: [
      { pageId: "home", name: "Home", slug: "/", pageType: "home", sections: [{ componentId: "hero.local_service", props: { headline: "Original", imageAssetId: "hero-image" } }], seo: { title: "Home" } },
      { pageId: "about", name: "About", slug: "about", pageType: "page", sections: [{ componentId: "content.rich_text", props: { body: "About us" } }], seo: { title: "About" } },
    ],
    navigation: [{ pageId: "home", label: "Home", url: "/" }, { pageId: "about", label: "About", url: "/about" }],
    forms: [], mediaAssets: [{ assetId: "hero-image", status: "approved", altText: "Hero", sourceUrl: "asset://hero-image?revision=1" }],
    ...overrides,
  }) as never;

  it("scopes an H1-style page edit to only that page", () => {
    const previous = releaseModel();
    const current = releaseModel({ pages: [
      { pageId: "home", name: "Home", slug: "/", pageType: "home", sections: [{ componentId: "hero.local_service", props: { headline: "Updated", imageAssetId: "hero-image" } }], seo: { title: "Home" } },
      { pageId: "about", name: "About", slug: "about", pageType: "page", sections: [{ componentId: "content.rich_text", props: { body: "About us" } }], seo: { title: "About" } },
    ] });
    expect(websiteReleaseDeploymentScope(current, previous)).toMatchObject({ mode: "incremental", pageIds: ["home"], changedAssetIds: [] });
  });

  it("uploads a replaced image and republishes only its page", () => {
    const previous = releaseModel();
    const current = releaseModel({ mediaAssets: [{ assetId: "hero-image", status: "approved", altText: "Hero", sourceUrl: "asset://hero-image?revision=2" }] });
    expect(websiteReleaseDeploymentScope(current, previous)).toMatchObject({ mode: "incremental", pageIds: ["home"], changedAssetIds: ["hero-image"] });
  });

  it("forces a complete release for navigation changes", () => {
    const previous = releaseModel();
    const current = releaseModel({ navigation: [{ pageId: "about", label: "About", url: "/about" }, { pageId: "home", label: "Home", url: "/" }] });
    expect(websiteReleaseDeploymentScope(current, previous)).toMatchObject({ mode: "full", pageIds: ["home", "about"], globalChanges: ["Navigation"] });
  });

  it("derives a production website from a domain-shaped project name", () => {
    expect(productionWebsiteUrl({ name: "lifexinsurance.ca", websiteUrl: null })).toEqual({ domain: "lifexinsurance.ca", rootUrl: "https://lifexinsurance.ca" });
  });

  it("prefers the real publishing destination for tracking identity", () => {
    expect(productionWebsiteUrl({ name: "Client website", websiteUrl: null }, "https://www.example.ca/path")).toEqual({ domain: "www.example.ca", rootUrl: "https://www.example.ca" });
  });

  it("imports an earlier page record into visual-editor components without another AI generation", () => {
    const components = canonicalComponents({
      heroEyebrow: "Protection planning",
      heroTitle: "Insurance planning for your priorities",
      heroSummary: "Review relevant options and prepare questions for an initial consultation.",
      sections: [{ heading: "A practical planning conversation", bodyHtml: "<p>Discuss your circumstances, goals, and existing arrangements.</p>" }],
      ctaTitle: "Start a conversation",
      ctaBody: "Contact the team to discuss what you would like to plan.",
      ctaLabel: "Contact us",
    });

    expect(components.map((component) => component.componentId)).toEqual([
      "hero.local_service",
      "content.rich_text",
      "conversion.cta",
    ]);
    expect(components[0].props.headline).toBe("Insurance planning for your priorities");
    expect(components[1].props.body).toContain("Discuss your circumstances");
  });

  it("replaces only the flagged public sentence inside registered component props", () => {
    const original = "Evaluate your needs to find the best fit for your situation.";
    const replacement = "Learn about the factors commonly considered when reviewing available options.";
    const components = [{
      instanceId: "body",
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: { heading: "Reviewing options", body: `Start here. ${original} Keep this sentence.` },
    }] as Parameters<typeof replaceWebsitePublicStatements>[0];
    const repaired = replaceWebsitePublicStatements(components, [{ original, replacement }]);
    expect(repaired[0].props.body).toBe(`Start here. ${replacement} Keep this sentence.`);
    expect(repaired[0].props.heading).toBe("Reviewing options");
  });

  it("keeps image bodies out of page-media summaries", () => {
    const compact = compactWebsiteBuilderMediaAsset({
      id: "media-1",
      role: "hero",
      prompt: "A page-specific hero image",
      sourceUrl: `data:image/webp;base64,PRIVATE_MEDIA_BYTES_${"A".repeat(9_000_000)}`,
      altText: "Service consultation",
    }, true);

    const serialized = JSON.stringify(compact);
    expect(serialized).not.toContain("PRIVATE_MEDIA_BYTES");
    expect(serialized.length).toBeLessThan(500);
    expect(compact).toMatchObject({ id: "media-1", sourceUrl: null, sourceAvailable: true });
  });

  it("keeps page bodies and media bytes out of the Website Builder overview", () => {
    const largeBody = `PRIVATE_PAGE_BODY_${"x".repeat(250_000)}`;
    const largeImage = `data:image/webp;base64,PRIVATE_IMAGE_BYTES_${"y".repeat(500_000)}`;
    const compact = compactWebsiteBuilderOverviewPage({
      id: "page-1",
      buildId: "build-1",
      parentPageId: null,
      pageType: "service",
      title: "Service",
      slug: "service",
      primaryKeyword: "service",
      secondaryKeywords: [],
      searchIntent: "commercial",
      targetUrl: "/service",
      targetCta: "Contact us",
      status: "review",
      sortOrder: 0,
      briefJson: {},
      contentJson: { components: [{ componentId: "content.rich_text", props: { body: largeBody } }] },
      seoJson: {},
      layoutJson: {},
      version: 1,
      approvedAt: null,
      remotePostId: null,
      remoteUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      generationPhase: "primary",
      seoQuality: undefined,
      approvalReadiness: undefined,
      mediaAssets: [{ id: "media-1", buildId: "build-1", pageId: "page-1", role: "hero", status: "review", prompt: "A useful hero image", sourceUrl: largeImage, storageKey: null, fileName: null, altText: "Service", mimeType: "image/webp", width: null, height: null, remoteMediaId: null, remoteUrl: null, approvedAt: null, createdAt: new Date(), updatedAt: new Date() }],
    });
    const serialized = JSON.stringify(compact);
    expect(serialized).not.toContain("PRIVATE_PAGE_BODY");
    expect(serialized).not.toContain("PRIVATE_IMAGE_BYTES");
    expect(serialized.length).toBeLessThan(5_000);
    expect(compact.mediaAssets[0]).toMatchObject({ sourceUrl: null, sourceAvailable: true });
  });

  it("never sends an embedded logo image in the logo colour-advisor prompt", () => {
    const embeddedLogo = `data:image/png;base64,${"A".repeat(520_504)}`;
    const context = logoPalettePromptBrand({
      logoUrl: embeddedLogo,
      logoData: embeddedLogo,
      primaryColor: "#0F766E",
      secondaryColor: "#14b8a6",
      accentColor: "not-a-colour",
      backgroundColor: "#f8fafc",
      textColor: "#0f172a",
      headingFont: "Inter",
      tone: "Professional and trustworthy",
    });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("AAAA");
    expect(serialized.length).toBeLessThan(1_000);
    expect(context).toMatchObject({
      primaryColor: "#0f766e",
      secondaryColor: "#14b8a6",
      backgroundColor: "#f8fafc",
      textColor: "#0f172a",
    });
    expect(context).not.toHaveProperty("accentColor");
    expect(context).not.toHaveProperty("headingFont");
  });

  it("keeps the complete logo colour-advisor prompt compact", () => {
    const embeddedLogo = `data:image/png;base64,${"B".repeat(520_504)}`;
    const prompt = logoPaletteAiPrompt(
      ["#0f766e", "#14b8a6", "#0F766E", "#f59e0b"],
      { logoUrl: embeddedLogo, primaryColor: "#0f766e", secondaryColor: "#14b8a6", backgroundColor: "#f8fafc", textColor: "#0f172a", headingFont: "Inter" },
      `Professional and trustworthy ${"very ".repeat(500)}`,
    );

    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThan(1_200);
    expect(prompt).not.toContain("data:image");
    expect(prompt).not.toContain("BBBB");
    expect(prompt.match(/#0f766e/g)).toHaveLength(2);
    expect(prompt).toContain("WCAG AA");
  });

  it("turns an HTML WordPress REST response into an actionable connection error", () => {
    expect(() => parseWordPressJsonResponse("<!DOCTYPE html><html><body>Login</body></html>", {
      endpoint: "https://example.com/wp-json/wp/v2/users/me?context=edit",
      status: 200,
      statusText: "OK",
      contentType: "text/html; charset=UTF-8",
    })).toThrow(/returned an HTML page instead of REST API JSON/);
  });

  it("parses a valid WordPress REST response", () => {
    expect(parseWordPressJsonResponse('{"id":7,"name":"Publisher"}', {
      endpoint: "https://example.com/wp-json/wp/v2/users/me?context=edit",
      status: 200,
      statusText: "OK",
      contentType: "application/json; charset=UTF-8",
    })).toEqual({ id: 7, name: "Publisher" });
  });

  it("keeps generated CSS compatible with older connector safety filters", () => {
    const css = ".menu{overflow-y:auto;overscroll-behavior:contain;border:1px solid #ddd}.card{color:#111}";
    const compatible = wordpressConnectorSafeCss(css);

    expect(compatible).not.toContain("overscroll-behavior");
    expect(compatible).toContain("overflow-y:auto");
    expect(compatible).toContain("border:1px solid #ddd");
    expect(compatible).toContain(".card{color:#111}");
  });

  it("uses release-scoped design CSS for drafts only with a compatible connector", () => {
    expect(shouldDeployWordPressDesignPackage({ mode: "draft", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.3.4" })).toBe(false);
    expect(shouldDeployWordPressDesignPackage({ mode: "draft", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.3.6" })).toBe(false);
    expect(shouldDeployWordPressDesignPackage({ mode: "draft", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.3.7" })).toBe(false);
    expect(shouldDeployWordPressDesignPackage({ mode: "draft", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.4.5" })).toBe(false);
    expect(shouldDeployWordPressDesignPackage({ mode: "draft", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.5.0" })).toBe(false);
    expect(shouldDeployWordPressDesignPackage({ mode: "draft", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.5.2" })).toBe(false);
    expect(shouldDeployWordPressDesignPackage({ mode: "draft", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.5.3" })).toBe(true);
    expect(shouldDeployWordPressDesignPackage({ mode: "pending", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.5.3" })).toBe(true);
    expect(shouldDeployWordPressDesignPackage({ mode: "publish", managedConnectorReady: true, deployDesignPackage: true, connectorVersion: "1.5.3" })).toBe(true);
  });

  it("requires the connector version that separates draft creation from theme activation", () => {
    expect(wordPressConnectorVersionAtLeast("1.4.4", "1.4.5")).toBe(false);
    expect(wordPressConnectorVersionAtLeast("1.4.5", "1.4.5")).toBe(true);
    expect(wordPressConnectorVersionAtLeast("1.5.0", "1.4.5")).toBe(true);
  });

  it("uses the exact WordPress permalink for hierarchical menu pages", () => {
    expect(wordpressMenuDestination("https://example.com/", {
      remoteUrl: "https://example.com/services/critical-illness-insurance/",
      slug: "critical-illness-insurance",
    })).toBe("https://example.com/services/critical-illness-insurance/");
    expect(wordpressMenuDestination("https://example.com/", { slug: "about" })).toBe("https://example.com/about");
    expect(wordpressMenuDestination("https://example.com/", {})).toBe("#");
  });

  it("reuses every reviewed WordPress draft when publishing the exact release", () => {
    const remoteIds = wordpressRemotePageIds({ pages: [
      { pageId: "home", remotePostId: "101", remoteUrl: "https://example.com/home-senuke-release/" },
      { pageId: "about", remotePostId: 102, remoteUrl: "https://example.com/about-senuke-release/" },
    ] }, ["home", "about"]);

    expect([...remoteIds ?? []]).toEqual([["home", "101"], ["about", "102"]]);
  });

  it("does not accept an incomplete draft mapping for live publication", () => {
    expect(wordpressRemotePageIds({ pages: [
      { pageId: "home", remotePostId: "101" },
      { pageId: "about", remotePostId: "" },
    ] }, ["home", "about"])).toBeNull();
  });

  it("promotes a reviewed draft without posting its page files and content again", () => {
    const payload = wordpressPageWritePayload({
      mode: "publish",
      promotingReviewedDraft: true,
      title: "About",
      slug: "about",
      content: "<!-- reviewed page blocks -->",
      excerpt: "Reviewed description",
      parent: 101,
      featuredMedia: 202,
    });

    expect(payload).toEqual({ status: "publish", slug: "about", parent: 101, featured_media: 202 });
    expect(payload).not.toHaveProperty("content");
    expect(payload).not.toHaveProperty("title");
    expect(payload).not.toHaveProperty("excerpt");
  });

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
