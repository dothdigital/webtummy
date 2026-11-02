import { describe, expect, it } from "vitest";
import type { ProjectWorkflowController } from "../types.js";
import { siteAnalysisPrimaryMode } from "./siteAnalysisNavigation.js";

const workflow = (stage: ProjectWorkflowController["websiteDeliveryStage"], url = "/site-analysis?projectId=simahi") => ({ websiteDeliveryStage: stage, state: "measurement", nextBestAction: { action: { url } } }) as ProjectWorkflowController;

describe("Site Analysis navigation after delivery", () => {
  it("offers a fresh live review even when an old report exists", () => {
    expect(siteAnalysisPrimaryMode(workflow("live_checks"), true)).toBe("live_review");
    expect(siteAnalysisPrimaryMode(workflow("live_checks"), false)).toBe("live_review");
  });
  it("supports verification actions without a delivery stage", () => {
    expect(siteAnalysisPrimaryMode(workflow(undefined), true)).toBe("live_review");
  });
  it.each(["tracking_checks", "growth_execution"] as const)("follows %s instead of returning to planning", stage => {
    expect(siteAnalysisPrimaryMode(workflow(stage, "/growth?projectId=simahi"), true)).toBe("workflow");
  });
  it("preserves the normal first-analysis and planning sequence", () => {
    expect(siteAnalysisPrimaryMode(null, false)).toBe("scan");
    expect(siteAnalysisPrimaryMode(null, true)).toBe("gap");
    expect(siteAnalysisPrimaryMode(workflow(undefined, "/strategy?projectId=simahi"), true)).toBe("gap");
  });
});
