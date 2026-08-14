import { describe, expect, it } from "vitest";
import { evaluateWebsiteLaunchReadiness } from "./websiteLaunchReadiness.js";
import { SENUKE_COMPONENT_REGISTRY_V1, type WebsiteModel } from "./websiteModel.js";

const validModel: WebsiteModel = {
  modelId: "model-1",
  websiteId: "website-1",
  projectId: "project-1",
  version: 1,
  status: "validated",
  componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
  designSystem: {
    version: "1.0.0",
    colors: { primary: "#2563eb", secondary: "#0f766e", accent: "#f59e0b", background: "#f8fafc", surface: "#ffffff", text: "#0f172a", mutedText: "#475569" },
    typography: { headingFont: "Poppins", bodyFont: "Inter" },
    spacingScale: "comfortable",
    radiusScale: "medium",
  },
  pages: [{
    pageId: "page-1",
    name: "Super Visa Insurance in Brampton",
    slug: "/super-visa-insurance-brampton/",
    pageType: "service",
    primaryCta: { label: "Request a quote", url: "/contact/" },
    sections: [{
      instanceId: "hero-1",
      componentId: "hero.local_service",
      componentVersion: "1.0.0",
      variant: "split",
      props: {
        headline: "Super Visa Insurance in Brampton",
        summary: "Compare appropriate coverage with a local insurance professional.",
        primaryCtaLabel: "Request a quote",
        primaryCtaUrl: "/contact/",
      },
    }, {
      instanceId: "overview-1",
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: { heading: "Coverage guidance", body: "Review current eligibility, coverage, limits, exclusions, deductibles, and application requirements before choosing a policy." },
    }, {
      instanceId: "faq-1",
      componentId: "content.faq",
      componentVersion: "1.0.0",
      variant: "accordion",
      props: {
        heading: "Super Visa insurance questions",
        items: [
          { question: "What should I compare before choosing coverage?", answer: "Review current eligibility, coverage limits, exclusions, deductibles, policy duration, and application requirements with a qualified professional." },
          { question: "Can coverage needs differ by visitor?", answer: "Yes. Age, health information, travel plans, existing protection, and current program requirements can affect the options that should be reviewed." },
          { question: "When should I request insurance guidance?", answer: "Request guidance before finalizing an application so there is time to review current requirements, documentation, coverage terms, and effective dates." },
          { question: "What can a consultation clarify?", answer: "A consultation can explain available considerations, while eligibility, acceptance, pricing, and policy terms remain subject to verified insurer requirements." },
        ],
      },
    }, {
      instanceId: "proof-1",
      componentId: "trust.proof",
      componentVersion: "1.0.0",
      variant: "credentials",
      props: { heading: "Local guidance", introduction: "Use verified business information.", items: [{ title: "Brampton support", description: "Discuss the visitor's situation and current requirements." }] },
    }, {
      instanceId: "cta-1",
      componentId: "conversion.cta",
      componentVersion: "1.0.0",
      variant: "banner",
      props: { heading: "Discuss coverage", body: "Ask questions and review suitable next steps.", buttonLabel: "Request a quote", buttonUrl: "/contact/" },
    }],
    seo: {
      title: "Super Visa Insurance Brampton | Example",
      metaDescription: "Compare Super Visa insurance options in Brampton and speak with a local professional about suitable coverage.",
      canonicalUrl: "/super-visa-insurance-brampton/",
      robots: "index,follow",
      primaryKeyword: "super visa insurance Brampton",
      secondaryKeywords: [],
      dominantIntent: "commercial",
      internalLinks: [],
      faqs: [
        { question: "What should I compare before choosing coverage?", answer: "Review current eligibility, coverage limits, exclusions, deductibles, policy duration, and application requirements with a qualified professional." },
        { question: "Can coverage needs differ by visitor?", answer: "Yes. Age, health information, travel plans, existing protection, and current program requirements can affect the options that should be reviewed." },
        { question: "When should I request insurance guidance?", answer: "Request guidance before finalizing an application so there is time to review current requirements, documentation, coverage terms, and effective dates." },
        { question: "What can a consultation clarify?", answer: "A consultation can explain available considerations, while eligibility, acceptance, pricing, and policy terms remain subject to verified insurer requirements." },
      ],
      schemaJsonLd: { "@context": "https://schema.org", "@graph": [{ "@type": "Service", name: "Super Visa Insurance" }, { "@type": "FAQPage", mainEntity: [
        { "@type": "Question", name: "What should I compare before choosing coverage?", acceptedAnswer: { "@type": "Answer", text: "Review current eligibility, coverage limits, exclusions, deductibles, policy duration, and application requirements with a qualified professional." } },
        { "@type": "Question", name: "Can coverage needs differ by visitor?", acceptedAnswer: { "@type": "Answer", text: "Yes. Age, health information, travel plans, existing protection, and current program requirements can affect the options that should be reviewed." } },
        { "@type": "Question", name: "When should I request insurance guidance?", acceptedAnswer: { "@type": "Answer", text: "Request guidance before finalizing an application so there is time to review current requirements, documentation, coverage terms, and effective dates." } },
        { "@type": "Question", name: "What can a consultation clarify?", acceptedAnswer: { "@type": "Answer", text: "A consultation can explain available considerations, while eligibility, acceptance, pricing, and policy terms remain subject to verified insurer requirements." } },
      ] }] },
      imageAltText: [],
    },
  }],
  navigation: [{ pageId: "page-1", label: "Super Visa Insurance" }],
  forms: [],
  mediaAssets: [],
};

describe("website launch readiness", () => {
  it("checks an immutable release and all renderer outputs", () => {
    const result = evaluateWebsiteLaunchReadiness(validModel, { approvedReleaseId: "release-1", snapshotHash: "abc123" });
    expect(result.blockingCount, JSON.stringify({ checks: result.checks, qualityGate: result.qualityGate }, null, 2)).toBe(0);
    expect(result.status).toBe("ready_with_warnings");
    expect(result.output.fileCount).toBeGreaterThanOrEqual(6);
    expect(result.checks.find((check) => check.key === "technical_files")?.status).toBe("passed");
  });

  it("blocks duplicate URLs and metadata before publication", () => {
    const duplicate: WebsiteModel = {
      ...validModel,
      pages: [
        validModel.pages[0],
        { ...validModel.pages[0], pageId: "page-2", name: "Duplicate" },
      ],
      navigation: [
        validModel.navigation[0],
        { pageId: "page-2", label: "Duplicate" },
      ],
    };
    const result = evaluateWebsiteLaunchReadiness(duplicate, { approvedReleaseId: "release-2", snapshotHash: "def456" });
    expect(result.status).toBe("blocked");
    expect(result.checks.find((check) => check.key === "unique_urls")?.status).toBe("blocking");
    expect(result.checks.find((check) => check.key === "unique_metadata")?.status).toBe("blocking");
  });

  it("keeps high-priority copy recommendations visible without locking publication", () => {
    const recommendationOnly: WebsiteModel = {
      ...validModel,
      pages: [{
        ...validModel.pages[0],
        sections: validModel.pages[0].sections.map((section) => section.instanceId === "overview-1"
          ? { ...section, props: { ...section.props, heading: "Our Services" } }
          : section),
      }],
    };
    const result = evaluateWebsiteLaunchReadiness(recommendationOnly, {
      approvedReleaseId: "release-recommendations",
      snapshotHash: "recommendations-snapshot",
    });

    expect(result.qualityGate.counts.high).toBeGreaterThan(0);
    expect(result.qualityGate.status).toBe("needs_review");
    expect(result.checks.find((check) => check.key === "quality_governance")?.status).toBe("warning");
    expect(result.blockingCount).toBe(0);
  });

  it("reports large generated media without blocking its own release", () => {
    const generatedMedia: WebsiteModel = {
      ...validModel,
      mediaAssets: [{
        assetId: "generated-hero",
        status: "approved",
        altText: "Generated website hero",
        sourceUrl: `data:image/png;base64,${"A".repeat(12_000_000)}`,
      }],
    };
    const result = evaluateWebsiteLaunchReadiness(generatedMedia, {
      approvedReleaseId: "release-large-media",
      snapshotHash: "large-media-snapshot",
    });

    expect(result.output.mediaBytes).toBeGreaterThan(8_000_000);
    expect(result.checks.find((check) => check.key === "performance_budget")).toMatchObject({
      status: "passed",
      label: "Static output size",
    });
    expect(result.checks.find((check) => check.key === "rendered_pages")?.status).toBe("passed");
    expect(result.blockingCount).toBe(0);
  });
});
