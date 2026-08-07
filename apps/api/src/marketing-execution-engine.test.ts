import { describe, expect, it } from "vitest";
import { attachApprovalFingerprint, attachPublicationOutcome, canonicalExecutionState, marketingExecutionSummary, marketingModuleContract, publishingExecutionPreflight, unversionedExecutionPlanCanBind } from "./marketing-execution-engine.js";

describe("DEV-047 Part 3 marketing execution contract", () => {
  it("maps existing module states into one canonical lifecycle", () => {
    expect(canonicalExecutionState("ready_to_publish")).toBe("APPROVED");
    expect(canonicalExecutionState("publishing")).toBe("EXECUTING_EXTERNAL");
    expect(canonicalExecutionState("published")).toBe("ACTIVE");
    expect(canonicalExecutionState("changes_requested")).toBe("CHANGES_REQUESTED");
  });

  it("uses capability-aware module contracts", () => {
    expect(marketingModuleContract("social_strategy").defaultMode).toBe("EXPORT_HANDOFF");
    expect(marketingModuleContract("lead_magnet").expectedOutputs).toContain("opt_in_form");
    expect(marketingModuleContract("website_builder").protectedExternalAction).toBe(true);
  });

  it("requires preparation, validation, immutable approval, and dependencies before publishing", () => {
    const unprepared = publishingExecutionPreflight({ approvalSnapshotJson: {}, status: "ready_to_publish", approvedAt: new Date(), dependencies: [] });
    expect(unprepared.errors.length).toBeGreaterThanOrEqual(3);
    const prepared = { contentAsset: { title: "Approved page" }, marketingExecution: { workPackage: { version: 1, fingerprint: "work-package-hash" }, validation: { status: "passed" } } };
    const approved = attachApprovalFingerprint(prepared, { taskId: "task-1", approvedAt: new Date(), destination: "/content", actorMembershipId: "member-1" });
    const ready = publishingExecutionPreflight({ approvalSnapshotJson: approved, status: "ready_to_publish", approvedAt: new Date(), dependencies: [{ requiredTask: { status: "completed" } }] });
    expect(ready.errors).toEqual([]);
    const edited = { ...approved, contentAsset: { title: "Changed after approval" } };
    expect(publishingExecutionPreflight({ approvalSnapshotJson: edited, status: "ready_to_publish", approvedAt: new Date(), dependencies: [] }).errors.join(" ")).toContain("no longer matches");
  });

  it("binds approval and verified publication to the exact execution package", () => {
    const prepared = { marketingExecution: { workPackage: { version: 2, fingerprint: "work-package-hash" }, validation: { status: "passed" }, measurementPlan: { status: "planned" } } };
    const approved = attachApprovalFingerprint(prepared, { taskId: "task-1", approvedAt: new Date("2026-08-02T12:00:00.000Z"), destination: "/content", actorMembershipId: "member-1" });
    expect((approved.marketingExecution as { approval: { fingerprint: string } }).approval.fingerprint).toHaveLength(64);
    const verified = attachPublicationOutcome(approved, { status: "verified", attemptId: "attempt-1", liveUrl: "https://example.com/page", verifiedAt: new Date("2026-08-02T13:00:00.000Z") });
    expect((verified.marketingExecution as { measurementPlan: { status: string } }).measurementPlan.status).toBe("active");
  });

  it("returns one guided next action from the canonical state", () => {
    const summary = marketingExecutionSummary({ moduleName: "content", status: "needs_review", approvalSnapshotJson: { marketingExecution: { workPackage: { fingerprint: "hash" }, validation: { status: "passed" }, measurementPlan: { status: "planned" } } } });
    expect(summary.canonicalState).toBe("NEEDS_REVIEW");
    expect(summary.nextAction.key).toBe("review");
  });

  it("binds only a completely unversioned plan created after the approved Strategy", () => {
    const strategyUpdatedAt = new Date("2026-08-05T12:00:00.000Z");
    expect(unversionedExecutionPlanCanBind({ strategyUpdatedAt, strategyApprovedAt: strategyUpdatedAt, planCreatedAt: new Date("2026-08-05T12:01:00.000Z"), strategyPlanId: null, strategyVersion: null })).toBe(true);
    expect(unversionedExecutionPlanCanBind({ strategyUpdatedAt, strategyApprovedAt: strategyUpdatedAt, planCreatedAt: new Date("2026-08-05T11:59:00.000Z"), strategyPlanId: null, strategyVersion: null })).toBe(false);
    expect(unversionedExecutionPlanCanBind({ strategyUpdatedAt, strategyApprovedAt: strategyUpdatedAt, planCreatedAt: new Date("2026-08-05T12:01:00.000Z"), strategyPlanId: "strategy-old", strategyVersion: 1 })).toBe(false);
  });
});
