import { describe, expect, it } from "vitest";
import {
  ensureConciseFirstSupportingOverview,
  ensurePageSpecificFirstH2,
  fitWebsiteAiChatRequest,
  fitWebsiteComponentsToWordBudget,
  jsonSchemaFromWebsiteShape,
  strictWebsiteJsonResponseFormat,
  websiteContentProgress,
  websiteContentBatchPageMode,
  websiteDraftAcceptanceWords,
  websiteJobRecoveryAction,
  websitePageHasCompleteContent,
  websitePageUniquenessCollisions,
  websiteRichTextExpansionBudget,
  websiteSectionGroupBudgets,
  websiteFirstSupportingHeading,
  WEBSITE_AI_REQUEST_BYTE_BUDGET,
} from "./websiteGeneration.js";
import {
  SENUKE_COMPONENT_REGISTRY_V1,
  validateComponentInstance,
  type WebsiteComponentInstance,
} from "./websiteModel.js";

describe("website generation workflow contracts", () => {
  it("compacts the exact oversized Website Builder failure class before the AI request", () => {
    const request = {
      model: "website-model",
      max_tokens: 8_000,
      response_format: { type: "json_schema", json_schema: { name: "website_page", strict: true, schema: { type: "object" } } },
      messages: [
        { role: "system", content: "Return governed website JSON only." },
        {
          role: "user",
          content: `BEGIN GOVERNING CONTRACT\n${"approved SEO evidence ".repeat(130_126)}\nFINAL REQUIREMENTS: preserve the approved SEO Plan and return the required schema.`,
        },
      ],
    };

    const bounded = fitWebsiteAiChatRequest(request);
    expect(new TextEncoder().encode(JSON.stringify(bounded)).byteLength).toBeLessThanOrEqual(WEBSITE_AI_REQUEST_BYTE_BUDGET);
    expect(bounded.messages[1].content).toContain("BEGIN GOVERNING CONTRACT");
    expect(bounded.messages[1].content).toContain("evidence omitted to stay within the model context limit");
    expect(bounded.messages[1].content).toContain("FINAL REQUIREMENTS");
    expect(bounded.response_format).toEqual(request.response_format);
  });

  it("does not alter Website Builder requests already inside the safe context budget", () => {
    const request = { model: "website-model", messages: [{ role: "user", content: "small page request" }] };
    expect(fitWebsiteAiChatRequest(request)).toEqual(request);
  });

  it("repairs a generic or repeated first H2 with a page-specific supporting heading", () => {
    const components: WebsiteComponentInstance[] = [
      {
        instanceId: "service-hero",
        componentId: "hero.local_service",
        componentVersion: "1.0.0",
        variant: "split",
        props: { eyebrow: "Life insurance", headline: "Life Insurance", summary: "Compare suitable coverage.", primaryCtaLabel: "Talk to an advisor", primaryCtaUrl: "/contact/" },
      },
      {
        instanceId: "service-overview",
        componentId: "content.rich_text",
        componentVersion: "1.0.0",
        variant: "answer_first",
        props: { heading: "A solution aligned to your goals", body: "Start with the customer need." },
      },
    ];
    const repaired = ensurePageSpecificFirstH2(components, {
      title: "Life Insurance",
      pageType: "service",
      primaryKeyword: "life insurance in Edmonton",
    }, "Lifex Insurance");
    expect(repaired[1].props.heading).toBe("life insurance in Edmonton: what to know before you decide");
    expect(components[1].props.heading).toBe("A solution aligned to your goals");
    expect(websiteFirstSupportingHeading({ pageTitle: "About Us", pageType: "about", businessName: "Lifex Insurance" })).toBe("A closer look at Lifex Insurance");
  });

  it("preserves a useful original first H2 that is not duplicated", () => {
    const components: WebsiteComponentInstance[] = [{
      instanceId: "service-overview",
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: { heading: "Choose coverage around your family's priorities", body: "Useful content." },
    }];
    expect(ensurePageSpecificFirstH2(components, { title: "Life Insurance", primaryKeyword: "life insurance" })[0].props.heading)
      .toBe("Choose coverage around your family's priorities");
    expect(ensurePageSpecificFirstH2(components, { title: "Life Insurance", primaryKeyword: "life insurance" }, "Advisor", [{
      pageId: "other-page",
      pageTitle: "Other page",
      seoTitles: [],
      metaDescriptions: [],
      h1s: [],
      h2s: ["Choose coverage around your family's priorities"],
    }])[0].props.heading).toBe("life insurance: what to know before you decide");
  });

  it("shrinks and separates an oversized second-fold overview into short paragraphs", () => {
    const body = [
      "Start by identifying the protection gap, the people affected, and the financial result the coverage should support.",
      "Compare eligibility, waiting periods, exclusions, benefit definitions, and how the policy responds when circumstances change.",
      "Review affordability over time instead of choosing only by the first quoted premium or the largest headline amount.",
      "Ask how personal savings, workplace benefits, existing insurance, and other resources affect the amount that may be suitable.",
      "Document the assumptions used in the comparison so they can be revisited when income, family responsibilities, or business needs change.",
      "A licensed advisor can then explain the available options and help identify questions that still require evidence.",
      "The final choice should reflect the approved need, budget, policy terms, and the applicant's actual information.",
      "No general website explanation replaces an individual assessment or the terms of an issued policy.",
    ].join(" ");
    const components: WebsiteComponentInstance[] = [{
      instanceId: "overview",
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: { heading: "Coverage decisions for your circumstances", body: `${body} ${body}` },
    }];
    const formatted = ensureConciseFirstSupportingOverview(components);
    const paragraphs = String(formatted[0].props.body).split("\n\n");
    expect(String(formatted[0].props.body).split(/\s+/)).toHaveLength(130);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.every((paragraph) => paragraph.length > 0)).toBe(true);
    expect(String(components[0].props.body)).not.toContain("\n\n");
  });

  it("rejects duplicate generated SEO titles, descriptions, and H1s before save", () => {
    const reserved = [{
      pageId: "home",
      pageTitle: "Home",
      seoTitles: ["Physiotherapy Clinic in Mississauga | Procare"],
      metaDescriptions: ["Book evidence-based physiotherapy care in Mississauga and choose a clear next step for assessment and recovery."],
      h1s: ["Physiotherapy and rehabilitation in Mississauga"],
    }];
    expect(websitePageUniquenessCollisions({
      seoTitle: "  Physiotherapy Clinic in Mississauga | Procare ",
      metaDescription: "Book evidence-based physiotherapy care in Mississauga and choose a clear next step for assessment and recovery.",
      h1: "Physiotherapy and Rehabilitation in Mississauga",
    }, reserved).map((collision) => collision.field)).toEqual(["seo_title", "meta_description", "h1"]);
  });

  it("keeps imported updates and new-page generation separate inside one content batch", () => {
    expect(websiteContentBatchPageMode({ contentWorkspaceBatch: true, targetedExistingSiteUpdates: false, importedExistingWebsite: true, hasTargetedRequirements: true })).toBe("targeted_update");
    expect(websiteContentBatchPageMode({ contentWorkspaceBatch: true, targetedExistingSiteUpdates: false, importedExistingWebsite: false, hasTargetedRequirements: false })).toBe("full_page");
    expect(websiteContentBatchPageMode({ contentWorkspaceBatch: true, targetedExistingSiteUpdates: false, importedExistingWebsite: true, hasTargetedRequirements: false })).toBe("skip");
    expect(websiteContentBatchPageMode({ contentWorkspaceBatch: false, targetedExistingSiteUpdates: true, importedExistingWebsite: false, hasTargetedRequirements: true })).toBe("skip");
  });

  it("does not reset work already owned by BullMQ", () => {
    expect(websiteJobRecoveryAction({ databaseStatus: "processing", queueState: "active" })).toBe("preserve");
    expect(websiteJobRecoveryAction({ databaseStatus: "queued", queueState: "waiting" })).toBe("preserve");
    expect(websiteJobRecoveryAction({ databaseStatus: "processing", queueState: "missing" })).toBe("requeue");
    expect(websiteJobRecoveryAction({ databaseStatus: "completed", queueState: "missing" })).toBe("ignore");
  });

  it("turns component object lists into strict nested array schemas", () => {
    const schema = jsonSchemaFromWebsiteShape({
      sections: {
        services: {
          items: [{ title: "", description: "" }],
          steps: [{ title: "", description: "" }],
        },
      },
    });
    const sections = schema.properties as Record<string, Record<string, unknown>>;
    const sectionProperties = (sections.sections.properties as Record<string, Record<string, unknown>>).services.properties as Record<string, Record<string, unknown>>;
    expect(sectionProperties.items.type).toBe("array");
    expect(sectionProperties.steps.type).toBe("array");
    expect((sectionProperties.items.items as Record<string, unknown>).type).toBe("object");
    expect(strictWebsiteJsonResponseFormat("Page sections", {}).json_schema.name).toBe("Page_sections");
  });

  it("keeps heterogeneous website component props tied to their registered component identity", () => {
    const schema = jsonSchemaFromWebsiteShape({
      content: {
        components: [
          {
            instanceId: "page-hero",
            componentId: "hero.local_service",
            componentVersion: "1.0.0",
            variant: "split",
            props: { eyebrow: "", headline: "", summary: "", primaryCtaLabel: "", primaryCtaUrl: "" },
          },
          {
            instanceId: "page-rich-text",
            componentId: "content.rich_text",
            componentVersion: "1.0.0",
            variant: "answer_first",
            props: { heading: "", body: "" },
          },
          {
            instanceId: "page-cta",
            componentId: "conversion.cta",
            componentVersion: "1.0.0",
            variant: "banner",
            props: { heading: "", body: "", buttonLabel: "", buttonUrl: "" },
          },
        ],
      },
    });
    const content = (schema.properties as Record<string, Record<string, unknown>>).content;
    const components = (content.properties as Record<string, Record<string, unknown>>).components;
    const alternatives = (components.items as { anyOf: Array<Record<string, unknown>> }).anyOf;
    expect(alternatives).toHaveLength(3);
    const identities = alternatives.map((alternative) => {
      const properties = alternative.properties as Record<string, Record<string, unknown>>;
      return {
        componentId: (properties.componentId.enum as string[])[0],
        propNames: Object.keys((properties.props.properties as Record<string, unknown>)),
      };
    });
    expect(identities).toEqual([
      expect.objectContaining({ componentId: "hero.local_service", propNames: expect.arrayContaining(["headline", "summary"]) }),
      expect.objectContaining({ componentId: "content.rich_text", propNames: ["heading", "body"] }),
      expect.objectContaining({ componentId: "conversion.cta", propNames: expect.arrayContaining(["buttonLabel", "buttonUrl"]) }),
    ]);
  });

  it("keeps every AI page section aligned across structured output and registry validation", () => {
    const components: WebsiteComponentInstance[] = [
      {
        instanceId: "page-hero",
        componentId: "hero.local_service",
        componentVersion: "1.0.0",
        variant: "split",
        props: {
          eyebrow: "Local service",
          headline: "A useful local service",
          summary: "Clear help for customers evaluating this service.",
          primaryCtaLabel: "Get started",
          primaryCtaUrl: "/contact",
        },
      },
      {
        instanceId: "page-rich-text",
        componentId: "content.rich_text",
        componentVersion: "1.0.0",
        variant: "answer_first",
        props: { heading: "What customers need to know", body: "Useful explanatory copy." },
      },
      {
        instanceId: "page-services",
        componentId: "service.grid",
        componentVersion: "1.0.0",
        variant: "three_column",
        props: {
          heading: "Services",
          introduction: "Choose the service that matches your needs.",
          items: [{ title: "Service one", description: "A clear service description." }],
        },
      },
      {
        instanceId: "page-benefits",
        componentId: "service.benefits",
        componentVersion: "1.0.0",
        variant: "checklist",
        props: {
          heading: "Benefits",
          items: [{ title: "Clear next step", description: "Know what happens next." }],
        },
      },
      {
        instanceId: "page-process",
        componentId: "content.process",
        componentVersion: "1.0.0",
        variant: "steps",
        props: {
          heading: "Our process",
          steps: [{ title: "Discovery", description: "Confirm needs and constraints." }],
        },
      },
      {
        instanceId: "page-proof",
        componentId: "trust.proof",
        componentVersion: "1.0.0",
        variant: "credentials",
        props: {
          heading: "Why customers trust us",
          introduction: "Use only approved evidence.",
          items: [{ title: "Verified evidence", description: "Approved proof belongs here." }],
        },
      },
      {
        instanceId: "page-faq",
        componentId: "content.faq",
        componentVersion: "1.0.0",
        variant: "accordion",
        props: {
          heading: "Frequently asked questions",
          items: [{ question: "How does this work?", answer: "A concise, useful answer." }],
        },
      },
      {
        instanceId: "page-cta",
        componentId: "conversion.cta",
        componentVersion: "1.0.0",
        variant: "banner",
        props: {
          heading: "Ready to continue?",
          body: "Talk with the team about the right next step.",
          buttonLabel: "Contact us",
          buttonUrl: "/contact",
        },
      },
    ];
    expect(components.flatMap((component) =>
      validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1))).toEqual([]);

    const schema = jsonSchemaFromWebsiteShape({ content: { components } });
    const content = (schema.properties as Record<string, Record<string, unknown>>).content;
    const componentArray = (content.properties as Record<string, Record<string, unknown>>).components;
    const alternatives = (componentArray.items as { anyOf: Array<Record<string, unknown>> }).anyOf;
    expect(alternatives).toHaveLength(components.length);

    for (const component of components) {
      const definition = SENUKE_COMPONENT_REGISTRY_V1.components.find(
        (candidate) => candidate.componentId === component.componentId,
      );
      const alternative = alternatives.find((candidate) => {
        const properties = candidate.properties as Record<string, Record<string, unknown>>;
        return (properties.componentId.enum as string[])[0] === component.componentId;
      });
      expect(alternative, component.componentId).toBeDefined();
      const properties = alternative!.properties as Record<string, Record<string, unknown>>;
      expect(properties.instanceId.enum).toEqual([component.instanceId]);
      expect(properties.componentVersion.enum).toEqual([component.componentVersion]);
      expect(properties.variant.enum).toEqual([component.variant]);
      expect(Object.keys(properties.props.properties as Record<string, unknown>).sort())
        .toEqual(Object.keys(component.props).sort());
      expect(Object.keys(component.props).every((key) => Boolean(definition?.fields[key]))).toBe(true);
    }
  });

  it("assigns richer groups more copy than hero and CTA groups", () => {
    const budgets = websiteSectionGroupBudgets(
      [["hero.local_service"], ["content.rich_text", "service.grid"], ["content.faq", "conversion.cta"]],
      650,
      750,
    );
    expect(budgets[1].targetWords).toBeGreaterThan(budgets[0].targetWords);
    expect(budgets.every((budget) => budget.minimumWords < budget.targetWords)).toBe(true);
    expect(budgets.every((budget) => budget.maximumWords <= 750)).toBe(true);
  });

  it("separates the editorial target from the incomplete-draft rejection floor", () => {
    expect(websiteDraftAcceptanceWords(650)).toBe(520);
    expect(websiteDraftAcceptanceWords(250)).toBe(200);
  });

  it("keeps multi-section expansion inside the page-level word ceiling", () => {
    const utilityBudget = websiteRichTextExpansionBudget({
      nonRichTextWords: 50,
      sectionCount: 2,
      minimumPageWords: 200,
      maximumPageWords: 450,
    });
    expect(utilityBudget.targetWordsPerSection).toBe(97);
    expect(utilityBudget.maximumCombinedWords).toBe(400);
    expect(utilityBudget.targetWordsPerSection * 2 + 50).toBeLessThanOrEqual(450);

    const serviceBudget = websiteRichTextExpansionBudget({
      nonRichTextWords: 260,
      sectionCount: 2,
      minimumPageWords: 520,
      maximumPageWords: 750,
    });
    expect(serviceBudget.targetWordsPerSection * 2 + 260).toBeLessThanOrEqual(750);
    expect(serviceBudget.targetWordsPerSection * 2 + 260).toBeGreaterThanOrEqual(520);
  });

  it("accepts a substantive contact-page expansion without imposing a service-page section minimum", () => {
    const acceptedMinimum = websiteDraftAcceptanceWords(280);
    const contactBudget = websiteRichTextExpansionBudget({
      nonRichTextWords: 70,
      sectionCount: 1,
      minimumPageWords: acceptedMinimum,
      maximumPageWords: 1_000,
    });

    expect(acceptedMinimum).toBe(224);
    expect(contactBudget.minimumAcceptedWordsPerSection).toBeLessThan(256);
    expect(256 + 70).toBeGreaterThan(acceptedMinimum);
  });

  it("fits an overlong AI response to the approved word ceiling without changing its structure", () => {
    const components: WebsiteComponentInstance[] = [
      {
        instanceId: "page-copy",
        componentId: "content.rich_text",
        componentVersion: "1.0.0",
        variant: "standard",
        props: { heading: "Detailed guidance", body: Array.from({ length: 1_100 }, (_, index) => `word${index}`).join(" ") },
      },
      {
        instanceId: "page-cta",
        componentId: "conversion.cta",
        componentVersion: "1.0.0",
        variant: "banner",
        props: { heading: "Continue", body: "Choose the appropriate next step.", buttonLabel: "Contact us", buttonUrl: "/contact" },
      },
    ];
    const fitted = fitWebsiteComponentsToWordBudget(components, 1_000);
    const visibleWords = JSON.stringify(fitted.flatMap((component) => Object.values(component.props)))
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    expect(visibleWords).toBeLessThanOrEqual(1_000);
    expect(fitted.map((component) => component.componentId)).toEqual(components.map((component) => component.componentId));
    expect(fitted[1].props.buttonUrl).toBe("/contact");
  });

  it("keeps overall progress tied to all project pages", () => {
    expect(websiteContentProgress({ totalPages: 18, generatedPages: 14, jobStatus: "completed" })).toBe(78);
    expect(websiteContentProgress({
      totalPages: 18,
      generatedPages: 8,
      jobStatus: "processing",
      jobProgress: 48,
      queuedPages: 10,
      checkpointedPages: 8,
    })).toBeGreaterThanOrEqual(44);
    expect(websiteContentProgress({
      totalPages: 18,
      generatedPages: 8,
      jobStatus: "processing",
      jobProgress: 48,
      queuedPages: 10,
      checkpointedPages: 8,
    })).toBeLessThan(50);
  });

  it("counts only generated registered pages as complete", () => {
    const content = {
      componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
      components: [
        {
          instanceId: "utility-hero",
          componentId: "hero.local_service",
          componentVersion: "1.0.0",
          variant: "split",
          props: {
            headline: "Privacy Policy",
            summary: "Review how information is handled when using this website.",
            primaryCtaLabel: "Contact us",
            primaryCtaUrl: "/contact/",
          },
        },
        {
          instanceId: "utility-copy",
          componentId: "content.rich_text",
          componentVersion: "1.0.0",
          variant: "standard",
          props: {
            heading: "How information is handled",
            body: "This page explains the approved website privacy information.",
          },
        },
      ],
    };

    expect(websitePageHasCompleteContent({ content: {}, status: "planned", pageType: "utility", title: "Privacy Policy" })).toBe(false);
    expect(websitePageHasCompleteContent({
      content: { componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version, components: [] },
      status: "review",
      pageType: "utility",
      title: "Privacy Policy",
    })).toBe(false);
    expect(websitePageHasCompleteContent({ content, status: "planned", pageType: "utility", title: "Privacy Policy" })).toBe(false);
    expect(websitePageHasCompleteContent({ content, status: "review", pageType: "utility", title: "Privacy Policy" })).toBe(true);
  });
});
