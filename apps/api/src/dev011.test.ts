import { describe, expect, it } from "vitest";
import { approvalDecisionState, approvalEscalationStage, normalizedApprovalDecision } from "./dev011.js";

describe("DEV-011 unified task approval workflow", () => {
  it("maps approval decisions to Execution Plan states", () => {
    expect(approvalDecisionState("approved", false)).toEqual({ status: "ready_to_publish", storedDecision: "approved" });
    expect(approvalDecisionState("approved", true)).toEqual({ status: "submitted_for_approval", storedDecision: "team_approved" });
    expect(approvalDecisionState("rejected", false).status).toBe("rejected");
    expect(approvalDecisionState("changes_requested", false).status).toBe("changes_requested");
  });

  it("normalizes legacy edit and regenerate actions into request changes", () => {
    expect(normalizedApprovalDecision("edit_first")).toBe("changes_requested");
    expect(normalizedApprovalDecision("regenerate")).toBe("changes_requested");
  });

  it("escalates pending requests to Manager and then Owner", () => {
    const submitted = new Date("2026-07-14T00:00:00Z");
    expect(approvalEscalationStage(submitted, new Date("2026-07-14T12:00:00Z"))).toBeNull();
    expect(approvalEscalationStage(submitted, new Date("2026-07-15T00:00:00Z"))).toBe("manager");
    expect(approvalEscalationStage(submitted, new Date("2026-07-16T00:00:00Z"))).toBe("owner");
  });
});
