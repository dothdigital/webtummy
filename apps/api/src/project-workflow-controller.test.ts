import { describe, expect, it } from "vitest";
import { executionPlanWorkflowBlocker, hasCurrentPreExecutionGrowth, resolveProjectApplicability, resolveProjectWorkflow, STRATEGY_EVIDENCE_SETTLING_WINDOW_MS, workflowStagePrerequisite, type WorkflowEvidenceSnapshot } from "./project-workflow-controller.js";

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
    ecommerceApplicable: false,
    ecommerceAnalysisComplete: true,
    ecommerceAnalysisInProgress: false,
    ecommerceAnalysisFailed: false,
    ecommerceEvidenceAt: null,
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
    criticalEvidenceIssueCount: 0,
    preExecutionGrowthComplete: true,
    executionPlanExists: false,
    executionTasksExist: false,
    executionPlanUpdatedAt: null,
    openExecutionTasks: 0,
    completedExecutionTasks: 0,
    websitePlanRequired: false,
    websitePlanGenerated: false,
    websitePlanGenerationStatus: null,
    websitePlanGenerationProgress: null,
    websitePlanApproved: false,
    websitePlanTaskStatus: null,
    websiteDevelopmentStarted: false,
    preparedChangesAwaitingApproval: false,
    postImplementationVerificationRequired: false,
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
  it("treats ecommerce as a project type and requires public-store intelligence only when a store is live", () => {
    const existingStore = resolveProjectApplicability({ projectType: "ecommerce", websiteStatus: "existing_website", hasWebsite: true, contextText: "online store" });
    const plannedStore = resolveProjectApplicability({ projectType: "ecommerce", websiteStatus: "new_website_required", hasWebsite: false, contextText: "online store" });
    expect(existingStore.requiredModules).toContain("ecommerce_intelligence");
    expect(plannedStore.requiredModules).not.toContain("ecommerce_intelligence");
    expect(plannedStore.requiredModules).not.toContain("site_analysis");
  });

  it("does not enable Local SEO from geography alone", () => {
    const result = resolveProjectApplicability({ projectType: "service_business", websiteStatus: "new_website_required", hasWebsite: false, targetMarketCount: 2, contextText: "Remote consulting delivered worldwide" });
    expect(result.localSeo).toBe(false);
    expect(result.requiredModules).not.toContain("local_seo_analysis");
  });

  it("blocks an existing ecommerce store at Ecommerce Intelligence after its public crawl", () => {
    const result = resolveProjectWorkflow(snapshot({ ecommerceApplicable: true, ecommerceAnalysisComplete: false }));
    const ecommerce = result.intelligenceModules.find((item) => item.key === "ecommerce_intelligence");
    expect(ecommerce?.required).toBe(true);
    expect(ecommerce?.status).toBe("not_started");
    expect(result.intelligenceReady).toBe(false);
    expect(result.nextBestAction.action.url).toContain("/ecommerce-intelligence?");
  });

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

  it("routes a completed Gap Analysis to Unified Strategy without requiring a separate AI Citation visit", () => {
    const result = resolveProjectWorkflow(snapshot({ citationEvidenceComplete: false, citationEvidenceAt: null }));
    const citation = result.intelligenceModules.find((item) => item.key === "ai_citation_analysis");
    expect(citation?.status).toBe("complete");
    expect(citation?.evidenceAt).toBe(snapshot().gapEvidenceAt?.toISOString());
    expect(result.intelligenceReady).toBe(true);
    expect(result.nextBestAction.title).toBe("Generate Unified Strategy");
    expect(result.nextBestAction.action.url).toContain("/strategy?");
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

  it("asks for target areas instead of presenting a zero-check analysis action", () => {
    const result = resolveProjectWorkflow(snapshot({
      targetLocationsConfirmed: false,
      approvedKeywords: false,
      approvedKeywordCount: 18,
      missingKeywordResearchCount: 18,
      missingKeywordResearchCheckCount: 0,
      gapAnalysisComplete: false,
      competitorAnalysisComplete: false,
    }));
    const keywords = result.intelligenceModules.find((item) => item.key === "keyword_intelligence");
    expect(keywords?.status).toBe("blocked");
    expect(keywords?.reason).toContain("Choose at least one exact city, region, or country");
    expect(keywords?.reason).not.toContain("0 exact market checks");
    expect(keywords?.action?.label).toBe("Choose target areas");
    expect(result.nextBestAction.reason).not.toContain("0 exact market checks");
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
    expect(result.nextBestAction.title).toBe("Create the SEO Page Map & Content Plan");
    expect(result.nextBestAction.action.label).toBe("Create SEO Plan");
    expect(result.nextBestAction.expectedResult).toContain("proposed pages");
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

  it("keeps an approved Strategy usable when newer evidence arrives", () => {
    const strategyAt = new Date("2026-07-20T12:00:00.000Z");
    const evidenceAt = new Date("2026-08-01T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt }, latestStrategyVersion: 6, latestEvidenceAt: evidenceAt }));
    expect(result.strategyStale).toBe(true);
    expect(result.state).toBe("strategy_approved");
    expect(result.nextBestAction.title).toBe("Create the Execution Plan");
    expect(result.nextBestAction.action.label).toBe("Create Execution Plan");
    expect(result.blockers.some((item) => item.key === "strategy_stale")).toBe(false);
    expect(result.stages.find((item) => item.key === "unified_strategy")?.reason).toContain("remains usable");
    expect(result.strategyCreatedAt).toBe(strategyAt.toISOString());
    expect(result.latestEvidenceAt).toBe(evidenceAt.toISOString());
    expect(result.changedEvidence.length).toBeGreaterThan(0);
    expect(result.changedEvidence.every((item) => new Date(item.evidenceAt) > strategyAt)).toBe(true);
    expect(result.changedEvidence.find((item) => item.key === "authority_analysis")?.action?.url).toContain("projectId=project-1");
  });

  it("requires a Strategy update when completed Gap Analysis is newer than the approved Strategy", () => {
    const strategyAt = new Date("2026-08-01T12:00:00.000Z");
    const gapAt = new Date("2026-08-01T13:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt }, latestStrategyVersion: 1, gapEvidenceAt: gapAt, latestEvidenceAt: gapAt, websitePlanRequired: true }));
    expect(result.nextBestAction.title).toContain("Update Unified Strategy");
    expect(result.nextBestAction.action.url).toContain("/strategy?");
    expect(result.stages.find((item) => item.key === "unified_strategy")?.status).toBe("stale");
    expect(result.stages.find((item) => item.key === "strategy_approval")?.status).toBe("blocked");
  });

  it("does not invalidate a fresh Strategy while its evidence cycle is settling", () => {
    const strategyAt = new Date("2026-08-25T19:29:32.624Z");
    const evidenceAt = new Date(strategyAt.getTime() + 28_000);
    const result = resolveProjectWorkflow(snapshot({
      latestStrategy: { id: "strategy-3", status: "draft", createdAt: strategyAt, approvedAt: null },
      latestStrategyVersion: 3,
      latestEvidenceAt: evidenceAt,
      authorityEvidenceAt: evidenceAt,
    }));
    expect(result.strategyStale).toBe(false);
    expect(result.stages.find((item) => item.key === "strategy_approval")?.status).toBe("ready");
  });

  it("invalidates Strategy after the evidence settling window", () => {
    const strategyAt = new Date("2026-08-25T19:29:32.624Z");
    const evidenceAt = new Date(strategyAt.getTime() + STRATEGY_EVIDENCE_SETTLING_WINDOW_MS + 1);
    const result = resolveProjectWorkflow(snapshot({
      latestStrategy: { id: "strategy-3", status: "draft", createdAt: strategyAt, approvedAt: null },
      latestStrategyVersion: 3,
      latestEvidenceAt: evidenceAt,
      authorityEvidenceAt: evidenceAt,
    }));
    expect(result.strategyStale).toBe(true);
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

  it("labels a completed Gap Analysis as stale when a newer website crawl exists", () => {
    const gapAt = new Date("2026-08-01T12:00:00.000Z");
    const crawlAt = new Date("2026-08-01T13:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({
      gapAnalysisComplete: false,
      gapEvidenceAt: gapAt,
      siteEvidenceAt: crawlAt,
      citationEvidenceComplete: false,
      authorityEvidenceComplete: false,
    }));

    for (const key of ["technical_seo", "content_gap_analysis", "authority_analysis"]) {
      const module = result.intelligenceModules.find((item) => item.key === key);
      expect(module?.status).toBe("stale");
      expect(module?.reason).toContain("predates newer");
      expect(module?.action?.url).toContain("/gap-analysis?");
    }
    const citation = result.intelligenceModules.find((item) => item.key === "ai_citation_analysis");
    expect(citation?.status).toBe("not_started");
    expect(citation?.action?.url).toContain("/ai-citations?");
    expect(result.nextBestAction.action.label).toBe("Refresh gap analysis");
  });

  it("routes approved work through execution and measurement", () => {
    const evidenceAt = new Date("2026-07-01T12:00:00.000Z");
    const strategyAt = new Date("2026-07-02T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ latestEvidenceAt: evidenceAt, latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt }, latestStrategyVersion: 2, executionPlanExists: true, executionTasksExist: true, executionPlanUpdatedAt: new Date("2026-07-03T12:00:00.000Z"), executionPlanVersion: "2.0", openExecutionTasks: 4 }));
    expect(result.state).toBe("execution");
    expect(result.nextBestAction.action.url).toContain("tab=execution");
    expect(result.nextBestAction.explainability.length).toBeGreaterThan(20);
  });

  it("requires a current pre-change Growth diagnosis before implementation planning", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({
      latestStrategy: { id: "strategy-1", status: "approved", createdAt: approvedAt, approvedAt },
      latestStrategyVersion: 1,
      preExecutionGrowthComplete: false,
    }));

    expect(result.state).toBe("strategy_approved");
    expect(result.nextBestAction.title).toBe("Run the Growth Engine before making changes");
    expect(result.nextBestAction.action.url).toContain("/growth?");
    expect(result.nextBestAction.explainability).toContain("before execution");
    expect(result.blockers.some((item) => item.key === "pre_execution_growth_required")).toBe(true);
    const blocker = executionPlanWorkflowBlocker(result);
    expect(blocker?.code).toBe("WORKFLOW_PREREQUISITE_REQUIRED");
    expect(blocker?.message).toContain("Run the Growth Engine before making changes first");
    expect(blocker?.nextAction.action.url).toContain("/growth?");
  });

  it("keeps accepted, approved, and in-progress Growth priorities current", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    const diagnosisAt = new Date("2026-08-01T12:05:00.000Z");
    for (const actionStatus of ["proposed", "recommended", "selected", "approved", "accepted", "in_progress"]) {
      expect(hasCurrentPreExecutionGrowth({ strategyApprovedAt: approvedAt, diagnosisAt, actionStatus })).toBe(true);
    }
    expect(hasCurrentPreExecutionGrowth({ strategyApprovedAt: approvedAt, diagnosisAt, actionStatus: "completed" })).toBe(false);
    expect(hasCurrentPreExecutionGrowth({ strategyApprovedAt: approvedAt, diagnosisAt: new Date(approvedAt.getTime() - 1), actionStatus: "accepted" })).toBe(false);
    expect(hasCurrentPreExecutionGrowth({ strategyApprovedAt: approvedAt, diagnosisAt: null, legacyCompletedCycleAt: diagnosisAt, actionStatus: "selected" })).toBe(false);
    expect(hasCurrentPreExecutionGrowth({ strategyApprovedAt: approvedAt, diagnosisAt: null, legacyCompletedCycleAt: new Date(approvedAt.getTime() - 1), actionStatus: "selected" })).toBe(false);
  });

  it("shows Growth Plan before SEO Plan and Website Development", () => {
    const result = resolveProjectWorkflow(snapshot({ websitePlanRequired: true }));
    const keys = result.stages.map((stage) => stage.key);
    expect(keys.indexOf("growth_plan")).toBeLessThan(keys.indexOf("seo_plan"));
    expect(keys.indexOf("seo_plan")).toBeLessThan(keys.indexOf("website_development"));
    expect(result.stages.find((stage) => stage.key === "seo_plan")?.reason).toContain("Growth priorities");
    expect(result.stages.find((stage) => stage.key === "website_development")?.reason).toContain("Approve the SEO Plan first");
  });

  it("uses the controller-owned next action for every SEO Plan hard gate", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    const approvedStrategy = { id: "strategy-1", status: "approved", createdAt: approvedAt, approvedAt };
    const blocked = resolveProjectWorkflow(snapshot({ latestStrategy: approvedStrategy, websitePlanRequired: true, preExecutionGrowthComplete: false }));
    const prerequisite = workflowStagePrerequisite(blocked, "seo_plan");
    expect(prerequisite?.code).toBe("WORKFLOW_PREREQUISITE_REQUIRED");
    expect(prerequisite?.nextAction.title).toBe(blocked.nextBestAction.title);
    expect(prerequisite?.nextAction.action.url).toBe(blocked.nextBestAction.action.url);
    expect(prerequisite?.nextAction.action.url).toContain("/growth?");

    const ready = resolveProjectWorkflow(snapshot({ latestStrategy: approvedStrategy, websitePlanRequired: true, preExecutionGrowthComplete: true }));
    expect(ready.stages.find((stage) => stage.key === "seo_plan")?.status).toBe("ready");
    expect(workflowStagePrerequisite(ready, "seo_plan")).toBeNull();
  });

  it("shows active SEO Plan generation instead of offering another Create action", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({
      latestStrategy: { id: "strategy-1", status: "approved", createdAt: approvedAt, approvedAt },
      preExecutionGrowthComplete: true,
      websitePlanRequired: true,
      websitePlanGenerationStatus: "running",
      websitePlanGenerationProgress: 35,
    }));
    expect(result.nextBestAction.title).toContain("in progress");
    expect(result.nextBestAction.reason).toContain("35%");
    expect(result.nextBestAction.action.label).toBe("Open SEO Plan progress");
    expect(result.nextBestAction.action.url).not.toContain("autoPrepare=1");
    expect(result.stages.find((stage) => stage.key === "seo_plan")?.status).toBe("in_progress");
  });

  it("resolves critical facts before Growth and SEO planning", () => {
    const result = resolveProjectWorkflow(snapshot({ criticalEvidenceIssueCount: 3 }));
    expect(result.nextBestAction.title).toBe("Confirm the business facts before planning");
    expect(result.nextBestAction.action.url).toContain("/ai-citations?");
  });

  it("creates, reviews, approves, and hands the SEO Plan to Website Development after Growth", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    const base = {
      latestStrategy: { id: "strategy-1", status: "approved", createdAt: approvedAt, approvedAt },
      latestStrategyVersion: 1,
      preExecutionGrowthComplete: true,
      websitePlanRequired: true,
    };
    const create = resolveProjectWorkflow(snapshot(base));
    expect(create.nextBestAction.title).toBe("Create the SEO Page Map & Content Plan");

    const review = resolveProjectWorkflow(snapshot({ ...base, websitePlanGenerated: true, websitePlanTaskStatus: "in_progress" }));
    expect(review.nextBestAction.title).toBe("Review the SEO Plan");

    const approve = resolveProjectWorkflow(snapshot({ ...base, websitePlanGenerated: true, websitePlanTaskStatus: "submitted_for_approval" }));
    expect(approve.nextBestAction.title).toBe("Approve the SEO Plan");

    const develop = resolveProjectWorkflow(snapshot({ ...base, websitePlanGenerated: true, websitePlanApproved: true, websitePlanTaskStatus: "completed" }));
    expect(develop.nextBestAction.title).toBe("Start Website Development");
    expect(executionPlanWorkflowBlocker(develop)?.nextAction.action.url).toContain("/site-architect?");
  });

  it("requires prepared-change approval and post-implementation verification before measurement", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    const base = {
      latestStrategy: { id: "strategy-1", status: "approved", createdAt: approvedAt, approvedAt },
      latestStrategyVersion: 1,
      preExecutionGrowthComplete: true,
      websitePlanRequired: true,
      websitePlanGenerated: true,
      websitePlanApproved: true,
      websiteDevelopmentStarted: true,
      executionPlanExists: true,
      executionTasksExist: true,
      executionPlanUpdatedAt: approvedAt,
    };
    const review = resolveProjectWorkflow(snapshot({ ...base, preparedChangesAwaitingApproval: true, openExecutionTasks: 2 }));
    expect(review.nextBestAction.title).toBe("Review the prepared website changes");

    const verify = resolveProjectWorkflow(snapshot({ ...base, completedExecutionTasks: 2, postImplementationVerificationRequired: true }));
    expect(verify.nextBestAction.title).toBe("Verify the website changes");

    const measure = resolveProjectWorkflow(snapshot({ ...base, completedExecutionTasks: 2 }));
    expect(measure.nextBestAction.title).toBe("Review results and choose the next improvement");
  });

  it("routes a Website Next Best Action through its unapproved Website Plan prerequisite", () => {
    const evidenceAt = new Date("2026-08-01T12:00:00.000Z");
    const strategyAt = new Date("2026-08-02T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({
      latestEvidenceAt: evidenceAt,
      keywordEvidenceAt: evidenceAt,
      siteEvidenceAt: evidenceAt,
      gapEvidenceAt: evidenceAt,
      competitorEvidenceAt: evidenceAt,
      citationEvidenceAt: evidenceAt,
      authorityEvidenceAt: evidenceAt,
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
    expect(result.nextBestAction.title).toBe("Create the SEO Page Map & Content Plan");
    expect(result.nextBestAction.action.url).toContain("/seo-page-map?");
    expect(result.nextBestAction.explainability).toContain("separate draft decision");
    expect(result.blockers.some((item) => item.key === "website_plan_required")).toBe(true);
  });

  it("treats publishing as an execution outcome instead of a universal blocker", () => {
    const evidenceAt = new Date("2026-07-01T12:00:00.000Z");
    const strategyAt = new Date("2026-07-02T12:00:00.000Z");
    const result = resolveProjectWorkflow(snapshot({ latestEvidenceAt: evidenceAt, latestStrategy: { id: "strategy-1", status: "approved", createdAt: strategyAt, approvedAt: strategyAt }, latestStrategyVersion: 2, executionPlanExists: true, executionTasksExist: true, executionPlanUpdatedAt: new Date("2026-07-03T12:00:00.000Z"), executionPlanVersion: "2.0", openExecutionTasks: 0, completedExecutionTasks: 3, publishingStarted: false, publishingComplete: false }));
    expect(result.stages.find((stage) => stage.key === "publish_implement")?.status).toBe("not_required");
    expect(result.state).toBe("measurement");
    expect(result.nextBestAction.title).toBe("Review results and choose the next improvement");
  });
});
