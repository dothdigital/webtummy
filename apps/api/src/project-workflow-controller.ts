import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@webtummy/db";
import { approvedKeywordEntries, incompleteApprovedKeywordResearchChecks, latestKeywordResearchChecks, missingApprovedKeywordResearch, normalizeKeywordPhrase, unresolvedApprovedKeywordResearchChecks, workflowBlockedPayload } from "@webtummy/core";
import { projectAnalysisLocationLabels, type BusinessLocation } from "./project-location.js";
import { isWebsitePlanTask } from "./website-plan-task.js";
import { isCompletedWebsiteLaunchFoundationAction } from "./completed-work.js";

export const WORKFLOW_CONTROLLER_VERSION = "workflow-controller-v1";

export const WORKFLOW_MODULE_CAPABILITIES = [
  { key: "keyword_intelligence", module: "keywords", route: "/keywords", events: ["intelligence.keyword_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
  { key: "location_intelligence", module: "local_seo", route: "/local-seo", events: ["intelligence.local_seo_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
  { key: "competitor_intelligence", module: "gap_analysis", route: "/gap-analysis", events: ["intelligence.competitor_completed", "intelligence.gap_analysis_completed"], canSuggest: true, canImplement: false, approvalRequired: false },
  { key: "site_analysis", module: "site_analysis", route: "/site-analysis", events: ["intelligence.site_analysis_completed"], canSuggest: true, canImplement: false, approvalRequired: false },
  { key: "ecommerce_intelligence", module: "ecommerce_intelligence", route: "/ecommerce-intelligence", events: ["intelligence.ecommerce_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
  { key: "technical_seo", module: "gap_analysis", route: "/gap-analysis", events: ["intelligence.gap_analysis_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
  { key: "content_gap_analysis", module: "gap_analysis", route: "/gap-analysis", events: ["intelligence.gap_analysis_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
  { key: "local_seo_analysis", module: "local_seo", route: "/local-seo", events: ["intelligence.local_seo_completed", "intelligence.gap_analysis_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
  { key: "ai_citation_analysis", module: "ai_citations", route: "/ai-citations", events: ["intelligence.citation_completed", "intelligence.gap_analysis_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
  { key: "authority_analysis", module: "backlinks", route: "/backlinks", events: ["intelligence.authority_completed", "intelligence.gap_analysis_completed"], canSuggest: true, canImplement: true, approvalRequired: true },
] as const;

const WORKFLOW_EVIDENCE_FRESHNESS_DAYS: Record<string, number> = {
  keyword_intelligence: 90,
  location_intelligence: 90,
  competitor_intelligence: 90,
  site_analysis: 45,
  ecommerce_intelligence: 45,
  technical_seo: 45,
  content_gap_analysis: 45,
  local_seo_analysis: 60,
  ai_citation_analysis: 60,
  authority_analysis: 90,
};

export function resolveProjectApplicability(input: { projectType: string; websiteStatus: string; hasWebsite: boolean; websiteLaunched?: boolean; targetMarketCount?: number; contextText: string }) {
  const existingWebsite = Boolean(input.websiteLaunched) || (input.websiteStatus === "existing_website" && input.hasWebsite);
  const preLaunchWebsite = ["new_website_required", "website_planned"].includes(input.websiteStatus) && !existingWebsite;
  const localSeo = input.projectType === "local_seo" || /local|service area|near me|google business|map pack|appointment|booking|physical location|storefront/i.test(input.contextText);
  return {
    existingWebsite,
    preLaunchWebsite,
    localSeo,
    requiredModules: WORKFLOW_MODULE_CAPABILITIES.filter((capability) => {
      if (["site_analysis", "technical_seo"].includes(capability.key)) return existingWebsite;
      if (capability.key === "ecommerce_intelligence") return input.projectType === "ecommerce" && existingWebsite;
      if (["location_intelligence", "local_seo_analysis"].includes(capability.key)) return localSeo;
      return true;
    }).map((capability) => capability.key),
  };
}

export type WorkflowModuleStatus =
  | "not_required"
  | "not_started"
  | "in_progress"
  | "needs_attention"
  | "ready"
  | "complete"
  | "approved"
  | "blocked"
  | "failed"
  | "stale"
  | "deferred"
  | "not_applicable"
  | "waived";

export type WorkflowState =
  | "discovery"
  | "intelligence_collection"
  | "strategy_ready"
  | "strategy_approved"
  | "execution_planning"
  | "execution"
  | "measurement"
  | "continuous_growth";

export type WorkflowAction = {
  label: string;
  url: string;
  type: "navigate" | "review" | "approve" | "generate" | "implement";
};

export type WorkflowAiRole = {
  mode: "automatic" | "ai_assisted" | "guided" | "approval_required";
  suggestion: string;
  implementation: string;
  humanRole: string;
};

export type WorkflowModule = {
  key: string;
  label: string;
  description: string;
  status: WorkflowModuleStatus;
  required: boolean;
  weight: number;
  reason: string;
  evidenceAt: string | null;
  action: WorkflowAction | null;
  ai: WorkflowAiRole;
};

export type WorkflowStage = {
  key: string;
  label: string;
  description: string;
  status: WorkflowModuleStatus;
  reason: string;
  action: WorkflowAction | null;
  ai: WorkflowAiRole;
  modules?: WorkflowModule[];
};

export type ProjectWorkflowControllerView = {
  version: string;
  projectId: string;
  state: WorkflowState;
  stateLabel: string;
  readinessPercent: number;
  overallProgressPercent: number;
  intelligenceReady: boolean;
  strategyStale: boolean;
  executionPlanStale: boolean;
  businessBrainVersion: number;
  evidenceVersion: number;
  strategyVersion: number;
  executionPlanVersion: string | null;
  executionPlanStrategyVersion: number | null;
  growthBlueprintVersion: number;
  strategyCreatedAt: string | null;
  strategyApprovedAt: string | null;
  latestEvidenceAt: string | null;
  changedEvidence: Array<{ key: string; label: string; evidenceAt: string; reason: string; action: WorkflowAction | null }>;
  confidence: {
    overall: number;
    completeness: number;
    freshness: number;
    signalCoverage: number;
    dataQuality: number;
    conflictPenalty: number;
    independentSignals: number;
    reasons: string[];
    cautions: string[];
  };
  blockers: Array<{ key: string; title: string; reason: string; action: WorkflowAction | null }>;
  nextBestAction: {
    title: string;
    reason: string;
    expectedResult: string;
    action: WorkflowAction;
    aiWill: string[];
    userWill: string;
    confidence: number;
    explainability: string;
  };
  stages: WorkflowStage[];
  intelligenceModules: WorkflowModule[];
  updatedAt: string;
};

const PRE_EXECUTION_WORKFLOW_TITLES = new Set([
  "Confirm the business facts before planning",
  "Run the Growth Engine before making changes",
  "Review and approve the Growth Blueprint",
  "Create the SEO Page Map & Content Plan",
  "Review the SEO Plan",
  "Approve the SEO Plan",
  "Start Website Development",
  "Create the Execution Plan",
  "Refresh the Execution Plan",
  "Review and approve the Execution Plan",
]);

export function executionPlanWorkflowBlocker(workflow: ProjectWorkflowControllerView | null) {
  if (!workflow || !PRE_EXECUTION_WORKFLOW_TITLES.has(workflow.nextBestAction.title)) return null;
  return {
    ...workflowBlockedPayload(workflow.nextBestAction.title, workflow.nextBestAction.action),
    code: "WORKFLOW_PREREQUISITE_REQUIRED",
    message: `${workflow.nextBestAction.title} first. ${workflow.nextBestAction.reason}`,
    nextAction: workflow.nextBestAction,
  };
}

const ACTIONABLE_STAGE_STATUSES = new Set<WorkflowModuleStatus>(["ready", "in_progress", "complete", "approved"]);

/**
 * Returns the single controller-owned action that must be completed before a
 * downstream stage can run. API hard gates and UI routing must use this
 * instead of independently reinterpreting raw evidence rows.
 */
export function workflowStagePrerequisite(workflow: ProjectWorkflowControllerView | null, stageKey: string) {
  const stage = workflow?.stages.find((item) => item.key === stageKey);
  if (!workflow || !stage || ACTIONABLE_STAGE_STATUSES.has(stage.status)) return null;
  return {
    ...workflowBlockedPayload(stage.label, workflow.nextBestAction.action),
    code: "WORKFLOW_PREREQUISITE_REQUIRED",
    message: `${workflow.nextBestAction.title}. ${workflow.nextBestAction.reason}`,
    nextAction: workflow.nextBestAction,
  };
}

const STRATEGY_PREREQUISITE_STAGES = ["business_brain_approval", "readiness_check", "opportunity_discovery", "required_intelligence", "findings_review"] as const;

export function strategyWorkflowPrerequisite(workflow: ProjectWorkflowControllerView | null) {
  if (!workflow) return workflowBlockedPayload("Complete the governed project prerequisites before Strategy.", { label: "Review project workflow", url: "/guided-projects", type: "review" });
  for (const key of STRATEGY_PREREQUISITE_STAGES) {
    const stage = workflow.stages.find((item) => item.key === key);
    if (!stage || !["complete", "approved", "not_applicable", "not_required"].includes(stage.status)) {
      return workflowBlockedPayload(stage ? `${stage.label} must be complete before Strategy.` : `Required workflow stage ${key} is unavailable.`, stage?.action ?? workflow.nextBestAction.action);
    }
  }
  return null;
}

const CURRENT_GROWTH_ACTION_STATUSES = new Set(["proposed", "recommended", "selected", "approved", "accepted", "in_progress"]);

export function hasCurrentPreExecutionGrowth(input: { strategyApprovedAt: Date | null; diagnosisAt: Date | null; legacyCompletedCycleAt?: Date | null; actionStatus: string | null }) {
  // Monitoring cycles collect and compare signals, but they do not create the
  // governed diagnosis consumed by SEO planning. Treating a cycle timestamp as
  // a Growth Plan made the Project page advance while the SEO planner had no
  // diagnosis payload. Only a current canonical diagnosis can complete this
  // stage.
  const growthEvidenceAt = input.diagnosisAt;
  return Boolean(input.strategyApprovedAt
    && growthEvidenceAt
    && growthEvidenceAt.getTime() >= input.strategyApprovedAt.getTime()
    && input.actionStatus
    && CURRENT_GROWTH_ACTION_STATUSES.has(input.actionStatus));
}

export type WorkflowEvidenceSnapshot = {
  projectId: string;
  projectConfigured: boolean;
  workspaceConfigured: boolean;
  situationConfigured: boolean;
  discoveryComplete: boolean;
  businessBrainApproved?: boolean;
  readinessComplete?: boolean;
  existingWebsite: boolean;
  preLaunchWebsite: boolean;
  localSeoApplicable: boolean;
  targetLocationsConfirmed: boolean;
  approvedKeywords: boolean;
  approvedKeywordCount?: number;
  missingKeywordResearchCount?: number;
  missingKeywordResearchCheckCount?: number;
  missingKeywordResearchKeywords?: string[];
  failedKeywordResearchKeywords?: string[];
  failedKeywordResearchCheckCount?: number;
  keywordResearchActiveCheckCount?: number;
  keywordResearchInProgress: boolean;
  keywordResearchFailed: boolean;
  keywordEvidenceAt: Date | null;
  siteAnalysisComplete: boolean;
  siteAnalysisInProgress: boolean;
  siteAnalysisFailed: boolean;
  siteEvidenceAt: Date | null;
  ecommerceApplicable: boolean;
  ecommerceAnalysisComplete: boolean;
  ecommerceAnalysisInProgress: boolean;
  ecommerceAnalysisFailed: boolean;
  ecommerceEvidenceAt: Date | null;
  gapAnalysisComplete: boolean;
  gapAnalysisInProgress: boolean;
  gapAnalysisFailed: boolean;
  gapEvidenceAt: Date | null;
  localAnalysisComplete: boolean;
  localAnalysisInProgress: boolean;
  localAnalysisFailed: boolean;
  localEvidenceAt: Date | null;
  competitorAnalysisComplete: boolean;
  competitorAnalysisInProgress: boolean;
  competitorAnalysisFailed: boolean;
  competitorEvidenceAt: Date | null;
  citationEvidenceComplete: boolean;
  citationEvidenceAt: Date | null;
  authorityEvidenceComplete: boolean;
  authorityEvidenceAt: Date | null;
  selectedOpportunity: boolean;
  latestStrategy: { id: string; status: string; createdAt: Date; approvedAt: Date | null } | null;
  latestEvidenceAt: Date | null;
  criticalEvidenceIssueCount: number;
  findingsReviewed?: boolean;
  trackingVerified?: boolean;
  trackingLimitationRecorded?: boolean;
  preExecutionGrowthComplete: boolean;
  executionPlanExists: boolean;
  executionTasksExist: boolean;
  executionPlanUpdatedAt: Date | null;
  openExecutionTasks: number;
  completedExecutionTasks: number;
  websitePlanRequired: boolean;
  websitePlanGenerated: boolean;
  websitePlanGenerationStatus: string | null;
  websitePlanGenerationProgress: number | null;
  websitePlanApproved: boolean;
  websitePlanTaskStatus: string | null;
  websiteDevelopmentStarted: boolean;
  preparedChangesAwaitingApproval: boolean;
  postImplementationVerificationRequired: boolean;
  publishingStarted: boolean;
  publishingComplete: boolean;
  measurementStarted: boolean;
  measurementComplete: boolean;
  reportingLearningComplete?: boolean;
  growthBlueprintStatus: string | null;
  executionPlanApproved?: boolean;
  nextBestActionExists: boolean;
  activeNextBestAction: {
    title: string;
    reason: string;
    expectedImpact: string;
    confidence: number;
    route: string;
    destinationUrl: string | null;
    status: string;
  } | null;
  latestStrategyVersion: number;
  executionPlanVersion: string | null;
  executionPlanStrategyVersion: number | null;
  growthBlueprintVersion: number;
  moduleDecisions: Record<string, "not_applicable" | "waived" | "deferred" | null>;
};

const stateLabels: Record<WorkflowState, string> = {
  discovery: "Business discovery",
  intelligence_collection: "Intelligence collection",
  strategy_ready: "Strategy ready",
  strategy_approved: "Strategy approved",
  execution_planning: "Execution planning",
  execution: "AI-assisted execution",
  measurement: "Measurement",
  continuous_growth: "Continuous growth",
};

// Intelligence providers can finish persisting records immediately after the
// Strategy transaction completes. Treat those near-simultaneous writes as part
// of the generation cycle so a fresh Strategy is not stale before it can be
// reviewed. Explicit invalidation events still set the Strategy status to
// `stale` immediately; the window applies only to timestamp-based detection.
export const STRATEGY_EVIDENCE_SETTLING_WINDOW_MS = 2 * 60 * 1000;

function newest(...dates: Array<Date | null | undefined>) {
  return dates.filter((date): date is Date => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

function action(label: string, url: string, type: WorkflowAction["type"] = "navigate"): WorkflowAction {
  return { label, url, type };
}

const aiRoles = {
  setup: {
    mode: "guided",
    suggestion: "AI checks the selected project path and explains which information is required.",
    implementation: "AI reuses workspace and client defaults so the user does not enter the same facts again.",
    humanRole: "Confirm factual business and ownership details.",
  },
  discovery: {
    mode: "ai_assisted",
    suggestion: "AI summarizes the business, audience, offer, goals, locations, competitors, and existing assets.",
    implementation: "AI identifies missing or conflicting intake facts and prepares a reusable Business Brain.",
    humanRole: "Verify facts and approve the completed profile.",
  },
  intelligence: {
    mode: "automatic",
    suggestion: "AI recommends the evidence collection required for this exact project situation.",
    implementation: "AI coordinates research, crawling, grouping, scoring, and gap diagnosis across the existing modules.",
    humanRole: "Start provider-backed research when required and verify sensitive business facts.",
  },
  strategy: {
    mode: "ai_assisted",
    suggestion: "AI turns all current evidence into ranked focus areas and one cross-platform plan of action.",
    implementation: "AI generates the unified SEO, content, local, citation, authority, lead, social, and publishing direction.",
    humanRole: "Review the decisions and request regeneration when the direction needs adjustment.",
  },
  approval: {
    mode: "approval_required",
    suggestion: "AI highlights assumptions, dependencies, expected impact, and decisions that need review.",
    implementation: "AI locks the approved strategy version used by downstream work.",
    humanRole: "Approve the exact strategy version or regenerate it.",
  },
  planning: {
    mode: "automatic",
    suggestion: "AI converts the approved strategy into sequenced, dependency-aware actions.",
    implementation: "AI creates tasks, expected outcomes, destinations, approvals, and implementation routes.",
    humanRole: "Confirm priorities, ownership, and any external access requirements.",
  },
  execution: {
    mode: "ai_assisted",
    suggestion: "AI recommends the highest-priority valid task instead of making the user choose a module.",
    implementation: "AI creates or fixes content, pages, metadata, schema, links, lead assets, social assets, and implementation packages where supported.",
    humanRole: "Review factual claims and approve protected or public changes.",
  },
  publishing: {
    mode: "approval_required",
    suggestion: "AI validates readiness, provider access, links, forms, assets, and rollback requirements.",
    implementation: "AI publishes through a connected provider or prepares a verified download and handoff package.",
    humanRole: "Approve public changes and provide required hosting or provider access.",
  },
  measurement: {
    mode: "automatic",
    suggestion: "AI selects the KPIs and checkpoints tied to the approved strategy and implemented work.",
    implementation: "AI records baselines, compares results, detects movement, and diagnoses weak outcomes.",
    humanRole: "Connect permitted analytics or confirm manually supplied observations.",
  },
  growth: {
    mode: "automatic",
    suggestion: "AI updates the Growth Blueprint from measured results and current business goals.",
    implementation: "AI ranks experiments and creates the next valid recommendation without bypassing approval rules.",
    humanRole: "Approve the next experiment or change its priority.",
  },
} satisfies Record<string, WorkflowAiRole>;

function moduleStatus(input: {
  required: boolean;
  complete: boolean;
  inProgress?: boolean;
  failed?: boolean;
  blockedBy?: string | null;
}): WorkflowModuleStatus {
  if (!input.required) return "not_required";
  if (input.complete) return "complete";
  if (input.failed) return "failed";
  if (input.inProgress) return "in_progress";
  if (input.blockedBy) return "blocked";
  return "not_started";
}

function statusReason(status: WorkflowModuleStatus, complete: string, pending: string, blocked?: string) {
  if (status === "complete" || status === "approved") return complete;
  if (status === "not_required") return "Not required for this project situation.";
  if (status === "in_progress") return "AI and connected data providers are collecting this evidence in the background.";
  if (status === "failed") return "The latest collection attempt failed. Review the error and run it again.";
  if (status === "blocked") return blocked || pending;
  return pending;
}

export function resolveProjectWorkflow(snapshot: WorkflowEvidenceSnapshot): ProjectWorkflowControllerView {
  const projectQuery = `projectId=${encodeURIComponent(snapshot.projectId)}`;
  const intelligence: WorkflowModule[] = [];
  const push = (value: WorkflowModule) => intelligence.push(value);

  const approvedKeywordCount = snapshot.approvedKeywordCount ?? 0;
  const missingKeywordResearchCount = snapshot.missingKeywordResearchCount ?? 0;
  const missingKeywordResearchCheckCount = snapshot.missingKeywordResearchCheckCount ?? missingKeywordResearchCount;
  const missingKeywordResearchKeywords = snapshot.missingKeywordResearchKeywords ?? [];
  const failedKeywordResearchKeywords = snapshot.failedKeywordResearchKeywords ?? [];
  const failedKeywordResearchCheckCount = snapshot.failedKeywordResearchCheckCount ?? failedKeywordResearchKeywords.length;
  const keywordResearchActiveCheckCount = snapshot.keywordResearchActiveCheckCount ?? (snapshot.keywordResearchInProgress ? 1 : 0);
  const keywordMarketSetupRequired = approvedKeywordCount > 0 && !snapshot.targetLocationsConfirmed;
  const keywordBlockedBy = !snapshot.discoveryComplete
    ? "Complete Business Discovery first."
    : !snapshot.selectedOpportunity
      ? "Create and select the project opportunity before Keyword Intelligence."
      : keywordMarketSetupRequired
        ? "Choose at least one exact city, region, or country before starting Keyword Intelligence analysis."
        : null;
  let keywordsStatus = moduleStatus({ required: true, complete: snapshot.approvedKeywords && !keywordMarketSetupRequired, inProgress: snapshot.keywordResearchInProgress, failed: snapshot.keywordResearchFailed && !snapshot.keywordResearchInProgress, blockedBy: keywordBlockedBy });
  if (keywordsStatus === "not_started" && approvedKeywordCount > missingKeywordResearchCount && missingKeywordResearchCount > 0) keywordsStatus = "needs_attention";
  const missingKeywordNames = missingKeywordResearchKeywords.length
    ? ` Affected: ${missingKeywordResearchKeywords.slice(0, 6).join(", ")}${missingKeywordResearchKeywords.length > 6 ? `, and ${missingKeywordResearchKeywords.length - 6} more` : ""}.`
    : "";
  const keywordResolution = keywordResearchActiveCheckCount > 0
    ? ` ${keywordResearchActiveCheckCount} keyword-location check${keywordResearchActiveCheckCount === 1 ? " is" : "s are"} currently running. Wait for those checks before reviewing any remaining failures.`
    : failedKeywordResearchCheckCount > 0
    ? ` Retry ${failedKeywordResearchCheckCount} failed keyword-location check${failedKeywordResearchCheckCount === 1 ? "" : "s"}; completed checks are preserved.`
    : " Start the remaining keywords from Keyword Intelligence.";
  const keywordPendingReason = approvedKeywordCount > 0 && missingKeywordResearchCount > 0
    ? `${missingKeywordResearchCheckCount} exact market check${missingKeywordResearchCheckCount === 1 ? "" : "s"} across ${missingKeywordResearchCount} of ${approvedKeywordCount} approved Primary and Secondary keywords do not have completed analysis.${missingKeywordNames}${keywordResolution}`
    : "Run Keyword Intelligence and approve the relevant groups.";
  const keywordActionLabel = keywordResearchActiveCheckCount > 0
    ? `View ${keywordResearchActiveCheckCount} Running Check${keywordResearchActiveCheckCount === 1 ? "" : "s"}`
    : keywordMarketSetupRequired
    ? "Choose target areas"
    : failedKeywordResearchCheckCount > 0
    ? `Review & Retry ${failedKeywordResearchCheckCount} Failed Check${failedKeywordResearchCheckCount === 1 ? "" : "s"}`
    : snapshot.approvedKeywords
    ? "Review keywords"
    : missingKeywordResearchCount > 0
      ? `Analyze ${missingKeywordResearchCheckCount} remaining check${missingKeywordResearchCheckCount === 1 ? "" : "s"}`
      : "Run keyword research";
  push({ key: "keyword_intelligence", label: "Keyword Intelligence", description: "Search demand, intent, topic groups, opportunity, and approved keyword evidence.", status: keywordsStatus, required: true, weight: 18, reason: statusReason(keywordsStatus, `All ${approvedKeywordCount || "approved"} Primary and Secondary keywords have completed analysis.`, keywordPendingReason, keywordBlockedBy ?? undefined), evidenceAt: snapshot.keywordEvidenceAt?.toISOString() ?? null, action: keywordBlockedBy === "Create and select the project opportunity before Keyword Intelligence." ? action("Create and select opportunity", `/opportunities?${projectQuery}`, "generate") : action(keywordActionLabel, `/keywords?${projectQuery}`, snapshot.approvedKeywords ? "review" : "generate"), ai: { ...aiRoles.intelligence, implementation: "AI expands seed topics, researches demand and intent, groups keywords, identifies page ownership, and explains the strongest opportunities." } });

  const locationRequired = snapshot.localSeoApplicable;
  const locationComplete = snapshot.targetLocationsConfirmed && (snapshot.localAnalysisComplete || snapshot.gapAnalysisComplete || snapshot.approvedKeywords);
  const locationStatus = moduleStatus({ required: locationRequired, complete: locationComplete, inProgress: snapshot.localAnalysisInProgress, failed: snapshot.localAnalysisFailed, blockedBy: snapshot.targetLocationsConfirmed ? null : "Confirm target markets first." });
  push({ key: "location_intelligence", label: "Location Intelligence", description: "Target markets, service areas, local intent, and location-specific evidence where applicable.", status: locationStatus, required: locationRequired, weight: 8, reason: statusReason(locationStatus, "Target markets and location evidence are available.", "Confirm target markets and collect local search evidence.", "Confirm target markets first."), evidenceAt: snapshot.localEvidenceAt?.toISOString() ?? snapshot.keywordEvidenceAt?.toISOString() ?? null, action: locationRequired ? action(locationComplete ? "Review Local SEO" : "Collect local evidence", `/local-seo?${projectQuery}`, locationComplete ? "review" : "generate") : null, ai: { ...aiRoles.intelligence, implementation: "AI maps services to cities and service areas, avoids doorway-page patterns, and recommends the markets that need attention first." } });

  const competitorRequired = true;
  const competitorStatus = moduleStatus({ required: competitorRequired, complete: snapshot.competitorAnalysisComplete || snapshot.gapAnalysisComplete, inProgress: snapshot.competitorAnalysisInProgress, failed: snapshot.competitorAnalysisFailed, blockedBy: snapshot.approvedKeywords ? null : "Keyword Intelligence must establish the comparison topics first." });
  push({ key: "competitor_intelligence", label: "Opportunity & Competitor Intelligence", description: "Demand, customer questions, real search competitors, positioning, coverage, and market opportunities.", status: competitorStatus, required: competitorRequired, weight: 10, reason: statusReason(competitorStatus, "Opportunity and competitor evidence has been collected.", "Run Market & Content Gap Analysis to compare demand, questions, and real search competitors.", "Complete Keyword Intelligence first."), evidenceAt: snapshot.competitorEvidenceAt?.toISOString() ?? snapshot.gapEvidenceAt?.toISOString() ?? null, action: action(competitorStatus === "complete" ? "Review market intelligence" : "Analyze market and competitors", `/gap-analysis?${projectQuery}`, competitorStatus === "complete" ? "review" : "generate"), ai: { ...aiRoles.intelligence, implementation: "AI identifies actual competing domains, demand and customer questions, compares coverage and authority, and recommends defensible opportunities rather than copying competitors." } });

  const siteStatus = moduleStatus({ required: snapshot.existingWebsite, complete: snapshot.siteAnalysisComplete, inProgress: snapshot.siteAnalysisInProgress, failed: snapshot.siteAnalysisFailed, blockedBy: snapshot.approvedKeywords ? null : "Complete Keyword Intelligence so the crawl can be interpreted against target demand." });
  const websiteBaselineDue = snapshot.existingWebsite && snapshot.publishingComplete && !snapshot.siteAnalysisComplete;
  push({ key: "site_analysis", label: snapshot.preLaunchWebsite || websiteBaselineDue ? "Website Intelligence Baseline" : "Website Intelligence", description: "Crawl-backed pages, links, indexability, content, schema, accessibility, and conversion evidence.", status: siteStatus, required: snapshot.existingWebsite, weight: 16, reason: snapshot.preLaunchWebsite ? "Starts after the website is published; a live-site baseline is never fabricated before launch." : statusReason(siteStatus, "A completed crawl exists for the current website.", websiteBaselineDue ? "The website is published. Run the first Website Intelligence assessment and save its measurement baseline." : "Analyze the connected website before Strategy generation.", "Complete Keyword Intelligence first."), evidenceAt: snapshot.siteEvidenceAt?.toISOString() ?? null, action: snapshot.existingWebsite ? action(snapshot.siteAnalysisComplete ? "Review Website Intelligence" : websiteBaselineDue ? "Create Website Intelligence Baseline" : "Analyze website", `/site-analysis?${projectQuery}`, snapshot.siteAnalysisComplete ? "review" : "generate") : null, ai: { ...aiRoles.intelligence, implementation: "The crawler collects page-level evidence; AI groups repeated findings, explains impact, and recommends fixes for the correct canonical page." } });

  const ecommerceStatus = moduleStatus({ required: snapshot.ecommerceApplicable, complete: snapshot.ecommerceAnalysisComplete, inProgress: snapshot.ecommerceAnalysisInProgress, failed: snapshot.ecommerceAnalysisFailed, blockedBy: snapshot.siteAnalysisComplete ? null : "Complete Website Intelligence for the public store first." });
  push({ key: "ecommerce_intelligence", label: "Ecommerce Intelligence", description: "Public products, collections, store structure, product search intent, merchandising, content, internal linking, and evidence limitations.", status: ecommerceStatus, required: snapshot.ecommerceApplicable, weight: 12, reason: statusReason(ecommerceStatus, "Public product and collection intelligence is available to Strategy.", "Analyze the public catalog and approve the product or collection priorities that should influence Strategy.", "Complete Website Intelligence for the public store first."), evidenceAt: snapshot.ecommerceEvidenceAt?.toISOString() ?? null, action: snapshot.ecommerceApplicable ? action(snapshot.ecommerceAnalysisComplete ? "Review Ecommerce Intelligence" : "Analyze public store", `/ecommerce-intelligence?${projectQuery}`, snapshot.ecommerceAnalysisComplete ? "review" : "generate") : null, ai: { ...aiRoles.intelligence, implementation: "AI classifies crawl-visible products and collections, compares them with search demand, labels inferred merchandising ideas, and never invents private sales, margin, inventory, or conversion data." } });

  // Every project needs a gap decision before Strategy. Existing websites use
  // crawl-backed technical and page evidence; pre-website projects use the
  // same workspace for keyword, competitor, market, entity, authority, local,
  // and planned-content gaps without pretending that live pages exist.
  const gapBlocked = snapshot.existingWebsite
    ? !snapshot.siteAnalysisComplete ? "Complete Site Analysis first." : null
    : !snapshot.approvedKeywords ? "Complete Keyword Intelligence first." : null;
  const technicalRequired = snapshot.existingWebsite;
  const gapEvidenceSuperseded = Boolean(snapshot.gapEvidenceAt && (
    snapshot.keywordEvidenceAt && snapshot.gapEvidenceAt.getTime() < snapshot.keywordEvidenceAt.getTime()
    || snapshot.existingWebsite && snapshot.siteEvidenceAt && snapshot.gapEvidenceAt.getTime() < snapshot.siteEvidenceAt.getTime()
  ));
  let technicalStatus = moduleStatus({ required: technicalRequired, complete: snapshot.gapAnalysisComplete, inProgress: snapshot.gapAnalysisInProgress, failed: snapshot.gapAnalysisFailed, blockedBy: technicalRequired ? gapBlocked : null });
  if (technicalStatus === "not_started" && gapEvidenceSuperseded) technicalStatus = "stale";
  const staleGapReason = "The saved Gap Analysis predates newer Keyword or Website evidence. Refresh it so the current crawl and approved search targets are included.";
  push({ key: "technical_seo", label: "Technical SEO", description: "Canonical, redirect, sitemap, indexability, performance, structured data, and crawl-health priorities.", status: technicalStatus, required: technicalRequired, weight: 12, reason: technicalStatus === "stale" ? staleGapReason : statusReason(technicalStatus, "Technical findings are consolidated and prioritized.", "Run SEO & Gap Analysis to turn crawl evidence into priorities.", gapBlocked ?? undefined), evidenceAt: snapshot.gapEvidenceAt?.toISOString() ?? null, action: technicalRequired ? action(technicalStatus === "complete" ? "Review technical fixes" : technicalStatus === "stale" ? "Refresh gap analysis" : "Run gap analysis", `/gap-analysis?${projectQuery}`, technicalStatus === "complete" ? "review" : "generate") : null, ai: { ...aiRoles.intelligence, implementation: "AI consolidates aliases and repeated crawl checks, ranks technical fixes, and sends approved work to implementation or publishing." } });

  const contentGapRequired = true;
  let contentGapStatus = moduleStatus({ required: contentGapRequired, complete: snapshot.gapAnalysisComplete, inProgress: snapshot.gapAnalysisInProgress, failed: snapshot.gapAnalysisFailed, blockedBy: gapBlocked });
  if (contentGapStatus === "not_started" && gapEvidenceSuperseded) contentGapStatus = "stale";
  const contentGapLabel = snapshot.existingWebsite ? "Content Gap Analysis" : "Market & Content Gap Analysis";
  const contentGapDescription = snapshot.existingWebsite
    ? "Keyword-to-page mapping, missing intent, weak content, internal links, entities, and conversion gaps."
    : "Keyword, competitor, market, entity, authority, local, and planned-content gaps before the first website is built.";
  const contentGapPending = snapshot.existingWebsite
    ? "Run SEO & Gap Analysis after the crawl."
    : "Analyze market and content gaps before generating Strategy.";
  push({ key: "content_gap_analysis", label: contentGapLabel, description: contentGapDescription, status: contentGapStatus, required: contentGapRequired, weight: 12, reason: contentGapStatus === "stale" ? staleGapReason : statusReason(contentGapStatus, "Content, market, and page-planning gaps are available.", contentGapPending, gapBlocked ?? undefined), evidenceAt: snapshot.gapEvidenceAt?.toISOString() ?? null, action: action(contentGapStatus === "complete" ? "Review content gaps" : contentGapStatus === "stale" ? "Refresh content gaps" : snapshot.existingWebsite ? "Find content gaps" : "Analyze market gaps", `/gap-analysis?${projectQuery}`, contentGapStatus === "complete" ? "review" : "generate"), ai: { ...aiRoles.intelligence, implementation: snapshot.existingWebsite ? "AI maps keywords and locations to owner pages, finds missing or competing intent, and prepares content, FAQ, schema, and internal-link fixes." : "AI compares approved keywords, markets, competitors, entities, authority, and local readiness, then defines the content and page opportunities the first website must address." } });

  const localAnalysisRequired = locationRequired;
  const localSeoStatus = moduleStatus({ required: localAnalysisRequired, complete: snapshot.localAnalysisComplete || snapshot.gapAnalysisComplete, inProgress: snapshot.localAnalysisInProgress, failed: snapshot.localAnalysisFailed, blockedBy: snapshot.targetLocationsConfirmed ? null : "Confirm business and target locations first." });
  push({ key: "local_seo_analysis", label: "Local SEO Analysis", description: "Business location, service areas, GBP readiness, NAP, citations, categories, local pages, schema, and local search intent.", status: localSeoStatus, required: localAnalysisRequired, weight: 8, reason: statusReason(localSeoStatus, "Local visibility and website-planning evidence is available.", "Run the Local SEO audit for this location-dependent project.", "Confirm business and target locations first."), evidenceAt: snapshot.localEvidenceAt?.toISOString() ?? snapshot.gapEvidenceAt?.toISOString() ?? null, action: localAnalysisRequired ? action(localSeoStatus === "complete" ? "Review local plan" : "Run Local SEO audit", `/local-seo?${projectQuery}`, localSeoStatus === "complete" ? "review" : "generate") : null, ai: { ...aiRoles.intelligence, implementation: "AI validates business and service-area facts, checks available profile evidence, and plans local pages and schema without inventing addresses, listings, or reviews." } });

  const citationRequired = true;
  let citationStatus = moduleStatus({ required: citationRequired, complete: snapshot.citationEvidenceComplete || snapshot.gapAnalysisComplete, inProgress: snapshot.gapAnalysisInProgress, failed: snapshot.gapAnalysisFailed, blockedBy: gapBlocked });
  push({ key: "ai_citation_analysis", label: snapshot.preLaunchWebsite ? "AI Citation Opportunities" : "AI Citation Analysis", description: snapshot.preLaunchWebsite ? "Planned entities, answer content, source clarity, schema, trust signals, and AI-discoverability requirements for the first website." : "Entity, claim, source, answer structure, trust, schema, and AI-discoverability readiness.", status: citationStatus, required: citationRequired, weight: 8, reason: citationStatus === "stale" ? staleGapReason : statusReason(citationStatus, snapshot.preLaunchWebsite ? "AI Citation and trust requirements are available to the Unified Strategy." : "AI citation and trust evidence is available.", "Run AI Citation research and save its evidence.", gapBlocked ?? undefined), evidenceAt: snapshot.citationEvidenceAt?.toISOString() ?? snapshot.gapEvidenceAt?.toISOString() ?? null, action: action(citationStatus === "complete" ? "Review citation direction" : citationStatus === "stale" ? "Refresh citation evidence" : snapshot.preLaunchWebsite ? "Plan AI Citation readiness" : "Analyze AI citations", "/ai-citations?" + projectQuery, citationStatus === "complete" ? "review" : "generate"), ai: { ...aiRoles.intelligence, implementation: snapshot.preLaunchWebsite ? "AI converts verified business facts, audience questions, trust requirements, and planned page roles into citation-ready content and schema requirements without inventing claims." : "AI validates trust signals against crawl and Website Development records, then prepares factual content, schema, files, and website updates for review." } });

  const authorityRequired = true;
  const authorityBlockedBy = snapshot.preLaunchWebsite ? gapBlocked : snapshot.siteAnalysisComplete ? null : "Complete Site Analysis first.";
  let authorityStatus = moduleStatus({ required: authorityRequired, complete: snapshot.authorityEvidenceComplete || snapshot.gapAnalysisComplete, inProgress: snapshot.competitorAnalysisInProgress || snapshot.gapAnalysisInProgress, failed: snapshot.competitorAnalysisFailed || snapshot.gapAnalysisFailed, blockedBy: authorityBlockedBy });
  if (authorityStatus === "not_started" && gapEvidenceSuperseded) authorityStatus = "stale";
  push({ key: "authority_analysis", label: snapshot.preLaunchWebsite ? "Authority Opportunities" : "Authority Analysis", description: snapshot.preLaunchWebsite ? "Topical authority clusters, proof assets, expert content, mentions, partnerships, and safe authority requirements for launch." : "Backlinks, mentions, assets, source quality, risk, and realistic authority opportunities.", status: authorityStatus, required: authorityRequired, weight: 8, reason: authorityStatus === "stale" ? staleGapReason : statusReason(authorityStatus, snapshot.preLaunchWebsite ? "Authority requirements and safe opportunities are available to the Unified Strategy." : "Authority evidence and safe opportunities are available.", snapshot.preLaunchWebsite ? "Identify topical, local, trust, and external authority opportunities before Strategy generation." : "Analyze backlink and authority gaps before Strategy generation.", authorityBlockedBy ?? undefined), evidenceAt: snapshot.authorityEvidenceAt?.toISOString() ?? snapshot.gapEvidenceAt?.toISOString() ?? null, action: action(authorityStatus === "complete" ? "Review authority opportunities" : authorityStatus === "stale" ? "Refresh authority evidence" : "Analyze authority", authorityStatus === "stale" || snapshot.preLaunchWebsite ? `/gap-analysis?${projectQuery}` : `/backlinks?${projectQuery}`, authorityStatus === "complete" ? "review" : "generate"), ai: { ...aiRoles.intelligence, implementation: snapshot.preLaunchWebsite ? "AI defines topical and local authority clusters, trust assets, proof requirements, and future earning opportunities that the first website must support." : "AI identifies relevant authority gaps and safe earning opportunities, scores risk, and prepares assets or outreach for approval without spam automation." } });

  for (const item of intelligence) {
    const freshnessDays = WORKFLOW_EVIDENCE_FRESHNESS_DAYS[item.key] ?? 90;
    const evidenceAgeDays = item.evidenceAt ? Math.floor((Date.now() - new Date(item.evidenceAt).getTime()) / 86_400_000) : null;
    if (item.required && ["complete", "approved"].includes(item.status) && evidenceAgeDays != null && evidenceAgeDays > freshnessDays) {
      item.status = "stale";
      item.reason = `This evidence is ${evidenceAgeDays} days old and exceeds its ${freshnessDays}-day freshness window. Refresh it or record an authorized waiver before generating an official Strategy.`;
    }
    const decision = snapshot.moduleDecisions[item.key];
    if (["not_applicable", "waived"].includes(decision ?? "") && item.required && !["complete", "approved"].includes(item.status)) {
      item.status = "not_applicable";
      item.reason = "An authorized user confirmed this module is Not Applicable and recorded the reason in the project audit history.";
    } else if (decision === "deferred" && item.required && !["complete", "approved"].includes(item.status)) {
      item.status = "deferred";
      item.reason = "This intelligence area is deferred. Strategy remains blocked until it is completed or explicitly marked Not Applicable.";
    }
  }

  const requiredIntelligence = intelligence.filter((item) => item.required);
  const intelligenceReady = requiredIntelligence.every((item) => ["complete", "approved", "not_applicable"].includes(item.status));
  const intelligenceWeight = requiredIntelligence.reduce((sum, item) => sum + item.weight, 0) || 1;
  const intelligenceReadinessPercent = Math.round(requiredIntelligence.reduce((sum, item) => sum + (["complete", "approved", "not_applicable"].includes(item.status) ? item.weight : item.status === "in_progress" ? item.weight * 0.5 : 0), 0) / intelligenceWeight * 100);
  const readinessPercent = snapshot.criticalEvidenceIssueCount > 0 ? Math.min(99, intelligenceReadinessPercent) : intelligenceReadinessPercent;
  const strategyStale = Boolean(snapshot.latestStrategy && (
    snapshot.latestStrategy.status === "stale"
    || (snapshot.latestEvidenceAt
      && snapshot.latestEvidenceAt.getTime() > snapshot.latestStrategy.createdAt.getTime() + STRATEGY_EVIDENCE_SETTLING_WINDOW_MS)
  ));
  const gapStrategyStale = Boolean(snapshot.websitePlanRequired && !snapshot.websitePlanGenerated && snapshot.latestStrategy && snapshot.gapEvidenceAt
    && snapshot.gapEvidenceAt.getTime() > snapshot.latestStrategy.createdAt.getTime());
  // An approved version remains the governing authority until the customer
  // explicitly chooses and approves a replacement. Freshness is a caution,
  // not a reason to invalidate paid work.
  const strategyApproved = snapshot.latestStrategy?.status === "approved" || Boolean(snapshot.latestStrategy?.approvedAt);
  const findingsReviewed = Boolean(snapshot.findingsReviewed);
  const trackingReady = Boolean(snapshot.trackingVerified || snapshot.trackingLimitationRecorded);
  const reportingLearningComplete = Boolean(snapshot.reportingLearningComplete);
  const continuousGrowthReady = Boolean(snapshot.businessBrainApproved && snapshot.readinessComplete && intelligenceReady && findingsReviewed && strategyApproved && snapshot.growthBlueprintStatus === "approved" && snapshot.executionPlanApproved && snapshot.completedExecutionTasks > 0 && snapshot.measurementComplete && reportingLearningComplete && trackingReady && snapshot.nextBestActionExists);
  const executionPlanStale = Boolean(snapshot.executionTasksExist && snapshot.latestStrategy?.status === "approved" && (snapshot.executionPlanStrategyVersion == null ? snapshot.latestStrategy.approvedAt && snapshot.executionPlanUpdatedAt && snapshot.latestStrategy.approvedAt.getTime() > snapshot.executionPlanUpdatedAt.getTime() : snapshot.executionPlanStrategyVersion !== snapshot.latestStrategyVersion));
  const implementationComplete = snapshot.executionTasksExist && snapshot.openExecutionTasks === 0 && snapshot.completedExecutionTasks > 0;
  // The build-ready Website Plan is the governed bridge between an approved
  // Strategy and every page-level execution action. For an existing website,
  // this is presented as the SEO Page Map & Content Plan. Prioritize it whenever it
  // is required and not approved; otherwise users can reach Website
  // Development first and encounter a circular approval blocker.
  const websitePlanPrerequisitePending = snapshot.websitePlanRequired && !snapshot.websitePlanApproved;
  const verifiedExecutionOutcome = snapshot.publishingComplete || implementationComplete;
  const evidenceAgeDays = snapshot.latestEvidenceAt ? Math.max(0, Math.floor((Date.now() - snapshot.latestEvidenceAt.getTime()) / 86_400_000)) : null;
  const freshness = evidenceAgeDays === null ? 30 : evidenceAgeDays <= 30 ? 100 : evidenceAgeDays <= 90 ? 75 : evidenceAgeDays <= 180 ? 55 : 30;
  const independentSignals = requiredIntelligence.filter((item) => ["complete", "approved", "not_applicable"].includes(item.status)).length;
  const signalCoverage = Math.round(independentSignals / Math.max(1, requiredIntelligence.length) * 100);
  const dataQualityChecks = [snapshot.projectConfigured, snapshot.situationConfigured, snapshot.discoveryComplete, snapshot.selectedOpportunity, !snapshot.existingWebsite || snapshot.siteAnalysisComplete, !snapshot.localSeoApplicable || snapshot.targetLocationsConfirmed];
  const dataQuality = Math.round(dataQualityChecks.filter(Boolean).length / dataQualityChecks.length * 100);
  const conflictPenalty = (strategyStale ? 12 : 0) + (executionPlanStale ? 8 : 0);
  const overallConfidence = Math.max(0, Math.min(100, Math.round(readinessPercent * 0.35 + freshness * 0.2 + signalCoverage * 0.2 + dataQuality * 0.15 + 10 - conflictPenalty)));
  const confidence = {
    overall: overallConfidence,
    completeness: readinessPercent,
    freshness,
    signalCoverage,
    dataQuality,
    conflictPenalty,
    independentSignals,
    reasons: [
      snapshot.discoveryComplete ? "Business Discovery is complete." : "Business Discovery is incomplete.",
      `${independentSignals} of ${requiredIntelligence.length} required independent intelligence signals are complete.`,
      evidenceAgeDays === null ? "No dated evidence is available yet." : `Latest evidence is ${evidenceAgeDays} day(s) old.`,
    ],
    cautions: [strategyStale ? "Strategy predates newer evidence." : null, executionPlanStale ? "Execution Plan predates the approved Strategy." : null, !snapshot.measurementStarted ? "No measured outcome evidence is connected yet." : null].filter((item): item is string => Boolean(item)),
  };

  const stages: WorkflowStage[] = [
    { key: "project_created", label: "Project Created", description: "Create the governed project record and correct workspace/client context.", status: snapshot.projectConfigured && snapshot.workspaceConfigured && snapshot.situationConfigured ? "complete" : snapshot.projectConfigured ? "needs_attention" : "not_started", reason: snapshot.projectConfigured && snapshot.workspaceConfigured && snapshot.situationConfigured ? "The project, workspace, client and project situation are configured." : "Complete the project, workspace/client and situation setup.", action: action("Review project", `/guided-projects/${snapshot.projectId}`, "review"), ai: aiRoles.setup },
    { key: "intake", label: "Intake", description: "Build the shared Business Brain used by all downstream work.", status: snapshot.discoveryComplete ? "complete" : "ready", reason: snapshot.discoveryComplete ? "Required business, audience, offer, goal and project facts exist." : "Complete guided Intake; opening the screen alone does not complete it.", action: action(snapshot.discoveryComplete ? "Review Intake" : "Continue Intake", `/guided-projects/${snapshot.projectId}/intake`, snapshot.discoveryComplete ? "review" : "generate"), ai: aiRoles.discovery },
    { key: "business_brain_approval", label: "Business Brain Review and Approval", description: "Approve the exact Business Brain version used by downstream work.", status: snapshot.businessBrainApproved ? "approved" : snapshot.discoveryComplete ? "ready" : "blocked", reason: snapshot.businessBrainApproved ? "The current Business Brain version is approved." : snapshot.discoveryComplete ? "Review and approve the current Business Brain before readiness checks." : "Complete Intake first.", action: action(snapshot.businessBrainApproved ? "Review Business Brain" : "Approve Business Brain", `/guided-projects/${snapshot.projectId}`, snapshot.businessBrainApproved ? "review" : "approve"), ai: aiRoles.approval },
    { key: "readiness_check", label: "Readiness Check", description: "Confirm required project facts and situation details before Opportunity Discovery.", status: snapshot.readinessComplete ? "complete" : snapshot.businessBrainApproved ? "ready" : "blocked", reason: snapshot.readinessComplete ? "The current Business Brain passed readiness." : snapshot.businessBrainApproved ? "Confirm readiness for Opportunity Discovery." : "Approve the Business Brain first.", action: action(snapshot.readinessComplete ? "Review Readiness" : "Confirm Readiness", `/guided-projects/${snapshot.projectId}`, snapshot.readinessComplete ? "review" : "approve"), ai: aiRoles.setup },
    { key: "opportunity_discovery", label: "Opportunity Discovery", description: "Create and select the project direction after readiness.", status: snapshot.selectedOpportunity ? "complete" : snapshot.readinessComplete ? "ready" : "blocked", reason: snapshot.selectedOpportunity ? "A project opportunity is selected." : snapshot.readinessComplete ? "Generate and select the direction that intelligence should investigate." : "Complete Readiness first.", action: action(snapshot.selectedOpportunity ? "Review Opportunity" : "Run Opportunity Discovery", `/opportunities?${projectQuery}`, snapshot.selectedOpportunity ? "review" : "generate"), ai: aiRoles.intelligence },
    { key: "required_intelligence", label: "Required Intelligence", description: "Collect only evidence applicable to this project.", status: intelligenceReady ? "complete" : requiredIntelligence.some((item) => item.status === "in_progress") ? "in_progress" : snapshot.selectedOpportunity ? "ready" : "blocked", reason: intelligenceReady ? "Every required module is Complete or Not Applicable." : `${requiredIntelligence.filter((item) => !["complete", "approved", "not_applicable"].includes(item.status)).length} required intelligence area(s) remain.`, action: intelligence.find((item) => item.required && !["complete", "approved", "not_applicable"].includes(item.status))?.action ?? action("Review intelligence", `/seo-growth?${projectQuery}`, "review"), ai: aiRoles.intelligence, modules: intelligence },
    { key: "findings_review", label: "Findings Review", description: "Review evidence, freshness, conflicts, confidence and limitations.", status: findingsReviewed ? "complete" : intelligenceReady && snapshot.criticalEvidenceIssueCount === 0 ? "ready" : "blocked", reason: findingsReviewed ? "The current Business Brain and evidence versions were reviewed." : snapshot.criticalEvidenceIssueCount > 0 ? `${snapshot.criticalEvidenceIssueCount} serious business fact issue(s) require resolution.` : intelligenceReady ? "Review and accept the current findings before Strategy." : "Complete required intelligence first.", action: action(findingsReviewed ? "Review Findings" : "Confirm Findings Review", `/guided-projects/${snapshot.projectId}`, findingsReviewed ? "review" : "approve"), ai: aiRoles.approval },
    { key: "growth_strategy", label: "Growth Strategy", description: "Create the evidence-backed cross-channel Strategy.", status: snapshot.latestStrategy ? "complete" : intelligenceReady && findingsReviewed ? "ready" : "blocked", reason: snapshot.latestStrategy ? "A Strategy version exists." : intelligenceReady && findingsReviewed ? "Current findings are approved for Strategy generation." : !intelligenceReady ? "Complete required intelligence first." : "Review findings first.", action: action(snapshot.latestStrategy ? "Review Strategy" : "Create Growth Strategy", `/strategy?${projectQuery}`, snapshot.latestStrategy ? "review" : "generate"), ai: aiRoles.strategy },
    { key: "growth_strategy_approval", label: "Growth Strategy Approval", description: "Approve the exact Strategy version controlling later work.", status: gapStrategyStale ? "stale" : strategyApproved ? "approved" : snapshot.latestStrategy ? "ready" : "blocked", reason: strategyApproved ? "The current Strategy is approved." : gapStrategyStale ? "Refresh Strategy from newer required evidence." : snapshot.latestStrategy ? "Review and approve this Strategy version." : "Create Strategy first.", action: action(strategyApproved ? "Review Strategy" : "Approve Strategy", `/strategy?${projectQuery}`, strategyApproved ? "review" : "approve"), ai: aiRoles.approval },
    { key: "growth_blueprint", label: "Growth Blueprint", description: "Create and approve the Blueprint controlled by Strategy.", status: snapshot.growthBlueprintStatus === "approved" ? "approved" : snapshot.growthBlueprintStatus === "needs_refresh" ? "stale" : snapshot.growthBlueprintStatus ? "ready" : strategyApproved ? "ready" : "blocked", reason: snapshot.growthBlueprintStatus === "approved" ? "The current Blueprint is approved." : snapshot.growthBlueprintStatus === "needs_refresh" ? "Refresh and reapprove the Blueprint." : strategyApproved ? "Create or approve the Blueprint." : "Approve Strategy first.", action: action(snapshot.growthBlueprintStatus ? "Review Growth Blueprint" : "Create Growth Blueprint", `/growth?${projectQuery}`, snapshot.growthBlueprintStatus ? "approve" : "generate"), ai: aiRoles.growth },
    { key: "required_channel_plans", label: "Required Channel Plans", description: "Create only plans selected by the approved Strategy.", status: !strategyApproved || snapshot.growthBlueprintStatus !== "approved" || !snapshot.preExecutionGrowthComplete ? "blocked" : !snapshot.websitePlanRequired ? "not_required" : snapshot.websitePlanApproved ? "complete" : snapshot.websitePlanGenerated ? "ready" : snapshot.websitePlanGenerationStatus ? "in_progress" : "ready", reason: !strategyApproved ? "Approve Strategy first." : snapshot.growthBlueprintStatus !== "approved" ? "Approve the Growth Blueprint first." : !snapshot.preExecutionGrowthComplete ? "Complete the pre-change Growth diagnosis and priority before creating a channel plan." : !snapshot.websitePlanRequired ? "No separate website/SEO channel plan is selected by the approved Strategy." : snapshot.websitePlanApproved ? "Every required website/SEO plan is approved." : "Create and approve the Strategy-selected website/SEO plan.", action: snapshot.websitePlanRequired ? action(snapshot.websitePlanGenerated ? "Review Channel Plan" : "Create Channel Plan", `/seo-page-map?${projectQuery}`, snapshot.websitePlanGenerated ? "review" : "generate") : null, ai: aiRoles.planning },
    { key: "execution_plan_approval", label: "Execution Plan Review and Approval", description: "Create, review and approve sequenced work.", status: executionPlanStale ? "stale" : snapshot.executionPlanApproved ? "approved" : snapshot.executionTasksExist && strategyApproved ? "ready" : strategyApproved ? "ready" : "blocked", reason: executionPlanStale ? "The plan needs refresh from current sources." : snapshot.executionPlanApproved ? "The current Execution Plan is approved." : snapshot.executionTasksExist ? "Review and approve the plan." : strategyApproved ? "Create the Execution Plan." : "Approve Strategy first.", action: action(snapshot.executionTasksExist ? "Review Execution Plan" : "Create Execution Plan", `/guided-projects/${snapshot.projectId}?tab=execution#execution-tasks`, snapshot.executionTasksExist ? "approve" : "generate"), ai: aiRoles.planning },
    { key: "approved_execution", label: "Approved Execution", description: "Prepare and execute only approved work.", status: snapshot.completedExecutionTasks > 0 ? "complete" : snapshot.executionPlanApproved && snapshot.executionTasksExist ? "in_progress" : "blocked", reason: snapshot.completedExecutionTasks > 0 ? "At least one approved action is complete." : snapshot.executionPlanApproved ? "Execute dependency-ready approved tasks." : "Approve the Execution Plan first.", action: action("Continue Execution", `/guided-projects/${snapshot.projectId}?tab=execution#execution-tasks`, "implement"), ai: aiRoles.execution },
    { key: "output_approval", label: "Output Review and Approval", description: "Review generated outputs before external action.", status: snapshot.preparedChangesAwaitingApproval ? "ready" : snapshot.completedExecutionTasks > 0 ? "complete" : "blocked", reason: snapshot.preparedChangesAwaitingApproval ? "Generated output is waiting for approval." : snapshot.completedExecutionTasks > 0 ? "Completed outputs have their required approval state." : "Prepare approved work first.", action: snapshot.preparedChangesAwaitingApproval ? action("Review Outputs", `/site-architect?${projectQuery}`, "approve") : null, ai: aiRoles.approval },
    { key: "external_completion", label: "Publishing or External Completion", description: "Publish approved work or record verified completion.", status: snapshot.publishingComplete ? "complete" : snapshot.publishingStarted ? "in_progress" : snapshot.completedExecutionTasks > 0 ? "not_required" : "blocked", reason: snapshot.publishingComplete ? "Approved external work is complete." : snapshot.publishingStarted ? "Publishing is in progress." : snapshot.completedExecutionTasks > 0 ? "No separate external publication applies to the completed action." : "Complete and approve an output first.", action: snapshot.publishingStarted ? action("Review Publishing", `/ai-content?${projectQuery}#publishing`, "implement") : null, ai: aiRoles.publishing },
    { key: "tracking_verification", label: "Tracking and Measurement Verification", description: "Verify connection, operation and arriving data or record a limitation.", status: trackingReady ? "complete" : verifiedExecutionOutcome ? "ready" : "blocked", reason: trackingReady ? "Tracking is verified or an authorized limitation is recorded." : "Verify that measurement works and data arrives.", action: action("Verify Tracking", `/growth?${projectQuery}`, "review"), ai: aiRoles.measurement },
    { key: "reporting_learning", label: "Reporting and Learning", description: "Turn completed measurement into a report and saved learning.", status: reportingLearningComplete ? "complete" : snapshot.measurementComplete && trackingReady ? "ready" : "blocked", reason: reportingLearningComplete ? "A current report and learning record exist." : snapshot.measurementComplete ? "Generate the report and record what was learned." : "Complete a measurement checkpoint first.", action: action("Review Reports and Learning", `/growth?${projectQuery}`, "review"), ai: aiRoles.measurement },
    { key: "growth_loop_activation", label: "Continuous Growth Loop Activation", description: "Activate only after every governed prerequisite.", status: continuousGrowthReady ? "complete" : reportingLearningComplete ? "ready" : "blocked", reason: continuousGrowthReady ? "Continuous Growth Loop is active." : "Complete reporting, learning and create the current Next Best Action.", action: action("Activate Growth Loop", `/growth?${projectQuery}`, "review"), ai: aiRoles.growth },
    { key: "next_best_action", label: "Next Best Action", description: "Show the one current evidence-based action.", status: continuousGrowthReady && snapshot.nextBestActionExists ? "in_progress" : "blocked", reason: continuousGrowthReady ? "A current workflow-valid Next Best Action is available." : "The Growth Loop must be ready first.", action: action("View Next Best Action", `/growth?${projectQuery}`, "review"), ai: aiRoles.growth },
  ];

  const incompleteIntelligence = intelligence.find((item) => item.required && !["complete", "approved", "not_applicable"].includes(item.status));
  let state: WorkflowState;
  let nextBestAction: ProjectWorkflowControllerView["nextBestAction"];
  if (!snapshot.discoveryComplete) {
    state = "discovery";
    nextBestAction = { title: "Complete Business Discovery", reason: "Every AI recommendation and implementation depends on verified business context.", expectedResult: "A reusable Business Brain for all modules.", action: action("Continue discovery", `/guided-projects/${snapshot.projectId}/intake`, "generate"), aiWill: ["Reuse workspace and client defaults", "Summarize business, audience, offer, goals, and assets", "Identify missing or conflicting facts"], userWill: "Confirm the factual profile.", confidence: overallConfidence, explainability: "This is first because all research, strategy, content, and fixes need verified business facts." };
  } else if (!snapshot.businessBrainApproved) {
    state = "discovery";
    nextBestAction = { title: "Review and approve the Business Brain", reason: "Intake is complete, but downstream research must use an explicitly approved Business Brain version.", expectedResult: "An auditable approved Business Brain version for this project and client.", action: action("Approve Business Brain", `/guided-projects/${snapshot.projectId}`, "approve"), aiWill: ["Show the current verified business facts", "Preserve the approved version and audit history"], userWill: "Confirm that the current Business Brain is accurate.", confidence: overallConfidence, explainability: "Opening or saving Intake never counts as approval." };
  } else if (!snapshot.readinessComplete) {
    state = "discovery";
    nextBestAction = { title: "Complete the Readiness Check", reason: "The Business Brain is approved; required project details must now be confirmed before Opportunity Discovery.", expectedResult: "A saved readiness decision tied to the approved Business Brain version.", action: action("Confirm Readiness", `/guided-projects/${snapshot.projectId}`, "approve"), aiWill: ["Check required project, market, website, and ownership details", "Explain every missing requirement"], userWill: "Resolve missing information and confirm readiness.", confidence: overallConfidence, explainability: "Opportunity Discovery remains locked until readiness is explicitly complete." };
  } else if (!snapshot.selectedOpportunity) {
    state = "intelligence_collection";
    nextBestAction = { title: "Create and select the project opportunity", reason: "The business intake is complete, but the project direction has not been generated and selected yet.", expectedResult: "One approved opportunity that guides keyword, competitor, website, and market research.", action: action("Generate Opportunities", `/opportunities?${projectQuery}`, "generate"), aiWill: ["Evaluate the Business Brain, goals, audience, offers, markets, and existing assets", "Generate and rank practical opportunities with reasons, confidence, impact, and effort", "Use the selected direction to focus every downstream intelligence module"], userWill: "Review the AI suggestions and select the direction to pursue.", confidence: overallConfidence, explainability: "Opportunity selection comes before Keyword Intelligence so research follows the chosen business direction instead of producing disconnected keyword data." };
  } else if (gapStrategyStale) {
    state = "strategy_ready";
    nextBestAction = { title: "Update Unified Strategy from the latest Gap Analysis", reason: `Gap Analysis is newer than approved Strategy v${snapshot.latestStrategyVersion || 1}. The SEO Page Map and downstream execution must use a Strategy that includes this evidence.`, expectedResult: "A new Strategy version incorporating the latest approved SEO gaps, ready for review and approval.", action: action("Update Unified Strategy", `/strategy?${projectQuery}`, "generate"), aiWill: [aiRoles.strategy.suggestion, "Carry the latest Gap Analysis findings and evidence into the new Strategy version"], userWill: "Review and approve the updated Strategy before continuing to SEO Page Map or execution.", confidence: overallConfidence, explainability: "This is mandatory because the build-ready SEO Page Map is governed by the latest approved Strategy, and the currently approved version predates the latest Gap Analysis." };
  } else if (!intelligenceReady && incompleteIntelligence) {
    state = "intelligence_collection";
    nextBestAction = { title: incompleteIntelligence.label, reason: incompleteIntelligence.reason, expectedResult: `Verified ${incompleteIntelligence.label.toLowerCase()} available to the Unified Strategy.`, action: incompleteIntelligence.action ?? action("Review intelligence", `/seo-growth?${projectQuery}`, "review"), aiWill: [incompleteIntelligence.ai.suggestion, incompleteIntelligence.ai.implementation], userWill: incompleteIntelligence.ai.humanRole, confidence: overallConfidence, explainability: `${incompleteIntelligence.label} is the highest-weight required evidence that is not complete. Completing it increases Strategy confidence and unlocks dependent analysis.` };
  } else if (snapshot.criticalEvidenceIssueCount > 0) {
    state = "intelligence_collection";
    nextBestAction = { title: "Confirm the business facts before planning", reason: `${snapshot.criticalEvidenceIssueCount} business fact${snapshot.criticalEvidenceIssueCount === 1 ? " needs" : "s need"} review, including claims, services, locations, or entity details that website recommendations must not assume.`, expectedResult: "Approved factual evidence that can safely support website recommendations and public content.", action: action("Review remaining business facts", `/ai-citations?${projectQuery}&tab=entities#business-facts`, "review"), aiWill: ["Show the exact claim and its source", "Identify unsupported or conflicting facts", "Keep unapproved facts out of website recommendations"], userWill: "Approve, edit, defer, or reject each fact that affects the plan.", confidence: overallConfidence, explainability: "Critical factual gaps are resolved before planning so generated pages do not invent services, locations, credentials, outcomes, or other public claims." };
  } else if (!findingsReviewed) {
    state = "strategy_ready";
    nextBestAction = { title: "Review the findings", reason: "Required intelligence is ready, but evidence freshness, conflicts, confidence, and limitations must be explicitly reviewed before Strategy creation.", expectedResult: "An auditable findings review tied to the current source versions.", action: action("Confirm findings review", `/guided-projects/${snapshot.projectId}`, "approve"), aiWill: ["Show verified findings and source freshness", "Identify conflicts, confidence, and important limitations"], userWill: "Resolve serious issues or accept the recorded limitations.", confidence: overallConfidence, explainability: "Opening an intelligence screen does not count as review." };
  } else if (!strategyApproved) {
    state = "strategy_ready";
    nextBestAction = { title: snapshot.latestStrategy ? `Review and approve Strategy v${snapshot.latestStrategyVersion || 1}` : "Generate Unified Strategy", reason: snapshot.latestStrategy ? "Use the Strategy already created for this project. Creating a newer version is optional and uses credits." : "Required intelligence is complete, so AI can now make evidence-backed decisions.", expectedResult: "One approved plan controlling Website, SEO, Local, Citations, Authority, Lead Magnets, Social, Growth, and Publishing.", action: action(snapshot.latestStrategy ? "Review Strategy" : "Generate Strategy", `/strategy?${projectQuery}`, snapshot.latestStrategy ? "approve" : "generate"), aiWill: [aiRoles.strategy.suggestion, aiRoles.strategy.implementation], userWill: snapshot.latestStrategy ? aiRoles.approval.humanRole : aiRoles.strategy.humanRole, confidence: overallConfidence, explainability: snapshot.latestStrategy ? "The saved Strategy remains usable. Newer evidence can be incorporated only if the user explicitly chooses a credit-consuming regeneration." : "All applicable intelligence requirements are complete, so Strategy is the next governed decision layer." };
  } else if (!snapshot.preExecutionGrowthComplete) {
    state = "strategy_approved";
    nextBestAction = { title: "Run the Growth Engine before making changes", reason: "The Strategy is approved, but the current evidence has not yet been diagnosed and prioritized into a baseline-backed Next Best Action.", expectedResult: "A stored pre-change diagnosis, baseline, expected result, and one explainable priority for approval.", action: action("Run Growth Engine", `/growth?${projectQuery}`, "generate"), aiWill: ["Normalize the current evidence and measurement availability", "Record the pre-change diagnosis and baseline", "Rank valid opportunities by impact, confidence, effort, dependencies, and expected result", "Recommend one Next Best Action without creating or publishing website changes"], userWill: "Review the diagnosis and approve, edit, defer, or reject the recommended action.", confidence: overallConfidence, explainability: "Growth Engine runs here to decide what should happen and why before execution. After deployment it reuses this baseline and action record, waits for meaningful evidence, then learns and reprioritizes." };
  } else if (snapshot.growthBlueprintStatus !== "approved") {
    state = "execution_planning";
    nextBestAction = { title: "Review and approve the Growth Blueprint", reason: "The Strategy has produced a Blueprint, but channel plans must use an explicitly approved Blueprint version.", expectedResult: "An approved Growth Blueprint controlling required channel plans.", action: action("Approve Growth Blueprint", `/growth?${projectQuery}`, "approve"), aiWill: ["Show priorities, dependencies, channels, evidence, and limitations"], userWill: "Approve the exact Blueprint version or request changes.", confidence: overallConfidence, explainability: "Channel plans remain locked until the Blueprint is approved." };
  } else if (snapshot.websitePlanRequired && !snapshot.websitePlanGenerated) {
    state = "execution_planning";
    nextBestAction = snapshot.websitePlanGenerationStatus
      ? { title: "SEO Page Map & Content Plan is in progress", reason: `The worker is ${snapshot.websitePlanGenerationStatus === "queued" ? "waiting to start" : "building the plan"}${snapshot.websitePlanGenerationProgress == null ? "." : ` at ${snapshot.websitePlanGenerationProgress}%.`}`, expectedResult: "One draft containing existing-page updates, proposed pages, keyword ownership, content and technical requirements, schema, trust, links, local coverage, and source evidence.", action: action("Open SEO Plan progress", `/seo-page-map?${projectQuery}`, "review"), aiWill: ["Continue the active generation job", "Save the completed draft for review", "Prevent duplicate generation while this job is active"], userWill: "Wait for generation to finish, or leave this page and return later.", confidence: overallConfidence, explainability: "An active worker job already owns this step, so the workflow shows progress instead of offering another Create action." }
      : { title: "Create the SEO Page Map & Content Plan", reason: "Required evidence and the pre-change Growth diagnosis are ready to become one governed website plan.", expectedResult: "One draft containing existing-page updates, proposed pages, keyword ownership, content and technical requirements, schema, trust, links, local coverage, and source evidence.", action: action("Create SEO Plan", `/seo-page-map?${projectQuery}&autoPrepare=1`, "generate"), aiWill: ["Collect critical website findings from every applicable evidence module", "Keep the source module and affected URL attached to each proposed requirement", "Create draft decisions only; nothing is approved or published"], userWill: "Review the generated plan before approving any implementation.", confidence: overallConfidence, explainability: "The SEO Plan is created only after evidence and Growth prioritization are ready, and remains a separate draft decision." };
  } else if (snapshot.websitePlanRequired && !snapshot.websitePlanApproved) {
    state = "execution_planning";
    const awaitingFinalApproval = ["submitted_for_approval", "needs_approval", "company_approval", "client_approval"].includes(snapshot.websitePlanTaskStatus ?? "");
    nextBestAction = { title: awaitingFinalApproval ? "Approve the SEO Plan" : "Review the SEO Plan", reason: awaitingFinalApproval ? "The draft decisions have been reviewed and are waiting for final approval." : "The unified plan is still a draft. Review, edit, defer, or reject individual decisions before approving the complete version.", expectedResult: "One explicitly approved SEO Page Map & Content Plan containing only accepted implementation decisions.", action: action(awaitingFinalApproval ? "Approve SEO Plan" : "Review SEO Plan", `/seo-page-map?${projectQuery}`, awaitingFinalApproval ? "approve" : "review"), aiWill: ["Explain each page and requirement using its stored evidence", "Preserve edits, deferrals, and rejected decisions", "Prevent unapproved items from entering Website Development"], userWill: "Approve individual decisions and then approve the complete plan version.", confidence: overallConfidence, explainability: "Generation, review, and approval are separate workflow states. Website Development cannot import a draft plan." };
  } else if (snapshot.websitePlanApproved && !snapshot.websiteDevelopmentStarted) {
    state = "execution_planning";
    nextBestAction = { title: "Start Website Development", reason: "The SEO Plan is approved and can now be imported without asking you to add the same findings again.", expectedResult: "Approved page and site decisions imported as editable implementation work; rejected and deferred items remain excluded.", action: action("Start Website Development", `/site-architect?${projectQuery}`, "implement"), aiWill: ["Import only the approved plan version", "Create page and site implementation tasks with their evidence and dependencies", "Keep the live website unchanged"], userWill: "Review the imported Website Development work and choose what to prepare first.", confidence: overallConfidence, explainability: "The Website Development importer validates that an approved plan exists before it creates or updates any page drafts." };
  } else if (!snapshot.executionTasksExist || executionPlanStale) {
    state = snapshot.executionPlanExists ? "execution_planning" : "strategy_approved";
    nextBestAction = { title: executionPlanStale ? "Refresh the Execution Plan" : "Create the Execution Plan", reason: executionPlanStale ? "The plan predates the approved Strategy." : "The Strategy is approved and can now be converted into governed work.", expectedResult: "A sequenced plan with dependencies, approvals, destinations, and expected outcomes.", action: action(executionPlanStale ? "Refresh Execution Plan" : "Create Execution Plan", `/guided-projects/${snapshot.projectId}?tab=execution#execution-tasks`, "generate"), aiWill: [aiRoles.planning.suggestion, aiRoles.planning.implementation], userWill: aiRoles.planning.humanRole, confidence: overallConfidence, explainability: "Execution must use the exact approved Strategy version; AI can now safely translate decisions into tasks." };
  } else if (!snapshot.executionPlanApproved) {
    state = "execution_planning";
    nextBestAction = { title: "Review and approve the Execution Plan", reason: "The plan exists, but execution must use an explicitly approved plan and source snapshot.", expectedResult: "An approved, version-locked Execution Plan ready for governed work.", action: action("Approve Execution Plan", `/guided-projects/${snapshot.projectId}?tab=execution#execution-tasks`, "approve"), aiWill: ["Show tasks, dependencies, destinations, approvals, and expected outcomes"], userWill: "Approve the plan or change its priorities.", confidence: overallConfidence, explainability: "Creating tasks is not the same as approving them for execution." };
  } else if (snapshot.preparedChangesAwaitingApproval) {
    state = "execution";
    nextBestAction = { title: "Review the prepared website changes", reason: "AI-prepared website changes are ready for human review. They cannot be published until they are explicitly approved.", expectedResult: "Approved website changes ready for connected publishing or a controlled implementation handoff.", action: action("Review prepared changes", `/site-architect?${projectQuery}`, "approve"), aiWill: ["Show the proposed page, content, metadata, schema, links, and technical changes", "Run quality checks and preserve the approved-plan evidence", "Make no live website changes during review"], userWill: "Approve, request changes, defer, or reject the prepared work.", confidence: overallConfidence, explainability: "Preparation and publication remain separate protected actions." };
  } else if (snapshot.openExecutionTasks > 0 || (snapshot.publishingStarted && !snapshot.publishingComplete)) {
    state = "execution";
    nextBestAction = websitePlanPrerequisitePending
      ? {
        title: snapshot.preLaunchWebsite
          ? snapshot.websitePlanTaskStatus === "ready" ? "Create and approve the Website Plan" : "Review and approve the Website Plan"
          : snapshot.websitePlanTaskStatus === "ready" ? "Create and approve the SEO Page Map & Content Plan" : "Review and approve the SEO Page Map & Content Plan",
        reason: snapshot.preLaunchWebsite
          ? "Website generation depends on one approved, build-ready plan derived from the Website and Unified Strategy."
          : "Website and page-level execution depends on one approved page-to-intent plan before Website Development can import pages or prepare changes.",
        expectedResult: snapshot.preLaunchWebsite
          ? "One approved Website Plan covering sitemap, navigation, pages, content briefs, conversion paths, Local SEO, AI Citation, authority, internal links, schema, media, and publishing requirements."
          : "One approved page map connecting canonical pages, keywords, search intent, conversion roles, content requirements, internal links, Local SEO, and citation requirements.",
        action: action(snapshot.preLaunchWebsite ? snapshot.websitePlanTaskStatus === "ready" ? "Create Website Plan" : "Review Website Plan" : snapshot.websitePlanTaskStatus === "ready" ? "Create SEO Plan" : "Review SEO Plan", `/seo-page-map?${projectQuery}`, snapshot.websitePlanTaskStatus === "ready" ? "generate" : "approve"),
        aiWill: [snapshot.preLaunchWebsite ? "Translate the approved Website and Unified Strategy into a build-ready implementation plan" : "Combine Keyword Intelligence, Site Analysis, Gap Analysis, the approved Strategy, and funnel decisions", "Prepare page ownership, URLs, briefs, CTAs, links, Local SEO, AI Citation, authority, schema, media, and publishing requirements for review"],
        userWill: "Review and approve the exact Website Plan before implementation begins.",
        confidence: snapshot.activeNextBestAction?.confidence ?? overallConfidence,
        explainability: "This prerequisite is shown first because the selected Website action cannot execute safely until every canonical page has one approved intent and conversion role. The original Strategy action remains queued and becomes actionable immediately after approval.",
      }
      : snapshot.activeNextBestAction
      ? { title: snapshot.activeNextBestAction.title, reason: snapshot.activeNextBestAction.reason, expectedResult: snapshot.activeNextBestAction.expectedImpact, action: action("Continue Next Best Action", snapshot.activeNextBestAction.destinationUrl ?? `/guided-projects/${snapshot.projectId}?tab=execution#execution-tasks`, "implement"), aiWill: ["Preserve the approved decision evidence and success measure", aiRoles.execution.implementation], userWill: aiRoles.execution.humanRole, confidence: snapshot.activeNextBestAction.confidence, explainability: `The Strategy Decision Engine selected this action across all valid modules. ${snapshot.openExecutionTasks} approved or dependency-ready task(s) remain in the background.` }
      : { title: "Continue the highest-priority valid task", reason: snapshot.openExecutionTasks > 0 ? `${snapshot.openExecutionTasks} approved or dependency-ready task(s) remain.` : "Execution outputs are ready for implementation or publishing.", expectedResult: "An implemented, approved, or publishing-ready project improvement.", action: action("Continue execution", `/guided-projects/${snapshot.projectId}?tab=execution#execution-tasks`, "implement"), aiWill: [aiRoles.execution.suggestion, aiRoles.execution.implementation], userWill: aiRoles.execution.humanRole, confidence: overallConfidence, explainability: "The controller prioritizes dependency-ready work from the approved plan and does not route around approvals or provider requirements." };
  } else if (snapshot.postImplementationVerificationRequired) {
    state = "execution";
    nextBestAction = { title: "Verify the website changes", reason: "Implementation is recorded, but no newer live crawl or trusted evidence check confirms the result yet.", expectedResult: "A saved post-change verification confirming the affected URLs and implemented elements before performance measurement begins.", action: action("Verify website changes", `/site-analysis?${projectQuery}`, "generate"), aiWill: ["Check the affected live URLs and implementation evidence", "Confirm content, metadata, canonical, indexability, schema, links, and tracking where applicable", "Record exactly what changed and when without drawing an immediate performance conclusion"], userWill: "Run the verification and resolve any failed checks.", confidence: overallConfidence, explainability: "Immediate technical verification confirms execution. Growth performance is evaluated later only when meaningful new evidence is available." };
  } else if (!snapshot.measurementStarted) {
    state = "measurement";
    nextBestAction = { title: "Review results and choose the next improvement", reason: "The implementation is verified. Measurement can now compare future evidence with the stored pre-change baseline.", expectedResult: "Cost-governed checkpoints that wait for sufficient data, then update learning and the Next Best Action.", action: action("Review measurement", `/growth?${projectQuery}`, "review"), aiWill: [aiRoles.measurement.suggestion, aiRoles.measurement.implementation], userWill: aiRoles.measurement.humanRole, confidence: overallConfidence, explainability: "The system does not force an immediate performance conclusion or a fixed 24-hour rerun. Continuous Growth Intelligence uses the applicable schedule, cooldown, data availability, and meaningful-change triggers." };
  } else if (!trackingReady) {
    state = "measurement";
    nextBestAction = { title: "Verify tracking or record its limitation", reason: "The Continuous Growth Loop cannot activate until tracking works and data arrives, or an authorized limitation is recorded.", expectedResult: "Verified tracking evidence or a saved limitation with its reason.", action: action("Record tracking limitation", `/guided-projects/${snapshot.projectId}`, "approve"), aiWill: ["Check connection, last verification, and last successful event", "Never replace unavailable data with a false zero"], userWill: "Fix tracking or record why it cannot apply.", confidence: overallConfidence, explainability: "A configured identifier alone is not proof that measurement works." };
  } else if (!snapshot.measurementComplete) {
    state = "measurement";
    nextBestAction = { title: "Complete the measurement checkpoint", reason: "Tracking is ready, but no completed checkpoint yet proves that the executed action has been measured.", expectedResult: "A completed measurement checkpoint with sufficient current data.", action: action("Review Measurement", `/growth?${projectQuery}`, "review"), aiWill: ["Wait for sufficient data", "Compare the governed baseline and outcome without inventing a result"], userWill: "Review and complete the measurement checkpoint when enough data exists.", confidence: overallConfidence, explainability: "A configured connection is not the same as a completed measurement." };
  } else if (!reportingLearningComplete) {
    state = "measurement";
    nextBestAction = { title: "Generate the report and record learning", reason: "Measurement is complete, but the result has not yet been converted into a report and reusable learning.", expectedResult: "A saved report and learning connected to the measured action.", action: action("Review Reports and Learning", `/growth?${projectQuery}`, "review"), aiWill: ["Summarize measured evidence", "Save an auditable learning for future prioritization"], userWill: "Review the report and confirm the learning.", confidence: overallConfidence, explainability: "Reporting and learning are required before the Continuous Growth Loop activates." };
  } else if (!snapshot.nextBestActionExists) {
    state = "measurement";
    nextBestAction = { title: "Create the current Next Best Action", reason: "Governed learning exists, but the next improvement has not yet been selected.", expectedResult: "One ranked, explainable Next Best Action based on current learning.", action: action("Create Next Best Action", `/growth?${projectQuery}`, "generate"), aiWill: ["Rank valid improvements from current evidence and learning"], userWill: "Review the recommended next action.", confidence: overallConfidence, explainability: "The loop cannot activate without an actual current action to show." };
  } else {
    state = continuousGrowthReady ? "continuous_growth" : "measurement";
    nextBestAction = continuousGrowthReady ? { title: "Review the Next Best Action", reason: "Continuous Growth Loop requirements are complete.", expectedResult: "A ranked experiment or improvement based on measured evidence.", action: action("Open Next Best Action", `/growth?${projectQuery}`, "review"), aiWill: [aiRoles.growth.suggestion, aiRoles.growth.implementation], userWill: aiRoles.growth.humanRole, confidence: overallConfidence, explainability: "The loop activates only after every governed prerequisite is satisfied." } : { title: "Complete the remaining Growth Loop requirements", reason: "An execution or approval requirement is still incomplete.", expectedResult: "All activation requirements completed without bypassing approvals.", action: action("Review project workflow", `/guided-projects/${snapshot.projectId}`, "review"), aiWill: ["Show the exact incomplete requirement"], userWill: "Complete the highlighted approval or action.", confidence: overallConfidence, explainability: "Measurement alone never activates the loop." };
  }

  const blockers = intelligence.filter((item) => item.required && ["blocked", "failed", "not_started", "needs_attention"].includes(item.status)).map((item) => ({ key: item.key, title: item.label, reason: item.reason, action: item.action }));
  if (executionPlanStale) blockers.push({ key: "execution_plan_stale", title: "Execution Plan needs refresh", reason: "The approved Strategy is newer than the current plan.", action: action("Refresh Execution Plan", `/guided-projects/${snapshot.projectId}?tab=execution#execution-tasks`, "generate") });
  if (strategyApproved && !snapshot.preExecutionGrowthComplete) blockers.push({ key: "pre_execution_growth_required", title: "Pre-change Growth diagnosis required", reason: "Diagnose and prioritize the approved Strategy before creating implementation work.", action: action("Run Growth Engine", `/growth?${projectQuery}`, "generate") });
  if (websitePlanPrerequisitePending) blockers.push({ key: "website_plan_required", title: snapshot.preLaunchWebsite ? "Website Plan approval required" : "SEO Page Map approval required", reason: snapshot.preLaunchWebsite ? "Website creation depends on an approved build-ready plan derived from the Website and Unified Strategy." : "Website and page-level execution depends on an approved page-to-intent and conversion plan.", action: action(snapshot.preLaunchWebsite ? snapshot.websitePlanTaskStatus === "ready" ? "Create Website Plan" : "Review Website Plan" : snapshot.websitePlanTaskStatus === "ready" ? "Create SEO Plan" : "Review SEO Plan", `/seo-page-map?${projectQuery}`, snapshot.websitePlanTaskStatus === "ready" ? "generate" : "approve") });

  const completedStageWeight = stages.reduce((sum, stage) => sum + (["complete", "approved", "not_required", "not_applicable"].includes(stage.status) ? 1 : stage.status === "in_progress" ? 0.5 : 0), 0);
  const overallProgressPercent = Math.round(completedStageWeight / stages.length * 100);
  const strategyCreatedAt = snapshot.latestStrategy?.createdAt ?? null;
  const changedEvidence = strategyCreatedAt ? intelligence
    .filter((item) => item.evidenceAt && new Date(item.evidenceAt).getTime() > strategyCreatedAt.getTime())
    .map((item) => ({ key: item.key, label: item.label, evidenceAt: new Date(item.evidenceAt!).toISOString(), reason: item.reason, action: item.action })) : [];
  if (strategyStale && snapshot.latestEvidenceAt && !changedEvidence.length) changedEvidence.push({ key: "business_profile", label: "Business Profile or project direction", evidenceAt: snapshot.latestEvidenceAt.toISOString(), reason: "Verified project information was updated after this Strategy version was created.", action: action("Review Business Profile", `/guided-projects/${snapshot.projectId}/intake`, "review") });
  return { version: WORKFLOW_CONTROLLER_VERSION, projectId: snapshot.projectId, state, stateLabel: stateLabels[state], readinessPercent, overallProgressPercent, intelligenceReady, strategyStale, executionPlanStale, businessBrainVersion: 0, evidenceVersion: 0, strategyVersion: snapshot.latestStrategyVersion, executionPlanVersion: snapshot.executionPlanVersion, executionPlanStrategyVersion: snapshot.executionPlanStrategyVersion, growthBlueprintVersion: snapshot.growthBlueprintVersion, strategyCreatedAt: strategyCreatedAt?.toISOString() ?? null, strategyApprovedAt: snapshot.latestStrategy?.approvedAt?.toISOString() ?? null, latestEvidenceAt: snapshot.latestEvidenceAt?.toISOString() ?? null, changedEvidence, confidence, blockers, nextBestAction, stages, intelligenceModules: intelligence, updatedAt: new Date().toISOString() };
}

export async function getProjectWorkflowController(projectId: string): Promise<ProjectWorkflowControllerView | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { id: true } },
      agencyClient: { select: { name: true } },
      businessProfile: true,
      intakeAnswers: { orderBy: { updatedAt: "desc" }, take: 100, select: { questionKey: true, questionText: true, answerValue: true, moduleContext: true, updatedAt: true } },
      keywordGroups: { orderBy: { updatedAt: "desc" }, select: { status: true, category: true, keywords: true, updatedAt: true } },
      keywordResearchRuns: { orderBy: { createdAt: "desc" }, select: { id: true, seedKeyword: true, status: true, keywordCount: true, competitorCount: true, locationName: true, languageCode: true, device: true, createdAt: true, completedAt: true } },
      opportunities: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, name: true, targetAudience: true, problemSolved: true, recommendedOffer: true, businessModel: true } },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, version: true, status: true, createdAt: true, approvedAt: true, businessBrainVersion: true, evidenceVersion: true, seoStrategy: true, contentStrategy: true, publishingStrategy: true } },
      executionPlans: { where: { status: "active" }, orderBy: { updatedAt: "desc" }, take: 1, select: { id: true, planVersion: true, strategyVersion: true, businessBrainVersion: true, evidenceVersion: true, updatedAt: true } },
      executionTasks: { where: { status: { notIn: ["cancelled", "canceled"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, actionButtonLabel: true, sourceType: true, dedupeKey: true, status: true, moduleName: true, approvalSnapshotJson: true, updatedAt: true, publishedAt: true, completedAt: true } },
      websiteBuilds: { orderBy: { updatedAt: "desc" }, take: 1, select: { id: true, status: true, deployments: { orderBy: { createdAt: "desc" }, take: 5, select: { status: true, mode: true, completedAt: true } } } },
      websitePublications: { orderBy: { createdAt: "desc" }, take: 10, select: { status: true, mode: true, target: true, publishedAt: true, completedAt: true } },
      website: { select: { id: true, rootUrl: true, trackingSite: { select: { enabled: true, installation: true, lastVerifiedAt: true, lastEventAt: true } }, crawlJobs: { orderBy: { createdAt: "desc" }, take: 10, select: { status: true, pagesCrawled: true, createdAt: true, completedAt: true } } } },
      gapAnalysisRuns: { orderBy: { createdAt: "desc" }, take: 3, select: { status: true, createdAt: true, completedAt: true } },
      competitiveIntelligenceRuns: { orderBy: { createdAt: "desc" }, take: 5, select: { status: true, createdAt: true, completedAt: true } },
      localSeoAuditJobs: { orderBy: { createdAt: "desc" }, take: 5, select: { status: true, createdAt: true, completedAt: true } },
      citationReadinessFindings: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      citationRecommendations: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      businessEntities: { where: { verificationStatus: "needs_review" }, select: { id: true } },
      entityClaims: { where: { verificationStatus: "needs_review" }, select: { id: true } },
      discoveryChecks: { where: { status: "verified" }, orderBy: { checkedAt: "desc" }, take: 1, select: { checkedAt: true } },
      authorityOpportunities: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      aiRuns: { where: { moduleName: { in: ["ecommerce_intelligence", "content_plan_generation_job"] } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, moduleName: true, status: true, outputJson: true, createdAt: true } },
      measurementCheckpoints: { orderBy: { updatedAt: "desc" }, take: 20, select: { status: true, updatedAt: true, completedAt: true } },
      growthReports: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
      growthLearnings: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
      growthDiagnoses: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      growthIntelligenceCycles: { where: { status: "completed" }, orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      growthBlueprint: { select: { status: true, currentVersion: true, businessBrainVersion: true, evidenceVersion: true, updatedAt: true } },
      workflowController: { select: { businessBrainVersion: true, evidenceVersion: true } },
      nextBestActions: { where: { status: { in: ["proposed", "recommended", "selected", "approved", "accepted", "in_progress"] } }, orderBy: [{ selectedAt: "desc" }, { priorityScore: "desc" }, { createdAt: "desc" }], take: 10, select: { id: true, title: true, recommendation: true, reasoningSummary: true, expectedImpact: true, confidence: true, route: true, evidenceJson: true, status: true } },
      workflowEvents: { where: { eventType: { in: ["module.not_applicable", "module.waived", "module.deferred", "module.resumed", "business_brain.approved", "readiness.completed", "findings.reviewed", "tracking.limitation_recorded", "execution_plan.approved"] } }, orderBy: { occurredAt: "desc" }, select: { eventType: true, sourceId: true, payloadJson: true } },
    },
  });
  if (!project) return null;

  const approvedKeywordList = approvedKeywordEntries(project.keywordGroups);
  const approvedKeywordSet = new Set(approvedKeywordList.map(normalizeKeywordPhrase));
  const governedKeywordRuns = project.keywordResearchRuns.filter((run) => approvedKeywordSet.has(normalizeKeywordPhrase(run.seedKeyword)));
  const latestKeywordRun = governedKeywordRuns[0] ?? null;
  const completedKeywordRun = governedKeywordRuns.find((run) => run.status === "completed") ?? null;
  const latestCrawl = project.website?.crawlJobs[0] ?? null;
  const completedCrawl = project.website?.crawlJobs.find((crawl) => crawl.status === "completed" && crawl.pagesCrawled > 0) ?? null;
  const latestGap = project.gapAnalysisRuns[0] ?? null;
  const completedGap = project.gapAnalysisRuns.find((run) => run.status === "completed") ?? null;
  const latestCompetitor = project.competitiveIntelligenceRuns[0] ?? null;
  const completedCompetitor = project.competitiveIntelligenceRuns.find((run) => run.status === "completed") ?? null;
  const latestLocal = project.localSeoAuditJobs[0] ?? null;
  const completedLocal = project.localSeoAuditJobs.find((run) => run.status === "completed") ?? null;
  const latestStrategy = project.strategyPlans[0] ?? null;
  const latestGrowthDiagnosis = project.growthDiagnoses[0] ?? null;
  const ecommerceRuns = project.aiRuns.filter((run) => run.moduleName === "ecommerce_intelligence");
  const latestEcommerce = ecommerceRuns[0] ?? null;
  const completedEcommerce = ecommerceRuns.find((run) => run.status === "completed") ?? null;
  const latestWebsitePlanJob = project.aiRuns.find((run) => run.moduleName === "content_plan_generation_job") ?? null;
  const websitePlanGenerationStatus = latestWebsitePlanJob && ["queued", "running"].includes(latestWebsitePlanJob.status) ? latestWebsitePlanJob.status : null;
  const websitePlanJobOutput = latestWebsitePlanJob?.outputJson && typeof latestWebsitePlanJob.outputJson === "object" && !Array.isArray(latestWebsitePlanJob.outputJson) ? latestWebsitePlanJob.outputJson as Record<string, unknown> : {};
  const websitePlanGenerationProgress = websitePlanGenerationStatus && typeof websitePlanJobOutput.progress === "number" ? Math.max(0, Math.min(100, Math.round(websitePlanJobOutput.progress))) : null;
  const activePlan = project.executionPlans[0] ?? null;
  const executionPlanApproved = Boolean(activePlan && project.workflowEvents.some((event) => event.eventType === "execution_plan.approved" && event.sourceId === activePlan.id && String((event.payloadJson as Record<string, unknown>)?.planVersion ?? "") === activePlan.planVersion && Number((event.payloadJson as Record<string, unknown>)?.strategyVersion) === activePlan.strategyVersion));
  const terminalStatuses = new Set(["completed", "skipped", "published", "verified"]);
  const openTasks = project.executionTasks.filter((task) => !terminalStatuses.has(task.status));
  const completedTasks = project.executionTasks.filter((task) => terminalStatuses.has(task.status));
  const websitePlanTasks = project.executionTasks.filter(isWebsitePlanTask);
  const approvedWebsitePlanTask = websitePlanTasks.find((task) => {
    if (!["completed", "approved", "ready_to_publish"].includes(task.status)) return false;
    const snapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson)
      ? task.approvalSnapshotJson as Record<string, unknown>
      : {};
    return Boolean(snapshot.contentPlan && typeof snapshot.contentPlan === "object" && !Array.isArray(snapshot.contentPlan) && Object.keys(snapshot.contentPlan as Record<string, unknown>).length);
  }) ?? null;
  // A project can contain an older draft and a later approved SEO/Website Plan.
  // Always let the valid approved plan satisfy the prerequisite; otherwise use
  // the newest remaining task so the user is routed to the current draft.
  const websitePlanTask = approvedWebsitePlanTask ?? websitePlanTasks[0] ?? null;
  const websitePlanSnapshot = websitePlanTask?.approvalSnapshotJson && typeof websitePlanTask.approvalSnapshotJson === "object" && !Array.isArray(websitePlanTask.approvalSnapshotJson)
    ? websitePlanTask.approvalSnapshotJson as Record<string, unknown>
    : {};
  const websitePlanContent = websitePlanSnapshot.contentPlan && typeof websitePlanSnapshot.contentPlan === "object" && !Array.isArray(websitePlanSnapshot.contentPlan)
    ? websitePlanSnapshot.contentPlan as Record<string, unknown>
    : {};
  const websitePlanApproved = Boolean(approvedWebsitePlanTask && Object.keys(websitePlanContent).length);
  const websitePlanGenerated = Boolean(websitePlanTask && Object.keys(websitePlanContent).length);
  const publishingTasks = project.executionTasks.filter((task) => task.moduleName === "publishing" || task.publishedAt);
  const publishedTasks = project.executionTasks.filter((task) => Boolean(task.publishedAt) || ["published", "verified"].includes(task.status));
  const targetLocations = Array.isArray(project.targetLocations) ? project.targetLocations.map(String).filter(Boolean) : [];
  const goalText = [project.projectType, project.primaryGoal, project.niche, project.businessLocation, ...(Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [])].filter(Boolean).join(" ").toLowerCase();
  const websiteLaunched = Boolean(
    project.websiteBuilds[0]?.deployments.some((deployment) => ["completed", "success", "success_with_warnings"].includes(deployment.status) && deployment.mode !== "draft")
    || project.websitePublications.some((publication) => publication.status === "published" || (publication.status === "completed" && ["publish", "sftp", "live"].includes(publication.mode ?? ""))),
  );
  const websiteDevelopmentStarted = project.websiteBuilds.length > 0;
  const preparedChangesAwaitingApproval = Boolean(project.websiteBuilds[0] && ["review", "needs_review", "ready_for_review"].includes(project.websiteBuilds[0].status));
  const latestManualWebsiteImplementationAt = newest(...completedTasks
    .filter((task) => !isWebsitePlanTask(task) && (task.moduleName === "site_architect" || task.sourceType === "website_builder_request" || task.sourceType === "site_architecture_page"))
    .map((task) => task.publishedAt ?? task.completedAt));
  const latestTrustedVerificationAt = newest(
    ...project.websitePublications.filter((publication) => publication.status === "published").map((publication) => publication.completedAt ?? publication.publishedAt),
    project.discoveryChecks[0]?.checkedAt,
    completedCrawl?.completedAt,
  );
  const postImplementationVerificationRequired = Boolean(latestManualWebsiteImplementationAt
    && (!latestTrustedVerificationAt || latestTrustedVerificationAt.getTime() < latestManualWebsiteImplementationAt.getTime()));
  const activeNextBestAction = project.nextBestActions.find((candidate) => !isCompletedWebsiteLaunchFoundationAction(candidate, { websiteLaunched, websitePlanApproved })) ?? null;
  const selectedActionRequiresWebsitePlan = Boolean(activeNextBestAction
    && (activeNextBestAction.route === "website"
      || activeNextBestAction.evidenceJson && typeof activeNextBestAction.evidenceJson === "object" && !Array.isArray(activeNextBestAction.evidenceJson) && /\/site-architect(?:\?|$)/i.test(String((activeNextBestAction.evidenceJson as Record<string, unknown>).destinationUrl ?? ""))));
  const approvedStrategyRequiresWebsitePlan = Boolean(latestStrategy
    && (latestStrategy.status === "approved" || latestStrategy.approvedAt)
    && [latestStrategy.seoStrategy, latestStrategy.contentStrategy, latestStrategy.publishingStrategy].some((value) => typeof value === "string" && value.trim().length > 0));
  const applicability = resolveProjectApplicability({ projectType: project.projectType, websiteStatus: project.websiteStatus, hasWebsite: Boolean(project.websiteId || project.websiteUrl || project.website?.rootUrl), websiteLaunched, targetMarketCount: targetLocations.length, contextText: goalText });
  const localSeoApplicable = applicability.localSeo;
  const existingWebsite = applicability.existingWebsite;
  const preLaunchWebsite = applicability.preLaunchWebsite;
  const ecommerceApplicable = project.projectType === "ecommerce" && existingWebsite;
  const businessLocationJson = project.businessLocationJson && typeof project.businessLocationJson === "object" && !Array.isArray(project.businessLocationJson)
    ? project.businessLocationJson as Partial<BusinessLocation>
    : null;
  const keywordAnalysisLocations = projectAnalysisLocationLabels(project.targetLocations, businessLocationJson);
  const incompleteKeywordResearchChecks = incompleteApprovedKeywordResearchChecks(project.keywordGroups, governedKeywordRuns, keywordAnalysisLocations);
  const missingKeywordResearch = missingApprovedKeywordResearch(project.keywordGroups, governedKeywordRuns, keywordAnalysisLocations);
  const failedKeywordResearchChecks = unresolvedApprovedKeywordResearchChecks(project.keywordGroups, governedKeywordRuns);
  const latestGovernedKeywordChecks = latestKeywordResearchChecks(governedKeywordRuns);
  const activeKeywordResearchChecks = [...latestGovernedKeywordChecks.values()].filter((run) => ["queued", "running", "in_progress"].includes(run.status));
  const failedKeywordResearch = [...new Set(failedKeywordResearchChecks.map((run) => run.seedKeyword ?? "").filter(Boolean))];
  const approvedKeywords = approvedKeywordList.length > 0 && missingKeywordResearch.length === 0;
  const keywordEvidenceAt = newest(
    ...project.keywordGroups.filter((group) => group.status === "approved").map((group) => group.updatedAt),
    completedKeywordRun?.completedAt ?? completedKeywordRun?.createdAt,
  );
  const siteEvidenceAt = completedCrawl?.completedAt ?? completedCrawl?.createdAt ?? null;
  const gapEvidenceAt = completedGap?.completedAt ?? completedGap?.createdAt ?? null;
  const localEvidenceAt = completedLocal?.completedAt ?? completedLocal?.createdAt ?? null;
  const gapAnalysisCurrent = Boolean(completedGap
    && (!keywordEvidenceAt || (gapEvidenceAt?.getTime() ?? 0) >= keywordEvidenceAt.getTime())
    && (!siteEvidenceAt || (gapEvidenceAt?.getTime() ?? 0) >= siteEvidenceAt.getTime()));
  const localAnalysisCurrent = Boolean(completedLocal
    && (!keywordEvidenceAt || (localEvidenceAt?.getTime() ?? 0) >= keywordEvidenceAt.getTime()));
  const competitorEvidenceAt = completedCompetitor?.completedAt ?? completedCompetitor?.createdAt ?? null;
  const citationEvidenceAt = newest(project.citationReadinessFindings[0]?.updatedAt, project.citationRecommendations[0]?.updatedAt);
  const authorityEvidenceAt = project.authorityOpportunities[0]?.updatedAt ?? null;
  const ecommerceEvidenceAt = completedEcommerce?.createdAt ?? null;
  const citationEvidenceCurrent = Boolean(citationEvidenceAt && (!keywordEvidenceAt || citationEvidenceAt.getTime() >= keywordEvidenceAt.getTime()));
  const authorityEvidenceCurrent = Boolean(gapAnalysisCurrent || (authorityEvidenceAt && (!keywordEvidenceAt || authorityEvidenceAt.getTime() >= keywordEvidenceAt.getTime())));
  const competitorComplete = Boolean(
    gapAnalysisCurrent
    || (completedCompetitor && (!keywordEvidenceAt || (competitorEvidenceAt?.getTime() ?? 0) >= keywordEvidenceAt.getTime()))
    || (approvedKeywords && governedKeywordRuns.some((run) => run.status === "completed" && run.competitorCount > 0)),
  );
  const latestEvidenceAt = newest(
    project.businessProfile?.updatedAt,
    project.intakeAnswers[0]?.updatedAt,
    keywordEvidenceAt,
    siteEvidenceAt,
    gapEvidenceAt,
    completedCompetitor?.completedAt ?? completedCompetitor?.createdAt,
    completedLocal?.completedAt ?? completedLocal?.createdAt,
    project.citationReadinessFindings[0]?.updatedAt,
    project.authorityOpportunities[0]?.updatedAt,
    ecommerceEvidenceAt,
  );
  const projectConfigured = Boolean(project.name && project.projectType && project.primaryGoal);
  const situationConfigured = Boolean(project.websiteStatus && (project.websiteStatus !== "existing_website" || existingWebsite));
  const discoveryComplete = Boolean(project.businessProfile && project.intakeAnswers.length && (project.businessName || project.agencyClient?.name || project.name) && project.niche && project.primaryGoal);
  const currentBrainVersion = project.workflowController?.businessBrainVersion ?? 0;
  const currentEvidenceVersion = project.workflowController?.evidenceVersion ?? 0;
  const businessBrainApproved = project.workflowEvents.some((event) => event.eventType === "business_brain.approved" && Number(event.sourceId) === currentBrainVersion);
  const readinessComplete = businessBrainApproved && project.workflowEvents.some((event) => event.eventType === "readiness.completed" && Number(event.sourceId) === currentBrainVersion);
  const moduleDecisions: Record<string, "not_applicable" | "waived" | "deferred" | null> = {};
  for (const event of project.workflowEvents) {
    if (!event.sourceId || event.sourceId in moduleDecisions) continue;
    const payload = event.payloadJson && typeof event.payloadJson === "object" && !Array.isArray(event.payloadJson) ? event.payloadJson as Record<string, unknown> : {};
    if (Number(payload.businessBrainVersion) !== currentBrainVersion) continue;
    moduleDecisions[event.sourceId] = event.eventType === "module.not_applicable" ? "not_applicable" : event.eventType === "module.waived" ? "waived" : event.eventType === "module.deferred" ? "deferred" : null;
  }

  const evidenceSnapshot: WorkflowEvidenceSnapshot = {
    projectId: project.id,
    projectConfigured,
    workspaceConfigured: Boolean(project.clientId),
    situationConfigured,
    discoveryComplete,
    businessBrainApproved,
    readinessComplete,
    existingWebsite,
    preLaunchWebsite,
    localSeoApplicable,
    targetLocationsConfirmed: targetLocations.length > 0,
    approvedKeywords,
    approvedKeywordCount: approvedKeywordList.length,
    missingKeywordResearchCount: missingKeywordResearch.length,
    missingKeywordResearchCheckCount: incompleteKeywordResearchChecks.length,
    missingKeywordResearchKeywords: missingKeywordResearch,
    failedKeywordResearchKeywords: failedKeywordResearch,
    failedKeywordResearchCheckCount: failedKeywordResearchChecks.length,
    keywordResearchActiveCheckCount: activeKeywordResearchChecks.length,
    keywordResearchInProgress: activeKeywordResearchChecks.length > 0,
    keywordResearchFailed: failedKeywordResearchChecks.length > 0 && activeKeywordResearchChecks.length === 0,
    keywordEvidenceAt,
    siteAnalysisComplete: !existingWebsite || Boolean(completedCrawl),
    siteAnalysisInProgress: Boolean(latestCrawl && ["queued", "running"].includes(latestCrawl.status)),
    siteAnalysisFailed: latestCrawl?.status === "failed",
    siteEvidenceAt,
    ecommerceApplicable,
    ecommerceAnalysisComplete: !ecommerceApplicable || Boolean(completedEcommerce && (!siteEvidenceAt || completedEcommerce.createdAt.getTime() >= siteEvidenceAt.getTime())),
    ecommerceAnalysisInProgress: Boolean(latestEcommerce && ["queued", "running", "in_progress"].includes(latestEcommerce.status)),
    ecommerceAnalysisFailed: latestEcommerce?.status === "failed",
    ecommerceEvidenceAt,
    // A new website has no crawl-backed technical gaps yet, but it still needs
    // a completed pre-website market/content gap decision before Strategy.
    gapAnalysisComplete: gapAnalysisCurrent,
    gapAnalysisInProgress: Boolean(latestGap && ["queued", "running", "in_progress"].includes(latestGap.status)),
    gapAnalysisFailed: latestGap?.status === "failed",
    gapEvidenceAt,
    localAnalysisComplete: !localSeoApplicable || localAnalysisCurrent || gapAnalysisCurrent,
    localAnalysisInProgress: Boolean(latestLocal && ["queued", "running", "in_progress"].includes(latestLocal.status)),
    localAnalysisFailed: latestLocal?.status === "failed",
    localEvidenceAt,
    competitorAnalysisComplete: competitorComplete,
    competitorAnalysisInProgress: Boolean(latestCompetitor && ["queued", "running", "in_progress"].includes(latestCompetitor.status)),
    competitorAnalysisFailed: latestCompetitor?.status === "failed",
    competitorEvidenceAt: completedCompetitor?.completedAt ?? completedCompetitor?.createdAt ?? null,
    citationEvidenceComplete: citationEvidenceCurrent,
    citationEvidenceAt,
    authorityEvidenceComplete: authorityEvidenceCurrent,
    authorityEvidenceAt,
    selectedOpportunity: project.opportunities.some((item) => ["selected", "confirmed", "approved"].includes(item.status)),
    latestStrategy: latestStrategy ? { id: latestStrategy.id, status: latestStrategy.status, createdAt: latestStrategy.createdAt, approvedAt: latestStrategy.approvedAt } : null,
    latestEvidenceAt,
    criticalEvidenceIssueCount: project.businessEntities.length + project.entityClaims.length,
    findingsReviewed: project.workflowEvents.some((event) => event.eventType === "findings.reviewed" && Number((event.payloadJson as Record<string, unknown>)?.businessBrainVersion) === currentBrainVersion && Number((event.payloadJson as Record<string, unknown>)?.evidenceVersion) === currentEvidenceVersion),
    trackingVerified: Boolean(project.website?.trackingSite?.enabled && project.website.trackingSite.lastVerifiedAt && project.website.trackingSite.lastEventAt),
    trackingLimitationRecorded: project.workflowEvents.some((event) => event.eventType === "tracking.limitation_recorded" && Number((event.payloadJson as Record<string, unknown>)?.businessBrainVersion) === currentBrainVersion && String((event.payloadJson as Record<string, unknown>)?.websiteId ?? "") === String(project.websiteId ?? "")),
    preExecutionGrowthComplete: hasCurrentPreExecutionGrowth({
      strategyApprovedAt: latestStrategy?.approvedAt ?? null,
      diagnosisAt: latestGrowthDiagnosis?.createdAt ?? null,
      actionStatus: activeNextBestAction?.status ?? null,
    }),
    executionPlanExists: Boolean(activePlan),
    executionTasksExist: project.executionTasks.some((task) => !["core_intake", "opportunity", "strategy", "strategy_approval"].includes(task.moduleName)),
    executionPlanUpdatedAt: newest(activePlan?.updatedAt, ...project.executionTasks.map((task) => task.updatedAt)),
    openExecutionTasks: openTasks.length,
    completedExecutionTasks: completedTasks.length,
    websitePlanRequired: approvedStrategyRequiresWebsitePlan || selectedActionRequiresWebsitePlan,
    websitePlanGenerated,
    websitePlanGenerationStatus,
    websitePlanGenerationProgress,
    websitePlanApproved,
    websitePlanTaskStatus: websitePlanTask?.status ?? null,
    websiteDevelopmentStarted,
    preparedChangesAwaitingApproval,
    postImplementationVerificationRequired,
    publishingStarted: publishingTasks.length > 0 || project.websitePublications.length > 0,
    publishingComplete: publishedTasks.length > 0 || websiteLaunched,
    measurementStarted: project.measurementCheckpoints.length > 0,
    measurementComplete: project.measurementCheckpoints.some((checkpoint) => checkpoint.status === "completed"),
    reportingLearningComplete: project.growthReports.length > 0 && project.growthLearnings.length > 0,
    growthBlueprintStatus: project.growthBlueprint?.status ?? null,
    executionPlanApproved,
    nextBestActionExists: Boolean(activeNextBestAction),
    activeNextBestAction: activeNextBestAction ? {
      title: activeNextBestAction.title,
      reason: activeNextBestAction.reasoningSummary,
      expectedImpact: activeNextBestAction.expectedImpact,
      confidence: activeNextBestAction.confidence,
      route: activeNextBestAction.route,
      destinationUrl: activeNextBestAction.evidenceJson && typeof activeNextBestAction.evidenceJson === "object" && !Array.isArray(activeNextBestAction.evidenceJson) && typeof (activeNextBestAction.evidenceJson as Record<string, unknown>).destinationUrl === "string" ? String((activeNextBestAction.evidenceJson as Record<string, unknown>).destinationUrl) : null,
      status: activeNextBestAction.status,
    } : null,
    latestStrategyVersion: latestStrategy?.version ?? 0,
    executionPlanVersion: activePlan?.planVersion ?? null,
    executionPlanStrategyVersion: activePlan?.strategyVersion ?? null,
    growthBlueprintVersion: project.growthBlueprint?.currentVersion ?? 0,
    moduleDecisions,
  };
  let view = resolveProjectWorkflow(evidenceSnapshot);
  const businessBrainSnapshot = {
    project: {
      name: project.name,
      projectType: project.projectType,
      websiteStatus: project.websiteStatus,
      businessName: project.businessName || project.agencyClient?.name || project.name,
      websiteUrl: project.websiteUrl,
      niche: project.niche,
      businessLocation: project.businessLocation,
      targetLocations: project.targetLocations,
      primaryGoal: project.primaryGoal,
      secondaryGoals: project.secondaryGoals,
      competitors: project.competitors,
      brandVoice: project.brandVoice,
      preferredOutputs: project.preferredOutputs,
      preferredPublishingMethod: project.preferredPublishingMethod,
      analyticsPlatforms: project.analyticsPlatforms,
      cmsPlatform: project.cmsPlatform,
      targetLaunchTimeline: project.targetLaunchTimeline,
      website: project.website ? { id: project.website.id, rootUrl: project.website.rootUrl } : project.websiteUrl ? { id: project.websiteId, rootUrl: project.websiteUrl } : null,
    },
    businessProfile: project.businessProfile ? {
      businessSummary: project.businessProfile.businessSummary,
      targetAudience: project.businessProfile.targetAudience,
      offerSummary: project.businessProfile.offerSummary,
      businessModel: project.businessProfile.businessModel,
      strengths: project.businessProfile.strengths,
      constraints: project.businessProfile.constraints,
      tonePreference: project.businessProfile.tonePreference,
      intelligence: project.businessProfile.intelligenceJson,
    } : null,
    intakeAnswers: project.intakeAnswers.map((answer) => ({ key: answer.questionKey, question: answer.questionText, value: answer.answerValue, module: answer.moduleContext })),
    approvedStrategicDecision: project.opportunities.find((item) => ["selected", "confirmed", "approved"].includes(item.status)) ?? null,
    workspaceContext: { clientId: project.clientId, agencyClientName: project.agencyClient?.name ?? null },
  };
  const analyticsPlatforms = Array.isArray(project.analyticsPlatforms) ? project.analyticsPlatforms.map(String).filter(Boolean) : [];
  const latestMeasurementAt = project.measurementCheckpoints[0]?.updatedAt ?? null;
  const evidenceSources = [
    ...view.intelligenceModules.map((item) => ({ key: item.key, status: item.status, required: item.required, evidenceAt: item.evidenceAt, reason: item.reason })),
    { key: "analytics_and_behavior", status: analyticsPlatforms.length ? "deferred" : "not_required", required: false, evidenceAt: null, reason: analyticsPlatforms.length ? `Analytics platform intent is recorded (${analyticsPlatforms.join(", ")}), but measured behaviour is optional for the initial Strategy until connected.` : "No analytics source is connected; this is optional for the initial Strategy and becomes important during measurement." },
    { key: "crm_pipeline_revenue", status: "not_required", required: false, evidenceAt: null, reason: "CRM, pipeline, and revenue evidence is optional for the initial Strategy unless a permitted integration is connected." },
    { key: "experiment_and_historical_performance", status: latestMeasurementAt ? "complete" : "deferred", required: false, evidenceAt: latestMeasurementAt?.toISOString() ?? null, reason: latestMeasurementAt ? "Recorded measurement or experiment evidence is available to Growth Intelligence." : "Historical outcomes are not yet available; confidence uses a neutral historical component until execution is measured." },
  ];
  const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const brainFingerprint = stableHash(businessBrainSnapshot);
  const evidenceFingerprint = stableHash(evidenceSources);
  const now = new Date();

  const persisted = await prisma.$transaction(async (tx) => {
    // Workflow reads can arrive concurrently from the page controller, AI agent,
    // and background intelligence jobs. Serialize reconciliation per project so
    // max(version) + 1 remains safe while unrelated projects continue in parallel.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-workflow:${projectId}`}, 0::bigint))::text AS lock_result`;
    let brain = await tx.businessBrainVersion.findFirst({ where: { projectId, fingerprint: brainFingerprint }, select: { version: true } });
    if (!brain) {
      const aggregate = await tx.businessBrainVersion.aggregate({ where: { projectId }, _max: { version: true } });
      brain = await tx.businessBrainVersion.create({ data: {
        projectId,
        version: (aggregate._max.version ?? 0) + 1,
        fingerprint: brainFingerprint,
        snapshotJson: businessBrainSnapshot as Prisma.InputJsonValue,
        confidence: view.confidence.dataQuality,
        confidenceJson: view.confidence as unknown as Prisma.InputJsonValue,
        explainabilityJson: { reason: "Version changes only when verified Business Brain inputs change.", sources: ["project", "business_profile"] },
      }, select: { version: true } });
    }
    let evidence = await tx.projectEvidenceVersion.findFirst({ where: { projectId, fingerprint: evidenceFingerprint }, select: { version: true } });
    if (!evidence) {
      const aggregate = await tx.projectEvidenceVersion.aggregate({ where: { projectId }, _max: { version: true } });
      evidence = await tx.projectEvidenceVersion.create({ data: {
        projectId,
        version: (aggregate._max.version ?? 0) + 1,
        fingerprint: evidenceFingerprint,
        sourceSnapshotJson: evidenceSources as unknown as Prisma.InputJsonValue,
        confidence: view.confidence.overall,
        completeness: view.confidence.completeness,
        freshness: view.confidence.freshness,
        independentSignals: view.confidence.independentSignals,
        conflictCount: view.confidence.conflictPenalty > 0 ? 1 : 0,
        confidenceJson: view.confidence as unknown as Prisma.InputJsonValue,
      }, select: { version: true } });
    }
    const versionedModuleDecisions: WorkflowEvidenceSnapshot["moduleDecisions"] = {};
    for (const event of project.workflowEvents) {
      if (!event.sourceId || event.sourceId in versionedModuleDecisions) continue;
      const payload = event.payloadJson && typeof event.payloadJson === "object" && !Array.isArray(event.payloadJson) ? event.payloadJson as Record<string, unknown> : {};
      if (Number(payload.businessBrainVersion) !== brain.version) continue;
      versionedModuleDecisions[event.sourceId] = event.eventType === "module.not_applicable" ? "not_applicable" : event.eventType === "module.waived" ? "waived" : event.eventType === "module.deferred" ? "deferred" : null;
    }
    const versionedBrainApproved = project.workflowEvents.some((event) => event.eventType === "business_brain.approved" && Number(event.sourceId) === brain.version);
    view = resolveProjectWorkflow({
      ...evidenceSnapshot,
      businessBrainApproved: versionedBrainApproved,
      readinessComplete: versionedBrainApproved && project.workflowEvents.some((event) => event.eventType === "readiness.completed" && Number(event.sourceId) === brain.version),
      findingsReviewed: project.workflowEvents.some((event) => event.eventType === "findings.reviewed" && Number((event.payloadJson as Record<string, unknown>)?.businessBrainVersion) === brain.version && Number((event.payloadJson as Record<string, unknown>)?.evidenceVersion) === evidence.version),
      trackingLimitationRecorded: project.workflowEvents.some((event) => event.eventType === "tracking.limitation_recorded" && Number((event.payloadJson as Record<string, unknown>)?.businessBrainVersion) === brain.version && String((event.payloadJson as Record<string, unknown>)?.websiteId ?? "") === String(project.websiteId ?? "")),
      moduleDecisions: versionedModuleDecisions,
    });
    const nextView = { ...view, businessBrainVersion: brain.version, evidenceVersion: evidence.version };
    const eventKey = `workflow-reconciled:${projectId}:${brain.version}:${evidence.version}:${view.state}:${view.strategyVersion}:${view.executionPlanVersion ?? "none"}`;
    const workflowEvent = await tx.projectWorkflowEvent.upsert({
      where: { idempotencyKey: eventKey },
      update: { processedAt: now },
      create: { projectId, eventType: "workflow.reconciled", sourceModule: "workflow_controller", idempotencyKey: eventKey, payloadJson: { state: view.state, businessBrainVersion: brain.version, evidenceVersion: evidence.version, readinessPercent: view.readinessPercent, confidence: view.confidence.overall }, occurredAt: now, processedAt: now },
      select: { occurredAt: true },
    });
    await tx.projectWorkflowEvent.updateMany({ where: { projectId, processedAt: null }, data: { processedAt: now } });
    await tx.projectWorkflowState.upsert({ where: { projectId }, update: {
      controllerVersion: WORKFLOW_CONTROLLER_VERSION,
      state: view.state,
      readinessPercent: view.readinessPercent,
      overallProgressPercent: view.overallProgressPercent,
      confidence: view.confidence.overall,
      businessBrainVersion: brain.version,
      evidenceVersion: evidence.version,
      strategyVersion: view.strategyVersion,
      executionPlanVersion: view.executionPlanVersion,
      growthBlueprintVersion: view.growthBlueprintVersion,
      intelligenceReady: view.intelligenceReady,
      strategyStale: view.strategyStale,
      executionPlanStale: view.executionPlanStale,
      applicabilityJson: Object.fromEntries(view.intelligenceModules.map((item) => [item.key, { required: item.required, weight: item.weight }])) as Prisma.InputJsonValue,
      moduleStatusJson: view.intelligenceModules as unknown as Prisma.InputJsonValue,
      confidenceJson: view.confidence as unknown as Prisma.InputJsonValue,
      explainabilityJson: { nextBestAction: view.nextBestAction.explainability, reasons: view.confidence.reasons, cautions: view.confidence.cautions },
      blockersJson: view.blockers as unknown as Prisma.InputJsonValue,
      nextBestActionJson: view.nextBestAction as unknown as Prisma.InputJsonValue,
      lastEventAt: workflowEvent.occurredAt,
      reconciledAt: now,
    }, create: {
      projectId,
      controllerVersion: WORKFLOW_CONTROLLER_VERSION,
      state: view.state,
      readinessPercent: view.readinessPercent,
      overallProgressPercent: view.overallProgressPercent,
      confidence: view.confidence.overall,
      businessBrainVersion: brain.version,
      evidenceVersion: evidence.version,
      strategyVersion: view.strategyVersion,
      executionPlanVersion: view.executionPlanVersion,
      growthBlueprintVersion: view.growthBlueprintVersion,
      intelligenceReady: view.intelligenceReady,
      strategyStale: view.strategyStale,
      executionPlanStale: view.executionPlanStale,
      applicabilityJson: Object.fromEntries(view.intelligenceModules.map((item) => [item.key, { required: item.required, weight: item.weight }])) as Prisma.InputJsonValue,
      moduleStatusJson: view.intelligenceModules as unknown as Prisma.InputJsonValue,
      confidenceJson: view.confidence as unknown as Prisma.InputJsonValue,
      explainabilityJson: { nextBestAction: view.nextBestAction.explainability, reasons: view.confidence.reasons, cautions: view.confidence.cautions },
      blockersJson: view.blockers as unknown as Prisma.InputJsonValue,
      nextBestActionJson: view.nextBestAction as unknown as Prisma.InputJsonValue,
      lastEventAt: workflowEvent.occurredAt,
      reconciledAt: now,
    } });
    if (latestStrategy && (latestStrategy.businessBrainVersion == null || latestStrategy.evidenceVersion == null)) {
      await tx.strategyPlan.update({ where: { id: latestStrategy.id }, data: { businessBrainVersion: brain.version, evidenceVersion: evidence.version, confidenceJson: view.confidence as unknown as Prisma.InputJsonValue, explainabilityJson: { generatedFrom: { businessBrainVersion: brain.version, evidenceVersion: evidence.version }, reason: view.nextBestAction.explainability } } });
    }
    if (activePlan && (activePlan.businessBrainVersion == null || activePlan.evidenceVersion == null || activePlan.strategyVersion == null)) {
      await tx.executionPlan.update({ where: { id: activePlan.id }, data: { strategyPlanId: latestStrategy?.id ?? null, strategyVersion: latestStrategy?.version ?? null, businessBrainVersion: brain.version, evidenceVersion: evidence.version, confidenceJson: view.confidence as unknown as Prisma.InputJsonValue, explainabilityJson: { generatedFrom: { strategyId: latestStrategy?.id ?? null, strategyVersion: latestStrategy?.version ?? null, businessBrainVersion: brain.version, evidenceVersion: evidence.version } } } });
    }
    if (project.growthBlueprint && (project.growthBlueprint.businessBrainVersion == null || project.growthBlueprint.evidenceVersion == null)) {
      await tx.growthBlueprint.update({ where: { projectId }, data: { businessBrainVersion: brain.version, evidenceVersion: evidence.version, confidenceJson: view.confidence as unknown as Prisma.InputJsonValue, explainabilityJson: { role: "Continuous optimization layer activated from execution and measurement evidence.", generatedFrom: { businessBrainVersion: brain.version, evidenceVersion: evidence.version } } } });
    }
    return nextView;
  }, { maxWait: 15_000, timeout: 15_000 });
  return persisted;
}

export async function publishProjectWorkflowEvent(input: { projectId: string; eventType: string; sourceModule: string; sourceId?: string | null; idempotencyKey: string; payload?: Record<string, unknown>; occurredAt?: Date }) {
  await prisma.projectWorkflowEvent.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: { projectId: input.projectId, eventType: input.eventType, sourceModule: input.sourceModule, sourceId: input.sourceId ?? null, idempotencyKey: input.idempotencyKey, payloadJson: (input.payload ?? {}) as Prisma.InputJsonValue, occurredAt: input.occurredAt ?? new Date() },
  });
  const invalidatesOfficialStrategy = input.eventType === "business_brain.updated" || input.eventType === "project_direction.selected" || input.eventType.startsWith("intelligence.");
  if (invalidatesOfficialStrategy) {
    const invalidatedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.strategyPlan.updateMany({
        where: { projectId: input.projectId, status: "approved" },
        data: { status: "stale", approvedAt: null },
      });
      await tx.growthBlueprint.updateMany({
        where: { projectId: input.projectId, status: { in: ["approved", "active"] } },
        data: { status: "needs_refresh", approvedAt: null, approvedByUserId: null, nextReviewAt: invalidatedAt },
      });
      const blueprints = await tx.growthBlueprint.findMany({ where: { projectId: input.projectId }, select: { id: true } });
      if (blueprints.length) await tx.growthBlueprintVersion.updateMany({
        where: { blueprintId: { in: blueprints.map((item) => item.id) }, status: "approved" },
        data: { status: "needs_refresh", approvedAt: null, approvedByUserId: null },
      });
      await tx.executionPlan.updateMany({
        where: { projectId: input.projectId, status: "active" },
        data: { status: "needs_refresh" },
      });
      await tx.executionTask.updateMany({
        where: {
          projectId: input.projectId,
          approvedAt: { not: null },
          status: { notIn: ["completed", "published", "publishing", "cancelled", "canceled", "skipped"] },
        },
        data: {
          status: "needs_refresh",
          approvedAt: null,
          clientApprovedAt: null,
          approverMembershipId: null,
          approvalDecision: null,
          blockedReason: "A required Business Brain, project direction, or intelligence source changed. Refresh this output and approve the new version before execution.",
        },
      });
      await tx.nextBestAction.updateMany({
        where: { projectId: input.projectId, status: { in: ["proposed", "selected", "recommended"] } },
        data: { status: "stale", decision: "source_version_changed", selectedAt: null, decidedAt: invalidatedAt },
      });
      await tx.projectWorkflowEvent.upsert({
        where: { idempotencyKey: `workflow.invalidated:${input.idempotencyKey}` },
        update: {},
        create: {
          projectId: input.projectId,
          eventType: "workflow.downstream_invalidated",
          sourceModule: "workflow_controller",
          sourceId: input.sourceId ?? null,
          idempotencyKey: `workflow.invalidated:${input.idempotencyKey}`,
          payloadJson: { triggerEvent: input.eventType, triggerSource: input.sourceModule, reason: "An approved source changed; affected downstream versions require refresh and approval." },
          occurredAt: invalidatedAt,
          processedAt: invalidatedAt,
        },
      });
    });
  }
  const refreshesGrowthBlueprint = input.eventType === "execution.outcome_ready" || input.eventType === "measurement.recorded" || input.eventType === "measurement.evaluated" || input.eventType === "experiment.completed" || input.eventType === "integration.connected" || input.eventType === "integration.disconnected";
  if (refreshesGrowthBlueprint) {
    await prisma.growthBlueprint.updateMany({ where: { projectId: input.projectId }, data: { status: "needs_refresh", nextReviewAt: new Date() } });
  }
  const workflow = await getProjectWorkflowController(input.projectId);
  if (workflow?.strategyStale) {
    const invalidationKey = `strategy.invalidated:${input.projectId}:${workflow.businessBrainVersion}:${workflow.evidenceVersion}:${workflow.strategyVersion}`;
    await prisma.projectWorkflowEvent.upsert({ where: { idempotencyKey: invalidationKey }, update: { processedAt: new Date() }, create: { projectId: input.projectId, eventType: "strategy.evidence_available", sourceModule: "workflow_controller", sourceId: input.sourceId ?? null, idempotencyKey: invalidationKey, payloadJson: { reason: "A required source changed. Refresh and approve Strategy before downstream execution continues.", businessBrainVersion: workflow.businessBrainVersion, evidenceVersion: workflow.evidenceVersion, strategyVersion: workflow.strategyVersion, requiredRefreshAction: `/strategy?projectId=${input.projectId}` }, occurredAt: new Date(), processedAt: new Date() } });
  }
  await prisma.projectWorkflowEvent.update({ where: { idempotencyKey: input.idempotencyKey }, data: { processedAt: new Date() } });
  // Monitoring is deliberately best-effort at publish time: Redis downtime must
  // never roll back the business event. The worker's recovery scheduler will
  // enqueue the durable cycle row when the queue becomes available again.
  if (!input.eventType.startsWith("growth_intelligence.")) {
    import("./continuous-growth-queue.js")
      .then(({ enqueueGrowthIntelligenceCycle }) => enqueueGrowthIntelligenceCycle({ projectId: input.projectId, triggerSource: `${input.sourceModule}:${input.eventType}`, sourceEventId: input.idempotencyKey, occurredAt: input.occurredAt }))
      .catch((error) => console.error("[growth-intelligence] could not enqueue event cycle", error));
  }
  return workflow;
}
