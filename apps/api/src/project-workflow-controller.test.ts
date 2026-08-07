import { describe, expect, it } from "vitest";
import { resolveProjectWorkflow, type WorkflowEvidenceSnapshot } from "./project-workflow-controller.js";

function snapshot(overrides: Partial<WorkflowEvidenceSnapshot> = {}): WorkflowEvidenceSnapshot {
  const now = new Date("2026-08-01T12:00:00.000Z");
  return {
    projectId: "project-1",
    projectConfigured: true,
    workspaceConfigured: true,
    situationConfigured: true,
    discoveryComplete: true,
    existingWebsite: true,
    preLaunchWebsite: false,
    localSeoApplicable: false,
    targetLocationsConfirmed: true,
    approvedKeywords: true,
    keywordResearchInProgress: false,
    keywordResearchFailed: false,
    keywordEvidenceAt: now,
    siteAnalysisComplete: true,
    siteAnalysisInProgress: false,
    siteAnalysisFailed: false,
    siteEvidenceAt: now,
    gapAnalysisComplete: true,
    gapAnalysisInProgress: false,
    gapAnalysisFailed: false,
    gapEvidenceAt: now,
    localAnalysisComplete: true,
    localAnalysisInProgress: false,
    localAnalysisFailed: false,
    localEvidenceAt: null,
    competitorAnalysisComplete: true,
    competitorAnalysisInProgress: false,
    competitorAnalysisFailed: false,
    competitorEvidenceAt: now,
    citationEvidenceComplete: true,
    citationEvidenceAt: now,
    authorityEvidenceComplete: true,
    authorityEvidenceAt: now,
    selectedOpportunity: true,
    latestStrategy: null,
    latestEvidenceAt: now,
    executionPlanExists: false,
    executionTasksExist: false,
    executionPlanUpdatedAt: null,
    openExecutionTasks: 0,
    completedExecutionTasks: 0,
    websitePlanRequired: false,
    websitePlanApproved: false,
    websitePlanTaskStatus: null,
    publishingStarted: false,
    publishingComplete: false,
    measurementStarted: false,
    measurementComplete: false,
    growthBlueprintStatus: null,
    nextBestActionExists: false,
    latestStrategyVersion: 0,
    executionPlanVersion: null,
    executionPlanStrategyVersion: null,
    growthBlueprintVersion: 0,
    moduleDecisions: {},
    ...overrides,
  };
}

describe("DEV-046 project workflow controller", () => {
  it("routes an intake-complete project to Opportunities before Keyword Intelligence", () => {
    const result = resolveProjectWorkflow(snapshot({
      selectedOpportunity: false,
      approvedKeywords: false,
      approvedKeywordCount: 0,
      missingKeywordResearchCount: 0,
      keywordEvidenceAt: null,
    }));
    const keywords = result.intelligenceModules.find((item) => item.key === "keyword_intelligence");
    expect(result.state).toBe("intelligence_collection");
    expect(result.nextBestAction.title).toContain("project opportunity");
    expect(result.nextBestAction.action.label).toBe("Generate Opportunities");
    expect(result.nextBestAction.action.url).toContain("/opportunities?");
    expect(keywords?.status).toBe("blocked");
    expect(keywords?.action?.url).toContain("/opportunities?");
  });

  it("blocks Strategy until all applicable intelligence is complete", () => {
    const result = resolveProjectWorkflow(snapshot({ gapAnalysisComplete: false, competitorAnalysisComplete: false, citationEvidenceComplete: false, authorityEvidenceComplete: false }));
    expect(result.intelligenceReady).toBe(false);
    expect(result.state).toBe("intelligence_collection");
    expect(result.nextBestAction.title).toBe("Opportunity & Competitor Intelligence");
    expect(result.blockers.some((item) => item.key === "technical_seo")).toBe(true);
  });

  it("explains which approved keywords need attention and how to resolve them", () => {
    const result = resolveProjectWorkflow(snapshot({
      approvedKeywords: false,
      approvedKeywordCount: 3,
      missingKeywordResearchCount: 2,
      missingKeywordResearchCheckCount: 7,
      missingKeywordResearchKeywords: ["Insurance CRM", "Policy Management"],
      failedKeywordResearchKeywords: ["Policy Management"],
    }));
    const keywords = result.intelligenceModules.find((item) => item.key === "keyword_intelligence");
    expect(keywords?.status).toBe("needs_attention");
    expect(keywords?.reason).toContain("Insurance CRM");
    expect(keywords?.reason).toContain("Policy Management");
    expect(keywords?.reason).toContain("7 exact market checks");
    expect(keywords?.action?.label).toBe("Review & Retry 1 Failed Check");
    expect(keywords?.reason).toContain("Retry");
  });

  it("requires market and content gap analysis but not crawl-only modules for a pre-website project", () => {
    const pending = resolveProjectWorkflow(snapshot({ existingWebsite: false, gapAnalysisComplete: false, siteAnalysisComplete: true, citationEvidenceComplete: true, authorityEvidenceComplete: true }));
    expect(pending.intelligenceModules.find((item) => item.key === "site_analysis")?.status).toBe("not_required");
    expect(pending.intelligenceModules.find((item) => item.key === "technical_seo")?.status).toBe("not_required");
    expect(pending.intelligenceModules.find((item) => item.key === "content_gap_analysis")?.status).toBe("not_started");
    expect(pending.nextBestAction.title).toBe("Market & Content Gap Analysis");
    expect(pending.nextBestAction.action.url).toContain("/gap-analysis?");

    const result = resolveProjectWorkflow(snapshot({ existingWebsite: false, gapAnalysisComplete: true, siteAnalysisComplete: true, citationEvidenceComplete: true, authorityEvidenceComplete: true }));
    expect(result.intelligenceModules.find((item) => item.key === "site_analysis")?.status).toBe("not_required");
    expect(result.intelligenceModules.find((item) => item.key === "technical_seo")?.status).toBe("not_required");
    expect(result.intelligenceReady).toBe(true);
    expect(result.nextBestAction.title).toBe("Generate Unified Strategy");
  });

  it("requires full pre-launch intelligence and Strategy before Website Development", () => {
    const result = resolveProjectWorkflow(snapshot({
      existingWebsite: false,
      preLaunchWebsite: true,
      approvedKeywords: false,
      approvedKeywordCount: 8,
      missingKeywordResearchCount: 8,
      missingKeywordResearchCheckCount: 24,
      gapAnalysisComplete: false,
      competitorAnalysisComplete: false,
      localSeoApplicable: false,
      siteAnalysisComplete: true,
      citationEvidenceComplete: true,
      authorityEvidenceComplete: true,
    }));
    expect(result.intelligenceModules.find((item) => item.key === "keyword_intelligence")?.label).toBe("Keyword Intelligence");
    expect(result.intelligenceModules.find((item) => item.key === "keyword_intelligence")?.status).toBe("not_started");
    expect(result.intelligenceModules.find((item) => item.key === "site_analysis")?.status).toBe("not_required");
    expect(result.intelligenceModules.find((item) => item.key === "site_analysis")?.reason).toContain("after the website is published");
    expect(result.intelligenceModules.find((item) => item.key === "content_gap_analysis")?.required).toBe(true);
    expect(result.stages.find((item) => item.key === "website_strategy")?.status).toBe("blocked");
    expect(result.stages.find((item) => item.key === "unified_strategy")?.status).toBe("blocked");
    expect(result.nextBestAction.title).toBe("Keyword Intelligence");
    expect(result.nextBestAction.action.url).toContain("/keywords?");
  });

  it("generates Unified Strategy after all pre-build intelligence is complete", () => {
    const result = resolveProjectWorkflow(snapshot({
      existingWebsite: false,
      preLaunchWebsite: true,
      approvedKeywords: true,
      approvedKeywordCount: 8,
      missingKeywordResearchCount: 0,
      gapAnalysisComplete: true,
      competitorAnalysisComplete: true,
      siteAnalysisComplete: true,
      citationEvidenceComplete: true,
      authorityEvidenceComplete: true,
    }));
    expect(result.intelligenceReady).toBe(true);
    expect(result.stages.find((item) => item.key === "website_strategy")?.status).toBe("ready");
    expect(result.nextBestAction.title).toBe("Generate Unified Strategy");
    expect(result.nextBestAction.action.url).toContain("/strategy?");
  });

  it("routes an approved new-site Strategy through the build-ready Website Plan", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({
      existingWebsite: false,
      preLaunchWebsite: true,
      latestStrategy: { id: "strategy-1", status: "approved", createdAt: approvedAt, approvedAt },
      latestEvidenceAt: approvedAt,
      latestStrategyVersion: 1,
      executionPlanExists: true,
      executionTasksExist: true,
      executionPlanUpdatedAt: approvedAt,
      executionPlanStrategyVersion: 1,
      openExecutionTasks: 4,
      websitePlanRequired: true,
      websitePlanApproved: false,
      websitePlanTaskStatus: "ready",
    }));
    expect(result.nextBestAction.title).toBe("Create and approve the Website Plan");
    expect(result.nextBestAction.action.label).toBe("Create Website Plan");
    expect(result.nextBestAction.expectedResult).toContain("sitemap");
  });

  it("makes the Website Intelligence baseline the first post-publication action", () => {
    const result = resolveProjectWorkflow(snapshot({
      existingWebsite: true,
      preLaunchWebsite: false,
      siteAnalysisComplete: false,
      siteEvidenceAt: null,
      publishingStarted: true,
      publishingComplete: true,
    }));
    expect(result.nextBestAction.title).toBe("Website Intelligence Baseline");
    expect(result.nextBestAction.action.label).toBe("Create Website Intelligence Baseline");
    expect(result.nextBestAction.action.url).toContain("/site-analysis?");
  });

  it("invalidates Strategy when newer evidence arrives", () => {
    const strategyAt = new Date("2026-07-20T12:00:00.000Z");
    const evidenceAt = new Date("2026-08-01T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt }, latestStrategyVersion: 6, latestEvidenceAt: evidenceAt }));
    expect(result.strategyStale).toBe(true);
    expect(result.state).toBe("strategy_ready");
    expect(result.nextBestAction.title).toContain("Regenerate Strategy");
  });

  it("allows an authorized waiver to satisfy one evidence cycle", () => {
    const result = resolveProjectWorkflow(snapshot({ competitorAnalysisComplete: false, gapAnalysisComplete: false, moduleDecisions: { competitor_intelligence: "waived", technical_seo: "waived", content_gap_analysis: "waived", ai_citation_analysis: "waived", authority_analysis: "waived" } }));
    expect(result.intelligenceModules.find((item) => item.key === "competitor_intelligence")?.status).toBe("waived");
    expect(result.intelligenceReady).toBe(true);
  });

  it("marks expired applicable evidence stale and provides a refresh path", () => {
    const expired = new Date("2026-01-01T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ keywordEvidenceAt: expired }));
    const keywords = result.intelligenceModules.find((item) => item.key === "keyword_intelligence");
    expect(keywords?.status).toBe("stale");
    expect(keywords?.reason).toContain("freshness window");
    expect(result.intelligenceReady).toBe(false);
  });

  it("routes approved work through execution and measurement", () => {
    const evidenceAt = new Date("2026-07-01T12:00:00.000Z");
    const strategyAt = new Date("2026-07-02T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ latestEvidenceAt: evidenceAt, latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt }, latestStrategyVersion: 2, executionPlanExists: true, executionTasksExist: true, executionPlanUpdatedAt: new Date("2026-07-03T12:00:00.000Z"), executionPlanVersion: "2.0", openExecutionTasks: 4 }));
    expect(result.state).toBe("execution");
    expect(result.nextBestAction.action.url).toContain("tab=execution");
    expect(result.nextBestAction.explainability.length).toBeGreaterThan(20);
  });

  it("routes a Website Next Best Action through its unapproved Website Plan prerequisite", () => {
    const evidenceAt = new Date("2026-07-01T12:00:00.000Z");
    const strategyAt = new Date("2026-07-02T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({
      latestEvidenceAt: evidenceAt,
      latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt },
      latestStrategyVersion: 2,
      executionPlanExists: true,
      executionTasksExist: true,
      executionPlanUpdatedAt: new Date("2026-07-03T12:00:00.000Z"),
      executionPlanVersion: "2.0",
      openExecutionTasks: 4,
      websitePlanRequired: true,
      websitePlanApproved: false,
      websitePlanTaskStatus: "ready",
      activeNextBestAction: {
        title: "Assign one intent and conversion role to each canonical page",
        reason: "Page ownership is the highest-impact opportunity.",
        expectedImpact: "Clear canonical ownership.",
        confidence: 92,
        route: "website",
        destinationUrl: "/site-architect?projectId=project-1",
        status: "recommended",
      },
    }));
    expect(result.nextBestAction.title).toBe("Create and approve the SEO Page Map & Content Plan");
    expect(result.nextBestAction.action.url).toContain("/seo-page-map?");
    expect(result.nextBestAction.explainability).toContain("original Strategy action remains queued");
    expect(result.blockers.some((item) => item.key === "website_plan_required")).toBe(true);
  });

  it("treats publishing as an execution outcome instead of a universal blocker", () => {
    const evidenceAt = new Date("2026-07-01T12:00:00.000Z");
    const strategyAt = new Date("2026-07-02T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ latestEvidenceAt: evidenceAt, latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt }, latestStrategyVersion: 2, executionPlanExists: true, executionTasksExist: true, executionPlanUpdatedAt: new Date("2026-07-03T12:00:00.000Z"), executionPlanVersion: "2.0", openExecutionTasks: 0, completedExecutionTasks: 3, publishingStarted: false, publishingComplete: false }));
    expect(result.stages.find((stage) => stage.key === "publish_implement")?.status).toBe("not_required");
    expect(result.state).toBe("measurement");
    expect(result.nextBestAction.title).toBe("Start measurement");
  });
});
