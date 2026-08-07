import { describe, expect, it } from "vitest";
import { expectedSuccessfulWorkflowCost, selectLowestSuccessfulWorkflowCostRoute } from "./usage-engine.js";

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
