import { describe, expect, it } from "vitest";
import { hasWorkspacePermission, hasWorkspaceRole, selectPreferredWorkspaceId, validateRolesForWorkspace, workspaceTypeReconciliationBlockReason, type WorkspaceContext } from "./workspace-access.js";

function context(roles: string[], workspaceType = "agency", overrides: unknown = {}, settingsJson: unknown = {}): WorkspaceContext {
  return {
    workspace: {
      id: "workspace-1", name: "Test", workspaceType, ownerUserId: roles.includes("owner") ? "user-1" : "owner-1",
      legacyClientId: "legacy-1", settingsJson, securitySettingsJson: {}, autoApprovalPolicyJson: {},
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

  it("keeps historical Ecommerce workspaces compatible with the Business role model", () => {
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
    expect(hasWorkspacePermission(clientViewer, "view_reports")).toBe(true);
    expect(hasWorkspacePermission(clientViewer, "export_reports")).toBe(true);
    expect(hasWorkspacePermission(clientViewer, "publish")).toBe(false);
  });

  it("enforces the launch permission matrix", () => {
    const manager = context(["manager"]);
    const editor = context(["editor"]);
    const viewer = context(["viewer"]);

    for (const permission of ["manage_clients", "manage_projects", "manage_integrations", "run_ai_analysis", "edit_strategy", "execute_tasks", "approve", "publish", "export_reports"]) {
      expect(hasWorkspacePermission(manager, permission), `manager: ${permission}`).toBe(true);
    }
    expect(hasWorkspacePermission(manager, "manage_users")).toBe(false);
    expect(hasWorkspacePermission(manager, "manage_settings")).toBe(false);
    expect(hasWorkspacePermission(manager, "billing")).toBe(false);

    for (const permission of ["create_projects", "edit_project_settings", "run_ai_analysis", "edit_strategy", "execute_tasks", "publish", "view_reports", "export_reports", "view_activity", "view_notifications", "read_integrations"]) {
      expect(hasWorkspacePermission(editor, permission), `editor: ${permission}`).toBe(true);
    }
    for (const permission of ["manage_clients", "manage_projects", "approve", "manage_integrations", "manage_api_keys"]) {
      expect(hasWorkspacePermission(editor, permission), `editor denied: ${permission}`).toBe(false);
    }

    for (const permission of ["read_internal", "view_reports", "view_activity", "view_notifications"]) {
      expect(hasWorkspacePermission(viewer, permission), `viewer: ${permission}`).toBe(true);
    }
    for (const permission of ["create_projects", "edit_assigned_work", "run_ai_analysis", "approve", "publish", "export_reports"]) {
      expect(hasWorkspacePermission(viewer, permission), `viewer denied: ${permission}`).toBe(false);
    }
  });

  it("supports optional manager invitation permission without role-management authority", () => {
    const manager = context(["manager"], "agency", { allow: ["manage_users"] });
    expect(hasWorkspacePermission(manager, "manage_users")).toBe(true);
    expect(hasWorkspacePermission(manager, "manage_roles")).toBe(false);
  });

  it("applies workspace role policies while preserving member-specific precedence", () => {
    const policy = { rolePermissionOverrides: { editor: { allow: ["approve"], deny: ["publish"] } } };
    expect(hasWorkspacePermission(context(["editor"], "agency", {}, policy), "approve")).toBe(true);
    expect(hasWorkspacePermission(context(["editor"], "agency", {}, policy), "publish")).toBe(false);
    expect(hasWorkspacePermission(context(["editor"], "agency", { allow: ["publish"] }, policy), "publish")).toBe(true);
    expect(hasWorkspacePermission(context(["editor"], "agency", { deny: ["approve"] }, policy), "approve")).toBe(false);
    expect(hasWorkspacePermission(context(["admin"], "agency", {}, policy), "publish")).toBe(true);
  });
});

describe("workspace session selection", () => {
  const date = (value: string) => new Date(value);
  const membership = (input: {
    id: string;
    workspaceId: string;
    ownerUserId: string;
    legacyClientId: string | null;
    joinedAt: string;
  }) => ({
    id: input.id,
    createdAt: date(input.joinedAt),
    joinedAt: date(input.joinedAt),
    workspace: {
      id: input.workspaceId,
      ownerUserId: input.ownerUserId,
      legacyClientId: input.legacyClientId,
      createdAt: date(input.joinedAt),
    },
  });

  it("selects the workspace linked to the current account instead of an older Agency membership", () => {
    const choices = [
      membership({ id: "old", workspaceId: "agency-old", ownerUserId: "user-1", legacyClientId: "client-old", joinedAt: "2025-01-01" }),
      membership({ id: "new", workspaceId: "personal-new", ownerUserId: "user-1", legacyClientId: "client-current", joinedAt: "2026-08-20" }),
    ];
    expect(selectPreferredWorkspaceId(choices, "user-1", "client-current")).toBe("personal-new");
  });

  it("prefers an owned workspace over a newer invitation when no account link exists", () => {
    const choices = [
      membership({ id: "owned", workspaceId: "personal-owned", ownerUserId: "user-1", legacyClientId: null, joinedAt: "2026-01-01" }),
      membership({ id: "invite", workspaceId: "agency-invite", ownerUserId: "another-user", legacyClientId: null, joinedAt: "2026-08-20" }),
    ];
    expect(selectPreferredWorkspaceId(choices, "user-1", null)).toBe("personal-owned");
  });

  it("uses the most recently joined owned workspace only as the final fallback", () => {
    const choices = [
      membership({ id: "old", workspaceId: "owned-old", ownerUserId: "user-1", legacyClientId: null, joinedAt: "2025-01-01" }),
      membership({ id: "new", workspaceId: "owned-new", ownerUserId: "user-1", legacyClientId: null, joinedAt: "2026-08-20" }),
    ];
    expect(selectPreferredWorkspaceId(choices, "user-1", null)).toBe("owned-new");
  });
});

describe("commercial workspace type alignment", () => {
  it("allows a one-user empty Agency shell to align to Entrepreneur", () => {
    expect(workspaceTypeReconciliationBlockReason({ storedType: "agency", expectedType: "personal", activeMemberships: 1, agencyClients: 0 })).toBeNull();
  });

  it("protects real Agency clients and additional members during narrowing", () => {
    expect(workspaceTypeReconciliationBlockReason({ storedType: "agency", expectedType: "personal", activeMemberships: 1, agencyClients: 1 })).toBe("agency_clients_exist");
    expect(workspaceTypeReconciliationBlockReason({ storedType: "agency", expectedType: "personal", activeMemberships: 2, agencyClients: 0 })).toBe("multiple_active_members_exist");
  });

  it("allows expansion to Agency without deleting existing data", () => {
    expect(workspaceTypeReconciliationBlockReason({ storedType: "personal", expectedType: "agency", activeMemberships: 1, agencyClients: 0 })).toBeNull();
  });
});
