import { describe, expect, it } from "vitest";
import { buildCitationAudit, claimFingerprint, visibilityStatus } from "./ai-citation-engine.js";

const baseInput = {
  businessName: "Example Business",
  websiteUrl: "https://example.com",
  businessSummary: "A verified project-intake summary.",
  offerSummary: "A verified service description.",
  targetAudience: "Canadian businesses",
  targetLocations: ["Canada"],
  approvedKeywords: ["AI visibility consulting"],
  competitors: [],
  crawl: {
    id: "crawl-1", completedAt: new Date(), pageCount: 10, indexablePageCount: 9,
    organizationSchemaCount: 1, websiteSchemaCount: 1, personSchemaCount: 1,
    faqSchemaCount: 1, breadcrumbSchemaCount: 3, invalidSchemaCount: 0,
    aboutPageFound: true, contactPageFound: true, privacyPageFound: true,
    termsPageFound: true, authorEvidenceFound: true, referenceEvidenceFound: true,
    llmsTxtPresent: true, sitemapPresent: true, robotsAccessible: true,
  },
  observedVisibility: { observationCount: 0, mentionCount: 0, accurateCount: 0 },
};

describe("AI citation engine", () => {
  it("produces explainable scores without promising citations", () => {
    const result = buildCitationAudit(baseInput);
    expect(result.scores.overallScore).toBeGreaterThan(70);
    expect(JSON.stringify(result)).not.toMatch(/guarantee(?:d)? citation/i);
  });

  it("marks answer opportunities as inferences", () => {
    const result = buildCitationAudit(baseInput);
    expect(result.opportunities.length).toBeGreaterThan(0);
    expect(result.opportunities.every((item) => item.isInference && item.evidence.inferredOpportunity === true)).toBe(true);
  });

  it("distinguishes observed visibility states", () => {
    expect(visibilityStatus({ mentionDetected: false, sourceCount: 0 })).toBe("not_observed");
    expect(visibilityStatus({ mentionDetected: true, accuracyStatus: "inaccurate", sourceCount: 1 })).toBe("mentioned_inaccurately");
    expect(visibilityStatus({ mentionDetected: true, accuracyStatus: "accurate", sourceCount: 2 })).toBe("mentioned_with_sources");
  });

  it("creates stable claim fingerprints", () => {
    expect(claimFingerprint("service", "  Offers AI audits ")).toBe("service:offers ai audits");
  });
});
