import { describe, expect, it } from "vitest";
import { rolesConsumeSeat, workspaceRoleCanEver } from "./workspacePermissions.js";

describe("DEV-016 role ceilings and seats", () => {
  it("keeps Viewer read-only", () => {
    expect(workspaceRoleCanEver("viewer", "read_internal")).toBe(true);
    expect(workspaceRoleCanEver("viewer", "view_reports")).toBe(true);
    expect(workspaceRoleCanEver("viewer", "create_projects")).toBe(false);
    expect(workspaceRoleCanEver("viewer", "approve")).toBe(false);
  });

  it("prevents Client Viewer privilege escalation", () => {
    expect(workspaceRoleCanEver("client_viewer", "read_shared_client_data")).toBe(true);
    expect(workspaceRoleCanEver("client_viewer", "manage_clients")).toBe(false);
    expect(workspaceRoleCanEver("client_viewer", "read_internal")).toBe(false);
  });

  it("charges seats only for internal roles", () => {
    expect(rolesConsumeSeat(["manager"])).toBe(true);
    expect(rolesConsumeSeat(["viewer"])).toBe(true);
    expect(rolesConsumeSeat(["client_viewer"])).toBe(false);
    expect(rolesConsumeSeat(["client_viewer", "editor"])).toBe(true);
  });
});
