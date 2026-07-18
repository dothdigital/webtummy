import { describe, expect, it } from "vitest";
import { permissionForWorkspaceRequest } from "./middleware.js";

describe("workspace activity permission mapping", () => {
  it.each([
    ["POST", "/projects-v2", "create_projects"],
    ["PATCH", "/projects-v2/project-1/locations", "edit_project_settings"],
    ["POST", "/projects-v2/project-1/opportunities/generate", "run_ai_analysis"],
    ["POST", "/projects-v2/project-1/keyword-groups/generate", "run_ai_analysis"],
    ["POST", "/projects-v2/project-1/strategy/generate", "edit_strategy"],
    ["POST", "/projects-v2/project-1/strategy/approve", "approve"],
    ["POST", "/projects-v2/project-1/execution-plan/create", "execute_tasks"],
    ["POST", "/execution-tasks/task-1/complete", "execute_tasks"],
    ["POST", "/gap-analysis/project-1/wordpress/publish", "publish"],
    ["GET", "/projects/project-1/site-architecture", "view_reports"],
    ["POST", "/projects/project-1/site-architecture/generate", "run_ai_analysis"],
    ["POST", "/projects/project-1/site-architecture/version-1/approve", "approve"],
    ["POST", "/social-connect/accounts/connect/facebook", "manage_integrations"],
    ["GET", "/keyword-insights", "view_reports"],
    ["GET", "/automation/audit-log", "view_activity"],
    ["DELETE", "/projects-v2/project-1", "manage_projects"],
  ])("maps %s %s to %s", (method, path, permission) => {
    expect(permissionForWorkspaceRequest(method, path)).toBe(permission);
  });
});
