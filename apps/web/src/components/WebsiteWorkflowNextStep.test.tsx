import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WebsiteWorkflowNextStep, { type WebsiteWorkflowNextStepData } from "./WebsiteWorkflowNextStep.js";
import WebsiteCompletionSummary from "./WebsiteCompletionSummary.js";

describe("shared next-action presentation", () => {
  it.each(["live_checks", "tracking_checks", "growth_execution"] as const)("uses the server action for %s in reports and completion", stage => {
    const url = stage === "growth_execution" ? "/growth?projectId=p" : stage === "tracking_checks" ? "/projects/p/website/performance?view=senuke" : "/site-analysis?projectId=p";
    const step: WebsiteWorkflowNextStepData = { stage, title: "Current workflow step", reason: "Current saved evidence", action: { label: "Continue this step", url } };
    const report = renderToStaticMarkup(createElement(WebsiteWorkflowNextStep, { step }));
    expect(report).toContain(url);
    for (const mode of ["published", "handoff"] as const) {
      const summary = renderToStaticMarkup(createElement(WebsiteCompletionSummary, { projectId: "p", businessName: "Example", releaseId: "r", mode, workflowNextStep: step, onManage: () => {}, onHistory: () => {} }));
      expect(summary).toContain(url);
      expect(summary).toContain("Continue this step");
      expect(summary).toContain("Open Performance reports");
    }
  });
});
