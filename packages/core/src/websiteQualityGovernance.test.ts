import { describe, expect, it } from "vitest";
import { evaluateWebsiteQualityGovernance } from "./websiteQualityGovernance.js";
import { createStaticWebsiteFiles, renderWebsitePageDocument } from "./websiteRenderer.js";
import { SENUKE_COMPONENT_REGISTRY_V1, type WebsiteModel } from "./websiteModel.js";

const model = (body: string, headline = "Super Visa Insurance in Brampton"): WebsiteModel => ({
  modelId: "model", websiteId: "website", projectId: "project", version: 1, status: "validated", componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
  identity: { businessName: "Example Insurance", contactEmail: "hello@example.test", contactPhone: "416-555-0100" },
  designSystem: { version: "1", colors: { primary: "#123456", secondary: "#234567", accent: "#f59e0b", background: "#fff", surface: "#fff", text: "#111", mutedText: "#555" }, typography: { headingFont: "Inter", bodyFont: "Inter" }, spacingScale: "comfortable", radiusScale: "medium" },
  pages: [{
    pageId: "page", name: "Super Visa Insurance in Brampton", slug: "/super-visa-insurance-brampton/", pageType: "service", primaryCta: { label: "Request a quote", url: "/contact/" },
    sections: [
      { instanceId: "hero", componentId: "hero.local_service", componentVersion: "1.0.0", variant: "split", props: { headline, summary: "Understand available coverage and next steps.", primaryCtaLabel: "Request a quote", primaryCtaUrl: "/contact/" } },
      { instanceId: "body", componentId: "content.rich_text", componentVersion: "1.0.0", variant: "answer_first", props: { heading: "Coverage information", body } },
    ],
    seo: { title: "Super Visa Insurance in Brampton | Example", metaDescription: "Learn about Super Visa insurance coverage in Brampton and request a consultation.", canonicalUrl: "/super-visa-insurance-brampton/", robots: "index, follow", primaryKeyword: "super visa insurance Brampton", secondaryKeywords: [], dominantIntent: "commercial", internalLinks: [], faqs: [], schemaJsonLd: { "@context": "https://schema.org", "@type": "Service" }, imageAltText: [] },
  }],
  navigation: [{ pageId: "page", label: "Super Visa Insurance" }], forms: [], mediaAssets: [],
});

describe("website quality governance", () => {
  it("blocks visitor-visible placeholders and internal instructions", () => {
    const result = evaluateWebsiteQualityGovernance(model("Insert the business phone here. Lorem ipsum."));
    expect(result.status).toBe("blocked");
    expect(result.issues.filter((issue) => issue.category === "content_leakage").every((issue) => issue.severity === "blocker")).toBe(true);
  });

  it("blocks unsupported regulated guarantees", () => {
    const result = evaluateWebsiteQualityGovernance(model("We guarantee the best returns for every client."), { industry: "Insurance and financial services" });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "regulated_or_guaranteed_claim", severity: "blocker", status: "open" })]));
  });

  it("allows a written waiver for high issues but never for blockers", () => {
    const draft = evaluateWebsiteQualityGovernance(model("Our experienced team explains the available options."));
    const high = draft.issues.find((issue) => issue.severity === "high");
    expect(high).toBeTruthy();
    const waived = evaluateWebsiteQualityGovernance(model("Our experienced team explains the available options."), { waivedIssues: { [high!.issueId]: "Approved as a documented exception by the manager." } });
    expect(waived.issues.find((issue) => issue.issueId === high!.issueId)?.status).toBe("waived");

    const blockerDraft = evaluateWebsiteQualityGovernance(model("Content goes here."));
    const blocker = blockerDraft.issues.find((issue) => issue.severity === "blocker")!;
    const notWaived = evaluateWebsiteQualityGovernance(model("Content goes here."), { waivedIssues: { [blocker.issueId]: "This must not bypass the blocker." } });
    expect(notWaived.issues.find((issue) => issue.issueId === blocker.issueId)?.status).toBe("open");
  });

  it("forces noindex on staging and restores production directives", () => {
    const website = model("Coverage depends on eligibility and policy terms.");
    const staging = renderWebsitePageDocument(website, website.pages[0], { environmentType: "staging", baseUrl: "https://staging.example.test" });
    const production = renderWebsitePageDocument(website, website.pages[0], { environmentType: "production", baseUrl: "https://example.test" });
    expect(staging).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(production).toContain('<meta name="robots" content="index, follow">');
    expect(production).toContain('<link rel="canonical" href="https://example.test/super-visa-insurance-brampton/">');
    expect(createStaticWebsiteFiles(website, { environmentType: "staging" }).find((file) => file.path === "robots.txt")?.content).toContain("Disallow: /");
  });
});
