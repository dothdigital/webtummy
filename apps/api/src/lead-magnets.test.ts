import { describe, expect, it } from "vitest";
import { leadFunnelOptimizationRecommendations, renderLeadMagnetPdf, validateLeadFunnelForPublish } from "./routes/lead-magnets.js";

const completeFunnel = {
  status: "approved",
  title: "Local SEO Checklist",
  magnetType: "Checklist",
  assetJson: { title: "Local SEO Checklist", promise: "Find and fix local visibility gaps.", sections: [{ title: "Profile", bullets: ["Confirm the business name."] }] },
  landingPageJson: { headline: "Fix local visibility gaps", subheadline: "Use a practical checklist before your next campaign.", benefitBullets: ["Prioritize the highest-impact fixes"], ctaText: "Send my checklist" },
  optInFormJson: { fields: [{ name: "email", label: "Email", type: "email", required: true }], submitLabel: "Send my checklist", consentText: "I agree to receive this resource and relevant follow-up email." },
  thankYouPageJson: { headline: "Your checklist is ready", body: "Download it now or check your inbox." },
  deliveryEmailJson: { subject: "Your local SEO checklist", body: "Use this checklist to review your local presence." },
  followUpSequenceJson: [{ day: "Day 2", subject: "Start with this fix", body: "Begin with your business profile." }],
  abTestsJson: [{ element: "headline" }, { element: "cta" }, { element: "form" }],
  seoMetadataJson: { title: "Local SEO Checklist", description: "A practical local visibility checklist." },
  trackingPlanJson: ["Views", "Opt-ins", "Downloads", "Email opens", "Email clicks"],
};

const connectedEsp = {
  status: "connected",
  lastVerifiedAt: new Date(),
  listId: "list-1",
  endpointUrl: "https://api.example.com",
  provider: "mailchimp",
  fieldMappingsJson: { email: "email", firstName: "first_name", lastName: "last_name" },
};

describe("DEV-011C lead funnel optimization", () => {
  it("does not overstate performance before a useful traffic sample exists", () => {
    const rows = leadFunnelOptimizationRecommendations({ views: 20, optIns: 3, conversionRate: 15, openRate: 0, clickRate: 0 }, 5);
    expect(rows.some((row) => row.title.includes("reliable traffic sample"))).toBe(true);
  });

  it("recommends a conversion test when performance is below target", () => {
    const rows = leadFunnelOptimizationRecommendations({ views: 200, optIns: 4, conversionRate: 2, openRate: 40, clickRate: 1 }, 5);
    expect(rows.map((row) => row.title)).toContain("Test the headline and form friction");
    expect(rows.map((row) => row.title)).toContain("Strengthen the email next step");
  });

  it("keeps a healthy funnel stable and changes one variable at a time", () => {
    const rows = leadFunnelOptimizationRecommendations({ views: 500, optIns: 45, conversionRate: 9, openRate: 48, clickRate: 8 }, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toContain("one headline, CTA, or form variation");
  });

  it("passes a complete approved funnel with a recently verified ESP", () => {
    const result = validateLeadFunnelForPublish(completeFunnel, connectedEsp);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  });

  it("blocks incomplete assets, forms, metadata, links, and stale ESP verification", () => {
    const result = validateLeadFunnelForPublish({
      ...completeFunnel,
      status: "draft",
      magnetType: "Whitepaper",
      assetJson: { title: "", promise: "", downloadUrl: "javascript:alert(1)" },
      landingPageJson: { headline: "", subheadline: "", benefitBullets: [], ctaText: "" },
      optInFormJson: { fields: [{ name: "", label: "", type: "text" }], submitLabel: "", consentText: "" },
      thankYouPageJson: {},
      deliveryEmailJson: {},
      followUpSequenceJson: [{ day: "", subject: "", body: "" }],
      abTestsJson: [],
      seoMetadataJson: {},
      trackingPlanJson: [],
    }, {
      ...connectedEsp,
      lastVerifiedAt: new Date("2020-01-01T00:00:00.000Z"),
      fieldMappingsJson: {},
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Approve this funnel before publishing.",
      "Choose one of the supported lead magnet formats.",
      "The opt-in form must include an email field.",
      "SEO and AI-friendly title and description are missing.",
    ]));
    expect(result.errors.some((error) => error.includes("invalid or unsafe links"))).toBe(true);
  });

  it("renders generated document lead magnets as real PDF downloads", async () => {
    const pdf = await renderLeadMagnetPdf({ title: completeFunnel.title, magnetType: completeFunnel.magnetType, assetJson: completeFunnel.assetJson });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
