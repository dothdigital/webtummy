import { describe, expect, it } from "vitest";
import { workflowRecoveryPayload } from "./workflowRecovery.js";

describe("workflow recovery payload", () => {
  it("reports saved work, Capacity outcome, and one recovery action", () => {
    expect(workflowRecoveryPayload({ whatFailed: "Strategy generation", workSaved: true, capacityOutcome: "refunded", nextStep: "Retry from Strategy.", action: "retry", actionUrl: "/strategy" })).toEqual({ whatFailed: "Strategy generation", workSaved: true, capacityOutcome: "refunded", nextStep: "Retry from Strategy.", action: "retry", actionUrl: "/strategy", errorCode: null });
  });
});
