import { Prisma, prisma } from "@webtummy/db";
import { approvalDecisionState, normalizedApprovalDecision } from "./dev011.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, managerSelfApprovalEnabled, recordWorkspaceActivity, workspaceContext } from "./workspace-access.js";

type Context = Awaited<ReturnType<typeof workspaceContext>>;

const taskInclude = {
  project: { include: { agencyClient: true } },
  assignee: { include: { user: true } },
  manager: { include: { user: true } },
  approver: { include: { user: true } },
  dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } },
  approvalHistory: { orderBy: { createdAt: "desc" as const }, take: 20 },
};

async function workflowTask(context: Context, taskId: string) {
  const task = await prisma.executionTask.findUnique({ where: { id: taskId }, include: taskInclude });
  if (!task?.projectId || !await canAccessProject(context, task.projectId)) throw Object.assign(new Error("Approval request not found."), { statusCode: 404 });
  return task;
}

export async function submitTaskApproval(context: Context, taskId: string, input: { notes?: string | null; confirmed?: boolean }) {
  const task = await workflowTask(context, taskId);
  if (!hasWorkspacePermission(context, "submit_for_approval")) throw Object.assign(new Error("Submit-for-approval permission is required."), { statusCode: 403 });
  if (task.assigneeMembershipId && task.assigneeMembershipId !== context.membership.id && !context.roles.has("owner") && !context.roles.has("admin")) throw Object.assign(new Error("Only the assigned user can submit this task."), { statusCode: 403 });
  if (!["draft", "in_progress", "changes_requested", "needs_review", "ready"].includes(task.status)) throw Object.assign(new Error("This task cannot be submitted from its current status."), { statusCode: 409 });
  const blocked = task.dependencies.filter((dependency) => !["completed", "published", "approved"].includes(dependency.requiredTask.status));
  if (blocked.length) throw Object.assign(new Error(`Complete dependencies first: ${blocked.map((dependency) => dependency.requiredTask.title).join(", ")}`), { statusCode: 409 });

  const personal = context.workspace.workspaceType === "personal";
  const fallbackApprovers = personal || task.approver?.userId ? [] : await prisma.workspaceMembership.findMany({
    where: { workspaceId: context.workspace.id, status: "active", roles: { some: { role: { in: ["owner", "admin", "manager", "approver", "manager_approver"] } } } },
    select: { id: true, userId: true },
  });
  const approvers = [
    ...(task.approver && task.approverMembershipId !== context.membership.id ? [{ id: task.approverMembershipId!, userId: task.approver.userId }] : []),
    ...fallbackApprovers.filter((member) => member.id !== context.membership.id),
  ];
  const soloOwner = approvers.length === 0 && (context.roles.has("owner") || context.roles.has("admin"));
  if (!personal && soloOwner && !input.confirmed) throw Object.assign(new Error("Confirm this action before continuing."), { statusCode: 409 });

  return prisma.$transaction(async (tx) => {
    const directlyApproved = personal || soloOwner;
    const clientPending = !personal && soloOwner && task.clientApprovalRequired;
    const status = directlyApproved ? (clientPending ? "submitted_for_approval" : "ready_to_publish") : "submitted_for_approval";
    const decision = directlyApproved ? (clientPending ? "team_approved" : "approved") : null;
    const now = new Date();
    const snapshot = { stage: clientPending ? "client_approval" : directlyApproved ? "approved" : "team_approval", requesterMembershipId: context.membership.id, requesterUserId: context.membership.userId, personalNoApprovalWorkflow: personal };
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: { status, submittedAt: now, approvalDecision: decision, approvedAt: directlyApproved ? now : null, approvalNotes: input.notes, changesRequestedAt: null, approvalSnapshotJson: snapshot } });
    if (!personal) await tx.executionTaskApproval.create({ data: { taskId: task.id, actorMembershipId: context.membership.id, decision: directlyApproved ? "approved" : "requested", notes: input.notes, snapshotJson: snapshot } });
    await recordWorkspaceActivity(tx, { context, action: personal ? "approval.not_required_personal" : soloOwner ? "approval.owner_confirmed" : "approval.requested", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, previousJson: { status: task.status }, nextJson: { status, decision, requesterMembershipId: context.membership.id } });
    for (const userId of [...new Set(approvers.map((member) => member.userId))]) await createWorkspaceNotification(tx, { context, userId, type: "approval_requested", title: "Approval requested", body: `${task.title} is ready for your review.`, actionUrl: `/approvals?projectId=${task.projectId}&taskId=${task.id}`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId });
    if (clientPending && task.project?.agencyClientId) await notifyClientApprovers(tx, context, task);
    return { task: updated };
  });
}

export async function decideTaskApproval(context: Context, taskId: string, input: { decision: string; notes?: string | null; snapshotJson?: Record<string, unknown> }) {
  const task = await workflowTask(context, taskId);
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  if (clientViewer && !task.clientApprovalRequired) throw Object.assign(new Error("This request was not sent to the client."), { statusCode: 403 });
  if (!clientViewer && !hasWorkspacePermission(context, "approve")) throw Object.assign(new Error("Approval permission is required."), { statusCode: 403 });
  if (!clientViewer && task.approverMembershipId && task.approverMembershipId !== context.membership.id && !context.roles.has("owner") && !context.roles.has("admin")) throw Object.assign(new Error("This approval is assigned to another Approver."), { statusCode: 403 });
  if (!["submitted_for_approval", "awaiting_confirmation"].includes(task.status)) throw Object.assign(new Error("Only submitted work can receive an approval decision."), { statusCode: 409 });
  const snapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
  const confirmationOnly = task.status === "awaiting_confirmation" || snapshot.confirmationOnly === true;
  if (confirmationOnly && !context.roles.has("owner") && !context.roles.has("admin")) throw Object.assign(new Error("Only Owner/Admin can confirm this action."), { statusCode: 403 });
  const selfApproving = !clientViewer && (task.assigneeMembershipId === context.membership.id || task.createdByUserId === context.membership.userId);
  const security = context.workspace.securitySettingsJson && typeof context.workspace.securitySettingsJson === "object" ? context.workspace.securitySettingsJson as { separationOfDuties?: unknown } : {};
  if (selfApproving && !context.roles.has("owner") && !context.roles.has("admin") && !managerSelfApprovalEnabled(context)) throw Object.assign(new Error("Managers cannot approve their own work unless self-approval is enabled."), { statusCode: 409 });
  if (security.separationOfDuties === true && selfApproving) throw Object.assign(new Error("Separation of duties prevents self-approval."), { statusCode: 409 });

  const decision = normalizedApprovalDecision(input.decision);
  const needsClient = !clientViewer && decision === "approved" && task.clientApprovalRequired;
  const state = approvalDecisionState(decision, needsClient);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const decisionSnapshot = { ...(input.snapshotJson ?? {}), before: task.approvalSnapshotJson, requester: snapshot.requesterMembershipId ?? null, approverMembershipId: context.membership.id, approverUserId: context.membership.userId };
    await tx.executionTaskApproval.create({ data: { taskId: task.id, actorMembershipId: context.membership.id, decision, notes: input.notes, snapshotJson: decisionSnapshot as Prisma.InputJsonValue } });
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: { status: state.status, approvalDecision: state.storedDecision, approvalNotes: input.notes, approvedAt: decision === "approved" ? now : null, clientApprovedAt: clientViewer && decision === "approved" ? now : undefined, changesRequestedAt: decision === "changes_requested" ? now : null, approvalSnapshotJson: needsClient ? { ...snapshot, stage: "client_approval" } as Prisma.InputJsonValue : undefined } });
    await recordWorkspaceActivity(tx, { context, action: `approval.${clientViewer ? "client_" : ""}${decision}`, entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, previousJson: { status: task.status, decision: task.approvalDecision }, nextJson: { status: state.status, decision, notes: input.notes, approverMembershipId: context.membership.id } });
    for (const userId of [...new Set([task.assignee?.userId, task.manager?.userId, task.createdByUserId].filter((id): id is string => Boolean(id)))]) await createWorkspaceNotification(tx, { context, userId, type: `approval_${decision}`, title: `Task ${decision.replaceAll("_", " ")}`, body: `${task.title}: ${input.notes || decision.replaceAll("_", " ")}.`, actionUrl: task.relatedUrl ?? `/guided-projects/${task.projectId}#execution-tasks`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId });
    if (needsClient && task.project?.agencyClientId) await notifyClientApprovers(tx, context, task);
    return { task: updated };
  });
}

async function notifyClientApprovers(tx: Prisma.TransactionClient, context: Context, task: Awaited<ReturnType<typeof workflowTask>>) {
  if (!task.project?.agencyClientId) return;
  const members = await tx.agencyClientMember.findMany({ where: { agencyClientId: task.project.agencyClientId, membership: { status: "active", roles: { some: { role: "client_viewer" } } } }, select: { membership: { select: { userId: true } } } });
  for (const member of members) await createWorkspaceNotification(tx, { context, userId: member.membership.userId, type: "client_approval_requested", title: "Client approval requested", body: `${task.title} is ready for your review.`, actionUrl: `/agency/clients/${task.project.agencyClientId}`, agencyClientId: task.project.agencyClientId, projectId: task.projectId });
}
