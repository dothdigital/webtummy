import { describe, expect, it } from "vitest";
import { isGrowthExecutionPrerequisite, nextReadyExecutionTask } from "./execution-task-page.js";

describe("execution task page", () => {
  it("does not hide execution for Growth continuation or measurement", () => {
    for (const title of ["Continue Growth Execution", "Complete the measurement checkpoint", "Review the Next Best Action"]) {
      expect(isGrowthExecutionPrerequisite({ title })).toBe(false);
    }
  });
  it("keeps real Growth setup requirements", () => {
    expect(isGrowthExecutionPrerequisite({ title: "Run the Growth Engine before making changes" })).toBe(true);
    expect(isGrowthExecutionPrerequisite({ title: "Review and approve the Growth Blueprint" })).toBe(true);
    expect(isGrowthExecutionPrerequisite(undefined)).toBe(false);
  });
  it("does not recommend a blocked task, including a requested task", () => {
    const tasks = [
      { id: "blocked", status: "blocked" },
      { id: "dependent", status: "ready", dependencies: [{ requiredTask: { status: "pending" } }] },
      { id: "ready", status: "ready" },
    ];
    expect(nextReadyExecutionTask(tasks, "dependent")?.id).toBe("ready");
    expect(nextReadyExecutionTask(tasks.slice(0, 2))).toBeNull();
  });
  it("honors requested available work and completed dependencies", () => {
    const tasks = [{ id: "first", status: "ready" }, { id: "requested", status: "ready", dependencies: [{ requiredTask: { status: "completed" } }] }];
    expect(nextReadyExecutionTask(tasks, "requested")?.id).toBe("requested");
  });
});
