import type { Request } from "express";
import { prisma, type Prisma } from "@webtummy/db";
import { projectClientIdForRequest } from "./project-scope.js";
import { defaultWorkspacePermission, rolesConsumeSeat, workspaceRoleCanEver, type ConfigurableWorkspaceRole } from "@webtummy/core/workspace-permissions";
import { authoritativePlanVersion, commercialSeatLimit, ensureCommercialSeatAssignments, workspaceTypeForCommercialPlan } from "./commercial-service.js";

export const workspaceRoles = ["owner", "admin", "manager", "approver", "editor", "viewer", "client_viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];
export const assignableWorkspaceRoles = ["admin", "manager", "editor", "viewer", "client_viewer"] as const;
export type AssignableWorkspaceRole = (typeof assignableWorkspaceRoles)[number];

export const rolesByWorkspaceType: Record<string, readonly WorkspaceRole[]> = {
  personal: ["owner", "admin"],
  business: ["owner", "admin", "manager", "approver", "editor", "viewer"],
  agency: ["owner", "admin", "manager", "approver", "editor", "viewer", "client_viewer"],
  ecommerce: ["owner", "admin", "manager", "approver", "editor", "viewer"],
};

const inheritedRoleOrder: readonly WorkspaceRole[] = ["owner", "admin", "manager", "approver", "editor", "viewer"];

export function workspaceTypeReconciliationBlockReason(input: { storedType: string; expectedType: string; activeMemberships: number; agencyClients: number }) {
  if (input.storedType === input.expectedType) return null;
  if (input.expectedType === "personal" && input.agencyClients > 0) return "agency_clients_exist";
  if (input.expectedType === "personal" && input.activeMemberships > 1) return "multiple_active_members_exist";
  if (input.expectedType === "business" && input.agencyClients > 0) return "agency_clients_exist";
  return null;
}

/**
 * Keep the operational workspace experience aligned with the authoritative
 * commercial plan. Narrowing is automatic only when it cannot hide Agency
 * clients or remove another active user's access. Every change is audited.
 */
export async function reconcileWorkspaceTypeFromCommercialPlan(workspaceId: string, storedType: string) {
  const [subscription, workspace] = await Promise.all([
    authoritativePlanVersion(workspaceId),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        legacyClient: { select: { plan: true } },
        _count: { select: { agencyClients: true, memberships: { where: { status: "active" } } } },
      },
    }),
  ]);
  const planCode = subscription?.planVersion.billingPlan.code ?? workspace?.legacyClient?.plan;
  let expectedType: string | null = null;
  try { expectedType = planCode ? workspaceTypeForCommercialPlan(planCode) : null; } catch { expectedType = null; }
  if (!expectedType || expectedType === storedType) return storedType;

  const blockReason = workspaceTypeReconciliationBlockReason({
    storedType,
    expectedType,
    activeMemberships: workspace?._count.memberships ?? 0,
    agencyClients: workspace?._count.agencyClients ?? 0,
  });
  if (blockReason) {
    console.warn(`[workspace] commercial type mismatch requires admin review`, { workspaceId, storedType, expectedType, planCode, blockReason });
    return storedType;
  }

  await prisma.$transaction(async (tx) => {
    const changed = await tx.workspace.updateMany({
      where: { id: workspaceId, workspaceType: storedType },
      data: { workspaceType: expectedType! },
    });
    if (!changed.count) return;
    await tx.workspaceActivity.create({
      data: {
        workspaceId,
        action: "workspace.type_aligned_to_plan",
        entityType: "workspace",
        entityId: workspaceId,
        previousJson: { workspaceType: storedType },
        nextJson: { workspaceType: expectedType, planCode },
        metadataJson: { source: "commercial_plan", automatic: true },
      },
    });
  });
  return expectedType;
}

type WorkspaceChoice = {
  id: string;
  createdAt: Date;
  joinedAt: Date | null;
  workspace: { id: string; ownerUserId: string; legacyClientId: string | null; createdAt: Date };
};

/**
 * Select the workspace that belongs to the user's current account tenant.
 *
 * A user can retain historical or invited memberships. Choosing the oldest
 * membership made a newly created Personal account open an older Agency
 * workspace. The account's legacy client link is the strongest identity signal,
 * ownership is next, and recency is only a deterministic final fallback.
 */
export function selectPreferredWorkspaceId(candidates: WorkspaceChoice[], userId: string, legacyClientId: string | null) {
  const ranked = [...candidates].sort((left, right) => {
    const leftClientMatch = Boolean(legacyClientId && left.workspace.legacyClientId === legacyClientId);
    const rightClientMatch = Boolean(legacyClientId && right.workspace.legacyClientId === legacyClientId);
    if (leftClientMatch !== rightClientMatch) return leftClientMatch ? -1 : 1;

    const leftOwned = left.workspace.ownerUserId === userId;
    const rightOwned = right.workspace.ownerUserId === userId;
    if (leftOwned !== rightOwned) return leftOwned ? -1 : 1;

    const leftActivity = left.joinedAt ?? left.createdAt ?? left.workspace.createdAt;
    const rightActivity = right.joinedAt ?? right.createdAt ?? right.workspace.createdAt;
    const recency = rightActivity.getTime() - leftActivity.getTime();
    if (recency !== 0) return recency;
    return left.workspace.id.localeCompare(right.workspace.id);
  });
  return ranked[0]?.workspace.id ?? null;
}

export async function preferredWorkspaceIdForUser(userId: string, legacyClientId: string | null) {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId, status: "active", workspace: { status: "active" } },
    select: {
      id: true,
      createdAt: true,
      joinedAt: true,
      workspace: { select: { id: true, ownerUserId: true, legacyClientId: true, createdAt: true } },
    },
  });
  return selectPreferredWorkspaceId(memberships, userId, legacyClientId);
}

export type WorkspaceContext = {
  workspace: {
    id: string; name: string; workspaceType: string; ownerUserId: string; legacyClientId: string | null;
    settingsJson: unknown; securitySettingsJson: unknown; autoApprovalPolicyJson: unknown; brandingJson?: unknown;
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
      if (normalizedType === "personal" && user.id !== owner.id) continue;
      const membership = await tx.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: user.id, status: "active", joinedAt: new Date() },
      });
      const roles = user.id === owner.id ? (normalizedType === "personal" ? ["owner"] : ["owner", "admin"]) : user.role === "client_admin" ? ["admin"] : ["viewer"];
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
  const preferredWorkspaceId = explicitWorkspaceId
    ? null
    : await preferredWorkspaceIdForUser(req.user.userId, req.user.clientId);
  let workspace = explicitWorkspaceId
    ? await prisma.workspace.findFirst({ where: { id: explicitWorkspaceId, status: "active", memberships: { some: { userId: req.user.userId, status: "active" } } } })
    : preferredWorkspaceId
      ? await prisma.workspace.findUnique({ where: { id: preferredWorkspaceId } })
      : null;

  // Browsers can retain a workspace id after local data or membership changes.
  // Use the user's active workspace instead of entering legacy bootstrap.
  if (!workspace && explicitWorkspaceId) {
    const fallbackWorkspaceId = await preferredWorkspaceIdForUser(req.user.userId, req.user.clientId);
    workspace = fallbackWorkspaceId ? await prisma.workspace.findUnique({ where: { id: fallbackWorkspaceId } }) : null;
  }

  if (!workspace) {
    if (req.user.role === "super_admin") {
      throw Object.assign(new Error("Create or join a workspace before using workspace projects."), { statusCode: 409 });
    }
    const legacyClientId = await projectClientIdForRequest(req);
    if (!legacyClientId || legacyClientId === "__no_client_scope__") throw Object.assign(new Error("Workspace context is required."), { statusCode: 400 });
    workspace = await bootstrapWorkspace(req, legacyClientId);
  }
  const reconciledWorkspaceType = await reconcileWorkspaceTypeFromCommercialPlan(workspace.id, workspace.workspaceType);
  if (reconciledWorkspaceType !== workspace.workspaceType) workspace = { ...workspace, workspaceType: reconciledWorkspaceType };
  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: req.user.userId } },
    include: { roles: { select: { role: true } } },
  });
  if (!membership || membership.status !== "active") throw Object.assign(new Error("Active workspace membership is required."), { statusCode: 403 });
  if (workspace.workspaceType === "personal" && workspace.ownerUserId !== membership.userId) throw Object.assign(new Error("Personal is a single-user Owner/Admin workspace."), { statusCode: 403 });
  const storedRoles = membership.roles.map((item) => item.role);
  if (storedRoles.includes("client_viewer") && (workspace.workspaceType !== "agency" || storedRoles.length !== 1)) throw Object.assign(new Error("Client Viewer must be an Agency-only, external-only role."), { statusCode: 403 });
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
  const canonicalRequired = required === "approver" ? "manager" : required;
  const requiredIndex = inheritedRoleOrder.indexOf(canonicalRequired);
  return [...context.roles].some((role) => {
    const canonicalRole = role === "approver" || role === "manager_approver" ? "manager" : role;
    const roleIndex = inheritedRoleOrder.indexOf(canonicalRole as WorkspaceRole);
    return roleIndex >= 0 && requiredIndex >= 0 && roleIndex <= requiredIndex;
  });
}

export function hasWorkspacePermission(context: WorkspaceContext, permission: string) {
  if (context.roles.has("owner") || context.roles.has("admin")) return true;
  const policyRoles = [...context.roles].map((role) => role === "approver" || role === "manager_approver" ? "manager" : role) as ConfigurableWorkspaceRole[];
  if (context.roles.has("client_viewer")) return policyRoles.length === 1 && workspaceRoleCanEver("client_viewer", permission) && permissionDecision(context, permission, ["client_viewer"]);
  const ceilingRoles = policyRoles.filter((role): role is ConfigurableWorkspaceRole => ["manager", "editor", "viewer"].includes(role));
  // Agency owners can delegate an exceptional permission through the explicit
  // member/role policy. Other workspace types retain the fixed role ceiling.
  if (context.workspace.workspaceType !== "agency" && !ceilingRoles.some((role) => workspaceRoleCanEver(role, permission))) return false;
  return permissionDecision(context, permission, ceilingRoles);
}

function permissionDecision(context: WorkspaceContext, permission: string, policyRoles: ConfigurableWorkspaceRole[]) {
  const overrides = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object"
    ? context.membership.permissionOverrides as { deny?: unknown; allow?: unknown }
    : {};
  const denied = Array.isArray(overrides.deny) && overrides.deny.includes(permission);
  const allowed = Array.isArray(overrides.allow) && overrides.allow.includes(permission);
  if (denied) return false;
  if (allowed) return true;
  const settings = context.workspace.settingsJson && typeof context.workspace.settingsJson === "object"
    ? context.workspace.settingsJson as { rolePermissionOverrides?: unknown }
    : {};
  const rolePolicies = settings.rolePermissionOverrides && typeof settings.rolePermissionOverrides === "object"
    ? settings.rolePermissionOverrides as Record<string, { allow?: unknown; deny?: unknown }>
    : {};
  if (policyRoles.some((role) => Array.isArray(rolePolicies[role]?.deny) && rolePolicies[role].deny.includes(permission))) return false;
  if (policyRoles.some((role) => Array.isArray(rolePolicies[role]?.allow) && rolePolicies[role].allow.includes(permission))) return true;
  const inherited = new Set<ConfigurableWorkspaceRole>();
  for (const role of policyRoles) {
    if (role === "manager") { inherited.add("manager"); inherited.add("editor"); inherited.add("viewer"); }
    else if (role === "editor") { inherited.add("editor"); inherited.add("viewer"); }
    else inherited.add(role);
  }
  return [...inherited].some((role) => workspaceRoleCanEver(role, permission) && defaultWorkspacePermission(role, permission));
}

export function effectiveWorkspaceRoles(context: WorkspaceContext): AssignableWorkspaceRole[] {
  const effective = new Set<AssignableWorkspaceRole>();
  if (context.roles.has("owner") || context.roles.has("admin")) effective.add("admin");
  if (context.roles.has("manager") || context.roles.has("approver") || context.roles.has("manager_approver")) effective.add("manager");
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
  // Personal editors are accepted for legacy single-workspace assignments even
  // though the public Personal role catalogue remains Owner/Admin only.
  const invalid = roles.filter((role) => !allowed.includes(role) && !(workspaceType === "personal" && role === "editor"));
  if (invalid.length) {
    const label = workspaceType.charAt(0).toUpperCase() + workspaceType.slice(1);
    throw Object.assign(new Error(label + " workspaces do not support: " + invalid.join(", ") + "."), { statusCode: 400 });
  }
  if (roles.includes("client_viewer") && workspaceType !== "agency") throw Object.assign(new Error("Client Viewer is Agency-only."), { statusCode: 400 });
  const completeAgencyRoleCatalogue = workspaceType === "agency"
    && assignableWorkspaceRoles.every((role) => roles.includes(role))
    && roles.length === assignableWorkspaceRoles.length;
  if (roles.includes("client_viewer") && roles.length !== 1 && !completeAgencyRoleCatalogue) throw Object.assign(new Error("Client Viewer is Agency-only and cannot be combined with an internal role."), { statusCode: 400 });
}

function seatLimit(settings: unknown) {
  const value = settings && typeof settings === "object" ? Number((settings as { seatLimit?: unknown }).seatLimit) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function workspaceSeatUsage(workspaceId: string, settings: unknown, excludeInvitationEmail?: string) {
  await ensureCommercialSeatAssignments(workspaceId);
  const now = new Date();
  const [memberships, invitations] = await Promise.all([
    prisma.workspaceMembership.findMany({ where: { workspaceId, status: "active" }, select: { roles: { select: { role: true } } } }),
    prisma.workspaceInvitation.findMany({ where: { workspaceId, status: "invited", expiresAt: { gt: now }, ...(excludeInvitationEmail ? { normalizedEmail: { not: excludeInvitationEmail } } : {}) }, select: { rolesJson: true } }),
  ]);
  const used = memberships.filter((membership) => rolesConsumeSeat(membership.roles.map((item) => item.role))).length;
  const reserved = invitations.filter((invitation) => rolesConsumeSeat(Array.isArray(invitation.rolesJson) ? invitation.rolesJson.map(String) : [])).length;
  const clientViewers = memberships.filter((membership) => { const roles = membership.roles.map((item) => item.role); return roles.length === 1 && roles[0] === "client_viewer"; }).length;
  const commercialLimit = await commercialSeatLimit(workspaceId);
  const limit = commercialLimit ?? seatLimit(settings);
  return { used, reserved, total: used + reserved, limit, available: limit == null ? null : Math.max(0, limit - used - reserved), clientViewers };
}

export async function requireAvailableSeat(context: WorkspaceContext, roles: readonly string[], options: { currentMembershipId?: string; excludeInvitationEmail?: string } = {}) {
  if (!rolesConsumeSeat(roles)) return workspaceSeatUsage(context.workspace.id, context.workspace.settingsJson, options.excludeInvitationEmail);
  const usage = await workspaceSeatUsage(context.workspace.id, context.workspace.settingsJson, options.excludeInvitationEmail);
  let additional = 1;
  if (options.currentMembershipId) {
    const current = await prisma.workspaceMembership.findFirst({ where: { id: options.currentMembershipId, workspaceId: context.workspace.id }, select: { status: true, roles: { select: { role: true } } } });
    if (current?.status === "active" && rolesConsumeSeat(current.roles.map((item) => item.role))) additional = 0;
  }
  if (usage.limit != null && usage.total + additional > usage.limit) throw Object.assign(new Error(`No paid workspace seats are available. ${usage.used} active and ${usage.reserved} invited internal seats are already allocated.`), { statusCode: 409 });
  return usage;
}

export async function workspaceApprovalMode(context: WorkspaceContext) {
  if (context.workspace.workspaceType === "personal") return "solo" as const;
  const otherApprover = await prisma.workspaceMembership.findFirst({
    where: { workspaceId: context.workspace.id, status: "active", id: { not: context.membership.id }, roles: { some: { role: { in: ["owner", "admin", "manager", "approver", "manager_approver"] } } } },
    select: { id: true },
  });
  return otherApprover ? "team" as const : "solo" as const;
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
  const recipient = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: input.context.workspace.id, userId: input.userId } }, include: { roles: { select: { role: true } } } });
  if (!recipient || recipient.status !== "active") return null;
  const recipientRoles = recipient.roles.map((item) => item.role);
  const clientViewerOnly = recipientRoles.length === 1 && recipientRoles[0] === "client_viewer";
  const clientSafeTypes = new Set(["report_sent", "approval_requested_client", "publishing_completed", "major_milestone", "performance_change", "client_feedback_requested"]);
  if (clientViewerOnly && !clientSafeTypes.has(input.type)) return null;
  if (input.projectId && !recipientRoles.some((role) => role === "owner" || role === "admin")) {
    const accessible = await tx.project.findFirst({ where: { id: input.projectId, OR: [
      { memberAssignments: { some: { membershipId: recipient.id } } },
      { teamAssignments: { some: { team: { members: { some: { membershipId: recipient.id } } } } } },
      { executionTasks: { some: { OR: [{ assigneeMembershipId: recipient.id }, { managerMembershipId: recipient.id }, { approverMembershipId: recipient.id }] } } },
      { agencyClient: { memberAssignments: { some: { membershipId: recipient.id } } } },
      { agencyClient: { teamAssignments: { some: { team: { members: { some: { membershipId: recipient.id } } } } } } },
    ] }, select: { id: true } });
    if (!accessible) return null;
  }
  const overrides = recipient.permissionOverrides && typeof recipient.permissionOverrides === "object" ? recipient.permissionOverrides as { notificationPreferences?: unknown } : {};
  const preferences = overrides.notificationPreferences && typeof overrides.notificationPreferences === "object" ? overrides.notificationPreferences as { nonCriticalEmail?: unknown; reportEmails?: unknown } : {};
  const critical = /security|integration.*(failed|disconnected)|publishing_failed|critical/.test(input.type);
  const reportNotification = /report/.test(input.type);
  const preferenceAllowsEmail = critical || (preferences.nonCriticalEmail !== false && (!reportNotification || preferences.reportEmails !== false));
  const emailEligible = input.emailEligible === false ? false : preferenceAllowsEmail;
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
      emailEligible,
      emailStatus: emailEligible ? "pending" : "disabled",
    },
  });
}
