import { describe, expect, it } from "vitest";
import { clientViewerRouteAllowed } from "./dev002.js";
import { permissionForWorkspaceRequest } from "./middleware.js";
import { hasWorkspacePermission, rolesByWorkspaceType, validateRolesForWorkspace, type WorkspaceContext } from "./workspace-access.js";

function context(roles: string[], allow: string[] = []): WorkspaceContext {
  return {
    workspace: { id: "workspace", name: "Workspace", workspaceType: "business", ownerUserId: "owner", legacyClientId: "client", settingsJson: {}, securitySettingsJson: {}, autoApprovalPolicyJson: {} },
    membership: { id: "membership", userId: "user", status: "active", permissionOverrides: { allow }, roles: roles.map((role) => ({ role })) },
    roles: new Set(roles),
  };
}

describe("DEV-016 workspace enforcement", () => {
  it("keeps Personal single-owner and Client Viewer Agency-only", () => {
    expect(rolesByWorkspaceType.personal).toEqual(["owner", "admin"]);
    expect(rolesByWorkspaceType.agency).toContain("client_viewer");
    expect(rolesByWorkspaceType.business).not.toContain("client_viewer");
  });

  it("cannot escalate Viewer or Client Viewer with member overrides", () => {
    expect(hasWorkspacePermission(context(["viewer"], ["create_projects"]), "create_projects")).toBe(false);
    expect(hasWorkspacePermission(context(["viewer"]), "view_reports")).toBe(true);
    expect(hasWorkspacePermission(context(["client_viewer"], ["manage_clients"]), "manage_clients")).toBe(false);
  });

  it("maps simplified internal roles to their intended boundaries", () => {
    expect(hasWorkspacePermission(context(["owner"]), "billing")).toBe(true);
    expect(hasWorkspacePermission(context(["manager"]), "approve")).toBe(true);
    expect(hasWorkspacePermission(context(["manager"], ["manage_users"]), "manage_users")).toBe(false);
    expect(hasWorkspacePermission(context(["editor"]), "create_projects")).toBe(true);
    expect(hasWorkspacePermission(context(["editor"]), "approve")).toBe(false);
  });

  it("lets Viewer read project modules but not mutate them", () => {
    expect(permissionForWorkspaceRequest("GET", "/strategy")).toBe("read_internal");
    expect(permissionForWorkspaceRequest("GET", "/execution-tasks")).toBe("read_internal");
    expect(permissionForWorkspaceRequest("POST", "/strategy/generate")).toBe("edit_strategy");
  });

  it("allows Client Viewer to download only through the shared-document route", () => {
    expect(clientViewerRouteAllowed("GET", "/api/project-reports/report-1/download")).toBe(true);
    expect(clientViewerRouteAllowed("POST", "/api/project-reports/generate")).toBe(false);
  });

  it("rejects mixed or non-Agency Client Viewer roles", () => {
    expect(() => validateRolesForWorkspace(context(["owner"]), ["client_viewer"])).toThrow(/do not support|Agency-only/);
    const agency = context(["owner"]); agency.workspace.workspaceType = "agency";
    expect(() => validateRolesForWorkspace(agency, ["client_viewer", "editor"])).toThrow(/cannot be combined/);
  });
});
