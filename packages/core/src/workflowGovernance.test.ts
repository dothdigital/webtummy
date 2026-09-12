import { describe, expect, it } from "vitest";
import { PROJECT_WORKFLOW_LIFECYCLE, PROJECT_WORKFLOW_STATUS, REQUIRED_STRATEGY_CHANNELS, workflowBlockedPayload, workflowStageNumber } from "./workflowGovernance.js";

describe("platform workflow governance contract", () => {
  it("defines the required 19-step lifecycle in strict order", () => {
    expect(PROJECT_WORKFLOW_LIFECYCLE).toHaveLength(19);
    expect(PROJECT_WORKFLOW_LIFECYCLE.map((stage) => stage.number)).toEqual(Array.from({ length: 19 }, (_, index) => index + 1));
    expect(PROJECT_WORKFLOW_LIFECYCLE[0]).toMatchObject({ key: "project_created", prerequisite: null });
    expect(PROJECT_WORKFLOW_LIFECYCLE[18]).toMatchObject({ key: "next_best_action", prerequisite: "growth_loop_activation" });
    for (let index = 1; index < PROJECT_WORKFLOW_LIFECYCLE.length; index += 1) {
      expect(PROJECT_WORKFLOW_LIFECYCLE[index].prerequisite).toBe(PROJECT_WORKFLOW_LIFECYCLE[index - 1].key);
    }
  });

  it("defines every customer-facing workflow status", () => {
    expect(new Set(Object.values(PROJECT_WORKFLOW_STATUS))).toEqual(new Set([
      "not_started", "in_progress", "needs_attention", "waiting_for_approval",
      "complete", "not_applicable", "needs_refresh", "blocked",
    ]));
  });

  it("defines only the governed channel-plan families", () => {
    expect(REQUIRED_STRATEGY_CHANNELS).toEqual([
      "seo", "aeo_geo", "website", "content", "funnel_conversion",
      "email", "ecommerce", "local_visibility", "authority_building", "paid_media",
    ]);
  });

  it("returns the standard backend blocker without leaking unrelated state", () => {
    expect(workflowBlockedPayload("Approve the Business Brain.", {
      label: "Review Business Brain",
      url: "/guided-projects/project-1?tab=profile",
      type: "approve",
    })).toEqual({
      error: "The action is not ready.",
      code: "WORKFLOW_PREREQUISITE_REQUIRED",
      missingRequirement: "Approve the Business Brain.",
      nextAction: {
        label: "Review Business Brain",
        url: "/guided-projects/project-1?tab=profile",
        type: "approve",
      },
    });
    expect(workflowStageNumber("tracking_verification")).toBe(16);
  });
});
