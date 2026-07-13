import { describe, expect, it } from "vitest";
import { hasWorkspacePermission, hasWorkspaceRole, validateRolesForWorkspace, type WorkspaceContext } from "./workspace-access.js";

function context(roles: string[], workspaceType = "agency", overrides: unknown = {}): WorkspaceContext {
  return {
    workspace: {
      id: "workspace-1", name: "Test", workspaceType, ownerUserId: roles.includes("owner") ? "user-1" : "owner-1",
      legacyClientId: "legacy-1", securitySettingsJson: {}, autoApprovalPolicyJson: {},
    },
    membership: { id: "membership-1", userId: "user-1", status: "active", permissionOverrides: overrides, roles: roles.map((role) => ({ role })) },
    roles: new Set(roles),
  };
}

describe("workspace role enforcement", () => {
  it("inherits permissions downward through the DEV-016 hierarchy", () => {
    const manager = context(["manager"]);
    expect(hasWorkspaceRole(manager, "manager")).toBe(true);
    expect(hasWorkspaceRole(manager, "approver")).toBe(true);
    expect(hasWorkspaceRole(manager, "editor")).toBe(true);
    expect(hasWorkspaceRole(manager, "viewer")).toBe(true);
    expect(hasWorkspacePermission(manager, "assign_tasks")).toBe(true);
    expect(hasWorkspacePermission(manager, "submit_for_approval")).toBe(true);
    expect(hasWorkspacePermission(manager, "approve")).toBe(true);
  });

  it("allows multiple independent roles", () => {
    const managerApprover = context(["manager", "approver"]);
    expect(hasWorkspacePermission(managerApprover, "assign_tasks")).toBe(true);
    expect(hasWorkspacePermission(managerApprover, "approve")).toBe(true);
    expect(hasWorkspacePermission(managerApprover, "submit_for_approval")).toBe(true);
  });

  it("gives the simplified Manager/Approver role both management and approval authority", () => {
    const manager = context(["manager"]);
    expect(hasWorkspacePermission(manager, "assign_tasks")).toBe(true);
    expect(hasWorkspacePermission(manager, "approve")).toBe(true);
    expect(hasWorkspacePermission(manager, "submit_for_approval")).toBe(true);
  });

  it("gives additional Owner/Admin members full workspace permission", () => {
    const admin = context(["admin"]);
    expect(hasWorkspacePermission(admin, "billing")).toBe(true);
    expect(hasWorkspacePermission(admin, "publish")).toBe(true);
    expect(hasWorkspacePermission(admin, "manage_settings")).toBe(true);
  });

  it("keeps Owner unrestricted", () => {
    const owner = context(["owner", "admin"]);
    expect(hasWorkspacePermission(owner, "publish")).toBe(true);
    expect(hasWorkspacePermission(owner, "billing")).toBe(true);
    expect(hasWorkspaceRole(owner, "editor")).toBe(true);
  });

  it("applies explicit allow and deny overrides", () => {
    expect(hasWorkspacePermission(context(["editor"], "agency", { deny: ["submit_for_approval"] }), "submit_for_approval")).toBe(false);
    expect(hasWorkspacePermission(context(["viewer"], "agency", { allow: ["publish"] }), "publish")).toBe(true);
  });

  it("allows Client Viewer only in Agency workspaces", () => {
    expect(() => validateRolesForWorkspace(context(["admin"], "business"), ["client_viewer"])).toThrow(/Business workspaces/);
    expect(() => validateRolesForWorkspace(context(["admin"], "agency"), ["client_viewer"])).not.toThrow();
  });

  it("limits Personal workspace roles", () => {
    expect(() => validateRolesForWorkspace(context(["owner"], "personal"), ["editor"])).not.toThrow();
    expect(() => validateRolesForWorkspace(context(["owner"], "personal"), ["admin"])).not.toThrow();
    expect(() => validateRolesForWorkspace(context(["owner"], "personal"), ["manager"])).toThrow(/Personal workspaces/);
  });

  it("supports the four simplified internal roles in Business and Ecommerce workspaces", () => {
    for (const workspaceType of ["business", "ecommerce"]) {
      expect(() => validateRolesForWorkspace(context(["owner"], workspaceType), ["admin", "manager", "editor", "viewer"])).not.toThrow();
      expect(() => validateRolesForWorkspace(context(["owner"], workspaceType), ["client_viewer"])).toThrow();
    }
  });

  it("allows Client Viewer only as the fifth Agency role", () => {
    expect(() => validateRolesForWorkspace(context(["owner"], "agency"), ["admin", "manager", "editor", "viewer", "client_viewer"])).not.toThrow();
  });

  it("keeps Client Viewer isolated from the internal hierarchy", () => {
    const clientViewer = context(["client_viewer"]);
    expect(hasWorkspaceRole(clientViewer, "viewer")).toBe(false);
    expect(hasWorkspacePermission(clientViewer, "read_internal")).toBe(false);
    expect(hasWorkspacePermission(clientViewer, "read_shared_client_data")).toBe(true);
  });
});
