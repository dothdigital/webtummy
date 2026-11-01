import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../queue.js", () => ({ websiteBuilderQueue: { add: vi.fn() }, crawlQueue: { add: vi.fn() }, keywordResearchQueue: { add: vi.fn() } }));
vi.mock("../central-ai-service.js", () => ({ centralAiJson: vi.fn() }));
import { centralAiJson } from "../central-ai-service.js";
import { applyAiPageFaqSuggestions, contentPlanFor, enrichSavedContentPlan, parseCompatibleContentPlan } from "./execution-tasks.js";
const cta = "Request a Growth Friction Assessment";
const context: Parameters<typeof applyAiPageFaqSuggestions>[1] = {
  goal: "Qualified assessments", locations: ["Grand Falls", "New Brunswick"],
  reviewComment: `Use the exact CTA ${cta}. Cover the province without thin duplicate location pages.`,
  business: { version: "ai_business_context_v1", sourceFingerprint: "test-kpiry", businessName: "KPIRY", industry: "Growth marketing", coreBusinessValue: "Identify and resolve growth friction", primaryServices: ["Growth marketing"], audienceSummary: "Businesses seeking sustainable growth", homepagePrimaryTopic: "Growth marketing", brandDescription: "Growth marketing and friction assessments", interpretationNotes: ["Approved business evidence"], evidenceSources: ["reviewer"], requiresBusinessNameConfirmation: false },
};
function savedPlan(): Parameters<typeof applyAiPageFaqSuggestions>[0] {
  const base = contentPlanFor({ projectName: "KPIRY", businessName: "KPIRY", goal: context.goal, markets: [], keywords: ["Growth marketing"], offer: "Growth marketing", audience: "Businesses", contentStrategy: null, localSeoEnabled: false, websiteUrl: null, websitePages: [] });
  const pages = [["Home", "/"], ["About", "/about/"], ["Growth Friction Assessment", "/growth-friction-assessment"], ["Privacy Policy", "/privacy-policy/"], ["Growth Marketing Services", "/growth-marketing-services/"]];
  return { ...base, pageAssignments: pages.map(([pageName, targetUrl], i) => ({ ...base.pageAssignments[0], pageName, targetUrl, pageKey: `saved-${i}`, intentOwner: targetUrl, ctaSuggestion: cta, faqTopics: [], faqStrategyVersion: undefined, seoTitle: undefined, metaDescription: undefined, contentOutline: undefined, contentBrief: undefined, supportingContentIdeas: undefined, proofRequirements: undefined })), pagePlanningIntelligence: { ...base.pagePlanningIntelligence, conflicts: [] } };
}
function suggestion(targetUrl: string) {
  return { targetUrl, faqTopics: ["Who is this service suitable for?", "How does an assessment work?", "What happens after the assessment?"], seoTitle: "KPIRY growth marketing guidance", metaDescription: "Explore growth marketing guidance and request an assessment for your business.", contentOutline: ["Purpose", "Evidence", "Next steps"], contentBrief: "Explain the page purpose with verified proof. Use WebPage schema and link to /growth-friction-assessment.", supportingContentIdeas: ["Assessment preparation guide", "Business growth checklist"], proofRequirements: ["Verified customer evidence"], ctaSuggestion: cta };
}
beforeEach(() => vi.clearAllMocks());
describe("Complete AI Plan preserves saved decisions", () => {
  it("completes exactly the five KPIRY pages, ignores restored locations, and is idempotent", async () => {
    const plan = savedPlan();
    const before = structuredClone(plan);
    vi.mocked(centralAiJson).mockResolvedValue({ result: { pages: [...plan.pageAssignments.map((p) => suggestion(p.targetUrl)), suggestion("/grand-falls/"), suggestion("/new-brunswick/")] } } as never);
    const result = await applyAiPageFaqSuggestions(plan, context);
    expect(result.pageAssignments).toHaveLength(5);
    const identities = (p: typeof plan) => p.pageAssignments.map(({ pageKey, pageName, targetUrl, intentOwner }) => ({ pageKey, pageName, targetUrl, intentOwner }));
    expect(identities(result)).toEqual(identities(plan));
    expect(result.pagePlanningIntelligence).toEqual(plan.pagePlanningIntelligence);
    for (const page of result.pageAssignments) {
      expect(page).toMatchObject({ faqStrategyVersion: "ai_seo_plan_v2", ctaSuggestion: cta });
      expect(page.contentBrief).toBeTruthy();
      expect(page.faqTopics).toHaveLength(3);
      expect(page.proofRequirements?.length).toBeGreaterThan(0);
    }
    expect(parseCompatibleContentPlan(result).pageAssignments).toHaveLength(5);
    expect(vi.mocked(centralAiJson).mock.calls[0][0].prompt).toContain(context.reviewComment);
    expect(plan).toEqual(before);
    expect(await applyAiPageFaqSuggestions(result, context)).toEqual(result);
    expect(centralAiJson).toHaveBeenCalledTimes(plan.pageAssignments.length);
  });
  it("keeps approved content and records conflicting AI wording as optional", () => {
    const plan = savedPlan();
    plan.pageAssignments[2].seoTitle = "Approved Growth Friction Assessment";
    const result = enrichSavedContentPlan(plan, plan.pageAssignments.map((p) => ({ ...suggestion(p.targetUrl), ctaSuggestion: "Contact us today" })));
    expect(result.pageAssignments[2].seoTitle).toBe("Approved Growth Friction Assessment");
    expect(result.pageAssignments.every((p) => p.ctaSuggestion === cta)).toBe(true);
    expect(result.planningChecks.some((note) => note.includes("Optional AI alternative") && note.includes("Contact us today"))).toBe(true);
    expect(result.contentBriefs).toEqual(expect.arrayContaining(plan.contentBriefs));
  });
  it("supplements a partial FAQ set while retaining the approved question", async () => {
    const plan = savedPlan();
    plan.pageAssignments[2].faqTopics = ["Which growth friction should we assess first?"];
    vi.mocked(centralAiJson).mockResolvedValue({ result: { pages: plan.pageAssignments.map((p) => suggestion(p.targetUrl)) } } as never);
    const result = await applyAiPageFaqSuggestions(plan, context);
    expect(result.pageAssignments[2].faqTopics?.[0]).toBe("Which growth friction should we assess first?");
    expect(result.pageAssignments[2].faqTopics?.length).toBeGreaterThanOrEqual(3);
    await applyAiPageFaqSuggestions(result, context);
    expect(centralAiJson).toHaveBeenCalledTimes(plan.pageAssignments.length);
  });
  it("leaves the saved plan untouched if AI cannot complete a page", async () => {
    const plan = savedPlan();
    const before = structuredClone(plan);
    vi.mocked(centralAiJson).mockResolvedValue({ result: { pages: [] } } as never);
    await expect(applyAiPageFaqSuggestions(plan, context)).rejects.toThrow("incomplete page suggestions");
    expect(plan).toEqual(before);
  });
});
