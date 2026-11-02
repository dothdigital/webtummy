import { describe, expect, it } from "vitest";
import { executionTaskDestination, executionTaskGuidance } from "./execution-task-guidance.js";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1", projectId: "project-1", moduleName: "website", sourceType: "strategy_decision", sourceId: "strategy-1",
    title: "Build a measurable enquiry journey", description: "Create the journey. AI will prepare: enquiry form; CTA copy; analytics events.",
    expectedOutcome: "A test enquiry is received and attributed.", priority: "high", automationLevel: "one_click_approval", status: "ready",
    requiresApproval: true, requiresIntegration: false, manualRequired: true, actionButtonLabel: null, relatedUrl: null,
    manualInstructions: null, createdAt: "2026-08-19T00:00:00.000Z", ...overrides,
  } as never;
}

describe("execution task guidance", () => {
  it("turns a strategy outcome into AI work, numbered user steps, and a completion check", () => {
    const guide = executionTaskGuidance(task());
    expect(guide.destinationLabel).toBe("Website Development");
    expect(guide.aiPreparation).toContain("enquiry form");
    expect(guide.userSteps[0]).toContain("Check readiness & prepare with AI");
    expect(guide.userSteps.join(" ")).toContain("Approve the exact prepared version");
    expect(guide.doneWhen).toBe("A test enquiry is received and attributed.");
  });

  it("does not claim that AI performed prospect or customer validation", () => {
    const guide = executionTaskGuidance(task({ description: "Validate the offer. AI will prepare: two positioning drafts; Test both drafts with five target prospects; launch copy." }));
    expect(guide.aiPreparation).toContain("it will not contact or interview people");
    expect(guide.userValidationActions).toEqual(["Test both drafts with five target prospects"]);
    expect(guide.userSteps.join(" ")).toContain("Carry out and record this real-world check");
  });

  it("lets a user continue a legacy stale task with the approved plan", () => {
    const guide = executionTaskGuidance(task({ status: "stale" }));
    expect(guide.stale).toBe(false);
    expect(guide.staleResolution).toBeNull();
    expect(guide.userSteps[0]).toContain("Check readiness & prepare with AI");
  });

  it("does not force paid Strategy regeneration for upstream evidence changes", () => {
    const guide = executionTaskGuidance(task({ status: "stale", blockedReason: "Upstream Business Brain or evidence changed. Regenerate and approve Strategy, then reconcile the Execution Plan before continuing." }));
    expect(guide.staleResolution).toBeNull();
    expect(guide.userSteps.join(" ")).not.toContain("Regenerate Strategy");
  });

  it("uses plain destination names for strategy modules", () => {
    expect(executionTaskDestination("measurement").label).toBe("Measurement");
    expect(executionTaskDestination("seo").label).toBe("SEO & Gap Analysis");
    expect(executionTaskDestination("execution_plan").label).toBe("Execution Plan");
  });

  it("replaces strategy jargon with a task a non-specialist can understand", () => {
    const guide = executionTaskGuidance(task({ title: "Validate the beachhead audience and offer", description: "Select one primary audience, one primary service pathway, and one compliant conversion promise." }));
    expect(guide.plainTitle).toBe("Choose the first customer group and main launch offer");
    expect(guide.plainPurpose).toContain("who the website should speak to first");
  });
});
