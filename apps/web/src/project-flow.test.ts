import { describe, expect, it } from "vitest";
import type { GuidedProject } from "./types.js";
import { isExistingWebsiteFlow, nextProjectFlowStep } from "./project-flow.js";

const project = (overrides: Partial<GuidedProject> = {}) => ({
  id: "project-1", projectType: "new_business", websiteStatus: "new_website_required", websiteUrl: "https://example.com",
  workflowSteps: [{ id: "keywords", projectId: "project-1", stepKey: "keyword_analysis", title: "Keywords", description: "", status: "ready", priority: "high", actionLabel: null, actionUrl: "/keywords", sortOrder: 40, sourceType: null, sourceId: null, completionReason: null, readyReason: null, blockedReason: null, completedAt: null, createdAt: "", updatedAt: "" }],
  strategyPlans: [], _count: { intakeAnswers: 1, strategyPlans: 0, opportunities: 1 },
  ...overrides,
} as GuidedProject);

describe("project workflow navigation", () => {
  it("sends new-website projects from opportunity to keywords before strategy", () => {
    const next = nextProjectFlowStep(project());
    expect(next.actionLabel).toBe("Run Keyword Analysis");
    expect(next.to).toContain("/keywords?projectId=project-1");
  });

  it("does not require site analysis merely because a new project has a URL", () => {
    expect(isExistingWebsiteFlow(project())).toBe(false);
    expect(isExistingWebsiteFlow(project({ websiteStatus: "existing_website", projectType: "existing_website" }))).toBe(true);
  });

  it("recognizes an approved strategy even when a newer draft is first", () => {
    const next = nextProjectFlowStep(project({
      workflowSteps: [
        { ...project().workflowSteps![0], status: "completed" },
        { ...project().workflowSteps![0], id: "execution", stepKey: "execution_plan", status: "completed" },
      ],
      strategyPlans: [{ status: "draft" }, { status: "approved" }] as GuidedProject["strategyPlans"],
      _count: { intakeAnswers: 1, strategyPlans: 2, opportunities: 1 },
    }));
    expect(next.actionLabel).toBe("Open Site Architect");
    expect(next.to).toContain("projectId=project-1");
  });
});
