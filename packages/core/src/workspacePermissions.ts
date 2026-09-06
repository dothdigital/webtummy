export const configurableWorkspaceRoles = ["manager", "editor", "viewer", "client_viewer"] as const;
export type ConfigurableWorkspaceRole = (typeof configurableWorkspaceRoles)[number];

export const internalSeatRoles = ["owner", "admin", "manager", "approver", "manager_approver", "editor", "viewer"] as const;

const permissionCeilings: Record<ConfigurableWorkspaceRole, ReadonlySet<string>> = {
  manager: new Set(["manage_integrations", "manage_clients", "create_projects", "edit_project_settings", "manage_projects", "run_ai_analysis", "edit_strategy", "execute_tasks", "approve", "publish", "view_reports", "export_reports", "view_activity", "view_notifications", "read_integrations", "manage_assigned_clients", "manage_assigned_projects", "assign_tasks", "request_approval", "edit_assigned_work", "submit_for_approval", "read_internal"]),
  editor: new Set(["create_projects", "edit_project_settings", "run_ai_analysis", "edit_strategy", "execute_tasks", "view_reports", "export_reports", "view_activity", "view_notifications", "read_integrations", "edit_assigned_work", "submit_for_approval", "read_internal"]),
  viewer: new Set(["view_reports", "view_activity", "view_notifications", "read_internal"]),
  client_viewer: new Set(["view_reports", "read_shared_client_data"]),
};

type PermissionDefinition = {
  key: string;
  label: string;
  configurable?: boolean;
  defaultRoles: readonly ConfigurableWorkspaceRole[];
};

export const workspacePermissionCatalog: readonly PermissionDefinition[] = [
  { key: "manage_integrations", label: "Manage integrations", configurable: true, defaultRoles: ["manager"] },
  { key: "manage_users", label: "Invite/remove users", configurable: true, defaultRoles: [] },
  { key: "manage_clients", label: "Create, edit and archive clients", configurable: true, defaultRoles: ["manager"] },
  { key: "create_projects", label: "Create projects", configurable: true, defaultRoles: ["manager", "editor"] },
  { key: "edit_project_settings", label: "Edit project settings", configurable: true, defaultRoles: ["manager", "editor"] },
  { key: "manage_projects", label: "Archive/delete projects", configurable: true, defaultRoles: ["manager"] },
  { key: "run_ai_analysis", label: "Run AI analysis", configurable: true, defaultRoles: ["manager", "editor"] },
  { key: "edit_strategy", label: "Create/edit strategy", configurable: true, defaultRoles: ["manager", "editor"] },
  { key: "execute_tasks", label: "Execute approved tasks", configurable: true, defaultRoles: ["manager", "editor"] },
  { key: "approve", label: "Approve AI changes", configurable: true, defaultRoles: ["manager"] },
  { key: "publish", label: "Publish changes", configurable: true, defaultRoles: ["manager"] },
  { key: "view_reports", label: "View reports", configurable: true, defaultRoles: ["manager", "editor", "viewer", "client_viewer"] },
  { key: "export_reports", label: "Export reports", configurable: true, defaultRoles: ["manager", "editor"] },
  { key: "view_activity", label: "View activity history", configurable: true, defaultRoles: ["manager", "editor", "viewer"] },
  { key: "view_notifications", label: "View notifications", configurable: true, defaultRoles: ["manager", "editor", "viewer"] },
  // Managing a connection necessarily includes opening and reading the Hub.
  // Approver resolves through the Manager policy, so this covers both roles.
  { key: "read_integrations", label: "Read Integrations Hub", configurable: true, defaultRoles: ["manager", "editor"] },
  { key: "manage_assigned_clients", label: "Manage assigned clients", defaultRoles: ["manager"] },
  { key: "manage_assigned_projects", label: "Manage assigned projects", defaultRoles: ["manager"] },
  { key: "assign_tasks", label: "Assign tasks", defaultRoles: ["manager"] },
  { key: "request_approval", label: "Request approval", defaultRoles: ["manager"] },
  { key: "edit_assigned_work", label: "Edit assigned work", defaultRoles: ["editor"] },
  { key: "submit_for_approval", label: "Submit for approval", defaultRoles: ["editor"] },
  { key: "read_internal", label: "View workspace", defaultRoles: ["viewer"] },
  { key: "read_shared_client_data", label: "View assigned client data", defaultRoles: ["client_viewer"] },
] as const;

export function defaultWorkspacePermission(role: ConfigurableWorkspaceRole, permission: string) {
  return workspacePermissionCatalog.some((item) => item.key === permission && item.defaultRoles.includes(role));
}

export function workspaceRoleCanEver(role: ConfigurableWorkspaceRole, permission: string) {
  return permissionCeilings[role].has(permission);
}

export function rolesConsumeSeat(roles: readonly string[]) {
  return roles.some((role) => (internalSeatRoles as readonly string[]).includes(role));
}
