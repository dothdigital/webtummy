import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { projectReportCatalog, projectReportTypes, reportFrequencies } from "@webtummy/core/reporting";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const projectReportsRouter = Router();

const generateSchema = z.object({ projectId: z.string().min(1), reportType: z.enum(projectReportTypes), exportFormat: z.enum(["pdf", "html", "secure_link"]).default("secure_link") });
const approvalSchema = z.object({ decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(5000).optional() });
const scheduleSchema = z.object({ projectId: z.string().min(1), reportType: z.enum(projectReportTypes), frequency: z.enum(reportFrequencies), automaticClientDelivery: z.boolean().default(false) });
const preferencesSchema = z.object({ nonCriticalEmail: z.boolean(), emailFrequency: z.enum(["immediate", "daily", "weekly", "monthly"]), reportEmails: z.boolean(), inAppNotifications: z.literal(true).default(true) });

function fail(message: string, statusCode = 403) {
  throw Object.assign(new Error(message), { statusCode });
}

async function scopedProject(context: Awaited<ReturnType<typeof workspaceContext>>, projectId: string) {
  if (!await canAccessProject(context, projectId)) fail("Project not found.", 404);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(context.workspace.legacyClientId ? { clientId: context.workspace.legacyClientId } : {}) },
    include: {
      agencyClient: { select: { id: true, name: true } }, website: { select: { id: true, domain: true } },
      keywordGroups: { select: { id: true, title: true, status: true, keywords: true } },
      strategyPlans: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true, updatedAt: true } },
      executionTasks: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, moduleName: true, status: true, priority: true, requiresApproval: true, approvedAt: true, publishedAt: true, completedAt: true, dueAt: true, assignee: { select: { user: { select: { name: true, email: true } } } }, approver: { select: { user: { select: { name: true, email: true } } } } } },
      memberAssignments: { select: { membershipId: true } },
      teamAssignments: { select: { team: { select: { members: { select: { membershipId: true } } } } } },
    },
  });
  if (!project) fail("Project not found.", 404);
  return project;
}

function reportContent(project: Awaited<ReturnType<typeof scopedProject>>, reportType: typeof projectReportTypes[number]) {
  const definition = projectReportCatalog.find((item) => item.type === reportType)!;
  const completed = project.executionTasks.filter((task) => task.completedAt || task.status === "completed");
  const published = project.executionTasks.filter((task) => task.publishedAt || task.status === "published");
  const awaitingApproval = project.executionTasks.filter((task) => task.requiresApproval && !task.approvedAt);
  const blocked = project.executionTasks.filter((task) => ["blocked", "failed"].includes(task.status));
  const scheduled = project.executionTasks.filter((task) => task.dueAt && !task.completedAt && !task.publishedAt);
  const approvedKeywordGroups = project.keywordGroups.filter((group) => group.status === "approved");
  const contentTasks = project.executionTasks.filter((task) => /content|page|publish/i.test(`${task.moduleName} ${task.title}`));
  const unavailable = "Connect the relevant analytics integration to populate this metric.";
  return {
    title: definition.title, reportType, project: { id: project.id, name: project.name, businessName: project.businessName, website: project.website?.domain ?? project.websiteUrl, primaryGoal: project.primaryGoal, targetMarkets: project.targetLocations },
    generatedAt: new Date().toISOString(), health: { workflowStep: project.currentStep, strategyStatus: project.strategyPlans[0]?.status ?? "not_started", completedTasks: completed.length, totalTasks: project.executionTasks.length, blockedTasks: blocked.length },
    seo: { approvedKeywordGroups: approvedKeywordGroups.length, approvedKeywords: approvedKeywordGroups.flatMap((group) => Array.isArray(group.keywords) ? group.keywords.map(String) : []).length, websiteConnected: Boolean(project.websiteId) },
    performance: { keywordRankingChanges: null, organicTraffic: null, searchImpressions: null, searchClicks: null, indexedPages: null, backlinkProgress: null, competitorVisibilityChanges: null, unavailableReason: unavailable },
    localSeo: { googleBusinessProfilePerformance: null, localGridRankings: null, citationsAndNapIssues: null, recommendations: ["Connect Google Business Profile and Local SEO tracking to populate local performance."] },
    reputation: { newReviews: null, negativeReviewsNeedingAttention: null, averageRating: null, ratingChange: null, responseStatus: null, trends: null, unavailableReason: unavailable },
    execution: { completed: completed.map((task) => ({ title: task.title, module: task.moduleName, completedBy: task.assignee?.user.name || task.assignee?.user.email || "Unassigned", approvedBy: task.approver?.user.name || task.approver?.user.email || null })), published: published.map((task) => task.title), awaitingApproval: awaitingApproval.map((task) => task.title), blocked: blocked.map((task) => task.title), scheduledNext: scheduled.slice(0, 20).map((task) => ({ title: task.title, dueAt: task.dueAt })) },
    contentPublishing: { created: contentTasks.length, approved: contentTasks.filter((task) => Boolean(task.approvedAt)).length, published: contentTasks.filter((task) => Boolean(task.publishedAt) || task.status === "published").map((task) => task.title), performance: null, unavailableReason: unavailable },
    ecommerce: { productAndCollectionOptimization: project.executionTasks.filter((task) => /product|collection/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), organicProductTraffic: null, storeSeoIssues: blocked.filter((task) => /store|product|collection|shopify/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), productPagePerformance: null, publishedStoreChanges: published.filter((task) => /store|product|collection|shopify/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), salesAndConversions: null, unavailableReason: unavailable },
    sections: definition.sections, recommendations: blocked.length ? ["Resolve blocked work before the next milestone."] : ["Continue with the next approved execution priorities."],
    clientSafe: "clientSafe" in definition && definition.clientSafe === true,
  };
}

projectReportsRouter.get("/project-reports/catalog", (_req, res) => res.json({ reports: projectReportCatalog, frequencies: reportFrequencies }));

projectReportsRouter.get("/project-reports", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "view_reports")) return res.status(403).json({ error: "Report viewing permission is required." });
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
  if (!projectId || !await canAccessProject(context, projectId)) return res.status(404).json({ error: "Project not found." });
  const clientViewer = context.roles.has("client_viewer") && context.roles.size === 1;
  const reports = await prisma.gapReportExport.findMany({ where: { projectId, ...(clientViewer ? { approvalStatus: "approved", clientVisible: true } : {}) }, orderBy: { createdAt: "desc" } });
  res.json({ reports });
});

projectReportsRouter.post("/project-reports/generate", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report generation permission is required." });
  const data = generateSchema.parse(req.body);
  const project = await scopedProject(context, data.projectId);
  const definition = projectReportCatalog.find((item) => item.type === data.reportType)!;
  if ("ecommerceOnly" in definition && definition.ecommerceOnly && context.workspace.workspaceType !== "ecommerce" && project.projectType !== "ecommerce") return res.status(400).json({ error: "Ecommerce Reports are available only for store projects." });
  if ("agencyOnly" in definition && definition.agencyOnly && context.workspace.workspaceType !== "agency") return res.status(400).json({ error: "Agency Client Reports are available only in Agency workspaces." });
  const approvalStatus = context.workspace.workspaceType === "agency" ? "needs_review" : "approved";
  const assignedMembershipIds = new Set([...project.memberAssignments.map((item) => item.membershipId), ...project.teamAssignments.flatMap((item) => item.team.members.map((member) => member.membershipId))]);
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.gapReportExport.create({ data: { projectId: project.id, clientId: project.clientId, reportType: data.reportType, clientName: project.agencyClient?.name ?? project.businessName ?? project.name, approvalStatus, exportFormat: data.exportFormat, status: "ready", completedAt: new Date(), contentJson: reportContent(project, data.reportType) as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: "report.generated", entityType: "gap_report_export", entityId: created.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { reportType: data.reportType, approvalStatus } });
    const memberships = await tx.workspaceMembership.findMany({ where: { workspaceId: context.workspace.id, status: "active", OR: [{ id: { in: [...assignedMembershipIds] } }, { userId: context.workspace.ownerUserId }] }, include: { roles: { select: { role: true } } } });
    for (const membership of memberships) {
      const roles = membership.roles.map((item) => item.role === "owner" ? "admin" : item.role === "approver" ? "manager" : item.role);
      if (!roles.some((role) => definition.audience.includes(role as never)) || roleIsClientViewer(roles)) continue;
      await createWorkspaceNotification(tx, { context, userId: membership.userId, type: "report_ready", title: `${definition.title} ready`, body: `${project.name}'s report is ready${approvalStatus === "needs_review" ? " for review" : ""}.`, actionUrl: `/reports?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
    }
    return created;
  });
  res.status(201).json({ report });
});

projectReportsRouter.patch("/project-reports/:reportId/approval", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const data = approvalSchema.parse(req.body);
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { project: true } });
  if (!report || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Report not found." });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.gapReportExport.update({ where: { id: report.id }, data: { approvalStatus: data.decision } });
    await recordWorkspaceActivity(tx, { context, action: `report.${data.decision}`, entityType: "gap_report_export", entityId: report.id, agencyClientId: report.project.agencyClientId, projectId: report.projectId, previousJson: { approvalStatus: report.approvalStatus }, nextJson: { approvalStatus: data.decision, notes: data.notes ?? null } });
    return next;
  });
  res.json({ report: updated });
});

projectReportsRouter.get("/project-reports/schedules", async (req, res) => {
  const context = await workspaceContext(req);
  const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
  if (!requestedProjectId || !await canAccessProject(context, requestedProjectId)) return res.status(404).json({ error: "Project not found." });
  const settings = context.workspace.settingsJson && typeof context.workspace.settingsJson === "object" ? context.workspace.settingsJson as { reportSchedules?: unknown } : {};
  const schedules = Array.isArray(settings.reportSchedules) ? settings.reportSchedules : [];
  res.json({ schedules: schedules.filter((item) => item && typeof item === "object" && "projectId" in item && canScheduleProject(item, requestedProjectId)) });
});

projectReportsRouter.put("/project-reports/schedules", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report scheduling permission is required." });
  const data = scheduleSchema.parse(req.body);
  await scopedProject(context, data.projectId);
  if (data.automaticClientDelivery && !hasWorkspacePermission(context, "manage_settings")) return res.status(403).json({ error: "Only Owner/Admin can enable automatic client delivery." });
  const previous = context.workspace.settingsJson && typeof context.workspace.settingsJson === "object" ? context.workspace.settingsJson as Record<string, unknown> : {};
  const schedules = (Array.isArray(previous.reportSchedules) ? previous.reportSchedules : []).filter((item) => !(item && typeof item === "object" && "projectId" in item && "reportType" in item && item.projectId === data.projectId && item.reportType === data.reportType));
  if (data.frequency !== "on_demand") schedules.push(data);
  await prisma.workspace.update({ where: { id: context.workspace.id }, data: { settingsJson: { ...previous, reportSchedules: schedules } as Prisma.InputJsonValue } });
  res.json({ schedules });
});

projectReportsRouter.get("/notification-preferences", async (req, res) => {
  const context = await workspaceContext(req);
  const overrides = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object" ? context.membership.permissionOverrides as { notificationPreferences?: unknown } : {};
  res.json({ preferences: overrides.notificationPreferences ?? { nonCriticalEmail: true, emailFrequency: "daily", reportEmails: true, inAppNotifications: true }, criticalNotificationsRequired: true });
});

projectReportsRouter.patch("/notification-preferences", async (req, res) => {
  const context = await workspaceContext(req);
  const preferences = preferencesSchema.parse(req.body);
  const previous = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object" ? context.membership.permissionOverrides as Record<string, unknown> : {};
  await prisma.workspaceMembership.update({ where: { id: context.membership.id }, data: { permissionOverrides: { ...previous, notificationPreferences: preferences } as Prisma.InputJsonValue } });
  res.json({ preferences, criticalNotificationsRequired: true });
});

function roleIsClientViewer(roles: string[]) { return roles.length === 1 && roles[0] === "client_viewer"; }
function canScheduleProject(item: object, requested: unknown) { return typeof requested !== "string" || (item as { projectId?: unknown }).projectId === requested; }
