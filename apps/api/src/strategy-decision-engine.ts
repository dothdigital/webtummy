import type { UnifiedStrategyPlan } from "./strategy-ai.js";
import { isCompletedWebsiteLaunchFoundationAction } from "./completed-work.js";

export const STRATEGY_DECISION_ENGINE_VERSION = "dev-047-part2-v1";

export type DecisionEvidenceType = "measured" | "verified_project_data" | "inferred";
export type DecisionEffort = "low" | "medium" | "high";
export type DecisionPriority = "critical" | "high" | "medium" | "low";

export type WorkflowConfidenceInput = {
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

export type StrategyDecisionCandidate = {
  analysisKey: string;
  title: string;
  businessObjective: string;
  problemOrOpportunity: string;
  whyNow: string;
  evidence: string[];
  evidenceType: DecisionEvidenceType;
  expectedImpact: string;
  impact: number;
  goalAlignment: number;
  urgency: number;
  effort: DecisionEffort;
  actions: string[];
  dependencies: string[];
  requiredPermissions: string[];
  capacityRequirement: string;
  executionMethod: string;
  successMeasure: string;
  destination: string;
  destinationUrl: string;
  affectedPages: string[];
  recommendedExperiment?: string;
  validationRequirement: string;
  sourceModule: string;
};

export type StrategyDecisionRecord = StrategyDecisionCandidate & {
  key: string;
  why: string;
  applicable: true;
  selected: boolean;
  disposition: "selected" | "queued" | "deferred";
  priority: DecisionPriority;
  priorityScore: number;
  confidence: number;
  confidenceLabel: "High" | "Medium" | "Low";
  confidenceReason: string;
  confidenceComponents: {
    completeness: number;
    freshness: number;
    independentSignals: number;
    dataQuality: number;
    sampleQuality: number;
    providerValidationQuality: number;
    historicalOutcomeQuality: number;
    taskSensitivity: number;
    conflictPenalty: number;
  };
  evidenceReferences: Array<{
    module: string;
    summary: string;
    businessBrainVersion: number;
    evidenceVersion: number;
  }>;
  whatHappensAfterApproval: string;
  reasonNotSelected: string | null;
  engineVersion: string;
  timeHorizon: "now" | "next" | "later";
};

export type StrategyDecisionSet = {
  engineVersion: string;
  businessBrainVersion: number;
  evidenceVersion: number;
  generatedAt: string;
  formula: string;
  nextBestActionKey: string;
  nextBestAction: StrategyDecisionRecord;
  decisions: StrategyDecisionRecord[];
  audit: {
    projectId: string;
    workspaceId: string | null;
    decisionType: "unified_strategy_next_best_action";
    timestamp: string;
    businessBrainVersion: number;
    evidenceVersion: number;
    modelPipelineReference: string;
    candidateCount: number;
    candidateActionsConsidered: Array<{
      key: string;
      title: string;
      priorityScore: number;
      confidence: number;
      disposition: StrategyDecisionRecord["disposition"];
    }>;
    selectedRecommendation: string;
    scoreComponents: StrategyDecisionRecord["confidenceComponents"] & {
      impact: number;
      goalAlignment: number;
      urgency: number;
      effort: DecisionEffort;
      priorityScore: number;
    };
    evidenceWarnings: string[];
    invalidCandidates: Array<{ key: string; reason: string }>;
    rejectedOrDeferred: Array<{ key: string; reason: string }>;
    approval: { status: "pending" | "approved" | "rejected"; decidedAt: string | null; decidedBy: string | null };
    executionOutcome: null;
    measurementResult: null;
    lifecycleStatus: "active" | "stale" | "superseded";
  };
};

export type ExternalRecommendation = {
  analysisKey?: string;
  key?: string;
  title?: string;
  applicable?: boolean;
  priority?: string;
  impact?: number;
  confidence?: number;
  why?: string;
  evidence?: unknown;
  actions?: string[];
  expectedImpact?: string;
  evidenceType?: string;
  effort?: string;
  timeHorizon?: string;
  dependencies?: string[];
  affectedPages?: string[];
  destination?: string;
  recommendedExperiment?: string;
  validationRequirement?: string;
};

const destinationRoutes: Record<string, string> = {
  seo: "/seo-growth",
  gap_analysis: "/gap-analysis",
  content: "/ai-content",
  website: "/site-architect",
  lead_magnets: "/lead-magnets",
  ai_citations: "/ai-citations",
  local_seo: "/local-seo",
  authority: "/backlinks",
  publishing: "/publishing",
  execution_plan: "/guided-projects",
  measurement: "/growth",
  social: "/social-strategy",
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function normalizedDestination(value: string) {
  const key = value.trim().toLowerCase().replace(/[&/\s-]+/g, "_");
  if (key.includes("citation")) return "ai_citations";
  if (key.includes("local")) return "local_seo";
  if (key.includes("lead")) return "lead_magnets";
  if (key.includes("gap") || key.includes("technical")) return "gap_analysis";
  if (key.includes("author") || key.includes("backlink")) return "authority";
  if (key.includes("publish")) return "publishing";
  if (key.includes("measure") || key.includes("growth")) return "measurement";
  if (key.includes("social")) return "social";
  if (key.includes("website") || key.includes("site_architect")) return "website";
  if (key.includes("content")) return "content";
  if (key.includes("seo") || key.includes("keyword") || key.includes("search")) return "seo";
  return "execution_plan";
}

function destinationUrl(destination: string, projectId: string) {
  const base = destinationRoutes[destination] ?? "/guided-projects";
  if (base === "/guided-projects") return `${base}/${encodeURIComponent(projectId)}?tab=execution#execution-tasks`;
  return `${base}?projectId=${encodeURIComponent(projectId)}`;
}

function evidenceType(value: unknown): DecisionEvidenceType {
  return value === "measured" || value === "verified_project_data" ? value : "inferred";
}

function effort(value: unknown): DecisionEffort {
  return value === "low" || value === "high" ? value : "medium";
}

function urgencyFrom(value: unknown, priority: unknown) {
  if (value === "now") return 96;
  if (value === "next") return 78;
  if (value === "later") return 58;
  if (priority === "critical") return 96;
  if (priority === "high") return 84;
  if (priority === "low") return 55;
  return 70;
}

function priorityFrom(score: number): DecisionPriority {
  if (score >= 72) return "critical";
  if (score >= 52) return "high";
  if (score >= 34) return "medium";
  return "low";
}

function confidenceLabel(score: number): "High" | "Medium" | "Low" {
  return score >= 80 ? "High" : score >= 60 ? "Medium" : "Low";
}

export function calculateStrategyDecisionConfidence(candidate: StrategyDecisionCandidate, workflow: WorkflowConfidenceInput) {
  const independentEvidence = unique(candidate.evidence).length;
  const independentSignals = clamp(Math.min(100, independentEvidence * 18 + workflow.independentSignals * 8));
  const providerValidationQuality = candidate.evidenceType === "measured" ? 95 : candidate.evidenceType === "verified_project_data" ? 82 : 52;
  const sampleQuality = candidate.evidenceType === "measured" ? clamp(70 + Math.min(25, independentEvidence * 5)) : candidate.evidenceType === "verified_project_data" ? clamp(55 + Math.min(25, independentEvidence * 5)) : 40;
  const historicalOutcomeQuality = 50;
  const taskSensitivity = candidate.requiredPermissions.some((permission) => /public|protected|publish/i.test(permission)) ? 70 : 90;
  const conflictPenalty = clamp(workflow.conflictPenalty);
  const score = clamp(
    workflow.completeness * 0.16
    + workflow.freshness * 0.15
    + independentSignals * 0.14
    + workflow.dataQuality * 0.16
    + sampleQuality * 0.10
    + providerValidationQuality * 0.14
    + historicalOutcomeQuality * 0.05
    + taskSensitivity * 0.10
    - conflictPenalty,
  );
  const components = {
    completeness: clamp(workflow.completeness),
    freshness: clamp(workflow.freshness),
    independentSignals,
    dataQuality: clamp(workflow.dataQuality),
    sampleQuality,
    providerValidationQuality,
    historicalOutcomeQuality,
    taskSensitivity,
    conflictPenalty,
  };
  const missing = [
    candidate.evidenceType === "inferred" ? "The opportunity is inferred and must be validated during execution." : null,
    workflow.freshness < 70 ? "Some supporting evidence is aging or has no recent timestamp." : null,
    workflow.completeness < 80 ? "Optional project evidence is incomplete." : null,
    "No verified historical outcome benchmark is connected, so historical confidence remains neutral.",
    workflow.cautions[0] ?? null,
  ].filter((item): item is string => Boolean(item));
  return {
    score,
    components,
    reason: `${confidenceLabel(score)} confidence based on ${independentEvidence} supporting signal${independentEvidence === 1 ? "" : "s"}, ${workflow.completeness}% evidence completeness, ${workflow.freshness}% freshness, and ${workflow.dataQuality}% data quality.${missing.length ? ` Caution: ${missing[0]}` : ""}`,
  };
}

export function scoreStrategyDecisionCandidate(candidate: StrategyDecisionCandidate, confidence: number) {
  const effortFactor = candidate.effort === "low" ? 0.78 : candidate.effort === "high" ? 1.28 : 1;
  return clamp((candidate.impact * (confidence / 100) * (candidate.goalAlignment / 100) * (candidate.urgency / 100)) / effortFactor);
}

function candidateFromFunnel(step: NonNullable<UnifiedStrategyPlan["growthFunnel"]>["steps"][number], objective: string, projectId: string): StrategyDecisionCandidate {
  const destination = normalizedDestination(step.destination);
  const stage = step.funnelStage ?? safeKey(step.key);
  return {
    analysisKey: `funnel_${stage}`,
    title: step.title,
    businessObjective: objective,
    problemOrOpportunity: step.leakOrGap ?? step.whyNow,
    whyNow: step.whyNow,
    evidence: unique(step.sourceSignals),
    evidenceType: evidenceType(step.evidenceType),
    expectedImpact: step.expectedImpact,
    impact: clamp(step.impactScore ?? 70),
    goalAlignment: 94,
    urgency: urgencyFrom(step.executionHorizon, "high"),
    effort: step.effort,
    actions: unique([step.recommendedAction, ...step.details]),
    dependencies: unique(step.dependencies),
    requiredPermissions: ["Strategy approval", "Approval before public or protected changes"],
    capacityRequirement: step.planningTimeEstimate ?? `${step.effort} implementation effort`,
    executionMethod: `AI prepares the ${stage.replaceAll("_", " ")} assets in ${destination.replaceAll("_", " ")}; the user reviews protected changes before implementation.`,
    successMeasure: step.successMetric ?? step.expectedImpact,
    destination,
    destinationUrl: destinationUrl(destination, projectId),
    affectedPages: unique(step.affectedPages),
    recommendedExperiment: step.recommendedExperiment,
    validationRequirement: step.validationRequirement ?? "Validate the result against the saved Strategy evidence and success measure.",
    sourceModule: "customer_funnel",
  };
}

function candidateFromFocus(area: UnifiedStrategyPlan["focusAreas"][number], objective: string, projectId: string): StrategyDecisionCandidate {
  const destination = normalizedDestination(area.channels[0] ?? "execution_plan");
  return {
    analysisKey: `focus_${safeKey(area.key)}`,
    title: area.title,
    businessObjective: objective,
    problemOrOpportunity: area.objective,
    whyNow: area.whyNow,
    evidence: unique(area.evidence),
    evidenceType: "verified_project_data",
    expectedImpact: area.successMeasures.join("; "),
    impact: area.priority === "critical" ? 94 : area.priority === "high" ? 84 : area.priority === "low" ? 58 : 72,
    goalAlignment: 92,
    urgency: urgencyFrom(undefined, area.priority),
    effort: area.dependencies.length > 4 ? "high" : area.dependencies.length > 1 ? "medium" : "low",
    actions: unique(area.actions),
    dependencies: unique(area.dependencies),
    requiredPermissions: ["Strategy approval", "Destination-module permissions"],
    capacityRequirement: `${area.actions.length} planned action${area.actions.length === 1 ? "" : "s"} across ${area.channels.length} channel${area.channels.length === 1 ? "" : "s"}`,
    executionMethod: `AI prepares the approved actions in ${destination.replaceAll("_", " ")} and preserves their evidence and dependencies in the Execution Plan.`,
    successMeasure: area.successMeasures.join("; "),
    destination,
    destinationUrl: destinationUrl(destination, projectId),
    affectedPages: [],
    validationRequirement: "Confirm the stated success measure from a recorded baseline before marking the action complete.",
    sourceModule: "unified_strategy",
  };
}

function candidateFromExternal(item: ExternalRecommendation, objective: string, projectId: string): StrategyDecisionCandidate | null {
  if (item.applicable === false || !item.title || !item.why) return null;
  const key = item.analysisKey ?? item.key ?? safeKey(item.title);
  if (key === "unified_strategy_plan") return null;
  const destination = normalizedDestination(item.destination ?? key);
  return {
    analysisKey: key,
    title: item.title,
    businessObjective: objective,
    problemOrOpportunity: item.why,
    whyNow: item.why,
    evidence: unique(strings(item.evidence)),
    evidenceType: evidenceType(item.evidenceType),
    expectedImpact: item.expectedImpact ?? "Potential improvement against the approved business objective; confirm against a recorded baseline.",
    impact: clamp(item.impact ?? 70),
    goalAlignment: 86,
    urgency: urgencyFrom(item.timeHorizon, item.priority),
    effort: effort(item.effort),
    actions: unique(item.actions ?? [item.title]),
    dependencies: unique(item.dependencies ?? []),
    requiredPermissions: ["Strategy approval", "Destination-module permissions"],
    capacityRequirement: `${effort(item.effort)} implementation effort`,
    executionMethod: `AI prepares the approved work in ${destination.replaceAll("_", " ")} and routes it through the Execution Plan.`,
    successMeasure: item.expectedImpact ?? "Validate the expected improvement against the recorded baseline.",
    destination,
    destinationUrl: destinationUrl(destination, projectId),
    affectedPages: unique(item.affectedPages ?? []),
    recommendedExperiment: item.recommendedExperiment,
    validationRequirement: item.validationRequirement ?? "Review the prepared output and validate the result before completion.",
    sourceModule: key.startsWith("gap_") ? "gap_analysis" : "strategy_analysis",
  };
}

function candidateValidation(candidate: StrategyDecisionCandidate) {
  const failures = [
    !candidate.title.trim() ? "Action title is missing." : null,
    !candidate.businessObjective.trim() ? "Supported business objective is missing." : null,
    !candidate.problemOrOpportunity.trim() ? "Problem or opportunity is missing." : null,
    !candidate.evidence.length ? "No applicable evidence supports this action." : null,
    !candidate.actions.length ? "No executable action was supplied." : null,
    !candidate.expectedImpact.trim() ? "Expected impact is missing." : null,
    !candidate.successMeasure.trim() ? "Success measure is missing." : null,
    !candidate.destination.trim() ? "Execution destination is missing." : null,
  ].filter((item): item is string => Boolean(item));
  return failures;
}

export function generateStrategyDecisionCandidates(input: { projectId: string; plan: UnifiedStrategyPlan; externalRecommendations?: ExternalRecommendation[]; completionState?: { websiteLaunched: boolean; websitePlanApproved: boolean } }) {
  const primaryObjective = input.plan.objectives[0] ?? input.plan.positioning.offer;
  const candidates = [
    ...(input.plan.growthFunnel?.steps ?? []).map((step) => candidateFromFunnel(step, primaryObjective, input.projectId)),
    ...input.plan.focusAreas.map((area) => candidateFromFocus(area, primaryObjective, input.projectId)),
    ...(input.externalRecommendations ?? []).map((item) => candidateFromExternal(item, primaryObjective, input.projectId)).filter((item): item is StrategyDecisionCandidate => Boolean(item)),
  ];
  const deduped = [...new Map(candidates.map((candidate) => [`${candidate.analysisKey}:${candidate.title.toLowerCase()}`, candidate])).values()];
  const invalidCandidates = deduped.flatMap((candidate) => {
    if (input.completionState && isCompletedWebsiteLaunchFoundationAction(candidate, input.completionState)) {
      return [{ key: candidate.analysisKey, reason: "The approved Website Plan and canonical website foundation are already published." }];
    }
    const failures = candidateValidation(candidate);
    return failures.length ? [{ key: candidate.analysisKey, reason: failures.join(" ") }] : [];
  });
  return {
    validCandidates: deduped.filter((candidate) => candidateValidation(candidate).length === 0
      && !(input.completionState && isCompletedWebsiteLaunchFoundationAction(candidate, input.completionState))),
    invalidCandidates,
  };
}

export function composeStrategyDecisionExplainability(decision: StrategyDecisionRecord) {
  return {
    finding: decision.problemOrOpportunity,
    whyItMatters: decision.why,
    whyNow: decision.whyNow,
    evidence: decision.evidenceReferences,
    expectedResult: decision.expectedImpact,
    confidence: { score: decision.confidence, label: decision.confidenceLabel, reason: decision.confidenceReason, components: decision.confidenceComponents },
    effortAndPermissions: { effort: decision.effort, capacity: decision.capacityRequirement, permissions: decision.requiredPermissions },
    afterApproval: decision.whatHappensAfterApproval,
    successMeasure: decision.successMeasure,
  };
}

export function selectStrategyNextBestAction(decisions: StrategyDecisionRecord[]) {
  const selected = decisions.find((decision) => decision.selected) ?? decisions[0];
  if (!selected) throw new Error("Strategy Decision Engine received no valid candidate actions.");
  return selected;
}

export function buildStrategyDecisionSet(input: {
  projectId: string;
  workspaceId?: string | null;
  modelPipelineReference?: string;
  approval?: { status: "pending" | "approved" | "rejected"; decidedAt?: string | null; decidedBy?: string | null };
  plan: UnifiedStrategyPlan;
  businessBrainVersion: number;
  evidenceVersion: number;
  workflowConfidence: WorkflowConfidenceInput;
  externalRecommendations?: ExternalRecommendation[];
  completionState?: { websiteLaunched: boolean; websitePlanApproved: boolean };
}): StrategyDecisionSet {
  const { validCandidates, invalidCandidates } = generateStrategyDecisionCandidates(input);
  const ranked = validCandidates.map((candidate) => {
    const calculatedConfidence = calculateStrategyDecisionConfidence(candidate, input.workflowConfidence);
    const score = scoreStrategyDecisionCandidate(candidate, calculatedConfidence.score);
    return { candidate, confidence: calculatedConfidence, score };
  }).sort((left, right) => right.score - left.score || right.candidate.impact - left.candidate.impact);

  if (!ranked.length) throw new Error("Strategy Decision Engine received no valid candidate actions.");

  const decisions: StrategyDecisionRecord[] = ranked.map(({ candidate, confidence, score }, index) => {
    const selected = index === 0;
    const disposition = selected ? "selected" : index < Math.min(12, ranked.length) ? "queued" : "deferred";
    const reasonNotSelected = selected ? null : disposition === "queued"
      ? `Ranked behind the current Next Best Action because its business-value score is ${score}/100 versus ${ranked[0].score}/100. It remains eligible in the approved Execution Plan.`
      : "Deferred until higher-value or prerequisite work is completed and new evidence is measured.";
    return {
      ...candidate,
      key: candidate.analysisKey,
      why: candidate.problemOrOpportunity,
      applicable: true,
      selected,
      disposition,
      priority: priorityFrom(score),
      priorityScore: score,
      confidence: confidence.score,
      confidenceLabel: confidenceLabel(confidence.score),
      confidenceReason: confidence.reason,
      confidenceComponents: confidence.components,
      evidenceReferences: candidate.evidence.map((summary) => ({ module: candidate.sourceModule, summary, businessBrainVersion: input.businessBrainVersion, evidenceVersion: input.evidenceVersion })),
      whatHappensAfterApproval: `${candidate.actions.length} AI-assisted action${candidate.actions.length === 1 ? "" : "s"} will be synchronized to ${candidate.destination.replaceAll("_", " ")} through the governed Execution Plan. Protected external changes remain approval-gated.`,
      reasonNotSelected,
      engineVersion: STRATEGY_DECISION_ENGINE_VERSION,
      timeHorizon: candidate.urgency >= 90 ? "now" : candidate.urgency >= 70 ? "next" : "later",
    };
  });
  const nextBestAction = selectStrategyNextBestAction(decisions);
  const generatedAt = new Date().toISOString();
  return {
    engineVersion: STRATEGY_DECISION_ENGINE_VERSION,
    businessBrainVersion: input.businessBrainVersion,
    evidenceVersion: input.evidenceVersion,
    generatedAt,
    formula: "Priority = Impact × Confidence × Goal Alignment × Urgency ÷ Effort",
    nextBestActionKey: nextBestAction.key,
    nextBestAction,
    decisions,
    audit: {
      projectId: input.projectId,
      workspaceId: input.workspaceId ?? null,
      decisionType: "unified_strategy_next_best_action",
      timestamp: generatedAt,
      businessBrainVersion: input.businessBrainVersion,
      evidenceVersion: input.evidenceVersion,
      modelPipelineReference: input.modelPipelineReference ?? "deterministic-ranking-after-ai-candidate-generation",
      candidateCount: decisions.length,
      candidateActionsConsidered: decisions.map((decision) => ({ key: decision.key, title: decision.title, priorityScore: decision.priorityScore, confidence: decision.confidence, disposition: decision.disposition })),
      selectedRecommendation: nextBestAction.title,
      scoreComponents: {
        ...nextBestAction.confidenceComponents,
        impact: nextBestAction.impact,
        goalAlignment: nextBestAction.goalAlignment,
        urgency: nextBestAction.urgency,
        effort: nextBestAction.effort,
        priorityScore: nextBestAction.priorityScore,
      },
      evidenceWarnings: unique(input.workflowConfidence.cautions),
      invalidCandidates,
      rejectedOrDeferred: decisions.filter((decision) => !decision.selected).map((decision) => ({ key: decision.key, reason: decision.reasonNotSelected ?? "Not selected" })),
      approval: {
        status: input.approval?.status ?? "pending",
        decidedAt: input.approval?.decidedAt ?? null,
        decidedBy: input.approval?.decidedBy ?? null,
      },
      executionOutcome: null,
      measurementResult: null,
      lifecycleStatus: "active",
    },
  };
}
