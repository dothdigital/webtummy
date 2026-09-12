import { describe, expect, it } from "vitest";
import { websiteReadinessAction } from "./websiteReadinessActions.js";

describe("readiness resolution actions", () => {
  it("opens the recipient editor in Navigation for a lead form blocker", () => {
    expect(websiteReadinessAction("lead_form")).toEqual({ step: "menus", label: "Set form recipient email", openForm: true });
  });
  it.each([["navigation", "menus"], ["media", "media"], ["unique_urls", "structure"], ["technical_files", "structure"], ["approved_release", "review"], ["unique_metadata", "optimization"], ["quality_governance", "optimization"]])("routes %s to %s", (key, step) => {
    expect(websiteReadinessAction(key).step).toBe(step);
  });
});
