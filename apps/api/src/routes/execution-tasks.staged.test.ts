import { describe, expect, it, vi } from "vitest";
vi.mock("../queue.js", () => ({ websiteBuilderQueue: { add: vi.fn() }, crawlQueue: { add: vi.fn() }, keywordResearchQueue: { add: vi.fn() } }));
vi.mock("../central-ai-service.js", () => ({ centralAiJson: vi.fn() }));
import { centralAiJson } from "../central-ai-service.js";
import { applyFullAiWebsitePlan, contentPlanFor } from "./execution-tasks.js";
import { withPlanCheckpoints, type PlanCheckpoints } from "../content-plan-checkpoints.js";

const template = () => contentPlanFor({ projectName: "Example", businessName: "Example", goal: "Generate leads", markets: [], keywords: ["property advice"], offer: "Property advice", audience: "Property buyers", contentStrategy: null, localSeoEnabled: false, websiteUrl: "https://example.com", websitePages: [] });
function decision(targetUrl: string) {
  return { targetUrl, pageName: "Property advice", canonicalKeyword: "property advice", secondaryKeywords: [], searchIntent: "commercial", pagePurpose: "Help property buyers understand the approved advice service.", gapAnalysis: "The page needs evidence-backed advice and one conversion action.", recommendedAction: "update_existing", intentOwner: targetUrl, decisionReason: "This page owns its distinct approved property advice intent.", funnelStage: "evaluate", strategyRole: "Support qualified buyers with verified service evidence.", requiredInternalLinks: [], prohibitedCompetingKeywords: [], contentBrief: "Explain the approved advice service, use only verified evidence, and provide a clear next action for qualified buyers.", ctaSuggestion: "Request advice", evidenceSources: ["Approved Strategy"] };
}
const evidence = { projectType: "existing_website", business: {} as never, goal: "Generate leads", keywords: ["property advice"], targetLocations: [], opportunity: null, aiCitationEvidence: null, growthPlan: null, gapRecommendations: [], sitePages: [], strategy: null, funnel: null };

describe("Website Plan page checkpoints", () => {
  it("evaluates every governed page beyond the old 100-page truncation", async () => {
    const base = template();
    const targets = Array.from({ length: 101 }, (_, i) => `https://example.com/page-${i}`);
    const plan = { ...base, pageAssignments: targets.map((targetUrl) => ({ ...base.pageAssignments[0]!, targetUrl })) };
    let index = 0;
    vi.mocked(centralAiJson).mockImplementation(async (input) => ({ result: input.validate({ summary: "An evidence-grounded decision for the requested page.", decisions: [decision(targets[index++]!)] }) }) as never);
    const generated = await applyFullAiWebsitePlan(plan, evidence);
    expect(index).toBe(101);
    expect(generated.pageAssignments).toHaveLength(101);
    expect(generated.pageAssignments.every((page) => Boolean(page.decisionReason))).toBe(true);
  });
  it("retries an omitted page without regenerating a previously validated page", async () => {
    const base = template();
    const targets = ["https://example.com/one", "https://example.com/two"];
    const plan = { ...base, pageAssignments: targets.map((targetUrl) => ({ ...base.pageAssignments[0]!, targetUrl })) };
    let saved: PlanCheckpoints = {};
    let calls = 0;
    let failSecond = true;
    vi.mocked(centralAiJson).mockImplementation(async (input) => {
      calls++;
      return { result: input.validate({ summary: "An evidence-grounded decision for the requested page.", decisions: calls === 1 ? [decision(targets[0]!)] : failSecond ? [] : [decision(targets[1]!)] }) } as never;
    });
    const run = () => withPlanCheckpoints({ stage: 2, values: JSON.parse(JSON.stringify(saved)), save: async (next) => { saved = JSON.parse(JSON.stringify(next)); } }, () => applyFullAiWebsitePlan(plan, evidence));
    await expect(run()).rejects.toThrow("incomplete Website Plan decisions");
    expect(Object.keys(saved)).toEqual([`decision:0:${targets[0]}`]);
    const previousCalls = calls;
    failSecond = false;
    const generated = await run();
    expect(calls - previousCalls).toBe(1);
    expect(generated.pageAssignments.map((page) => page.targetUrl)).toEqual(targets);
  });
});
