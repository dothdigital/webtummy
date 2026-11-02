import { describe, expect, it } from "vitest";
import { groupBacklinkActions, executionPlanActions, optimizationTaskGuide, optimizationTaskUrl } from "./optimization-task-guide.js";
describe("growth task guidance", () => {
  it("opens a specific execution task instead of looping back to the panel", () => {
    expect(optimizationTaskUrl({ id: "task1", relatedUrl: "/guided-projects/project1?tab=execution" }, "project1")).toBe("/guided-projects/project1?tab=execution&actionTask=task1#execution-tasks");
  });
  it("preserves an existing content task destination", () => {
    const relatedUrl = "/ai-content?projectId=p&taskId=t&open=1";
    expect(optimizationTaskUrl({ id: "t", relatedUrl }, "p")).toBe(relatedUrl);
  });
  it("does not send task navigation to an external destination", () => {
    expect(optimizationTaskUrl({ id: "t", relatedUrl: "//example.com" }, "p")).toContain("actionTask=t");
  });
  it("makes page ownership a review of existing work", () => {
    const guide = optimizationTaskGuide({ title: "Canonical intent ownership and page repair", recommendation: "", route: "content" });
    expect(guide.steps.join(" ")).toContain("reuse work already prepared");
    expect(guide.done).toContain("saved for review");
  });
});

describe("execution plan list", () => {
  const row = (status: string, taskId: string | null = null, title = "Choose a page") => ({ title, route: "content", recommendation: "Review existing pages", status, followupTask: taskId ? { id: taskId } : null });
  it("shows the created task once and omits its planning recommendation", () => {
    const task = row("accepted", "task1");
    expect(executionPlanActions([row("recommended"), row("proposed"), task, task])).toEqual([task]);
  });
  it("does not present planning or history records as tasks awaiting approval", () => {
    expect(executionPlanActions([row("recommended"), row("selected"), row("superseded"), row("dismissed")])).toEqual([]);
  });
  it("keeps separate competitor reviews and separate actual tasks", () => {
    const rows = [row("accepted", "a"), row("accepted", "b"), row("proposed", null, "Review competitor A"), row("proposed", null, "Review competitor B")];
    expect(executionPlanActions(rows)).toEqual(rows);
  });
});

describe("backlink task grouping", () => {
  it("groups competitor backlink reviews while keeping other work separate", () => {
    const items = [
      { title: "Review 20 verified referring-domain gaps against competitor-a.com" },
      { title: "Review 10 verified referring-domain gaps against competitor-b.com" },
      { title: "Review backlinks" },
      { title: "Connect and baseline Authority" },
    ];
    expect(groupBacklinkActions(items)).toEqual({ backlinks: items.slice(0, 3), tasks: items.slice(3) });
  });
});

it("routes page ownership reviews to the existing SEO plan instead of content publishing", () => {
  expect(optimizationTaskUrl({ id: "review", title: "Canonical intent ownership and page repair", relatedUrl: "/ai-content?projectId=p&taskId=review&open=1" }, "p")).toBe("/seo-page-map?projectId=p");
});
