import { describe, expect, it } from "vitest";
import { creditTransactionReason, expectedSuccessfulWorkflowCost, selectLowestSuccessfulWorkflowCostRoute, usageCorrelationId, usageIdempotencyKey, usageWorkFingerprint } from "./usage-engine.js";

describe("AI Orchestrator successful-workflow cost routing", () => {
  it("includes initial, retry, validation, and correction cost", () => {
    expect(expectedSuccessfulWorkflowCost({ initialApiCost: 2, expectedRetryCost: 1.5, validationCost: 0.5, correctionCost: 1 })).toBe(5);
    expect(expectedSuccessfulWorkflowCost({ initialApiCost: 2, retryCost: 4, expectedRetryRate: 0.25, validationCost: 1, correctionCost: 0 })).toBe(4);
  });

  it("chooses the lowest expected successful-workflow cost within the applicable plan", () => {
    const selected = selectLowestSuccessfulWorkflowCostRoute([
      { model: "cheap-first-call", planCode: "pro", sortOrder: 0, configJson: { initialApiCost: 1, expectedRetryCost: 4, validationCost: 2, correctionCost: 2 } },
      { model: "lower-total-cost", planCode: "pro", sortOrder: 5, configJson: { initialApiCost: 3, expectedRetryCost: 0.2, validationCost: 0.4, correctionCost: 0.2 } },
      { model: "different-plan", planCode: null, sortOrder: 0, configJson: { initialApiCost: 0.1 } },
    ], "pro");
    expect(selected?.model).toBe("lower-total-cost");
  });

  it("does not route to a provider marked unavailable", () => {
    const selected = selectLowestSuccessfulWorkflowCostRoute([
      { model: "offline", planCode: "pro", sortOrder: 0, configJson: { initialApiCost: 0.1, providerAvailable: false } },
      { model: "available", planCode: "pro", sortOrder: 1, configJson: { initialApiCost: 1 } },
    ], "pro");
    expect(selected?.model).toBe("available");
  });
});

describe("usage refund ledger reasons", () => {
  it("bounds long validation errors to the database column without losing a valid reason", () => {
    const validationError = "growthFunnel.steps[5].evidenceType failed strict validation. ".repeat(20);
    const reason = creditTransactionReason(validationError);
    expect(Array.from(reason)).toHaveLength(255);
    expect(reason).toBe(validationError.slice(0, 255));
  });

  it("uses a stable fallback when no diagnostic reason is supplied", () => {
    expect(creditTransactionReason("  ")).toBe("usage refunded");
  });
});

describe("usage idempotency keys", () => {
  it("keeps short keys unchanged", () => {
    expect(usageIdempotencyKey("keyword-research:canada")).toBe("keyword-research:canada");
  });

  it("bounds large keyword-market batches without losing deterministic retry identity", () => {
    const batchKey = `keyword-research-batch:1787241600000:${Array.from({ length: 30 }, (_, index) => `keyword-${index}:Canada:United States`).join(":")}`;
    const normalized = usageIdempotencyKey(batchKey);
    expect(Array.from(normalized ?? "")).toHaveLength(255);
    expect(normalized).toBe(usageIdempotencyKey(batchKey));
    expect(normalized).not.toBe(usageIdempotencyKey(`${batchKey}:different`));
    expect(normalized).toMatch(/^keyword-research-batch:/);
    expect(Array.from(usageCorrelationId(normalized) ?? "").length).toBeLessThanOrEqual(191);
  });

  it("gives reloads and timestamped retries the same billable work identity", () => {
    const base = { clientId: "client-1", projectId: "project-1", websiteId: null, featureKey: "strategy_generate", actionKey: "Generate strategy" };
    expect(usageWorkFingerprint({ ...base, idempotencyKey: "strategy:project-1:1787937000000" }))
      .toBe(usageWorkFingerprint({ ...base, idempotencyKey: "strategy:project-1:1787937999999:retry:1787938000000" }));
  });

  it("charges materially different request fingerprints separately", () => {
    const base = { clientId: "client-1", projectId: "project-1", websiteId: null, featureKey: "strategy_generate", actionKey: "Generate strategy", idempotencyKey: null };
    expect(usageWorkFingerprint(base, "payload-a")).not.toBe(usageWorkFingerprint(base, "payload-b"));
  });
});
