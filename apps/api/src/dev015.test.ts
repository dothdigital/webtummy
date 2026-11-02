import { describe, expect, it } from "vitest";
import { buildIntelligentExecutionTasks, type StrategyRecommendation } from "./dev015.js";

const recommendation = (analysisKey: string): StrategyRecommendation => ({ analysisKey, title: `Fix ${analysisKey}`, why: "Evidence shows a relevant opportunity.", priority: "high", impact: 80, confidence: 85, evidence: ["saved evidence"] });

describe("DEV-015 intelligent Execution Plan", () => {
  it("creates explainable tasks only for supported applicable recommendations", () => {
    const tasks = buildIntelligentExecutionTasks([recommendation("freshness"), recommendation("entity_graph"), { ...recommendation("crawl_budget"), applicable: false }]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toContain("saved evidence");
    expect(tasks[0].expectedOutcome).toContain("current");
  });

  it("requires approval for protected live-site work", () => {
    const tasks = buildIntelligentExecutionTasks([recommendation("internal_link_equity"), recommendation("serp_ai")]);
    expect(tasks.find((item) => item.analysisKey === "internal_link_equity")?.requiresApproval).toBe(true);
    expect(tasks.find((item) => item.analysisKey === "serp_ai")?.requiresApproval).toBe(false);
  });

  it("adds intent mapping dependencies where required", () => {
    const tasks = buildIntelligentExecutionTasks([recommendation("intent_content_mapping"), recommendation("cannibalization"), recommendation("serp_ai")]);
    expect(tasks.find((item) => item.analysisKey === "cannibalization")?.dependencyKeys).toContain("intent_content_mapping");
    expect(tasks.find((item) => item.analysisKey === "serp_ai")?.dependencyKeys).toContain("intent_content_mapping");
  });

  it("routes admitted work to an exact module operation", () => {
    const tasks = buildIntelligentExecutionTasks([recommendation("intent_content_mapping"), recommendation("cannibalization")]);
    expect(tasks.find((item) => item.analysisKey === "intent_content_mapping")).toMatchObject({ title: "Review the keyword-to-page map", destinationUrl: "/seo-page-map" });
    expect(tasks.find((item) => item.analysisKey === "cannibalization")).toMatchObject({ title: "Resolve pages competing for the same keyword", destinationUrl: "/gap-analysis" });
  });

  it("keeps broad strategy and funnel recommendations out of Execution", () => {
    const tasks = buildIntelligentExecutionTasks([{ ...recommendation("focus_conversion"), engineVersion: "dev-047-part2-v1", disposition: "queued", destination: "content", destinationUrl: "/ai-content?projectId=project-1", successMeasure: "Qualified actions improve from baseline." }]);
    expect(tasks).toHaveLength(0);
  });

  it("keeps customer-journey narratives in Strategy until a module creates exact work", () => {
    const tasks = buildIntelligentExecutionTasks([recommendation("funnel_convert"), recommendation("funnel_delight")]);
    expect(tasks).toHaveLength(0);
  });
});
