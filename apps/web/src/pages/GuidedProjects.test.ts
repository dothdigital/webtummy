import { describe, expect, it } from "vitest";
import { projectDiscoveryInProgress } from "../project-discovery-status.js";

describe("projectDiscoveryInProgress", () => {
  it.each(["queued", "running", "processing", "in_progress"])("recognizes %s as background discovery work", (status) => {
    expect(projectDiscoveryInProgress({ projectLaunchAnalysis: { id: "analysis", status, errorCode: null, completedAt: null } })).toBe(true);
  });

  it.each(["completed", "failed", "reviewed", "applied"])("does not show an in-progress badge for %s", (status) => {
    expect(projectDiscoveryInProgress({ projectLaunchAnalysis: { id: "analysis", status, errorCode: null, completedAt: null } })).toBe(false);
  });
});
