import { describe, expect, it } from "vitest";
import { emailSequenceHtml, emailSequenceText, leadCaptureWidgetHtml, leadFunnelOptimizationRecommendations, leadMagnetLandingPageHtml, leadMagnetWebsitePageDraft, leadOpportunityRecommendations, renderLeadMagnetPdf, validateLeadFunnelForPublish, validateProviderEmbedCode } from "./routes/lead-magnets.js";
import { websitePageHasCompleteContent } from "@webtummy/core/website-generation";
import { leadMagnetBodyWordCount, leadMagnetRecommendationIsFresh, openAiWebCitations } from "./routes/projects-v2.js";

const completeFunnel = {
  status: "approved",
  title: "Local SEO Checklist",
  magnetType: "Checklist",
  assetJson: {
    title: "Local SEO Checklist",
    promise: "Find and fix local visibility gaps.",
    sections: [{ title: "Profile", summary: "Start with identity accuracy.", paragraphs: ["Review every saved business detail before editing listings."], bullets: ["Confirm the business name."], actionStep: "Record inconsistencies." }],
    businessAnalysis: { business: "North Star SEO", audience: "Local business owners", offer: "Local SEO services", goal: "Qualified leads" },
    branding: { businessName: "North Star SEO", brandVoice: "Clear and practical", primaryColor: "#2563EB", secondaryColor: "#0F766E" },
    imagePlan: [{ role: "diagram", altText: "Local SEO profile review flow", sourceLabel: "Google Business Profile Help", sourceUrl: "https://support.google.com/business/" }],
    generatedImages: [{ role: "diagram", altText: "Profile review", sourceLabel: "Google Business Profile Help", sourceUrl: "https://support.google.com/business/", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }],
    coverImage: "data:image/svg+xml;base64,PHN2Zy8+",
  },
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

  it("recommends a new buyer-stage or format opportunity after sustained low conversion", () => {
    const rows = leadFunnelOptimizationRecommendations({ views: 600, optIns: 6, conversionRate: 1, openRate: 35, clickRate: 5 }, 5);
    expect(rows.map((row) => row.title)).toContain("Test a new lead magnet opportunity");
  });

  it("passes a complete approved funnel with a recently verified ESP", () => {
    const result = validateLeadFunnelForPublish(completeFunnel, connectedEsp);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  });

  it("accepts a validated provider form embed without requiring an API integration", () => {
    const providerEmbed = '<form action="https://forms.example.com/subscribe" method="post"><input type="email" name="email"><button>Join</button></form>';
    expect(validateProviderEmbedCode(providerEmbed)).toBe(providerEmbed);
    const result = validateLeadFunnelForPublish(completeFunnel, {
      status: "connected",
      lastVerifiedAt: new Date(),
      listId: "provider-form",
      endpointUrl: null,
      provider: "provider_embed",
      credentialCiphertext: "encrypted-provider-form",
      fieldMappingsJson: { mode: "sandboxed_provider_form" },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects incomplete, insecure, and nested provider embeds", () => {
    expect(() => validateProviderEmbedCode("<form><input name=\"email\"></form>")).toThrow("complete HTTPS");
    expect(() => validateProviderEmbedCode('<script src="http://forms.example.com/embed.js"></script>')).toThrow("complete HTTPS");
    expect(() => validateProviderEmbedCode('<iframe src="https://forms.example.com" srcdoc="<script></script>"></iframe>')).toThrow("Nested srcdoc");
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

  it("supports a 1,000–2,000 word mini eBook as a downloadable lead magnet", async () => {
    const miniEbook = { ...completeFunnel, magnetType: "Mini eBook (1,000–2,000 words)" };
    expect(validateLeadFunnelForPublish(miniEbook, connectedEsp).valid).toBe(true);
    const pdf = await renderLeadMagnetPdf(miniEbook);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("counts only generated lead-magnet body copy for the requested word target", () => {
    expect(leadMagnetBodyWordCount({
      title: "Excluded title",
      sections: [{
        title: "Excluded section title",
        summary: "Four useful words here",
        paragraphs: ["Another practical paragraph appears now"],
        bullets: ["Check every important detail"],
        actionStep: "Record the result",
      }],
    })).toBe(16);
  });

  it("extracts clickable evidence citations returned by OpenAI web research", () => {
    expect(openAiWebCitations({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "Evidence",
          annotations: [{ type: "url_citation", title: "Statistics Canada", url: "https://www.statcan.gc.ca/example" }],
        }],
      }],
    })).toEqual([{ title: "Statistics Canada", url: "https://www.statcan.gc.ca/example" }]);
  });

  it("rejects renamed refresh recommendations that repeat the same core concept", () => {
    const previous = [{
      title: "Canadian Visitor Insurance Checklist",
      signal: "Visitors need help comparing medical coverage requirements.",
      why: "A checklist simplifies visitor insurance preparation.",
      newKeywordAngle: "visitor insurance Canada",
    }];
    expect(leadMagnetRecommendationIsFresh({
      title: "Visitor Insurance Preparation Checklist for Canada",
      signal: "Help visitors compare medical coverage requirements.",
      why: "A preparation checklist simplifies visitor insurance decisions.",
      newKeywordAngle: "Canada visitor insurance",
    }, previous)).toBe(false);
    expect(leadMagnetRecommendationIsFresh({
      title: "Super Visa Waiting-Period Cost Calculator",
      signal: "Applicants ask how waiting periods change expected out-of-pocket cost.",
      why: "A calculator addresses decision-stage cost planning.",
      newKeywordAngle: "super visa insurance waiting period cost",
    }, previous)).toBe(true);
  });

  it("requires visible HTTPS sources for factual visuals in every lead magnet format", () => {
    const assetJson = {
      ...completeFunnel.assetJson,
      generatedImages: [{ role: "chart", altText: "Lead conversion comparison", sourceLabel: "Internal conversion report", sourceUrl: "", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }],
    };
    const result = validateLeadFunnelForPublish({ ...completeFunnel, assetJson }, connectedEsp);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Every factual chart, image, and diagram requires a visible source label and HTTPS source URL.");
    expect(result.checks.brandAndImages).toBe(false);
  });

  it("allows clearly labelled decorative AI-generated illustrations without an external URL", () => {
    const assetJson = {
      ...completeFunnel.assetJson,
      generatedImages: [{ role: "image", altText: "Decorative local map", sourceLabel: "AI-generated illustration based on project evidence", sourceUrl: null, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }],
    };
    expect(validateLeadFunnelForPublish({ ...completeFunnel, assetJson }, connectedEsp).valid).toBe(true);
  });

  it("detects a visitor-insurance lead opportunity from business and page evidence", () => {
    const rows = leadOpportunityRecommendations({
      businessName: "Maple Cover",
      niche: "Canadian visitor insurance",
      audience: "Visitors to Canada and Super Visa applicants",
      offer: "Visitor medical insurance coverage",
      goal: "Increase qualified quote requests",
      market: "Canada",
      pages: [
        { url: "https://example.com/visitor-insurance", title: "Visitor Insurance Canada", commercial: true, hasLeadCapture: false },
        { url: "https://example.com/super-visa", title: "Super Visa Insurance", commercial: true, hasLeadCapture: false },
      ],
      keywords: [{ keyword: "visitor insurance canada", monthlySearches: 1_200 }],
      hasPublishedFunnel: false,
    });
    expect(rows[0]).toMatchObject({ type: "Checklist", title: "Canadian Visitor Insurance Checklist", buyerStage: "consideration", actionLabel: "Generate with AI" });
    expect(rows[0].estimatedImpact.high).toBeGreaterThan(rows[0].estimatedImpact.low);
    expect(rows[0].signal).toContain("no explicit downloadable capture CTA");
    expect(rows[0].evidence.join(" ")).toContain("1,200 combined monthly searches");
  });

  it("labels impact as directional when measured demand or crawl evidence is unavailable", () => {
    const [row] = leadOpportunityRecommendations({ businessName: "Acme Advisory", niche: "consulting", audience: "Small businesses", offer: "Advisory", goal: "Consultations", market: "", pages: [], keywords: [], hasPublishedFunnel: false });
    expect(row.estimatedImpact.confidence).toBe("directional");
    expect(row.estimatedImpact.disclaimer).toContain("not a guaranteed result");
    expect(row.evidence.some((item) => item.includes("No completed crawl evidence"))).toBe(true);
  });

  it("exports portable email and website-widget handoff files", () => {
    const text = emailSequenceText(completeFunnel);
    const html = emailSequenceHtml(completeFunnel);
    const widget = leadCaptureWidgetHtml({ ...completeFunnel, publicSlug: "local-seo-checklist" });
    expect(text).toContain("DELIVERY EMAIL");
    expect(text).toContain("FOLLOW-UP 1");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Email sequence");
    expect(widget).toContain("data-senuke-lead-widget");
    expect(widget).toContain("/local-seo-checklist/subscribe");
  });

  it("exports a complete responsive landing page with an active delivery form", () => {
    const html = leadMagnetLandingPageHtml({ ...completeFunnel, publicSlug: "local-seo-checklist" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Fix local visibility gaps");
    expect(html).toContain("/local-seo-checklist/subscribe");
    expect(html).toContain("data-download");
    expect(html).not.toContain("disabled>Send my checklist");
  });

  it("carries a provider form into the widget, landing HTML, and Site Architect handoff", () => {
    const providerEmbedCode = '<script src="https://forms.example.com/embed.js"></script><form action="https://forms.example.com/subscribe"></form>';
    const widget = leadCaptureWidgetHtml({ ...completeFunnel, publicSlug: "local-seo-checklist", providerEmbedCode });
    const landing = leadMagnetLandingPageHtml({ ...completeFunnel, publicSlug: "local-seo-checklist", providerEmbedCode });
    expect(widget).toContain('sandbox="allow-forms allow-scripts allow-popups"');
    expect(widget).toContain("forms.example.com");
    expect(widget).not.toContain("/local-seo-checklist/subscribe");
    expect(landing).toContain("senuke-provider-form-embed");
    expect(landing).not.toContain('id="registration-form"');

    const draft = leadMagnetWebsitePageDraft({
      ...completeFunnel,
      id: "funnel-provider",
      seriesId: "series-provider",
      version: 1,
      audience: "Local business owners",
      publicUrl: "https://app.example.com/lead/local-seo-checklist",
    }, {
      title: "Local SEO Checklist",
      slug: "local-seo-checklist",
      primaryKeyword: "local SEO checklist",
      targetCta: "Send my checklist",
      includeInNavigation: false,
    }, { providerEmbedHtml: providerEmbedCode });
    const components = draft.contentJson.components as Array<{ componentId: string; props: Record<string, unknown> }>;
    const formComponent = components.find((component) => component.componentId === "conversion.contact_form");
    expect(formComponent?.props.providerEmbedHtml).toBe(providerEmbedCode);
    expect(formComponent?.props.submissionUrl).toBeUndefined();
    expect(draft.briefJson.leadMagnet).toMatchObject({ status: "connected_draft", captureReady: true });
  });

  it("creates an approved website draft before registration is connected and marks the remaining setup", () => {
    const draft = leadMagnetWebsitePageDraft({
      ...completeFunnel,
      id: "funnel-approved",
      seriesId: "series-approved",
      version: 3,
      audience: "Local business owners",
      publicUrl: null,
    }, {
      title: "Local SEO Checklist",
      slug: "local-seo-checklist",
      primaryKeyword: "local SEO checklist",
      targetCta: "Send my checklist",
      includeInNavigation: false,
    }, {});

    expect(draft.briefJson.leadMagnet).toMatchObject({
      funnelId: "funnel-approved",
      version: 3,
      status: "form_setup_required",
      captureReady: false,
    });
    expect(draft.briefJson.conversionPlan).toContain("setup is still required");
    const components = draft.contentJson.components as Array<{ componentId: string; props: Record<string, unknown> }>;
    const form = components.find((component) => component.componentId === "conversion.contact_form");
    expect(form?.props.providerEmbedHtml).toBeUndefined();
    expect(form?.props.submissionUrl).toBeUndefined();
  });

  it("supports both gated sales-pitch and full promotional landing pages", () => {
    const landingWithFaqs = {
      ...completeFunnel.landingPageJson,
      faqs: [{ question: "Who is this for?", answer: "Local business owners preparing to improve visibility." }],
    };
    const pitch = leadMagnetLandingPageHtml({ ...completeFunnel, landingPageJson: { ...landingWithFaqs, contentMode: "sales_pitch" }, publicSlug: "local-seo-checklist" });
    expect(pitch).toContain("Inside the resource");
    expect(pitch).toContain("Frequently asked questions");
    expect(pitch).not.toContain("Review every saved business detail before editing listings.");

    const full = leadMagnetLandingPageHtml({ ...completeFunnel, landingPageJson: { ...landingWithFaqs, contentMode: "full_content" }, publicSlug: "local-seo-checklist" });
    expect(full).toContain("Complete content");
    expect(full).toContain("Review every saved business detail before editing listings.");
    expect(full).toContain("Confirm the business name.");
    expect(full).toContain('id="registration-form"');
  });

  it("maps an approved lead funnel into editable Site Architect components", () => {
    const draft = leadMagnetWebsitePageDraft({
      ...completeFunnel,
      id: "funnel-1",
      seriesId: "series-1",
      version: 2,
      audience: "Local business owners",
      publicUrl: "https://app.example.com/lead/local-seo-checklist",
    }, {
      title: "Local SEO Checklist",
      slug: "local-seo-checklist",
      primaryKeyword: "local SEO checklist",
      targetCta: "Send my checklist",
      includeInNavigation: false,
    }, {
      submissionUrl: "https://api.example.com/api/public/lead-magnets/local-seo-checklist/subscribe",
      imageAssetId: "image-1",
    });
    const components = draft.contentJson.components as Array<{ componentId: string; props: Record<string, unknown> }>;
    expect(components.map((component) => component.componentId)).toEqual(expect.arrayContaining(["hero.local_service", "service.benefits", "conversion.contact_form", "conversion.cta"]));
    expect(components.find((component) => component.componentId === "conversion.contact_form")?.props.submissionUrl).toContain("/subscribe");
    expect(draft.briefJson.leadMagnet).toMatchObject({ funnelId: "funnel-1", seriesId: "series-1", version: 2 });
    expect(draft.seoJson.canonicalUrl).toBe("/local-seo-checklist");
    expect(websitePageHasCompleteContent({
      content: draft.contentJson,
      status: "review",
      pageType: "landing",
      title: "Local SEO Checklist",
      searchIntent: "transactional",
    })).toBe(true);
  });

  it("preserves full promotional content and FAQs in the Site Architect handoff", () => {
    const draft = leadMagnetWebsitePageDraft({
      ...completeFunnel,
      id: "funnel-full",
      seriesId: "series-full",
      version: 1,
      audience: "Local business owners",
      publicUrl: "https://app.example.com/lead/local-seo-checklist",
      landingPageJson: {
        ...completeFunnel.landingPageJson,
        contentMode: "full_content",
        faqs: [{ question: "Who is this for?", answer: "Local business owners." }],
      },
    }, {
      title: "Local SEO Promotional Page",
      slug: "local-seo-offer",
      primaryKeyword: "local SEO offer",
      targetCta: "Register interest",
      includeInNavigation: false,
    }, {
      submissionUrl: "https://api.example.com/api/public/lead-magnets/local-seo-checklist/subscribe",
    });
    const components = draft.contentJson.components as Array<{ componentId: string; props: Record<string, unknown> }>;
    expect(components.find((component) => component.componentId === "content.rich_text")?.props.body).toContain("Review every saved business detail");
    expect(components.find((component) => component.componentId === "content.faq")?.props.items).toEqual([{ question: "Who is this for?", answer: "Local business owners." }]);
    expect(draft.briefJson.leadMagnet).toMatchObject({ contentMode: "full_content" });
  });
});
