import { Router, type Response } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "../middleware.js";
import { config } from "../config.js";
import { sendMail } from "../email.js";
import { assignableWorkspaceRoles, canAccessAgencyClient, canAccessProject, createWorkspaceNotification, effectiveWorkspaceRoles, hasWorkspacePermission, isWorkspaceOwner, managerSelfApprovalEnabled, recordWorkspaceActivity, requireWorkspaceRole, validateRolesForWorkspace, workspaceContext } from "../workspace-access.js";
import { agencyNextActions } from "../dev002.js";

export const agencyWorkspaceRouter = Router();
agencyWorkspaceRouter.use(requireAuth);

function handle(res: Response, action: () => Promise<unknown>) {
  action().then((value) => res.json(value)).catch((error: unknown) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.flatten() });
    const typed = error as { statusCode?: number; code?: string; message?: string };
    if (typed.code === "P2002") return res.status(409).json({ error: "A record with this name already exists." });
    return res.status(typed.statusCode ?? 500).json({ error: typed.message ?? "Agency Workspace request failed." });
  });
}

const clientFields = {
  name: z.string().trim().min(1).max(180),
  contactName: z.string().trim().max(180).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().trim().max(80).optional().nullable(),
  websites: z.array(z.string().url()).max(50).default([]),
  businessLocations: z.array(z.string().trim().min(1).max(255)).max(100).default([]),
  targetMarkets: z.array(z.string().trim().min(1).max(180)).max(100).default([]),
  competitors: z.array(z.string().trim().min(1).max(255)).max(100).default([]),
  brandingJson: z.record(z.unknown()).default({}),
  internalNotes: z.string().max(20000).optional().nullable(),
  clientVisibleNotes: z.string().max(20000).optional().nullable(),
  defaultSettings: z.record(z.unknown()).default({}),
};
const createClientSchema = z.object(clientFields).superRefine((data, ctx) => {
  if (!data.contactName?.trim()) ctx.addIssue({ code: "custom", path: ["contactName"], message: "Contact name is required." });
  if (!data.contactEmail) ctx.addIssue({ code: "custom", path: ["contactEmail"], message: "Email address is required." });
  if (!data.websites.length) ctx.addIssue({ code: "custom", path: ["websites"], message: "Website URL is required." });
  if (!data.businessLocations.length) ctx.addIssue({ code: "custom", path: ["businessLocations"], message: "Business location is required." });
  if (!data.targetMarkets.length) ctx.addIssue({ code: "custom", path: ["targetMarkets"], message: "At least one target market is required." });
  if (typeof data.defaultSettings.industryNiche !== "string" || !data.defaultSettings.industryNiche.trim()) ctx.addIssue({ code: "custom", path: ["defaultSettings", "industryNiche"], message: "Industry or niche is required." });
  if (typeof data.defaultSettings.primaryBusinessGoal !== "string" || !data.defaultSettings.primaryBusinessGoal.trim()) ctx.addIssue({ code: "custom", path: ["defaultSettings", "primaryBusinessGoal"], message: "Primary business goal is required." });
  for (const [key, label] of [["businessDescription", "Business description"], ["targetAudience", "Target audience"], ["mainProductsServices", "Main products or services"], ["brandVoice", "Brand voice or tone"], ["preferredLanguage", "Preferred language"], ["timeZone", "Time zone"]] as const) {
    if (typeof data.defaultSettings[key] !== "string" || !data.defaultSettings[key].trim()) ctx.addIssue({ code: "custom", path: ["defaultSettings", key], message: `${label} is required.` });
  }
});
const updateClientSchema = z.object(clientFields).partial();
const teamSchema = z.object({ name: z.string().trim().min(1).max(180), description: z.string().trim().max(5000).optional().nullable() });
const teamMembersSchema = z.object({ membershipIds: z.array(z.string()).max(500) });
const rolesSchema = z.object({ roles: z.array(z.enum(assignableWorkspaceRoles)).min(1), permissionOverrides: z.record(z.unknown()).optional() });
const membershipStatusSchema = z.object({ status: z.enum(["active", "suspended", "deactivated"]) });
const deleteMembershipSchema = z.object({ replacementMembershipId: z.string().min(1) });
const transferSchema = z.object({ newOwnerMembershipId: z.string(), confirmation: z.literal("TRANSFER OWNERSHIP") });
const deleteClientSchema = z.object({ confirmation: z.string() });
const clientAssignmentsSchema = z.object({
  membershipIds: z.array(z.string()).max(500).default([]),
  teamIds: z.array(z.string()).max(500).default([]),
});
const invitationSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().max(180).optional().nullable(),
  roles: z.array(z.enum(assignableWorkspaceRoles)).min(1),
  teamIds: z.array(z.string()).max(100).default([]),
  agencyClientIds: z.array(z.string()).max(100).default([]),
  permissionOverrides: z.record(z.unknown()).default({}),
});
const taskAssignmentSchema = z.object({
  assigneeMembershipId: z.string().optional().nullable(),
  assignedTeamId: z.string().optional().nullable(),
  managerMembershipId: z.string().optional().nullable(),
  approverMembershipId: z.string().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  approvalRisk: z.enum(["low", "medium", "high", "critical"]).optional(),
  internalNotes: z.string().max(20000).optional().nullable(),
  clientVisibleNotes: z.string().max(20000).optional().nullable(),
  dependencyTaskIds: z.array(z.string()).max(100).optional(),
});
const taskSubmitSchema = z.object({ notes: z.string().max(10000).optional().nullable() });
const taskDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  notes: z.string().max(10000).optional().nullable(),
  snapshotJson: z.record(z.unknown()).default({}),
});
const approvalPolicySchema = z.object({ allowManagerSelfApproval: z.boolean() });

const normalizeName = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g, " ");

agencyWorkspaceRouter.get(["/agency/workspace", "/workspace"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  const clientFilter = context.roles.has("owner") || context.roles.has("admin") ? {} : {
    OR: [
      { createdById: context.membership.userId },
      { memberAssignments: { some: { membershipId: context.membership.id } } },
      { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } },
    ],
  };
  const clientViewer = context.roles.has("client_viewer") && context.roles.size === 1;
  const workspaceAdmin = context.roles.has("owner") || context.roles.has("admin");
  const [clients, teams, members, invitations, notifications, activity] = await Promise.all([
    prisma.agencyClient.findMany({
      where: { workspaceId: context.workspace.id, ...clientFilter },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        projects: { orderBy: { createdAt: "desc" }, include: {
          _count: { select: { executionTasks: true, gapReportExports: true } },
          workflowSteps: { orderBy: { sortOrder: "asc" }, select: { stepKey: true, title: true, status: true, actionLabel: true, actionUrl: true, sortOrder: true } },
          strategyPlans: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true } },
        } },
        memberAssignments: { include: { membership: { include: { user: { select: { id: true, name: true, email: true } }, roles: true } } } },
        teamAssignments: { include: { team: true } },
      },
    }),
    workspaceAdmin ? prisma.workspaceTeam.findMany({ where: { workspaceId: context.workspace.id }, orderBy: { name: "asc" }, include: { members: { include: { membership: { include: { user: { select: { id: true, name: true, email: true } }, roles: true } } } }, _count: { select: { clientAssignments: true, projectAssignments: true } } } }) : Promise.resolve([]),
    workspaceAdmin ? prisma.workspaceMembership.findMany({ where: { workspaceId: context.workspace.id }, orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, email: true, isActive: true } }, roles: true, teamMemberships: { include: { team: true } } } }) : Promise.resolve([]),
    workspaceAdmin ? prisma.workspaceInvitation.findMany({ where: { workspaceId: context.workspace.id, status: "invited" }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, name: true, rolesJson: true, teamIdsJson: true, agencyClientIdsJson: true, status: true, expiresAt: true, createdAt: true } }) : Promise.resolve([]),
    prisma.workspaceNotification.findMany({ where: { workspaceId: context.workspace.id, userId: context.membership.userId, ...(clientViewer ? { type: "report_sent" } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.workspaceActivity.findMany({ where: { workspaceId: context.workspace.id, ...(clientViewer ? { agencyClientId: { in: [] } } : {}) }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { id: true, name: true, email: true } } } }),
  ]);
  const directProjectFilter: Prisma.ProjectWhereInput = context.roles.has("owner") || context.roles.has("admin") || context.workspace.workspaceType === "personal" ? {} : {
    OR: [
      { memberAssignments: { some: { membershipId: context.membership.id } } },
      { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } },
      { executionTasks: { some: { OR: [
        { assigneeMembershipId: context.membership.id },
        { managerMembershipId: context.membership.id },
        { approverMembershipId: context.membership.id },
      ] } } },
    ],
  };
  const directProjects = context.workspace.workspaceType === "agency" || !context.workspace.legacyClientId ? [] : await prisma.project.findMany({
    where: { clientId: context.workspace.legacyClientId, ...directProjectFilter },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { executionTasks: true, gapReportExports: true } },
      workflowSteps: { orderBy: { sortOrder: "asc" }, select: { stepKey: true, title: true, status: true, actionLabel: true, actionUrl: true, sortOrder: true } },
      strategyPlans: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  const visibleProjectIds = context.workspace.workspaceType === "agency" ? clients.flatMap((client) => client.projects.map((project) => project.id)) : directProjects.map((project) => project.id);
  const pendingApprovalTasks = visibleProjectIds.length ? await prisma.executionTask.findMany({
    where: { projectId: { in: visibleProjectIds }, requiresApproval: true, approvedAt: null, status: "submitted_for_approval" },
    orderBy: [{ dueAt: "asc" }, { submittedAt: "asc" }],
    select: { id: true, title: true, priority: true, submittedAt: true, dueAt: true, projectId: true, project: { select: { id: true, name: true, agencyClient: { select: { id: true, name: true } } } } },
  }) : [];
  const pendingApprovals = pendingApprovalTasks.length;
  const reportsReady = visibleProjectIds.length ? await prisma.gapReportExport.count({ where: { projectId: { in: visibleProjectIds }, approvalStatus: "approved", status: { in: ["complete", "completed", "ready"] } } }) : 0;
  const actionRows = visibleProjectIds.length ? await prisma.executionTask.findMany({
    where: { projectId: { in: visibleProjectIds } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, projectId: true, title: true, moduleName: true, priority: true, status: true, relatedUrl: true, completedAt: true, skippedAt: true, publishedAt: true, dueAt: true },
  }) : [];
  const completedStatuses = new Set(["completed", "skipped", "published"]);
  const now = new Date();
  const priorityRank: Record<string, number> = { critical: 0, urgent: 0, high: 1, medium: 2, low: 3 };
  const orderedActionRows = [...actionRows].sort((left, right) => {
    const leftOverdue = Boolean(left.dueAt && left.dueAt < now);
    const rightOverdue = Boolean(right.dueAt && right.dueAt < now);
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    const priorityDifference = (priorityRank[left.priority] ?? 2) - (priorityRank[right.priority] ?? 2);
    if (priorityDifference) return priorityDifference;
    return (left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  });
  const progressByProject = new Map<string, { total: number; completed: number; remaining: number; overdue: number }>();
  const nextTaskByProject = new Map<string, { id: string; title: string; moduleName: string; priority: string; status: string; dueAt: Date | null; href: string }>();
  for (const task of orderedActionRows) {
    if (!task.projectId) continue;
    const progress = progressByProject.get(task.projectId) ?? { total: 0, completed: 0, remaining: 0, overdue: 0 };
    const complete = Boolean(task.completedAt || task.skippedAt || task.publishedAt || completedStatuses.has(task.status));
    progress.total += 1;
    progress.completed += complete ? 1 : 0;
    progress.remaining += complete ? 0 : 1;
    progress.overdue += !complete && Boolean(task.dueAt && task.dueAt < now) ? 1 : 0;
    progressByProject.set(task.projectId, progress);
    if (!complete && !nextTaskByProject.has(task.projectId)) nextTaskByProject.set(task.projectId, {
      id: task.id, title: task.title, moduleName: task.moduleName, priority: task.priority, status: task.status,
      dueAt: task.dueAt, href: task.relatedUrl || `/guided-projects/${task.projectId}`,
    });
  }
  const projectWithProgress = <T extends {
    id: string;
    workflowSteps: { stepKey: string; title: string; status: string; actionLabel: string | null; actionUrl: string | null; sortOrder: number }[];
    strategyPlans: { status: string }[];
  }>(project: T) => {
    const { workflowSteps, strategyPlans, ...record } = project;
    const completedSteps = workflowSteps.filter((step) => ["completed", "skipped"].includes(step.status)).length;
    const nextStep = workflowSteps.find((step) => !["completed", "skipped"].includes(step.status)) ?? null;
    return {
      ...record,
      actionProgress: progressByProject.get(project.id) ?? { total: 0, completed: 0, remaining: 0, overdue: 0 },
      workflowProgress: { total: workflowSteps.length, completed: completedSteps, nextStep },
      strategyStatus: strategyPlans[0]?.status ?? "not_started",
      nextTask: nextTaskByProject.get(project.id) ?? null,
    };
  };
  const safeClients = clients.map((client) => clientViewer ? {
    id: client.id, name: client.name, status: client.status, contactName: null, contactEmail: null,
    websites: [], businessLocations: [], targetMarkets: [], competitors: [], brandingJson: {}, defaultSettings: {},
    internalNotes: null, clientVisibleNotes: null, projects: [], memberAssignments: [], teamAssignments: [],
  } : { ...client, projects: client.projects.map(projectWithProgress) });
  const projectsWithProgress = directProjects.map(projectWithProgress);
  const summary = {
    clients: clients.filter((client) => client.status === "active").length,
    activeProjects: (context.workspace.workspaceType === "agency" ? clients.flatMap((client) => client.projects) : directProjects).filter((project) => project.status === "active").length,
    pendingApprovals, overdueTasks: actionRows.filter((task) => {
      const complete = Boolean(task.completedAt || task.skippedAt || task.publishedAt || completedStatuses.has(task.status));
      return !complete && Boolean(task.dueAt && task.dueAt < now);
    }).length, reportsReady,
  };
  return {
    workspace: context.workspace,
    currentMembership: { ...context.membership, roles: effectiveWorkspaceRoles(context) },
    clients: safeClients,
    projects: projectsWithProgress,
    teams,
    members,
    invitations,
    notifications,
    activity,
    pendingApprovalTasks: clientViewer ? [] : pendingApprovalTasks,
    summary,
    nextActions: clientViewer ? [] : agencyNextActions(summary),
  };
}));

agencyWorkspaceRouter.patch(["/agency/settings/approval-policy", "/workspace/settings/approval-policy"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const policy = approvalPolicySchema.parse(req.body);
  const previous = context.workspace.autoApprovalPolicyJson && typeof context.workspace.autoApprovalPolicyJson === "object"
    ? context.workspace.autoApprovalPolicyJson as Record<string, unknown> : {};
  const next = { ...previous, ...policy };
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: context.workspace.id }, data: { autoApprovalPolicyJson: next } });
    await recordWorkspaceActivity(tx, { context, action: "workspace.approval_policy_changed", entityType: "workspace", entityId: context.workspace.id, previousJson: previous as Prisma.InputJsonValue, nextJson: next as Prisma.InputJsonValue });
  });
  return { approvalPolicy: next };
}));

agencyWorkspaceRouter.post(["/agency/invitations", "/workspace/invitations"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const data = invitationSchema.parse(req.body);
  validateRolesForWorkspace(context, data.roles);
  if (data.roles.includes("client_viewer") && !data.agencyClientIds.length) throw Object.assign(new Error("Client Viewer invitations require at least one client assignment."), { statusCode: 400 });
  const normalizedEmail = data.email.trim().toLowerCase();
  const existingMember = await prisma.workspaceMembership.findFirst({ where: { workspaceId: context.workspace.id, user: { email: normalizedEmail } } });
  if (existingMember) throw Object.assign(new Error("This person is already a workspace member."), { statusCode: 409 });
  const validTeams = data.teamIds.length ? await prisma.workspaceTeam.findMany({ where: { id: { in: [...new Set(data.teamIds)] }, workspaceId: context.workspace.id, isActive: true }, select: { id: true } }) : [];
  if (validTeams.length !== new Set(data.teamIds).size) throw Object.assign(new Error("Invitation teams must belong to this workspace."), { statusCode: 400 });
  const validClients = data.agencyClientIds.length ? await prisma.agencyClient.findMany({ where: { id: { in: [...new Set(data.agencyClientIds)] }, workspaceId: context.workspace.id, status: "active" }, select: { id: true } }) : [];
  if (validClients.length !== new Set(data.agencyClientIds).size) throw Object.assign(new Error("Invitation clients must belong to this workspace."), { statusCode: 400 });
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(`${token}.${config.jwtSecret}`).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.workspaceInvitation.updateMany({ where: { workspaceId: context.workspace.id, normalizedEmail, status: "invited" }, data: { status: "revoked", revokedAt: new Date() } });
    const created = await tx.workspaceInvitation.create({ data: {
      workspaceId: context.workspace.id, email: data.email.trim(), normalizedEmail, name: data.name,
      rolesJson: data.roles, teamIdsJson: data.teamIds, agencyClientIdsJson: data.agencyClientIds, permissionOverrides: data.permissionOverrides as Prisma.InputJsonValue,
      tokenHash, invitedByUserId: context.membership.userId, expiresAt,
    } });
    await recordWorkspaceActivity(tx, { context, action: "membership.invited", entityType: "workspace_invitation", entityId: created.id, nextJson: { email: normalizedEmail, roles: data.roles, teamIds: data.teamIds, agencyClientIds: data.agencyClientIds } });
    return created;
  });
  const link = `${config.webAppUrl.replace(/\/$/, "")}/accept-invitation?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: invitation.email,
    subject: `Join ${context.workspace.name} on SEnuke AI`,
    text: `You were invited to ${context.workspace.name}. Accept the invitation: ${link}. This link expires in 7 days.`,
    html: `<p>You were invited to <strong>${context.workspace.name}</strong>.</p><p><a href="${link}">Accept workspace invitation</a></p><p>This secure link expires in 7 days.</p>`,
  });
  return { invitation: { id: invitation.id, email: invitation.email, status: invitation.status, expiresAt } };
}));

agencyWorkspaceRouter.post(["/agency/invitations/:invitationId/revoke", "/workspace/invitations/:invitationId/revoke"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const invitation = await prisma.workspaceInvitation.findFirst({ where: { id: req.params.invitationId, workspaceId: context.workspace.id, status: "invited" } });
  if (!invitation) throw Object.assign(new Error("Invitation not found."), { statusCode: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.workspaceInvitation.update({ where: { id: invitation.id }, data: { status: "revoked", revokedAt: new Date() } });
    await recordWorkspaceActivity(tx, { context, action: "membership.invitation_revoked", entityType: "workspace_invitation", entityId: invitation.id, previousJson: { status: invitation.status }, nextJson: { status: "revoked" } });
  });
  return { revoked: true };
}));

agencyWorkspaceRouter.put("/agency/clients/:clientId/assignments", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const data = clientAssignmentsSchema.parse(req.body);
  const client = await prisma.agencyClient.findFirst({ where: { id: req.params.clientId, workspaceId: context.workspace.id } });
  if (!client) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
  const membershipIds = [...new Set(data.membershipIds)];
  const teamIds = [...new Set(data.teamIds)];
  const [members, teams] = await Promise.all([
    membershipIds.length ? prisma.workspaceMembership.findMany({ where: { id: { in: membershipIds }, workspaceId: context.workspace.id, status: "active" }, select: { id: true } }) : Promise.resolve([]),
    teamIds.length ? prisma.workspaceTeam.findMany({ where: { id: { in: teamIds }, workspaceId: context.workspace.id, isActive: true }, select: { id: true } }) : Promise.resolve([]),
  ]);
  if (members.length !== membershipIds.length || teams.length !== teamIds.length) throw Object.assign(new Error("Assignments must belong to this workspace."), { statusCode: 400 });
  return prisma.$transaction(async (tx) => {
    await tx.agencyClientMember.deleteMany({ where: { agencyClientId: client.id } });
    await tx.agencyClientTeam.deleteMany({ where: { agencyClientId: client.id } });
    if (members.length) await tx.agencyClientMember.createMany({ data: members.map((member) => ({ agencyClientId: client.id, membershipId: member.id })) });
    if (teams.length) await tx.agencyClientTeam.createMany({ data: teams.map((team) => ({ agencyClientId: client.id, teamId: team.id })) });
    await recordWorkspaceActivity(tx, { context, action: "client.assignments_changed", entityType: "agency_client", entityId: client.id, agencyClientId: client.id, nextJson: { membershipIds, teamIds } });
    return { updated: true };
  });
}));

agencyWorkspaceRouter.get("/agency/clients/:clientId/dashboard", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  if (!await canAccessAgencyClient(context, req.params.clientId)) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  const client = await prisma.agencyClient.findFirst({
    where: { id: req.params.clientId, workspaceId: context.workspace.id },
    include: { teamAssignments: { include: { team: { select: { id: true, name: true } } } } },
  });
  if (!client) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
  const projects = await prisma.project.findMany({
    where: { agencyClientId: client.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, projectType: true, status: true, currentStep: true, primaryGoal: true, websiteUrl: true, createdAt: true },
  });
  const projectIds = projects.map((project) => project.id);
  const [tasks, reports, activity] = await Promise.all([
    prisma.executionTask.findMany({
      where: { projectId: { in: projectIds }, ...(clientViewer ? { clientVisibleNotes: { not: null }, status: { in: ["submitted_for_approval", "ready_to_publish", "published", "completed"] } } : {}) },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }], take: 200,
      select: { id: true, projectId: true, title: true, status: true, priority: true, dueAt: true, approvalRisk: true, clientApprovalRequired: true, clientApprovedAt: true, clientVisibleNotes: true, requiresApproval: true, approvedAt: true },
    }),
    prisma.gapReportExport.findMany({
      where: { projectId: { in: projectIds }, ...(clientViewer ? { clientVisible: true, approvalStatus: "approved", sentToClientAt: { not: null } } : {}) },
      orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, projectId: true, reportType: true, clientName: true, approvalStatus: true, exportFormat: true, status: true, clientVisible: true, sentToClientAt: true, contentJson: true, createdAt: true },
    }),
    prisma.workspaceActivity.findMany({
      where: { workspaceId: context.workspace.id, agencyClientId: client.id, ...(clientViewer ? { action: { in: ["report.sent_to_client", "publishing.completed", "approval.client_approved", "approval.client_changes_requested"] } } : {}) },
      orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true, email: true } } },
    }),
  ]);
  const memberAssignments = clientViewer ? [] : await prisma.agencyClientMember.findMany({
    where: { agencyClientId: client.id },
    include: { membership: { include: { user: { select: { id: true, name: true, email: true } }, roles: true } } },
  });
  return {
    client: clientViewer
      ? { id: client.id, name: client.name, status: client.status, contactName: null, contactEmail: null, targetMarkets: [], clientVisibleNotes: null, internalNotes: null, teamAssignments: [], memberAssignments: [] }
      : { ...client, memberAssignments },
    projects: clientViewer ? [] : projects, tasks, reports, activity,
    permissions: { clientViewer, canManage: !clientViewer && (context.roles.has("owner") || context.roles.has("admin") || context.roles.has("manager")) },
  };
}));

agencyWorkspaceRouter.get("/agency/projects/:projectId/dashboard", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  if (context.roles.has("client_viewer")) throw Object.assign(new Error("Project operations are internal workspace resources."), { statusCode: 403 });
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, agencyClient: { workspaceId: context.workspace.id } },
    include: {
      agencyClient: { select: { id: true, name: true } },
      memberAssignments: { include: { membership: { include: { user: { select: { id: true, name: true, email: true } }, roles: true } } } },
      teamAssignments: { include: { team: true } },
    },
  });
  if (!project?.agencyClientId || !await canAccessProject(context, project.id)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const [tasks, members, teams, activity, reports] = await Promise.all([
    prisma.executionTask.findMany({
      where: { projectId: project.id },
      orderBy: [{ dueAt: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
      include: {
        assignee: { include: { user: { select: { id: true, name: true, email: true } } } },
        manager: { include: { user: { select: { id: true, name: true, email: true } } } },
        approver: { include: { user: { select: { id: true, name: true, email: true } } } },
        assignedTeam: { select: { id: true, name: true } },
        dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } },
        approvalHistory: { orderBy: { createdAt: "desc" }, take: 10 },
      },
      take: 300,
    }),
    prisma.workspaceMembership.findMany({ where: { workspaceId: context.workspace.id, status: "active" }, orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, email: true } }, roles: true } }),
    prisma.workspaceTeam.findMany({ where: { workspaceId: context.workspace.id, isActive: true }, orderBy: { name: "asc" } }),
    prisma.workspaceActivity.findMany({ where: { workspaceId: context.workspace.id, projectId: project.id }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true, email: true } } } }),
    prisma.gapReportExport.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return {
    project, tasks, members, teams, activity, reports,
    permissions: {
      canAssignProjects: context.roles.has("owner") || context.roles.has("admin"),
      canAssignTasks: hasWorkspacePermission(context, "assign_tasks") || hasWorkspacePermission(context, "manage_projects"),
      canApprove: hasWorkspacePermission(context, "approve"),
      canPublish: hasWorkspacePermission(context, "publish"),
      canSubmit: hasWorkspacePermission(context, "submit_for_approval"),
    },
  };
}));

agencyWorkspaceRouter.put("/agency/projects/:projectId/assignments", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const data = clientAssignmentsSchema.parse(req.body);
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, agencyClient: { workspaceId: context.workspace.id } } });
  if (!project) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const membershipIds = [...new Set(data.membershipIds)];
  const teamIds = [...new Set(data.teamIds)];
  const [members, teams] = await Promise.all([
    membershipIds.length ? prisma.workspaceMembership.findMany({ where: { id: { in: membershipIds }, workspaceId: context.workspace.id, status: "active" }, select: { id: true } }) : Promise.resolve([]),
    teamIds.length ? prisma.workspaceTeam.findMany({ where: { id: { in: teamIds }, workspaceId: context.workspace.id, isActive: true }, select: { id: true } }) : Promise.resolve([]),
  ]);
  if (members.length !== membershipIds.length || teams.length !== teamIds.length) throw Object.assign(new Error("Assignments must belong to this workspace."), { statusCode: 400 });
  return prisma.$transaction(async (tx) => {
    await tx.projectMemberAssignment.deleteMany({ where: { projectId: project.id } });
    await tx.projectTeamAssignment.deleteMany({ where: { projectId: project.id } });
    if (members.length) await tx.projectMemberAssignment.createMany({ data: members.map((member) => ({ projectId: project.id, membershipId: member.id, assignmentRole: "contributor" })) });
    if (teams.length) await tx.projectTeamAssignment.createMany({ data: teams.map((team) => ({ projectId: project.id, teamId: team.id })) });
    await recordWorkspaceActivity(tx, { context, action: "project.assignments_changed", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { membershipIds, teamIds } });
    return { updated: true };
  });
}));

agencyWorkspaceRouter.post("/agency/reports/:reportId/send-to-client", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "manage_reports") && !context.roles.has("manager")) throw Object.assign(new Error("Report delivery requires Manager, Admin, or Owner authority."), { statusCode: 403 });
  const report = await prisma.gapReportExport.findFirst({
    where: { id: req.params.reportId, project: { agencyClient: { workspaceId: context.workspace.id } } },
    include: { project: { include: { agencyClient: true } } },
  });
  const agencyClient = report?.project.agencyClient;
  if (!report || !agencyClient || !await canAccessAgencyClient(context, agencyClient.id)) throw Object.assign(new Error("Report not found."), { statusCode: 404 });
  if (report.approvalStatus !== "approved") throw Object.assign(new Error("Only approved reports can be sent to a client."), { statusCode: 409 });
  const clientViewers = await prisma.agencyClientMember.findMany({
    where: { agencyClientId: agencyClient.id, membership: { status: "active", roles: { some: { role: "client_viewer" } } } },
    include: { membership: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.gapReportExport.update({ where: { id: report.id }, data: { clientVisible: true, sentToClientAt: new Date(), sentByUserId: context.membership.userId } });
    await recordWorkspaceActivity(tx, { context, action: "report.sent_to_client", entityType: "gap_report_export", entityId: report.id, agencyClientId: agencyClient.id, projectId: report.projectId, nextJson: { recipients: clientViewers.map((item) => item.membership.user.email) } });
    for (const viewer of clientViewers) await createWorkspaceNotification(tx, { context, userId: viewer.membership.user.id, type: "report_sent", title: "New client report", body: `${report.reportType.replace(/_/g, " ")} is ready to view.`, actionUrl: `/agency/clients/${agencyClient.id}`, agencyClientId: agencyClient.id, projectId: report.projectId });
    return next;
  });
  for (const viewer of clientViewers) await sendMail({
    to: viewer.membership.user.email,
    subject: `New report from ${context.workspace.name}`,
    text: `Your ${report.reportType.replace(/_/g, " ")} is ready in SEnuke AI.`,
    html: `<p>Your <strong>${report.reportType.replace(/_/g, " ")}</strong> is ready in SEnuke AI.</p>`,
  });
  return { report: updated, recipients: clientViewers.length };
}));

agencyWorkspaceRouter.post("/agency/clients", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin", "manager");
  if (context.workspace.workspaceType !== "agency") throw Object.assign(new Error("Client management is available only in Agency workspaces."), { statusCode: 400 });
  const data = createClientSchema.parse(req.body);
  const normalizedName = normalizeName(data.name);
  const duplicate = await prisma.agencyClient.findUnique({ where: { workspaceId_normalizedName: { workspaceId: context.workspace.id, normalizedName } } });
  if (duplicate) throw Object.assign(new Error("A client with this name already exists."), { statusCode: 409 });
  return prisma.$transaction(async (tx) => {
    const client = await tx.agencyClient.create({ data: {
      workspaceId: context.workspace.id, createdById: context.membership.userId, normalizedName,
      name: data.name, contactName: data.contactName, contactEmail: data.contactEmail, contactPhone: data.contactPhone,
      websites: data.websites, businessLocations: data.businessLocations, targetMarkets: data.targetMarkets, competitors: data.competitors,
      brandingJson: data.brandingJson as Prisma.InputJsonValue, internalNotes: data.internalNotes,
      clientVisibleNotes: data.clientVisibleNotes, defaultSettings: data.defaultSettings as Prisma.InputJsonValue,
    } });
    if (!context.roles.has("owner") && !context.roles.has("admin")) {
      await tx.agencyClientMember.create({
        data: { agencyClientId: client.id, membershipId: context.membership.id, assignmentRole: "manager" },
      });
    }
    await recordWorkspaceActivity(tx, { context, action: "client.created", entityType: "agency_client", entityId: client.id, agencyClientId: client.id, nextJson: { name: client.name, status: client.status } });
    await createWorkspaceNotification(tx, { context, userId: context.membership.userId, type: "client_created", title: "Client created", body: `${client.name} was added to the workspace.`, actionUrl: `/agency/clients/${client.id}`, agencyClientId: client.id, emailEligible: false });
    return { client };
  });
}));

agencyWorkspaceRouter.patch("/agency/clients/:clientId", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin", "manager");
  if (!await canAccessAgencyClient(context, req.params.clientId)) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
  const data = updateClientSchema.parse(req.body);
  const previous = await prisma.agencyClient.findFirst({ where: { id: req.params.clientId, workspaceId: context.workspace.id } });
  if (!previous) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
  return prisma.$transaction(async (tx) => {
    const client = await tx.agencyClient.update({ where: { id: previous.id }, data: {
      ...data, brandingJson: data.brandingJson as Prisma.InputJsonValue | undefined,
      defaultSettings: data.defaultSettings as Prisma.InputJsonValue | undefined,
      ...(data.name ? { normalizedName: normalizeName(data.name) } : {}),
    } });
    await recordWorkspaceActivity(tx, { context, action: "client.updated", entityType: "agency_client", entityId: client.id, agencyClientId: client.id, previousJson: { name: previous.name }, nextJson: { name: client.name } });
    return { client };
  });
}));

for (const action of ["archive", "restore"] as const) {
  agencyWorkspaceRouter.post(`/agency/clients/:clientId/${action}`, (req, res) => handle(res, async () => {
    const context = await workspaceContext(req);
    requireWorkspaceRole(context, "owner", "admin");
    const client = await prisma.agencyClient.findFirst({ where: { id: req.params.clientId, workspaceId: context.workspace.id } });
    if (!client) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
    const status = action === "archive" ? "archived" : "active";
    return prisma.$transaction(async (tx) => {
      const updated = await tx.agencyClient.update({ where: { id: client.id }, data: { status, archivedAt: action === "archive" ? new Date() : null, archivedById: action === "archive" ? context.membership.userId : null } });
      await tx.project.updateMany({ where: { agencyClientId: client.id }, data: { status, archivedAt: action === "archive" ? new Date() : null, archivedById: action === "archive" ? context.membership.userId : null } });
      await recordWorkspaceActivity(tx, { context, action: `client.${action}d`, entityType: "agency_client", entityId: client.id, agencyClientId: client.id, previousJson: { status: client.status }, nextJson: { status } });
      return { client: updated };
    });
  }));
}

agencyWorkspaceRouter.delete("/agency/clients/:clientId", (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const body = deleteClientSchema.parse(req.body);
  const client = await prisma.agencyClient.findFirst({ where: { id: req.params.clientId, workspaceId: context.workspace.id } });
  if (!client) throw Object.assign(new Error("Client not found."), { statusCode: 404 });
  if (client.status !== "archived") throw Object.assign(new Error("Archive the client before permanently deleting it."), { statusCode: 409 });
  if (body.confirmation !== client.name) throw Object.assign(new Error("Type the exact client name to confirm permanent deletion."), { statusCode: 400 });
  await prisma.$transaction(async (tx) => {
    await recordWorkspaceActivity(tx, { context, action: "client.permanently_deleted", entityType: "agency_client", entityId: client.id, metadataJson: { deletedName: client.name } });
    await tx.agencyClient.delete({ where: { id: client.id } });
  });
  return { deleted: true };
}));

agencyWorkspaceRouter.post(["/agency/teams", "/workspace/teams"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const data = teamSchema.parse(req.body);
  return prisma.$transaction(async (tx) => {
    const team = await tx.workspaceTeam.create({ data: { workspaceId: context.workspace.id, name: data.name, description: data.description } });
    await recordWorkspaceActivity(tx, { context, action: "team.created", entityType: "team", entityId: team.id, nextJson: { name: team.name } });
    return { team };
  });
}));

agencyWorkspaceRouter.put(["/agency/teams/:teamId/members", "/workspace/teams/:teamId/members"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const { membershipIds } = teamMembersSchema.parse(req.body);
  const team = await prisma.workspaceTeam.findFirst({ where: { id: req.params.teamId, workspaceId: context.workspace.id } });
  if (!team) throw Object.assign(new Error("Team not found."), { statusCode: 404 });
  const validCount = await prisma.workspaceMembership.count({ where: { id: { in: membershipIds }, workspaceId: context.workspace.id, status: "active" } });
  if (validCount !== new Set(membershipIds).size) throw Object.assign(new Error("Every team member must be an active workspace member."), { statusCode: 400 });
  return prisma.$transaction(async (tx) => {
    await tx.workspaceTeamMember.deleteMany({ where: { teamId: team.id } });
    await tx.workspaceTeamMember.createMany({ data: [...new Set(membershipIds)].map((membershipId) => ({ teamId: team.id, membershipId })) });
    await recordWorkspaceActivity(tx, { context, action: "team.members_changed", entityType: "team", entityId: team.id, nextJson: { membershipIds } });
    for (const membershipId of membershipIds) {
      const member = await tx.workspaceMembership.findUnique({ where: { id: membershipId }, select: { userId: true } });
      if (member) await createWorkspaceNotification(tx, { context, userId: member.userId, type: "team_assignment", title: "Team assignment", body: `You were assigned to ${team.name}.`, actionUrl: "/workspace?tab=teams", emailEligible: true });
    }
    return { updated: true };
  });
}));

agencyWorkspaceRouter.patch(["/agency/members/:membershipId/status", "/workspace/members/:membershipId/status"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const data = membershipStatusSchema.parse(req.body);
  const target = await prisma.workspaceMembership.findFirst({ where: { id: req.params.membershipId, workspaceId: context.workspace.id }, include: { user: { select: { id: true } } } });
  if (!target) throw Object.assign(new Error("Member not found."), { statusCode: 404 });
  if (target.userId === context.workspace.ownerUserId) throw Object.assign(new Error("The Workspace Owner cannot be suspended or deactivated."), { statusCode: 409 });
  if (target.id === context.membership.id && data.status !== "active") throw Object.assign(new Error("You cannot suspend or deactivate your own membership."), { statusCode: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.workspaceMembership.update({ where: { id: target.id }, data: {
      status: data.status, suspendedAt: data.status === "suspended" ? new Date() : null,
      deactivatedAt: data.status === "deactivated" ? new Date() : null,
    } });
    await recordWorkspaceActivity(tx, { context, action: "membership.status_changed", entityType: "workspace_membership", entityId: target.id, previousJson: { status: target.status }, nextJson: { status: data.status } });
    await createWorkspaceNotification(tx, { context, userId: target.userId, type: "membership_status_changed", title: "Workspace membership updated", body: "Your workspace membership is now " + data.status + ".", actionUrl: "/workspace" });
  });
  return { updated: true, status: data.status };
}));

agencyWorkspaceRouter.delete(["/agency/members/:membershipId", "/workspace/members/:membershipId"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const data = deleteMembershipSchema.parse(req.body);
  const target = await prisma.workspaceMembership.findFirst({
    where: { id: req.params.membershipId, workspaceId: context.workspace.id },
    include: { user: { select: { id: true, name: true, email: true } }, projectAssignments: true, clientAssignments: true, teamMemberships: true },
  });
  if (!target) throw Object.assign(new Error("Member not found."), { statusCode: 404 });
  if (target.userId === context.workspace.ownerUserId) throw Object.assign(new Error("Transfer workspace ownership before deleting the Primary Owner."), { statusCode: 409 });
  if (target.id === context.membership.id) throw Object.assign(new Error("You cannot delete your own workspace membership."), { statusCode: 409 });
  if (target.status === "active") throw Object.assign(new Error("Suspend the user before permanently removing them."), { statusCode: 409 });
  const replacement = await prisma.workspaceMembership.findFirst({
    where: { id: data.replacementMembershipId, workspaceId: context.workspace.id, status: "active", NOT: { id: target.id } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!replacement) throw Object.assign(new Error("Select an active replacement user from this workspace."), { statusCode: 400 });
  return prisma.$transaction(async (tx) => {
    if (target.projectAssignments.length) await tx.projectMemberAssignment.createMany({ data: target.projectAssignments.map((item) => ({ projectId: item.projectId, membershipId: replacement.id, assignmentRole: item.assignmentRole })), skipDuplicates: true });
    if (target.clientAssignments.length) await tx.agencyClientMember.createMany({ data: target.clientAssignments.map((item) => ({ agencyClientId: item.agencyClientId, membershipId: replacement.id, assignmentRole: item.assignmentRole })), skipDuplicates: true });
    if (target.teamMemberships.length) await tx.workspaceTeamMember.createMany({ data: target.teamMemberships.map((item) => ({ teamId: item.teamId, membershipId: replacement.id })), skipDuplicates: true });
    await tx.executionTask.updateMany({ where: { assigneeMembershipId: target.id }, data: { assigneeMembershipId: replacement.id } });
    await tx.executionTask.updateMany({ where: { managerMembershipId: target.id }, data: { managerMembershipId: replacement.id } });
    await tx.executionTask.updateMany({ where: { approverMembershipId: target.id }, data: { approverMembershipId: replacement.id } });
    await tx.workspaceMembership.delete({ where: { id: target.id } });
    await recordWorkspaceActivity(tx, { context, action: "membership.deleted_and_reassigned", entityType: "workspace_membership", entityId: target.id, previousJson: { userId: target.userId, email: target.user.email }, nextJson: { replacementMembershipId: replacement.id, replacementUserId: replacement.userId } });
    await createWorkspaceNotification(tx, { context, userId: replacement.userId, type: "work_reassigned", title: "Work reassigned", body: `${target.user.name || target.user.email}'s client, project, team, and task assignments were transferred to you.`, actionUrl: "/workspace?tab=teams" });
    return { deleted: true, replacementMembershipId: replacement.id };
  });
}));

agencyWorkspaceRouter.patch(["/agency/members/:membershipId/roles", "/workspace/members/:membershipId/roles"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin");
  const data = rolesSchema.parse(req.body);
  validateRolesForWorkspace(context, data.roles);
  const target = await prisma.workspaceMembership.findFirst({ where: { id: req.params.membershipId, workspaceId: context.workspace.id }, include: { roles: true } });
  if (!target) throw Object.assign(new Error("Member not found."), { statusCode: 404 });
  if (target.userId === context.workspace.ownerUserId && !data.roles.includes("admin")) throw Object.assign(new Error("The Primary Owner cannot lose Owner/Admin authority during normal role editing."), { statusCode: 409 });
  const storedRoles = target.userId === context.workspace.ownerUserId ? ["owner", ...data.roles] : data.roles;
  return prisma.$transaction(async (tx) => {
    await tx.workspaceMemberRole.deleteMany({ where: { membershipId: target.id } });
    await tx.workspaceMemberRole.createMany({ data: [...new Set(storedRoles)].map((role) => ({ membershipId: target.id, role, grantedById: context.membership.userId })) });
    await tx.workspaceMembership.update({ where: { id: target.id }, data: { permissionOverrides: data.permissionOverrides as Prisma.InputJsonValue | undefined } });
    await recordWorkspaceActivity(tx, { context, action: "membership.roles_changed", entityType: "workspace_membership", entityId: target.id, previousJson: { roles: target.roles.map((role) => role.role) }, nextJson: { roles: data.roles } });
    await createWorkspaceNotification(tx, { context, userId: target.userId, type: "role_changed", title: "Workspace roles updated", body: `Your roles are now: ${data.roles.join(", ")}.`, actionUrl: "/workspace?tab=teams" });
    return { updated: true };
  });
}));

agencyWorkspaceRouter.post(["/agency/ownership/transfer", "/workspace/ownership/transfer"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  if (!isWorkspaceOwner(context)) throw Object.assign(new Error("Only the current Workspace Owner can transfer ownership."), { statusCode: 403 });
  const data = transferSchema.parse(req.body);
  const nextOwner = await prisma.workspaceMembership.findFirst({ where: { id: data.newOwnerMembershipId, workspaceId: context.workspace.id, status: "active" } });
  if (!nextOwner) throw Object.assign(new Error("The new owner must be an active workspace member."), { statusCode: 400 });
  if (nextOwner.userId === context.membership.userId) throw Object.assign(new Error("This member already owns the workspace."), { statusCode: 400 });
  return prisma.$transaction(async (tx) => {
    await tx.workspaceMemberRole.upsert({ where: { membershipId_role: { membershipId: nextOwner.id, role: "owner" } }, create: { membershipId: nextOwner.id, role: "owner", grantedById: context.membership.userId }, update: {} });
    if (context.workspace.workspaceType !== "personal") await tx.workspaceMemberRole.upsert({ where: { membershipId_role: { membershipId: nextOwner.id, role: "admin" } }, create: { membershipId: nextOwner.id, role: "admin", grantedById: context.membership.userId }, update: {} });
    await tx.workspace.update({ where: { id: context.workspace.id }, data: { ownerUserId: nextOwner.userId } });
    await tx.workspaceMemberRole.deleteMany({ where: { membershipId: context.membership.id, role: "owner" } });
    await recordWorkspaceActivity(tx, { context, action: "workspace.ownership_transferred", entityType: "workspace", entityId: context.workspace.id, previousJson: { ownerUserId: context.membership.userId }, nextJson: { ownerUserId: nextOwner.userId } });
    await createWorkspaceNotification(tx, { context, userId: nextOwner.userId, type: "ownership_transferred", title: "Workspace ownership transferred", body: `You are now the Owner of ${context.workspace.name}.`, actionUrl: "/workspace?tab=teams" });
    if (context.workspace.workspaceType === "personal") await tx.workspaceMemberRole.upsert({ where: { membershipId_role: { membershipId: context.membership.id, role: "editor" } }, create: { membershipId: context.membership.id, role: "editor", grantedById: nextOwner.userId }, update: {} });
    return { ownerUserId: nextOwner.userId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}));

agencyWorkspaceRouter.patch(["/agency/notifications/:notificationId/read", "/workspace/notifications/:notificationId/read"], (req, res) => handle(res, async () => {
  const context = await workspaceContext(req);
  const result = await prisma.workspaceNotification.updateMany({ where: { id: req.params.notificationId, workspaceId: context.workspace.id, userId: context.membership.userId }, data: { readAt: new Date() } });
  if (!result.count) throw Object.assign(new Error("Notification not found."), { statusCode: 404 });
  return { updated: true };
}));

async function scopedAgencyTask(req: Parameters<typeof workspaceContext>[0], taskId: string) {
  const context = await workspaceContext(req);
  const task = await prisma.executionTask.findFirst({
    where: { id: taskId, project: { agencyClient: { workspaceId: context.workspace.id } } },
    include: {
      project: { include: { agencyClient: true } },
      assignee: { include: { user: { select: { id: true, name: true, email: true } } } },
      manager: { include: { user: { select: { id: true, name: true, email: true } } } },
      approver: { include: { user: { select: { id: true, name: true, email: true } } } },
      dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } },
      approvalHistory: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  const directTaskAccess = task && [task.assigneeMembershipId, task.managerMembershipId, task.approverMembershipId].includes(context.membership.id);
  if (!task?.project?.agencyClientId || (!directTaskAccess && !await canAccessProject(context, task.project.id))) {
    throw Object.assign(new Error("Task not found."), { statusCode: 404 });
  }
  return { context, task };
}

agencyWorkspaceRouter.patch("/agency/tasks/:taskId/assignment", (req, res) => handle(res, async () => {
  const { context, task } = await scopedAgencyTask(req, req.params.taskId);
  if (!hasWorkspacePermission(context, "assign_tasks") && !hasWorkspacePermission(context, "manage_projects")) {
    throw Object.assign(new Error("Task assignment requires Manager or Admin authority."), { statusCode: 403 });
  }
  const data = taskAssignmentSchema.parse(req.body);
  const membershipIds = [...new Set([data.assigneeMembershipId, data.managerMembershipId, data.approverMembershipId].filter((id): id is string => Boolean(id)))];
  const members = membershipIds.length ? await prisma.workspaceMembership.findMany({
    where: { id: { in: membershipIds }, workspaceId: context.workspace.id, status: "active" },
    select: { id: true, userId: true },
  }) : [];
  if (members.length !== membershipIds.length) throw Object.assign(new Error("Every assignee must be an active workspace member."), { statusCode: 400 });
  if (data.assignedTeamId) {
    const team = await prisma.workspaceTeam.findFirst({ where: { id: data.assignedTeamId, workspaceId: context.workspace.id, isActive: true } });
    if (!team) throw Object.assign(new Error("Assigned team must belong to this workspace."), { statusCode: 400 });
  }
  if (data.dependencyTaskIds?.includes(task.id)) throw Object.assign(new Error("A task cannot depend on itself."), { statusCode: 400 });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.executionTask.update({
      where: { id: task.id },
      data: {
        assigneeMembershipId: data.assigneeMembershipId,
        assignedTeamId: data.assignedTeamId,
        managerMembershipId: data.managerMembershipId,
        approverMembershipId: data.approverMembershipId,
        dueAt: data.dueAt ? new Date(data.dueAt) : data.dueAt,
        approvalRisk: data.approvalRisk,
        internalNotes: data.internalNotes,
        clientVisibleNotes: data.clientVisibleNotes,
      },
    });
    if (data.dependencyTaskIds) {
      const validDependencies = await tx.executionTask.findMany({
        where: { id: { in: [...new Set(data.dependencyTaskIds)] }, projectId: task.projectId },
        select: { id: true },
      });
      if (validDependencies.length !== new Set(data.dependencyTaskIds).size) throw Object.assign(new Error("Dependencies must belong to the same project."), { statusCode: 400 });
      await tx.executionTaskDependency.deleteMany({ where: { taskId: task.id } });
      await tx.executionTaskDependency.createMany({ data: validDependencies.map((dependency) => ({ taskId: task.id, requiredTaskId: dependency.id })) });
    }
    await recordWorkspaceActivity(tx, {
      context, action: "task.assignment_changed", entityType: "execution_task", entityId: task.id,
      agencyClientId: task.project!.agencyClientId, projectId: task.projectId,
      previousJson: { assigneeMembershipId: task.assigneeMembershipId, managerMembershipId: task.managerMembershipId, approverMembershipId: task.approverMembershipId },
      nextJson: { assigneeMembershipId: data.assigneeMembershipId, managerMembershipId: data.managerMembershipId, approverMembershipId: data.approverMembershipId, assignedTeamId: data.assignedTeamId, dueAt: data.dueAt },
    });
    for (const member of members) {
      await createWorkspaceNotification(tx, {
        context, userId: member.userId, type: "task_assignment", title: "Task assignment updated",
        body: `You were assigned to ${task.title}.`, actionUrl: task.relatedUrl ?? `/guided-projects/${task.projectId}`,
        agencyClientId: task.project!.agencyClientId, projectId: task.projectId,
      });
    }
    return { task: updated };
  });
}));

agencyWorkspaceRouter.post("/agency/tasks/:taskId/submit", (req, res) => handle(res, async () => {
  const { context, task } = await scopedAgencyTask(req, req.params.taskId);
  if (!hasWorkspacePermission(context, "submit_for_approval")) throw Object.assign(new Error("Editor authority is required to submit work."), { statusCode: 403 });
  if (task.assigneeMembershipId && task.assigneeMembershipId !== context.membership.id && !context.roles.has("owner") && !context.roles.has("admin")) {
    throw Object.assign(new Error("Only the assigned Editor can submit this task."), { statusCode: 403 });
  }
  if (!["draft", "in_progress", "changes_requested", "needs_review", "ready"].includes(task.status)) {
    throw Object.assign(new Error("This task cannot be submitted from its current status."), { statusCode: 409 });
  }
  const body = taskSubmitSchema.parse(req.body);
  const blocked = task.dependencies.filter((dependency) => !["completed", "published", "approved"].includes(dependency.requiredTask.status));
  if (blocked.length) throw Object.assign(new Error(`Complete dependencies first: ${blocked.map((dependency) => dependency.requiredTask.title).join(", ")}`), { statusCode: 409 });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: { status: "submitted_for_approval", submittedAt: new Date(), approvalDecision: null, approvalNotes: body.notes } });
    await recordWorkspaceActivity(tx, { context, action: "approval.requested", entityType: "execution_task", entityId: task.id, agencyClientId: task.project!.agencyClientId, projectId: task.projectId, nextJson: { status: "submitted_for_approval" } });
    if (task.approver?.userId) await createWorkspaceNotification(tx, {
      context, userId: task.approver.userId, type: "approval_requested", title: "Approval requested",
      body: `${task.title} is ready for your review.`, actionUrl: task.relatedUrl ?? `/guided-projects/${task.projectId}`,
      agencyClientId: task.project!.agencyClientId, projectId: task.projectId,
    });
    return { task: updated };
  });
}));

agencyWorkspaceRouter.post("/agency/tasks/:taskId/decision", (req, res) => handle(res, async () => {
  const { context, task } = await scopedAgencyTask(req, req.params.taskId);
  const clientDecision = context.roles.size === 1 && context.roles.has("client_viewer");
  if (clientDecision && !task.clientApprovalRequired) throw Object.assign(new Error("This item was not sent for client approval."), { statusCode: 403 });
  if (!clientDecision && !hasWorkspacePermission(context, "approve")) throw Object.assign(new Error("Manager/Approver authority is required."), { statusCode: 403 });
  if (!clientDecision && task.approverMembershipId && task.approverMembershipId !== context.membership.id && !context.roles.has("owner") && !context.roles.has("admin")) {
    throw Object.assign(new Error("This approval is assigned to another Approver."), { statusCode: 403 });
  }
  if (task.status !== "submitted_for_approval") throw Object.assign(new Error("Only submitted work can receive an approval decision."), { statusCode: 409 });
  const security = context.workspace.securitySettingsJson && typeof context.workspace.securitySettingsJson === "object"
    ? context.workspace.securitySettingsJson as { separationOfDuties?: unknown } : {};
  const selfApproving = !clientDecision && (task.assigneeMembershipId === context.membership.id || task.createdByUserId === context.membership.userId);
  const ownerAdmin = context.roles.has("owner") || context.roles.has("admin");
  if (selfApproving && !ownerAdmin && !managerSelfApprovalEnabled(context)) {
    throw Object.assign(new Error("Managers cannot approve their own work unless an Owner/Admin enables self-approval."), { statusCode: 409 });
  }
  if (security.separationOfDuties === true && selfApproving) {
    throw Object.assign(new Error("Separation of duties prevents the creator or assignee from self-approving."), { statusCode: 409 });
  }
  const body = taskDecisionSchema.parse(req.body);
  const status = body.decision === "approved" ? "ready_to_publish" : body.decision === "changes_requested" ? "changes_requested" : "rejected";
  return prisma.$transaction(async (tx) => {
    await tx.executionTaskApproval.create({ data: { taskId: task.id, actorMembershipId: context.membership.id, decision: body.decision, notes: body.notes, snapshotJson: body.snapshotJson as Prisma.InputJsonValue } });
    const updated = await tx.executionTask.update({
      where: { id: task.id },
      data: {
        status, approvalDecision: body.decision, approvalNotes: body.notes,
        approvedAt: body.decision === "approved" ? new Date() : null,
        clientApprovedAt: clientDecision && body.decision === "approved" ? new Date() : undefined,
        changesRequestedAt: body.decision === "changes_requested" ? new Date() : null,
        approvalSnapshotJson: body.snapshotJson as Prisma.InputJsonValue,
      },
    });
    await recordWorkspaceActivity(tx, { context, action: clientDecision ? `approval.client_${body.decision}` : `approval.${body.decision}`, entityType: "execution_task", entityId: task.id, agencyClientId: task.project!.agencyClientId, projectId: task.projectId, previousJson: { status: task.status }, nextJson: { status, notes: body.notes } });
    const recipients = [...new Set([task.assignee?.userId, task.manager?.userId].filter((id): id is string => Boolean(id)))];
    for (const userId of recipients) await createWorkspaceNotification(tx, {
      context, userId, type: body.decision, title: `Task ${body.decision.replace("_", " ")}`,
      body: `${task.title}: ${body.notes || body.decision.replace("_", " ")}.`, actionUrl: task.relatedUrl ?? `/guided-projects/${task.projectId}`,
      agencyClientId: task.project!.agencyClientId, projectId: task.projectId,
    });
    return { task: updated };
  });
}));

agencyWorkspaceRouter.post("/agency/tasks/:taskId/publish", (req, res) => handle(res, async () => {
  const { context, task } = await scopedAgencyTask(req, req.params.taskId);
  if (!hasWorkspacePermission(context, "publish")) throw Object.assign(new Error("Explicit publishing permission is required."), { statusCode: 403 });
  if (task.status !== "ready_to_publish" || !task.approvedAt) throw Object.assign(new Error("Only approved work can be published."), { statusCode: 409 });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: { status: "published", publishedAt: new Date() } });
    await recordWorkspaceActivity(tx, { context, action: "publishing.completed", entityType: "execution_task", entityId: task.id, agencyClientId: task.project!.agencyClientId, projectId: task.projectId, previousJson: { status: task.status }, nextJson: { status: "published" } });
    const recipients = [...new Set([task.assignee?.userId, task.manager?.userId].filter((id): id is string => Boolean(id)))];
    for (const userId of recipients) await createWorkspaceNotification(tx, { context, userId, type: "publishing_completed", title: "Publishing completed", body: `${task.title} was published.`, actionUrl: task.relatedUrl, agencyClientId: task.project!.agencyClientId, projectId: task.projectId });
    return { task: updated };
  });
}));
