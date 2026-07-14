import type { Request } from "express";
import { prisma, type Prisma } from "@webtummy/db";
import { projectClientIdForRequest } from "./project-scope.js";

export const workspaceRoles = ["owner", "admin", "manager", "approver", "editor", "viewer", "client_viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];
export const assignableWorkspaceRoles = ["admin", "manager", "editor", "viewer", "client_viewer"] as const;
export type AssignableWorkspaceRole = (typeof assignableWorkspaceRoles)[number];

export const rolesByWorkspaceType: Record<string, readonly WorkspaceRole[]> = {
  personal: ["owner", "admin", "editor", "viewer"],
  business: ["owner", "admin", "manager", "approver", "editor", "viewer"],
  agency: ["owner", "admin", "manager", "approver", "editor", "viewer", "client_viewer"],
  ecommerce: ["owner", "admin", "manager", "approver", "editor", "viewer"],
};

const inheritedRoleOrder: readonly WorkspaceRole[] = ["owner", "admin", "manager", "approver", "editor", "viewer"];

export type WorkspaceContext = {
  workspace: {
    id: string; name: string; workspaceType: string; ownerUserId: string; legacyClientId: string | null;
    settingsJson: unknown; securitySettingsJson: unknown; autoApprovalPolicyJson: unknown;
  };
  membership: { id: string; userId: string; status: string; permissionOverrides: unknown; roles: { role: string }[] };
  roles: Set<string>;
};

async function bootstrapWorkspace(req: Request, legacyClientId: string) {
  const users = await prisma.user.findMany({
    where: { clientId: legacyClientId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true },
  });
  const owner = users.find((user) => user.role === "client_admin") ?? users.find((user) => user.id === req.user!.userId);
  if (!owner) throw Object.assign(new Error("An active workspace owner is required."), { statusCode: 409 });
  const tenant = await prisma.client.findUniqueOrThrow({ where: { id: legacyClientId }, select: { name: true } });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.workspace.findUnique({ where: { legacyClientId } });
    if (existing) return existing;
    const normalizedType = ["personal", "business", "agency", "ecommerce"].includes(tenant.name.toLowerCase()) ? tenant.name.toLowerCase() : "business";
    const workspace = await tx.workspace.create({
      data: { legacyClientId, name: tenant.name, workspaceType: normalizedType, ownerUserId: owner.id },
    });
    for (const user of users) {
      const membership = await tx.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: user.id, status: "active", joinedAt: new Date() },
      });
      const roles = user.id === owner.id ? (normalizedType === "personal" ? ["owner"] : ["owner", "admin"]) : user.role === "client_admin" ? (normalizedType === "personal" ? ["editor"] : ["admin"]) : ["viewer"];
      await tx.workspaceMemberRole.createMany({ data: roles.map((role) => ({ membershipId: membership.id, role })) });
    }
    await tx.workspaceActivity.create({
      data: { workspaceId: workspace.id, actorUserId: req.user!.userId, action: "workspace.migrated", entityType: "workspace", entityId: workspace.id, metadataJson: { legacyClientId } },
    });
    return workspace;
  });
}

export async function workspaceContext(req: Request): Promise<WorkspaceContext> {
  if (!req.user) throw Object.assign(new Error("Unauthenticated."), { statusCode: 401 });
  const explicitWorkspaceId = req.header("x-senuke-ai-workspace-id")?.trim();
  let workspace = explicitWorkspaceId
    ? await prisma.workspace.findFirst({ where: { id: explicitWorkspaceId, memberships: { some: { userId: req.user.userId, status: "active" } } } })
    : await prisma.workspace.findFirst({ where: { memberships: { some: { userId: req.user.userId } } }, orderBy: { createdAt: "asc" } });

  // Browsers can retain a workspace id after local data or membership changes.
  // Use the user's active workspace instead of entering legacy bootstrap.
  if (!workspace && explicitWorkspaceId) {
    workspace = await prisma.workspace.findFirst({
      where: { memberships: { some: { userId: req.user.userId, status: "active" } } },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!workspace) {
    if (req.user.role === "super_admin") {
      throw Object.assign(new Error("Create or join a workspace before using workspace projects."), { statusCode: 409 });
    }
    const legacyClientId = await projectClientIdForRequest(req);
    if (!legacyClientId || legacyClientId === "__no_client_scope__") throw Object.assign(new Error("Workspace context is required."), { statusCode: 400 });
    workspace = await bootstrapWorkspace(req, legacyClientId);
  }
  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: req.user.userId } },
    include: { roles: { select: { role: true } } },
  });
  if (!membership || membership.status !== "active") throw Object.assign(new Error("Active workspace membership is required."), { statusCode: 403 });
  return {
    workspace: {
      id: workspace.id, name: workspace.name, workspaceType: workspace.workspaceType,
      ownerUserId: workspace.ownerUserId, legacyClientId: workspace.legacyClientId,
      settingsJson: workspace.settingsJson,
      securitySettingsJson: workspace.securitySettingsJson, autoApprovalPolicyJson: workspace.autoApprovalPolicyJson,
    },
    membership,
    roles: new Set(membership.roles.map((item) => item.role)),
  };
}

export function requireWorkspaceRole(context: WorkspaceContext, ...roles: WorkspaceRole[]) {
  if (!roles.some((role) => hasWorkspaceRole(context, role))) throw Object.assign(new Error("Insufficient workspace permission."), { statusCode: 403 });
}

export function hasWorkspaceRole(context: WorkspaceContext, required: WorkspaceRole) {
  if (context.roles.has("owner")) return true;
  const overrides = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object"
    ? context.membership.permissionOverrides as { deny?: unknown; allow?: unknown }
    : {};
  const denied = Array.isArray(overrides.deny) && overrides.deny.includes(required);
  const allowed = Array.isArray(overrides.allow) && overrides.allow.includes(required);
  if (denied) return false;
  if (allowed) return true;
  if (required === "client_viewer") return context.roles.has("client_viewer");
  const requiredIndex = inheritedRoleOrder.indexOf(required);
  return [...context.roles].some((role) => {
    const roleIndex = inheritedRoleOrder.indexOf(role as WorkspaceRole);
    return roleIndex >= 0 && requiredIndex >= 0 && roleIndex <= requiredIndex;
  });
}

export function hasWorkspacePermission(context: WorkspaceContext, permission: string) {
  if (context.roles.has("owner") || context.roles.has("admin")) return true;
  const overrides = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object"
    ? context.membership.permissionOverrides as { deny?: unknown; allow?: unknown }
    : {};
  const denied = Array.isArray(overrides.deny) && overrides.deny.includes(permission);
  const allowed = Array.isArray(overrides.allow) && overrides.allow.includes(permission);
  if (denied) return false;
  if (allowed) return true;
  const defaults: Record<WorkspaceRole, readonly string[]> = {
    owner: [],
    admin: ["manage_clients", "manage_projects", "manage_users", "manage_teams", "manage_templates", "manage_reports", "manage_settings"],
    manager: ["manage_assigned_clients", "manage_assigned_projects", "assign_tasks", "request_approval", "approve"],
    // Legacy role retained for existing records; it behaves as Manager/Approver.
    approver: ["manage_assigned_clients", "manage_assigned_projects", "assign_tasks", "request_approval", "approve"],
    editor: ["edit_assigned_work", "submit_for_approval"],
    viewer: ["read_internal"],
    client_viewer: ["read_shared_client_data"],
  };
  return workspaceRoles.some((role) => hasWorkspaceRole(context, role) && defaults[role].includes(permission));
}

export function effectiveWorkspaceRoles(context: WorkspaceContext): AssignableWorkspaceRole[] {
  const effective = new Set<AssignableWorkspaceRole>();
  if (context.roles.has("owner") || context.roles.has("admin")) effective.add("admin");
  if (context.roles.has("manager") || context.roles.has("approver")) effective.add("manager");
  if (context.roles.has("editor")) effective.add("editor");
  if (context.roles.has("viewer")) effective.add("viewer");
  if (context.roles.has("client_viewer")) effective.add("client_viewer");
  return [...effective];
}

export function managerSelfApprovalEnabled(context: WorkspaceContext) {
  const policy = context.workspace.autoApprovalPolicyJson && typeof context.workspace.autoApprovalPolicyJson === "object"
    ? context.workspace.autoApprovalPolicyJson as { allowManagerSelfApproval?: unknown }
    : {};
  return policy.allowManagerSelfApproval === true;
}

export function validateRolesForWorkspace(context: WorkspaceContext, roles: readonly WorkspaceRole[]) {
  const workspaceType = context.workspace.workspaceType.toLowerCase();
  const allowed = rolesByWorkspaceType[workspaceType] ?? rolesByWorkspaceType.business;
  const invalid = roles.filter((role) => !allowed.includes(role));
  if (invalid.length) {
    const label = workspaceType.charAt(0).toUpperCase() + workspaceType.slice(1);
    throw Object.assign(new Error(label + " workspaces do not support: " + invalid.join(", ") + "."), { statusCode: 400 });
  }
}

export function isWorkspaceOwner(context: WorkspaceContext) {
  return context.workspace.ownerUserId === context.membership.userId && context.roles.has("owner");
}

export async function canAccessAgencyClient(context: WorkspaceContext, agencyClientId: string) {
  if (context.roles.has("owner") || context.roles.has("admin")) return true;
  const assigned = await prisma.agencyClient.findFirst({
    where: {
      id: agencyClientId,
      workspaceId: context.workspace.id,
      OR: [
        { createdById: context.membership.userId },
        { memberAssignments: { some: { membershipId: context.membership.id } } },
        { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(assigned);
}

export async function canAccessProject(context: WorkspaceContext, projectId: string) {
  if (context.roles.has("owner") || context.roles.has("admin")) return true;
  if (!context.workspace.legacyClientId) return false;
  if (context.workspace.workspaceType === "personal") {
    return Boolean(await prisma.project.findFirst({ where: { id: projectId, clientId: context.workspace.legacyClientId }, select: { id: true } }));
  }
  const assignments: Prisma.ProjectWhereInput[] = [
    { memberAssignments: { some: { membershipId: context.membership.id } } },
    { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } },
    { executionTasks: { some: { OR: [
      { assigneeMembershipId: context.membership.id },
      { managerMembershipId: context.membership.id },
      { approverMembershipId: context.membership.id },
    ] } } },
  ];
  if (context.workspace.workspaceType === "agency") assignments.push(
    { agencyClient: { workspaceId: context.workspace.id, createdById: context.membership.userId } },
    { agencyClient: { workspaceId: context.workspace.id, memberAssignments: { some: { membershipId: context.membership.id } } } },
    { agencyClient: { workspaceId: context.workspace.id, teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } } },
  );
  const project = await prisma.project.findFirst({
    where: { id: projectId, clientId: context.workspace.legacyClientId, OR: assignments },
    select: { id: true },
  });
  return Boolean(project);
}

export async function recordWorkspaceActivity(tx: Prisma.TransactionClient, input: {
  context: WorkspaceContext;
  action: string;
  entityType: string;
  entityId?: string | null;
  agencyClientId?: string | null;
  projectId?: string | null;
  previousJson?: Prisma.InputJsonValue;
  nextJson?: Prisma.InputJsonValue;
  metadataJson?: Prisma.InputJsonValue;
}) {
  return tx.workspaceActivity.create({
    data: {
      workspaceId: input.context.workspace.id,
      actorUserId: input.context.membership.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      agencyClientId: input.agencyClientId ?? null,
      projectId: input.projectId ?? null,
      previousJson: input.previousJson,
      nextJson: input.nextJson,
      metadataJson: input.metadataJson ?? {},
    },
  });
}

export async function createWorkspaceNotification(tx: Prisma.TransactionClient, input: {
  context: WorkspaceContext;
  userId: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string | null;
  agencyClientId?: string | null;
  projectId?: string | null;
  emailEligible?: boolean;
}) {
  return tx.workspaceNotification.create({
    data: {
      workspaceId: input.context.workspace.id,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl ?? null,
      agencyClientId: input.agencyClientId ?? null,
      projectId: input.projectId ?? null,
      emailEligible: input.emailEligible ?? true,
    },
  });
}
