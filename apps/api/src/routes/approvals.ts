import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { approvalRequired, automationLevels, classifyApproval, type AutomationLevel } from "@webtummy/core/approvals";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, managerSelfApprovalEnabled, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const approvalsRouter = Router();
const decisionSchema = z.object({ decision: z.enum(["approved", "rejected", "changes_requested", "edit_first", "regenerate"]), notes: z.string().trim().max(10000).optional(), snapshotJson: z.record(z.unknown()).default({}) });
const bulkSchema = z.object({ taskIds: z.array(z.string()).min(1).max(200), decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(10000).optional() });
const policySchema = z.object({ automationLevel: z.enum(automationLevels) });

const projectPolicy = (settings: unknown, projectId: string): AutomationLevel => {
  const value = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as { projectAutomationLevels?: Record<string, unknown> }).projectAutomationLevels?.[projectId] : null;
  return automationLevels.includes(value as AutomationLevel) ? value as AutomationLevel : "manual";
};

async function accessibleTask(context: Awaited<ReturnType<typeof workspaceContext>>, taskId: string) {
  const task = await prisma.executionTask.findUnique({ where: { id: taskId }, include: { project: { include: { agencyClient: true } }, assignee: { include: { user: true } }, manager: { include: { user: true } }, approver: { include: { user: true } }, approvalHistory: { orderBy: { createdAt: "desc" } } } });
  if (!task?.projectId || !await canAccessProject(context, task.projectId)) throw Object.assign(new Error("Approval request not found."), { statusCode: 404 });
  return task;
}

function approvalView(task: Awaited<ReturnType<typeof accessibleTask>>, level: AutomationLevel) {
  const snapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" ? task.approvalSnapshotJson as Record<string, unknown> : {};
  const affectedCount = typeof snapshot.affectedCount === "number" ? snapshot.affectedCount : null;
  const classification = classifyApproval({ ...task, affectedCount });
  return { ...task, approvalType: classification.type, effectiveRisk: classification.risk, highRisk: classification.highRisk, automationLevel: level, policyRequiresApproval: approvalRequired(level, { ...task, affectedCount }), expectedBenefit: task.impact || snapshot.expectedBenefit || null, aiReason: task.description, affectedCount, beforeVersion: snapshot.before ?? null, proposedVersion: snapshot.after ?? snapshot.proposed ?? null };
}

approvalsRouter.get("/approvals", async (req, res) => {
  const context = await workspaceContext(req);
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  if (!clientViewer && !hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const candidates = await prisma.executionTask.findMany({ where: { projectId: projectId ?? { not: null }, status: "submitted_for_approval", ...(clientViewer ? { clientApprovalRequired: true } : {}) }, orderBy: [{ approvalRisk: "desc" }, { submittedAt: "asc" }], include: { project: { include: { agencyClient: true } }, assignee: { include: { user: true } }, manager: { include: { user: true } }, approver: { include: { user: true } }, approvalHistory: { orderBy: { createdAt: "desc" }, take: 20 } } });
  const tasks = [];
  for (const task of candidates) if (task.projectId && await canAccessProject(context, task.projectId)) tasks.push(approvalView(task as Awaited<ReturnType<typeof accessibleTask>>, projectPolicy(context.workspace.settingsJson, task.projectId)));
  res.json({ tasks, automationLevels });
});

approvalsRouter.get("/projects-v2/:projectId/approval-policy", async (req, res) => {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project not found." });
  res.json({ automationLevel: projectPolicy(context.workspace.settingsJson, req.params.projectId) });
});

approvalsRouter.patch("/projects-v2/:projectId/approval-policy", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "edit_project_settings") || !await canAccessProject(context, req.params.projectId)) return res.status(403).json({ error: "Project settings permission is required." });
  const data = policySchema.parse(req.body);
  const previous = context.workspace.settingsJson && typeof context.workspace.settingsJson === "object" && !Array.isArray(context.workspace.settingsJson) ? context.workspace.settingsJson as Record<string, unknown> : {};
  const levels = previous.projectAutomationLevels && typeof previous.projectAutomationLevels === "object" && !Array.isArray(previous.projectAutomationLevels) ? previous.projectAutomationLevels as Record<string, unknown> : {};
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: context.workspace.id }, data: { settingsJson: { ...previous, projectAutomationLevels: { ...levels, [req.params.projectId]: data.automationLevel } } as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: "project.automation_level_changed", entityType: "project", entityId: req.params.projectId, projectId: req.params.projectId, previousJson: { automationLevel: projectPolicy(previous, req.params.projectId) }, nextJson: data });
  });
  res.json(data);
});

approvalsRouter.post("/approvals/:taskId/decision", async (req, res) => {
  const context = await workspaceContext(req); const task = await accessibleTask(context, req.params.taskId); const data = decisionSchema.parse(req.body);
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  if (clientViewer && !task.clientApprovalRequired) return res.status(403).json({ error: "This request was not sent to the client." });
  if (!clientViewer && !hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const selfApproving = task.assigneeMembershipId === context.membership.id || task.createdByUserId === context.membership.userId;
  if (!clientViewer && selfApproving && !context.roles.has("owner") && !context.roles.has("admin") && !managerSelfApprovalEnabled(context)) return res.status(409).json({ error: "Managers cannot approve their own work unless self-approval is enabled." });
  const status = data.decision === "approved" ? "ready_to_publish" : data.decision === "edit_first" || data.decision === "changes_requested" ? "changes_requested" : data.decision === "regenerate" ? "draft" : "rejected";
  const updated = await prisma.$transaction(async (tx) => {
    await tx.executionTaskApproval.create({ data: { taskId: task.id, actorMembershipId: context.membership.id, decision: data.decision, notes: data.notes, snapshotJson: { ...data.snapshotJson, before: task.approvalSnapshotJson, action: task.title, aiReason: task.description } as Prisma.InputJsonValue } });
    const next = await tx.executionTask.update({ where: { id: task.id }, data: { status, approvalDecision: data.decision, approvalNotes: data.notes, approvedAt: data.decision === "approved" ? new Date() : null, clientApprovedAt: clientViewer && data.decision === "approved" ? new Date() : undefined, changesRequestedAt: ["edit_first", "changes_requested"].includes(data.decision) ? new Date() : null } });
    await recordWorkspaceActivity(tx, { context, action: `approval.${clientViewer ? "client_" : ""}${data.decision}`, entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, previousJson: { status: task.status, snapshot: task.approvalSnapshotJson }, nextJson: { status, decision: data.decision, notes: data.notes, snapshot: data.snapshotJson } });
    for (const userId of [...new Set([task.assignee?.userId, task.manager?.userId, task.createdByUserId].filter((id): id is string => Boolean(id)))]) await createWorkspaceNotification(tx, { context, userId, type: "approval_decided", title: `Approval ${data.decision.replace("_", " ")}`, body: `${task.title}: ${data.notes || data.decision.replace("_", " ")}.`, actionUrl: task.relatedUrl ?? `/guided-projects/${task.projectId}`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId });
    return next;
  });
  res.json({ task: updated });
});

approvalsRouter.post("/approvals/bulk-decision", async (req, res) => {
  const context = await workspaceContext(req); if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const data = bulkSchema.parse(req.body); const results = [];
  for (const taskId of [...new Set(data.taskIds)]) {
    const task = await accessibleTask(context, taskId); const classification = classifyApproval(task);
    if (classification.highRisk && data.decision === "approved") { results.push({ taskId, ok: false, error: "High-risk actions require individual confirmation." }); continue; }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.executionTaskApproval.create({ data: { taskId, actorMembershipId: context.membership.id, decision: data.decision, notes: data.notes, snapshotJson: { bulkDecision: true, before: task.approvalSnapshotJson } as Prisma.InputJsonValue } });
      const next = await tx.executionTask.update({ where: { id: taskId }, data: { status: data.decision === "approved" ? "ready_to_publish" : "rejected", approvalDecision: data.decision, approvalNotes: data.notes, approvedAt: data.decision === "approved" ? new Date() : null } });
      await recordWorkspaceActivity(tx, { context, action: `approval.bulk_${data.decision}`, entityType: "execution_task", entityId: taskId, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, previousJson: { status: task.status }, nextJson: { status: next.status, decision: data.decision } }); return next;
    });
    results.push({ taskId, ok: true, status: updated.status });
  }
  res.json({ results });
});
