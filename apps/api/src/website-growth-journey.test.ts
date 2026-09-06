import { describe, expect, it } from "vitest";
import { websiteGrowthJourney } from "./website-growth-journey.js";
const task = { id: "map-review", title: "Review the keyword-to-page map", moduleName: "content", sourceType: "strategy", status: "ready" };
const approvedPlan = { ...task, id: "approved-plan", title: "Website Launch Page Map & Content Plan", sourceType: "website_launch_plan", status: "completed", approvedAt: new Date("2026-09-05"), approvalSnapshotJson: { contentPlan: { pageAssignments: [{ title: "Home" }] } } };
describe("Performance growth handoff", () => {
  it("opens the approved plan instead of creating a second map for the review task", () => {
    const result = websiteGrowthJourney("project", [task, approvedPlan], true);
    expect(result.plan?.approved).toBe(true);
    expect(result.nextActivity).toMatchObject({ id: task.id, stage: "ready" });
    expect(result.nextActivity?.url).toContain("taskId=approved-plan");
    expect(result.nextActivity?.url).not.toContain("taskId=map-review");
    expect(result.nextActivity?.url).toContain("returnTo=");
    expect(result.activities).toHaveLength(1);
  });
  it("shows worker progress and user review before untouched activities", () => {
    const result = websiteGrowthJourney("project", [task, { ...task, id: "worker", title: "Prepare buyer guide", status: "in_progress" }, { ...task, id: "review", title: "Review buyer guide", status: "needs_review" }], true);
    expect(result.nextActivity?.id).toBe("review");
    expect(result.counts).toMatchObject({ working: 1, review: 1, ready: 1 });
    expect(result.activities.find(item => item.id === "worker")?.actionLabel).toBe("View progress");
  });
  it("keeps blocked tasks planned and excludes completed website work", () => {
    const result = websiteGrowthJourney("project", [approvedPlan,
      { ...task, id: "website", moduleName: "website", title: "Build website", status: "completed" },
      { ...task, dependencies: [{ requiredTask: { title: "Approve Strategy", status: "needs_review" } }] },
      { ...task, id: "gap", moduleName: "gap_analysis", title: "SEO & Gap Execution Plan" }], true);
    expect(result.nextActivity?.id).toBe("gap");
    expect(result.activities.find(item => item.id === task.id)).toMatchObject({ stage: "planned", blockedReason: "Complete first: Approve Strategy" });
    expect(result.activities).toHaveLength(2);
  });
  it("does not claim a draft plan is approved", () => {
    const result = websiteGrowthJourney("project", [{ ...approvedPlan, status: "needs_review", approvedAt: null }], true);
    expect(result.plan?.approved).toBe(false);
    expect(result.nextActivity).toBeNull();
  });
});
