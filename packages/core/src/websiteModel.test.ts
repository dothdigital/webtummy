import { describe, expect, it } from "vitest";
import {
  SENUKE_COMPONENT_REGISTRY_V1,
  WEBSITE_PAGE_MAXIMUM_WORDS,
  applyWebsiteGovernance,
  normalizeGeneratedComponentInstance,
  scoreSeoPage,
  validateComponentInstance,
  validateWebsiteModel,
  websiteContentGenerationPhase,
  websitePageCompositionPolicy,
  websiteMediaStatusHasApprovedDecision,
  type WebsiteModel,
  type WebsitePageModel,
} from "./websiteModel.js";

describe("website media lifecycle", () => {
  it("keeps a WordPress-uploaded image approved after publication", () => {
    expect(websiteMediaStatusHasApprovedDecision("approved")).toBe(true);
    expect(websiteMediaStatusHasApprovedDecision("uploaded")).toBe(true);
    expect(websiteMediaStatusHasApprovedDecision("review")).toBe(false);
  });
});

const page = (overrides: Partial<WebsitePageModel> = {}): WebsitePageModel => ({
  pageId: "page-super-visa-brampton",
  name: "Super Visa Insurance in Brampton",
  slug: "/super-visa-insurance-brampton/",
  pageType: "local_service",
  primaryCta: { label: "Request a Quote", url: "/request-a-quote/" },
  sections: [
    {
      instanceId: "hero-1",
      componentId: "hero.local_service",
      componentVersion: "1.0.0",
      variant: "split",
      props: {
        headline: "Super Visa Insurance in Brampton",
        summary: "Compare appropriate coverage options for visiting parents and grandparents.",
        primaryCtaLabel: "Request a Quote",
        primaryCtaUrl: "/request-a-quote/",
      },
    },
    {
      instanceId: "proof-1",
      componentId: "trust.proof",
      componentVersion: "1.0.0",
      variant: "credentials",
      props: {
        heading: "Insurance guidance for Brampton families",
        introduction: "Review policy conditions with a licensed professional.",
        items: [{ title: "Local consultation", description: "Speak with the Brampton service team." }],
      },
    },
    {
      instanceId: "overview-1",
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: {
        heading: "Super Visa insurance guidance",
        body: "Review the visitor's needs, current eligibility requirements, policy limits, exclusions, deductibles, and the application process before choosing coverage.",
      },
    },
    {
      instanceId: "faq-1",
      componentId: "content.faq",
      componentVersion: "1.0.0",
      variant: "accordion",
      props: {
        heading: "Super Visa insurance questions",
        items: [
          { question: "What coverage is required?", answer: "Confirm current requirements before purchasing." },
          { question: "How can I compare policies?", answer: "Review limits, deductibles, exclusions, and eligibility." },
          { question: "What information should I prepare?", answer: "Prepare the visitor details and the requirements needed to compare suitable options." },
          { question: "When should I request guidance?", answer: "Request guidance before choosing coverage when policy terms or eligibility need clarification." },
        ],
      },
    },
    {
      instanceId: "cta-1",
      componentId: "conversion.cta",
      componentVersion: "1.0.0",
      variant: "banner",
      props: {
        heading: "Compare coverage options",
        body: "Discuss the visitor's needs and the available policy conditions.",
        buttonLabel: "Request a Quote",
        buttonUrl: "/request-a-quote/",
      },
    },
  ],
  seo: {
    title: "Super Visa Insurance Brampton | Example Insurance",
    metaDescription: "Compare Super Visa insurance options in Brampton and request guidance choosing suitable coverage for visiting parents and grandparents.",
    canonicalUrl: "/super-visa-insurance-brampton/",
    robots: "index,follow",
    primaryKeyword: "super visa insurance Brampton",
    secondaryKeywords: ["super visa insurance quote Brampton"],
    dominantIntent: "local_commercial",
    location: { city: "Brampton", province: "Ontario", country: "Canada" },
    internalLinks: [],
    faqs: [
      { question: "What coverage is required?", answer: "Confirm current requirements before purchasing." },
      { question: "How can I compare policies?", answer: "Review limits, deductibles, exclusions, and eligibility." },
      { question: "What information should I prepare?", answer: "Prepare the visitor details and the requirements needed to compare suitable options." },
      { question: "When should I request guidance?", answer: "Request guidance before choosing coverage when policy terms or eligibility need clarification." },
    ],
    schemaJsonLd: { "@context": "https://schema.org", "@type": "Service" },
    imageAltText: ["Family discussing Super Visa insurance options in Brampton"],
  },
  ...overrides,
});

const model = (pages = [page()]): WebsiteModel => ({
  modelId: "model-1",
  websiteId: "website-1",
  projectId: "project-1",
  version: 1,
  status: "generated",
  componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
  designSystem: {
    version: "1.0.0",
    colors: {
      primary: "#1d4ed8",
      secondary: "#0f766e",
      accent: "#f59e0b",
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
      mutedText: "#475569",
    },
    typography: { headingFont: "Poppins", bodyFont: "Inter" },
    spacingScale: "comfortable",
    radiusScale: "medium",
  },
  pages,
  navigation: pages.map((item) => ({ pageId: item.pageId, label: item.name })),
  forms: [],
  mediaAssets: [],
});

describe("SENuke canonical Website Model", () => {
  it("uses a separately saved footer menu instead of the automatic footer groups", () => {
    const home = page({ pageId: "home", name: "Home", slug: "/", pageType: "home" });
    const contact = page({ pageId: "contact", name: "Contact Us", slug: "/contact/", pageType: "contact" });
    const governed = applyWebsiteGovernance(
      [home, contact],
      [{ pageId: "home", label: "Home" }],
      undefined,
      [
        { pageId: "custom-company", label: "Company", custom: true },
        { pageId: "contact", label: "Contact", parentPageId: "custom-company" },
        { pageId: "home", label: "Homepage" },
      ],
    );

    expect(governed.navigationModel.primaryMenu).toEqual([{ pageId: "home", label: "Home" }]);
    expect(governed.navigationModel.footerMenus).toEqual([
      { groupId: "custom-company", label: "Company", items: [{ pageId: "contact", label: "Contact", parentPageId: undefined }] },
      { groupId: "footer-links", label: "Quick links", items: [{ pageId: "home", label: "Homepage" }] },
    ]);
  });

  it("keeps every active website page in a partially customized footer", () => {
    const home = page({ pageId: "home", name: "Home", slug: "/", pageType: "home" });
    const service = page({ pageId: "service", name: "Life Insurance", slug: "/life-insurance/", pageType: "service" });
    const contact = page({ pageId: "contact", name: "Contact Us", slug: "/contact/", pageType: "contact" });
    const governed = applyWebsiteGovernance(
      [home, service, contact],
      [{ pageId: "home", label: "Home" }],
      undefined,
      [{ pageId: "contact", label: "Contact" }],
    );

    expect(governed.navigationModel.footerMenus).toEqual([
      { groupId: "footer-links", label: "Quick links", items: [{ pageId: "contact", label: "Contact" }] },
      { groupId: "remaining-pages", label: "More", items: [{ pageId: "home", label: "Home" }, { pageId: "service", label: "Life Insurance" }] },
    ]);
  });

  it("expands repeated short footer labels into distinct page names", () => {
    const toronto = page({ pageId: "toronto", name: "Insurance CRM Services in Toronto", slug: "/locations/toronto/insurance-crm/", pageType: "local_service" });
    const brampton = page({ pageId: "brampton", name: "Insurance CRM Services in Brampton", slug: "/locations/brampton/insurance-crm/", pageType: "local_service" });
    const governed = applyWebsiteGovernance(
      [toronto, brampton],
      [],
      undefined,
      [{ pageId: "toronto", label: "Services" }, { pageId: "brampton", label: "Services" }],
    );

    expect(governed.navigationModel.footerMenus[0].items.map((item) => item.label)).toEqual([
      "Insurance CRM Services in Toronto",
      "Insurance CRM Services in Brampton",
    ]);
  });

  it("merges legacy footer columns that use the same heading", () => {
    const life = page({ pageId: "life", name: "Life Insurance", slug: "/life-insurance/", pageType: "service" });
    const critical = page({ pageId: "critical", name: "Critical Illness Insurance", slug: "/critical-illness/", pageType: "service" });
    const governed = applyWebsiteGovernance(
      [life, critical],
      [],
      undefined,
      [
        { pageId: "legacy-services-one", label: "Services", custom: true },
        { pageId: "life", label: "Life Insurance", parentPageId: "legacy-services-one" },
        { pageId: "legacy-services-two", label: "Services", custom: true },
        { pageId: "critical", label: "Critical Illness Insurance", parentPageId: "legacy-services-two" },
      ],
    );

    expect(governed.navigationModel.footerMenus).toEqual([
      {
        groupId: "legacy-services-one",
        label: "Services",
        items: [
          { pageId: "life", label: "Life Insurance", parentPageId: undefined },
          { pageId: "critical", label: "Critical Illness Insurance", parentPageId: undefined },
        ],
      },
    ]);
  });

  it("rebuilds a duplicated saved footer into one appropriate group per page", () => {
    const home = page({ pageId: "home", name: "Home", slug: "/", pageType: "home" });
    const service = page({ pageId: "life", name: "Life Insurance", slug: "/life-insurance/", pageType: "service" });
    const governed = applyWebsiteGovernance(
      [home, service],
      [],
      undefined,
      [
        { pageId: "quick", label: "Quick links", custom: true },
        { pageId: "home", label: "Home", parentPageId: "quick" },
        { pageId: "life", label: "Life Insurance", parentPageId: "quick" },
        { pageId: "services", label: "Services", custom: true },
        { pageId: "life", label: "Life Insurance", parentPageId: "services" },
      ],
    );

    expect(governed.navigationModel.footerMenus.flatMap((group) => group.items).map((item) => item.pageId)).toEqual(["home", "life"]);
    expect(governed.navigationModel.footerMenus).toHaveLength(2);
  });

  it("supports intentionally removing a page from the footer", () => {
    const home = page({ pageId: "home", name: "Home", slug: "/", pageType: "home" });
    const contact = page({ pageId: "contact", name: "Contact Us", slug: "/contact/", pageType: "contact" });
    const governed = applyWebsiteGovernance([home, contact], [], undefined, [], ["contact"]);
    expect(governed.navigationModel.footerMenus.flatMap((group) => group.items).map((item) => item.pageId)).toEqual(["home"]);
  });

  it("reports when the Home first fold has no approved hero image", () => {
    const home = page({
      name: "Home",
      slug: "/",
      pageType: "home",
    });
    const releaseModel = model([home]);
    releaseModel.status = "validated";
    releaseModel.identity = {
      businessName: "Example Insurance",
      contactPhone: "+1 905 555 0100",
      contactEmail: "hello@example.com",
      copyrightText: "© 2026 Example Insurance. All rights reserved.",
    };
    const missing = validateWebsiteModel(releaseModel);
    expect(missing.findings.map((finding) => finding.code)).toContain("missing_home_first_fold_hero_image");

    const heroSection = releaseModel.pages[0].sections.find((section) => section.componentId === "hero.local_service")!;
    heroSection.props.imageAssetId = "home-hero";
    releaseModel.mediaAssets = [{ assetId: "home-hero", status: "approved", altText: "Family reviewing coverage options", sourceUrl: "https://example.com/home-hero.jpg" }];
    const supplied = validateWebsiteModel(releaseModel);
    expect(supplied.findings.map((finding) => finding.code)).not.toContain("missing_home_first_fold_hero_image");
  });

  it("uses page-specific composition instead of requiring a process block everywhere", () => {
    const home = websitePageCompositionPolicy({ pageType: "home", title: "Home", searchIntent: "navigational" });
    const service = websitePageCompositionPolicy({ pageType: "service", title: "Life Insurance", searchIntent: "commercial" });
    const contact = websitePageCompositionPolicy({ pageType: "conversion", title: "Contact Us", searchIntent: "navigational" });
    const faq = websitePageCompositionPolicy({ pageType: "supporting", title: "Frequently Asked Questions", searchIntent: "informational" });
    const blogSection = websitePageCompositionPolicy({ pageType: "blog_section", title: "Blog", searchIntent: "informational" });
    const blogArticle = websitePageCompositionPolicy({ pageType: "blog_article", title: "How to Compare Coverage", searchIntent: "informational" });
    const legal = websitePageCompositionPolicy({ pageType: "legal", title: "Privacy Policy", searchIntent: "navigational" });
    expect(home.requiredComponentIds).not.toContain("content.process");
    expect(service.recommendedComponentIds).toContain("content.process");
    expect(contact.requiredComponentIds).toContain("conversion.contact_form");
    expect(contact.requiredComponentIds).not.toContain("conversion.cta");
    expect(faq.archetype).toBe("faq");
    expect(faq.requiredComponentIds).toContain("content.faq");
    expect(faq.guidance).toContain("8–12");
    expect(blogSection.archetype).toBe("supporting");
    expect(blogSection.requiredComponentIds).toEqual(["hero.local_service"]);
    expect(blogSection.minimumFaqs).toBe(0);
    expect(blogArticle.archetype).toBe("supporting");
    expect(blogArticle.requiredComponentIds).toContain("content.rich_text");
    expect(blogArticle.minimumFaqs).toBe(4);
    expect(contact.minimumFaqs).toBe(0);
    expect(legal.requiredComponentIds).toEqual(["hero.local_service", "content.rich_text"]);
    expect(legal.minimumFaqs).toBe(0);
    expect(websitePageCompositionPolicy({ pageType: "team", title: "Our Team" }).minimumFaqs).toBe(0);
    expect(websitePageCompositionPolicy({ pageType: "portfolio", title: "Portfolio" }).minimumFaqs).toBe(0);
  });

  it("does not require Service schema for a transactional Contact page", () => {
    const contact = page({
      name: "Contact Us",
      pageType: "conversion",
      seo: {
        ...page().seo,
        dominantIntent: "transactional",
        schemaJsonLd: {
          "@context": "https://schema.org",
          "@type": "ContactPage",
          about: { "@type": "Organization", name: "Example Insurance" },
        },
      },
    });
    const result = validateWebsiteModel(model([contact]));
    expect(result.findings.map((finding) => finding.code)).not.toContain("missing_service_entity_schema");
  });

  it("uses one universal maximum word ceiling for every page archetype", () => {
    const examples = [
      { pageType: "legal", title: "Privacy Policy", searchIntent: "navigational" },
      { pageType: "contact", title: "Contact Us", searchIntent: "navigational" },
      { pageType: "home", title: "Home", searchIntent: "navigational" },
      { pageType: "case_study", title: "Case Studies", searchIntent: "commercial" },
      { pageType: "service", title: "About Us", searchIntent: "navigational" },
      { pageType: "location", title: "Service in Toronto", searchIntent: "local" },
      { pageType: "resource", title: "Buyer Guide", searchIntent: "informational" },
      { pageType: "service", title: "Core Service", searchIntent: "commercial" },
    ];
    expect(examples.map((example) => websitePageCompositionPolicy(example).maximumWords))
      .toEqual(examples.map(() => WEBSITE_PAGE_MAXIMUM_WORDS));
  });

  it("keeps content-depth targets advisory after a page is validated", () => {
    const releaseModel = model();
    releaseModel.status = "validated";
    const result = validateWebsiteModel(releaseModel);
    const depthFinding = result.findings.find((finding) => finding.code === "content_depth_recommendation");
    expect(depthFinding?.severity).toBe("warning");
  });

  it("accepts the registered contact enquiry form", () => {
    const findings = validateComponentInstance({
      instanceId: "contact-form-1",
      componentId: "conversion.contact_form",
      componentVersion: "1.0.0",
      variant: "split",
      props: {
        heading: "Tell us how we can help",
        introduction: "Send your question and the team will follow up.",
        formId: "primary-contact",
        fields: [
          { label: "Name", name: "name", inputType: "text", required: true },
          { label: "Email", name: "email", inputType: "email", required: true },
          { label: "Message", name: "message", inputType: "textarea", required: true },
        ],
        submitLabel: "Send enquiry",
        successMessage: "Thank you. Your enquiry has been received.",
      },
    });
    expect(findings).toEqual([]);
  });

  it("accepts registered component instances", () => {
    expect(validateComponentInstance(page().sections[0])).toEqual([]);
    expect(validateWebsiteModel(model()).valid).toBe(true);
  });

  it("validates governed nested blocks inside a section layout", () => {
    const layout = {
      instanceId: "layout-1",
      componentId: "layout.section",
      componentVersion: "1.0.0",
      variant: "two_equal",
      props: {
        backgroundColor: "primary",
        textColor: "white",
        backgroundOverlay: 40,
        spacing: "comfortable",
        columnOne: [page().sections[2]],
        columnTwo: [page().sections[4]],
        columnThree: [],
      },
    };
    expect(validateComponentInstance(layout)).toEqual([]);
    expect(validateComponentInstance({
      ...layout,
      props: { ...layout.props, columnOne: [page().sections[0]] },
    }).map((finding) => finding.code)).toContain("disallowed_nested_component");
  });

  it("rejects unknown components before editing or publishing", () => {
    const invalid = page();
    invalid.sections[0] = { ...invalid.sections[0], componentId: "custom.random.hero" };
    const result = validateWebsiteModel(model([invalid]));
    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.code === "unknown_component")).toBe(true);
  });

  it("rejects unknown props and unsafe URLs", () => {
    const section = page().sections[0];
    section.props.customJavascript = "alert(1)";
    section.props.primaryCtaUrl = "javascript:alert(1)";
    const findings = validateComponentInstance(section);
    expect(findings.map((finding) => finding.code)).toContain("unknown_component_prop");
    expect(findings.map((finding) => finding.code)).toContain("unsafe_component_url");
  });

  it("accepts safe same-page CTA anchors used by landing-page forms", () => {
    const section = page().sections[0];
    section.props.primaryCtaUrl = "#lead-magnet-registration";
    expect(validateComponentInstance(section).map((finding) => finding.code)).not.toContain("unsafe_component_url");
  });

  it("repairs generated size limits without allowing unsupported props", () => {
    const generated = {
      instanceId: "services-1",
      componentId: "service.grid",
      componentVersion: "1.0.0",
      variant: "three_column",
      props: {
        heading: "Insurance services",
        introduction: "A detailed introduction ".repeat(30),
        items: Array.from({ length: 10 }, (_, index) => ({ title: `Service ${index + 1}`, description: "Details" })),
        customJavascript: "alert(1)",
      },
    } satisfies WebsitePageModel["sections"][number];
    const normalized = normalizeGeneratedComponentInstance(generated);
    expect(String(normalized.props.introduction).length).toBeLessThanOrEqual(240);
    expect(normalized.props.items).toHaveLength(8);
    expect(validateComponentInstance(normalized).map((finding) => finding.code)).toEqual(["unknown_component_prop"]);
  });

  it("shortens generated CTA labels to the registered button limit", () => {
    const generated = {
      instanceId: "cta-1",
      componentId: "conversion.cta",
      componentVersion: "1.0.0",
      variant: "banner",
      props: {
        heading: "Discuss your insurance requirements",
        body: "Speak with the team about the options relevant to your needs.",
        buttonLabel: "Contact our insurance specialists for personalized assistance",
        buttonUrl: "/contact/",
      },
    } satisfies WebsitePageModel["sections"][number];

    const normalized = normalizeGeneratedComponentInstance(generated);
    expect(String(normalized.props.buttonLabel).length).toBeLessThanOrEqual(40);
    expect(validateComponentInstance(normalized)).toEqual([]);
  });

  it("orders primary, local authority, and supporting pages for staged generation", () => {
    expect(websiteContentGenerationPhase({ pageType: "home", searchIntent: "navigational" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "about", searchIntent: "navigational" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "contact", searchIntent: "navigational" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "conversion", searchIntent: "navigational" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "service", searchIntent: "navigational", authorityPageKey: "page-about-business-trust" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "service", searchIntent: "navigational", authorityPageKey: "page-privacy-policy-legal" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "service", searchIntent: "commercial", authorityClusterRole: "global" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "hub", searchIntent: "commercial", authorityClusterRole: "global" })).toBe("primary");
    expect(websiteContentGenerationPhase({ pageType: "service", searchIntent: "navigational", authorityClusterRole: "global" })).toBe("supporting");
    expect(websiteContentGenerationPhase({ pageType: "location_hub", searchIntent: "local", authorityClusterRole: "location_hub", authorityLocation: "Brampton" })).toBe("authority");
    expect(websiteContentGenerationPhase({ pageType: "local_service", searchIntent: "local", authorityClusterRole: "service", authorityLocation: "Brampton" })).toBe("authority");
    expect(websiteContentGenerationPhase({ pageType: "service", searchIntent: "local_service" })).toBe("authority");
    expect(websiteContentGenerationPhase({ pageType: "supporting", searchIntent: "informational", authorityClusterRole: "supporting", authorityLocation: "Brampton" })).toBe("supporting");
  });

  it("blocks duplicate intent and thin city-swap content", () => {
    const toronto = page({
      pageId: "page-super-visa-toronto",
      name: "Super Visa Insurance in Toronto",
      slug: "/super-visa-insurance-toronto/",
      seo: {
        ...page().seo,
        title: "Super Visa Insurance Toronto | Example Insurance",
        canonicalUrl: "/super-visa-insurance-toronto/",
        location: { city: "Toronto", province: "Ontario", country: "Canada" },
      },
    });
    const result = validateWebsiteModel(model([page(), toronto]));
    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.code === "high_duplicate_content_risk")).toBe(true);
  });

  it("keeps missing local evidence advisory-only after website validation", () => {
    const website = { ...model(), status: "validated" as const };
    const result = validateWebsiteModel(website);
    const localEvidenceFinding = result.findings.find((finding) => finding.code === "missing_local_uniqueness_evidence");

    expect(localEvidenceFinding?.severity).toBe("warning");
    expect(scoreSeoPage(website.pages[0], website, result).blockingFindings)
      .not.toContainEqual(expect.objectContaining({ code: "missing_local_uniqueness_evidence" }));
  });

  it("blocks an incomplete approved location authority cluster", () => {
    const hub = page({
      authority: {
        pageKey: "location-brampton-hub",
        clusterKey: "location-brampton",
        clusterRole: "location_hub",
        location: "Brampton",
        authorityScore: 72,
      },
    });
    const website: WebsiteModel = {
      ...model([hub]),
      locationAuthorityGraph: [{
        location: "Brampton",
        clusterKey: "location-brampton",
        authorityScore: 72,
        competitionLevel: "medium",
        demandLevel: "medium",
        evidenceConfidence: "moderate",
        requiredPageCount: 3,
        hubPageKey: "location-brampton-hub",
        servicePageKeys: ["location-brampton-service-super-visa"],
        supportingPageKeys: ["location-brampton-support-cost-guide"],
        neighbourhoodPageKeys: [],
        rationale: "Approved keyword and competitor evidence requires a hub, service page, and supporting guide.",
        schemaTypes: ["Organization", "Service", "FAQPage"],
        internalLinkRules: ["The hub and child pages must link in both directions."],
      }],
    };
    const result = validateWebsiteModel(website);
    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.code === "incomplete_location_authority_cluster")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "location_authority_cluster_too_small")).toBe(true);
  });

  it("produces a version-specific SEO score", () => {
    const website = model();
    const score = scoreSeoPage(website.pages[0], website);
    expect(score.score).toBeGreaterThanOrEqual(90);
    expect(score.status).toBe("ready");
    expect(score.checks.find((check) => check.key === "h1")?.status).toBe("pass");
  });

  it("does not penalize a contact page without body-level internal links", () => {
    const contact = page({
      pageId: "contact-page",
      name: "Contact Example Insurance",
      slug: "/contact/",
      pageType: "contact",
      seo: { ...page().seo, internalLinks: [], canonicalUrl: "/contact/" },
    });
    const website = model([page(), contact]);
    const score = scoreSeoPage(contact, website);
    expect(score.checks.find((check) => check.key === "internal_links")).toEqual(expect.objectContaining({ status: "pass", score: 10 }));
  });

  it("does not force FAQs through validation or quality scoring on excluded page types", () => {
    for (const [pageType, name] of [["privacy", "Privacy Policy"], ["terms", "Terms and Conditions"], ["contact", "Contact Us"], ["team", "Our Team"], ["portfolio", "Portfolio"], ["blog_section", "Blog"]] as const) {
      const candidate = page({
        pageId: `no-faq-${pageType}`,
        name,
        pageType,
        sections: page().sections.filter((section) => section.componentId !== "content.faq"),
        seo: { ...page().seo, faqs: [], canonicalUrl: `/${pageType}/`, dominantIntent: pageType === "blog_section" ? "informational" : page().seo.dominantIntent },
      });
      const website = model([candidate]);
      const validation = validateWebsiteModel(website);
      expect(validation.findings.some((finding) => finding.code === "insufficient_page_faqs"), pageType).toBe(false);
      expect(scoreSeoPage(candidate, website, validation).checks.find((check) => check.key === "faq"), pageType)
        .toEqual(expect.objectContaining({ status: "pass", score: 5 }));
    }
  });

  it("blocks release quality when the canonical is missing", () => {
    const invalidPage = page({ seo: { ...page().seo, canonicalUrl: "" } });
    const website = model([invalidPage]);
    const score = scoreSeoPage(invalidPage, website);
    expect(score.status).toBe("blocked");
    expect(score.blockingReasons.some((reason) => reason.includes("canonical"))).toBe(true);
    expect(score.blockingFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_canonical", severity: "blocking" }),
    ]));
  });

  it("does not attach page 10 findings to page 1", () => {
    const pages = Array.from({ length: 11 }, (_, index) => {
      const base = page();
      return page({
        pageId: `page-${index}`,
        name: `Service Page ${index}`,
        slug: `/service-${index}/`,
        intentOwner: `service-${index}`,
        sections: index === 10 ? [] : base.sections,
        seo: {
          ...base.seo,
          title: `Service Page ${index} | Example Insurance`,
          metaDescription: `Review the details, options, and next steps available on service page ${index} from Example Insurance before requesting guidance.`,
          canonicalUrl: `/service-${index}/`,
          primaryKeyword: `service page ${index}`,
        },
      });
    });
    const website = model(pages);
    const validation = validateWebsiteModel(website);
    const pageOneScore = scoreSeoPage(pages[1], website, validation);
    const pageTenScore = scoreSeoPage(pages[10], website, validation);

    expect(pageOneScore.blockingReasons.some((reason) => reason.includes("Service Page 10"))).toBe(false);
    expect(pageTenScore.blockingReasons.some((reason) => reason.includes("Service Page 10 has no registered sections"))).toBe(true);
  });
});
