export const GROWTH_INTELLIGENCE_CONTRACT_VERSION = "dev-047-part4-v1" as const;

export type EvidenceAvailability = "AVAILABLE" | "LIMITED" | "STALE" | "UNAVAILABLE" | "INSUFFICIENT";
export type EvaluationClassification = "IMPROVED" | "DECLINED" | "NO_MATERIAL_CHANGE" | "INCONCLUSIVE" | "COLLECTING";

export type MeasurementInput = {
  metricKey: string;
  direction?: "increase" | "decrease";
  baselineValue?: number | null;
  currentValue?: number | null;
  baselineSampleSize?: number | null;
  currentSampleSize?: number | null;
  minimumSampleSize?: number;
  minimumMaterialChangePercent?: number;
  sourceStatus?: EvidenceAvailability;
  sourceFreshnessDays?: number | null;
  evaluationWindowComplete?: boolean;
  limitations?: string[];
};

export type PerformanceEvaluation = {
  contractVersion: typeof GROWTH_INTELLIGENCE_CONTRACT_VERSION;
  metricKey: string;
  availability: EvidenceAvailability;
  classification: EvaluationClassification;
  baselineValue: number | null;
  currentValue: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  sampleSize: number | null;
  confidence: number;
  limitations: string[];
  summary: string;
  causalClaimAllowed: false;
};

export type OpportunityFactors = {
  impact: number;
  goalAlignment: number;
  confidence: number;
  reach: number;
  urgency: number;
  learningValue: number;
  ease: number;
  readiness: number;
  risk: number;
};

export type OpportunityGate = {
  eligible: boolean;
  blockers: string[];
  warnings: string[];
};

export type BlueprintPatch = {
  contractVersion: typeof GROWTH_INTELLIGENCE_CONTRACT_VERSION;
  patchType: "LEARNING" | "PRIORITY" | "MEASUREMENT" | "STRATEGY_REVIEW_REQUEST";
  path: string;
  operation: "add" | "replace" | "remove";
  previousValue: unknown;
  nextValue: unknown;
  reason: string;
  evidenceRefs: string[];
  materialStrategyChange: boolean;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function asRatio(value: number) {
  return clamp01(value > 1 ? value / 100 : value);
}

function rounded(value: number, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function evaluateMeasurement(input: MeasurementInput): PerformanceEvaluation {
  const minimumSampleSize = input.minimumSampleSize ?? 30;
  const materialThreshold = Math.max(0, input.minimumMaterialChangePercent ?? 5);
  const limitations = [...(input.limitations ?? [])];
  const baseline = typeof input.baselineValue === "number" && Number.isFinite(input.baselineValue) ? input.baselineValue : null;
  const current = typeof input.currentValue === "number" && Number.isFinite(input.currentValue) ? input.currentValue : null;
  const sampleSize = typeof input.currentSampleSize === "number" ? input.currentSampleSize : null;
  let availability = input.sourceStatus ?? "AVAILABLE";

  if (input.sourceFreshnessDays != null && input.sourceFreshnessDays > 45 && availability === "AVAILABLE") {
    availability = "STALE";
    limitations.push(`The source evidence is ${Math.round(input.sourceFreshnessDays)} days old.`);
  }
  if (baseline == null || current == null) {
    availability = availability === "UNAVAILABLE" ? "UNAVAILABLE" : "INSUFFICIENT";
    limitations.push("A valid baseline and current value are both required; missing evidence is not treated as zero.");
  }
  if (sampleSize != null && sampleSize < minimumSampleSize) {
    availability = "INSUFFICIENT";
    limitations.push(`Only ${sampleSize} observations are available; ${minimumSampleSize} are required for a directional conclusion.`);
  }
  if (input.evaluationWindowComplete === false) limitations.push("The evaluation window is still collecting evidence.");

  const absoluteChange = baseline == null || current == null ? null : rounded(current - baseline);
  const percentChange = baseline == null || current == null || baseline === 0 ? null : rounded(((current - baseline) / Math.abs(baseline)) * 100);
  let classification: EvaluationClassification = "INCONCLUSIVE";
  if (input.evaluationWindowComplete === false && availability === "AVAILABLE") classification = "COLLECTING";
  else if (availability === "AVAILABLE" && percentChange != null) {
    const directedChange = (input.direction ?? "increase") === "decrease" ? -percentChange : percentChange;
    classification = Math.abs(directedChange) < materialThreshold ? "NO_MATERIAL_CHANGE" : directedChange > 0 ? "IMPROVED" : "DECLINED";
  }

  const completeness = baseline != null && current != null ? 1 : 0.35;
  const sampleConfidence = sampleSize == null ? 0.55 : Math.min(1, sampleSize / Math.max(minimumSampleSize * 2, 1));
  const freshnessConfidence = input.sourceFreshnessDays == null ? 0.7 : Math.max(0.2, 1 - input.sourceFreshnessDays / 120);
  const availabilityPenalty = availability === "AVAILABLE" ? 1 : availability === "LIMITED" ? 0.75 : 0.45;
  const confidence = Math.round(100 * completeness * sampleConfidence * freshnessConfidence * availabilityPenalty);
  const changeText = percentChange == null ? "A defensible change cannot be calculated yet" : `${Math.abs(percentChange)}% ${percentChange >= 0 ? "increase" : "decrease"} was observed`;
  const summary = classification === "COLLECTING"
    ? `${input.metricKey} is still collecting evidence; no result has been declared.`
    : classification === "INCONCLUSIVE"
      ? `${input.metricKey} is inconclusive. ${changeText}, but the available evidence does not support a reliable conclusion.`
      : `${input.metricKey} is classified as ${classification.toLowerCase().replaceAll("_", " ")}. ${changeText} during the evaluation window.`;

  return {
    contractVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION,
    metricKey: input.metricKey,
    availability,
    classification,
    baselineValue: baseline,
    currentValue: current,
    absoluteChange,
    percentChange,
    sampleSize,
    confidence,
    limitations: [...new Set(limitations)],
    summary,
    causalClaimAllowed: false,
  };
}

export function opportunityGate(input: {
  strategyApproved: boolean;
  evidenceAvailable: boolean;
  measurementBlocked?: boolean;
  conflictingActiveWork?: boolean;
  approvalPending?: boolean;
  providerAttentionRequired?: boolean;
}) : OpportunityGate {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.strategyApproved) blockers.push("Approve the current Unified Strategy before selecting Growth work.");
  if (!input.evidenceAvailable) blockers.push("Collect applicable evidence before scoring this opportunity.");
  if (input.measurementBlocked) blockers.push("Resolve the measurement or data-quality blocker before drawing a conclusion.");
  if (input.conflictingActiveWork) blockers.push("Complete or reconcile the conflicting active work first.");
  if (input.approvalPending) warnings.push("An existing approval decision takes precedence over a new opportunity.");
  if (input.providerAttentionRequired) warnings.push("A provider recovery action takes precedence over new optimization work.");
  return { eligible: blockers.length === 0, blockers, warnings };
}

export function scoreGrowthOpportunity(input: OpportunityFactors) {
  const value =
    0.30 * asRatio(input.impact) +
    0.25 * asRatio(input.goalAlignment) +
    0.15 * asRatio(input.confidence) +
    0.10 * asRatio(input.reach) +
    0.10 * asRatio(input.urgency) +
    0.10 * asRatio(input.learningValue);
  const score = 100 * value * (0.5 + 0.5 * asRatio(input.ease)) * (0.5 + 0.5 * asRatio(input.readiness)) * (1 - 0.5 * asRatio(input.risk));
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function selectGovernedNextBestAction<T extends {
  id: string;
  score: number;
  gate: OpportunityGate;
  precedence?: "BLOCKER" | "APPROVAL" | "RECOVERY" | "EVALUATION" | "OPPORTUNITY" | "MEASURE";
  createdAt?: string | Date;
}>(candidates: readonly T[]) {
  const order = { BLOCKER: 0, APPROVAL: 1, RECOVERY: 2, EVALUATION: 3, OPPORTUNITY: 4, MEASURE: 5 } as const;
  return [...candidates]
    .filter((candidate) => candidate.gate.eligible)
    .sort((left, right) => {
      const precedence = order[left.precedence ?? "OPPORTUNITY"] - order[right.precedence ?? "OPPORTUNITY"];
      if (precedence) return precedence;
      if (right.score !== left.score) return right.score - left.score;
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return leftTime - rightTime || left.id.localeCompare(right.id);
    })[0] ?? null;
}

const strategyPaths = new Set(["audience", "offer", "market", "objective", "positioning"]);

export function createBlueprintPatch(input: Omit<BlueprintPatch, "contractVersion" | "materialStrategyChange">): BlueprintPatch {
  const root = input.path.replace(/^\//, "").split("/")[0] ?? "";
  return { ...input, contractVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION, materialStrategyChange: strategyPaths.has(root) };
}

export function safeObservedImpact(evaluation: PerformanceEvaluation) {
  return {
    label: evaluation.classification === "INCONCLUSIVE" || evaluation.classification === "COLLECTING" ? "Observed evidence" : "Observed change",
    value: evaluation.percentChange,
    narrative: evaluation.summary,
    limitation: "This is an observational evaluation and is not presented as proof that one change caused the result.",
  };
}
