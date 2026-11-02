export type StrategyEvidenceWorkflowState =
  | "evidence_required"
  | "strategy_required"
  | "strategy_update_required"
  | "strategy_review_required"
  | "execution_ready";

type DateValue = Date | string | null | undefined;

function timestamp(value: DateValue) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : null;
}

export function resolveStrategyEvidenceWorkflow(input: {
  latestStrategy?: { id: string; version: number; status: string; createdAt: DateValue } | null;
  latestCrawlAt?: DateValue;
  latestGapAnalysisAt?: DateValue;
  latestApprovedGapAt?: DateValue;
  hasExecutionPlan?: boolean;
}) {
  const evidenceTimes = [input.latestCrawlAt, input.latestGapAnalysisAt, input.latestApprovedGapAt]
    .map(timestamp)
    .filter((value): value is number => value !== null);
  const latestEvidenceTime = evidenceTimes.length ? Math.max(...evidenceTimes) : null;
  const strategyTime = timestamp(input.latestStrategy?.createdAt);
  const hasNewerEvidence = latestEvidenceTime !== null && (strategyTime === null || latestEvidenceTime > strategyTime);

  let state: StrategyEvidenceWorkflowState;
  if (timestamp(input.latestGapAnalysisAt) === null || (timestamp(input.latestCrawlAt) ?? 0) > (timestamp(input.latestGapAnalysisAt) ?? 0)) state = "evidence_required";
  else if (!input.latestStrategy) state = "strategy_required";
  else if (hasNewerEvidence) state = "strategy_update_required";
  else if (input.latestStrategy.status === "draft") state = "strategy_review_required";
  else if (input.latestStrategy.status === "approved") state = "execution_ready";
  else state = "strategy_required";

  return {
    state,
    evidenceAt: latestEvidenceTime === null ? null : new Date(latestEvidenceTime).toISOString(),
    strategyId: input.latestStrategy?.id ?? null,
    strategyVersion: input.latestStrategy?.version ?? null,
    strategyStatus: input.latestStrategy?.status ?? null,
    strategyCreatedAt: strategyTime === null ? null : new Date(strategyTime).toISOString(),
    hasNewerEvidence,
    executionUnlocked: state === "execution_ready",
    hasExecutionPlan: Boolean(input.hasExecutionPlan),
  };
}
