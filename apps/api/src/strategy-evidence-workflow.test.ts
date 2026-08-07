import { describe, expect, it } from "vitest";
import { resolveStrategyEvidenceWorkflow } from "./strategy-evidence-workflow.js";

describe("SEO evidence to Strategy workflow", () => {
  it("requires Strategy when SEO evidence exists but no Strategy has been generated", () => {
    expect(resolveStrategyEvidenceWorkflow({ latestGapAnalysisAt: "2026-08-01T12:00:00.000Z" }).state).toBe("strategy_required");
  });

  it("requires a Strategy update when Gap Analysis is newer than the approved version", () => {
    const workflow = resolveStrategyEvidenceWorkflow({
      latestStrategy: { id: "strategy-1", version: 1, status: "approved", createdAt: "2026-08-01T11:00:00.000Z" },
      latestGapAnalysisAt: "2026-08-01T12:00:00.000Z",
      hasExecutionPlan: true,
    });
    expect(workflow.state).toBe("strategy_update_required");
    expect(workflow.executionUnlocked).toBe(false);
  });

  it("requires review when the evidence-backed Strategy is still a draft", () => {
    expect(resolveStrategyEvidenceWorkflow({
      latestStrategy: { id: "strategy-2", version: 2, status: "draft", createdAt: "2026-08-01T13:00:00.000Z" },
      latestGapAnalysisAt: "2026-08-01T12:00:00.000Z",
    }).state).toBe("strategy_review_required");
  });

  it("unlocks execution only when the current Strategy is approved and newer than the evidence", () => {
    const workflow = resolveStrategyEvidenceWorkflow({
      latestStrategy: { id: "strategy-2", version: 2, status: "approved", createdAt: "2026-08-01T13:00:00.000Z" },
      latestGapAnalysisAt: "2026-08-01T12:00:00.000Z",
      hasExecutionPlan: true,
    });
    expect(workflow.state).toBe("execution_ready");
    expect(workflow.executionUnlocked).toBe(true);
  });
});
