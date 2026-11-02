import { describe, expect, it } from "vitest";
import { isProjectScopedPath } from "./active-project.js";

describe("project-scoped platform routes", () => {
  it("requires a project for every operational sidebar module", () => {
    [
      "/opportunities",
      "/strategy",
      "/seo-page-map",
      "/keywords",
      "/site-analysis",
      "/backlinks",
      "/ai-citations",
      "/site-architect",
      "/lead-magnets",
      "/growth",
      "/gap-analysis",
      "/local-seo",
      "/ai-content",
      "/social-strategy",
      "/reports",
      "/approvals",
    ].forEach((path) => expect(isProjectScopedPath(path), path).toBe(true));
    expect(isProjectScopedPath("/guided-projects/project-1")).toBe(true);
    expect(isProjectScopedPath("/guided-projects/project-1/intake")).toBe(true);
  });

  it("keeps workspace, project management, billing, and administration global", () => {
    [
      "/workspace",
      "/projects",
      "/projects/new",
      "/billing",
      "/pricing",
      "/admin",
      "/admin/tasks",
    ].forEach((path) => expect(isProjectScopedPath(path), path).toBe(false));
  });
});
