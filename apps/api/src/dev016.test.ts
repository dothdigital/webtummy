import { describe, expect, it } from "vitest";
import { rankNextBestAction, type NextBestActionTask } from "./dev016.js";

const task = (id: string, patch: Partial<NextBestActionTask> = {}): NextBestActionTask => ({ id, moduleName: "manual", title: id, description: "Complete this work", priority: "medium", status: "ready", dependencies: [], ...patch });
const context = { primaryGoal: "Generate More Leads", targetMarkets: ["Mississauga"], keywordGapCount: 4, competitorCount: 2, technicalIssueCount: 6, contentDecayCount: 1, canExecute: true, canApprove: true };

describe("DEV-016 Next Best Action", () => {
  it("selects one explainable action using advanced signals", () => {
    const result = rankNextBestAction([task("generic"), task("technical", { moduleName: "crawl", title: "Repair broken internal links", priority: "high" })], context);
    expect(result?.taskId).toBe("technical");
    expect(result?.signals.some((item) => item.key === "technical")).toBe(true);
    expect(result?.expectedOutcome).toBeTruthy();
  });

  it("respects unresolved dependencies and reprioritizes after completion", () => {
    const blocked = task("blocked", { priority: "critical", dependencies: [{ requiredTask: { id: "dep", title: "Map intent", status: "ready" } }] });
    expect(rankNextBestAction([blocked, task("ready")], context)?.taskId).toBe("ready");
    blocked.dependencies![0].requiredTask.status = "completed";
    expect(rankNextBestAction([blocked, task("ready")], context)?.taskId).toBe("blocked");
  });

  it("keeps read-only and approval-restricted recommendations non-actionable", () => {
    const protectedTask = task("protected", { priority: "high", requiresApproval: true });
    expect(rankNextBestAction([protectedTask, task("editor-task")], { ...context, canApprove: false })?.taskId).toBe("editor-task");
    expect(rankNextBestAction([protectedTask], { ...context, canExecute: false })?.actionLabel).toBe("View Task");
  });
});
