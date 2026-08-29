import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const optimizationWorkflowRouter = Router();
optimizationWorkflowRouter.use(requireAuth);

const routeValues = ["content", "technical", "local_seo", "gbp", "citations_reviews", "authority"] as const;
const discoverySchema = z.object({
  liveUrl: z.string().url(), httpStatus: z.number().int().min(100).max(599).optional().nullable(), canonicalUrl: z.string().url().optional().nullable(),
  canonicalMatches: z.boolean().optional().nullable(), indexable: z.boolean().optional().nullable(), robotsAllowed: z.boolean().optional().nullable(),
  sitemapPresent: z.boolean().optional().nullable(), analyticsDetected: z.boolean().optional().nullable(), crawlRequested: z.boolean().default(false), indexingRequested: z.boolean().default(false),
  evidence: z.record(z.unknown()).default({}), errorMessage: z.string().trim().max(5000).optional().nullable(),
});
const checkpointSchema = z.object({
  metrics: z.record(z.unknown()).default({}), diagnosis: z.string().trim().min(2).max(10000),
  nextBestAction: z.object({ title: z.string().trim().min(2).max(255), recommendation: z.string().trim().min(2).max(10000), reasoningSummary: z.string().trim().min(2).max(10000), expectedImpact: z.string().trim().min(2).max(5000), confidence: z.number().int().min(0).max(100), estimatedEffort: z.enum(["low", "medium", "high"]), route: z.enum(routeValues), priorityScore: z.number().int().min(0).max(100), evidence: z.record(z.unknown()).default({}) }).optional(),
});
const decisionSchema = z.object({ decision: z.enum(["accepted", "edited", "dismissed", "rerouted"]), comment: z.string().trim().min(2).max(5000), title: z.string().trim().min(2).max(255).optional(), recommendation: z.string().trim().min(2).max(10000).optional(), route: z.enum(routeValues).optional() });

async function projectContext(req: Parameters<typeof workspaceContext>[0], projectId: string) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  return context;
}

optimizationWorkflowRouter.get("/projects/:projectId/optimization-workflow", async (req, res) => {
  try {
    await projectContext(req, req.params.projectId);
    const [discoveryChecks, checkpoints, nextBestActions] = await Promise.all([
      prisma.contentDiscoveryCheck.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: "desc" }, include: { task: { select: { id: true, title: true, status: true } } } }),
      prisma.measurementCheckpoint.findMany({ where: { projectId: req.params.projectId }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], include: { task: { select: { id: true, title: true, status: true, relatedUrl: true } } } }),
      prisma.nextBestAction.findMany({ where: { projectId: req.params.projectId }, orderBy: [{ status: "asc" }, { priorityScore: "desc" }, { createdAt: "desc" }], include: { sourceTask: { select: { id: true, title: true } }, followupTask: { select: { id: true, title: true, status: true, relatedUrl: true } } } }),
    ]);
    res.json({ discoveryChecks, checkpoints, nextBestActions });
  } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode ?? 400).json({ error: typed.message ?? "Could not load optimization workflow." }); }
});

optimizationWorkflowRouter.post("/execution-tasks/:taskId/discovery-check", async (req, res) => {
  try {
    const input = discoverySchema.parse(req.body);
    const task = await prisma.executionTask.findUnique({ where: { id: req.params.taskId }, include: { project: true } });
    if (!task?.projectId) return res.status(404).json({ error: "Task not found." });
    const context = await projectContext(req, task.projectId);
    if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
    const healthy = input.httpStatus != null && input.httpStatus >= 200 && input.httpStatus < 400 && input.canonicalMatches === true && input.indexable === true && input.robotsAllowed === true && input.sitemapPresent === true;
    const now = new Date();
    const check = await prisma.$transaction(async (tx) => {
      const row = await tx.contentDiscoveryCheck.create({ data: { projectId: task.projectId!, taskId: task.id, liveUrl: input.liveUrl, status: healthy ? "verified" : "issue", httpStatus: input.httpStatus, canonicalUrl: input.canonicalUrl, canonicalMatches: input.canonicalMatches, indexable: input.indexable, robotsAllowed: input.robotsAllowed, sitemapPresent: input.sitemapPresent, analyticsDetected: input.analyticsDetected, crawlRequestedAt: input.crawlRequested ? now : null, indexingRequestedAt: input.indexingRequested ? now : null, firstDiscoveredAt: healthy ? now : null, evidenceJson: input.evidence as Prisma.InputJsonValue, errorMessage: input.errorMessage, checkedAt: now } });
      const snapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
      await tx.executionTask.update({ where: { id: task.id }, data: { status: healthy ? "published" : "discovery_issue", blockedReason: healthy ? null : input.errorMessage || "Published content failed one or more discovery checks.", approvalSnapshotJson: { ...snapshot, contentWorkflow: { ...((snapshot.contentWorkflow as object) ?? {}), currentStage: healthy ? "performance_monitoring" : "discovery_check" }, latestDiscoveryCheckId: row.id } as Prisma.InputJsonValue } });
      await recordWorkspaceActivity(tx, { context, action: "content_discovery.checked", entityType: "content_discovery_check", entityId: row.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { healthy, liveUrl: input.liveUrl, canonicalMatches: input.canonicalMatches, indexable: input.indexable, sitemapPresent: input.sitemapPresent } });
      if (!healthy) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "content_discovery_issue", title: "Discovery issue detected", body: `${task.title} is live but failed canonical, indexability, robots, sitemap, or availability verification.`, actionUrl: `/guided-projects/${task.projectId}?tab=execution`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId });
      return row;
    });
    res.status(201).json({ check });
  } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode ?? 400).json({ error: typed.message ?? "Could not record discovery check." }); }
});

optimizationWorkflowRouter.post("/measurement-checkpoints/:checkpointId/complete", async (req, res) => {
  try {
    const input = checkpointSchema.parse(req.body);
    const checkpoint = await prisma.measurementCheckpoint.findUnique({ where: { id: req.params.checkpointId }, include: { project: true, task: true } });
    if (!checkpoint) return res.status(404).json({ error: "Checkpoint not found." });
    const context = await projectContext(req, checkpoint.projectId);
    if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
    const result = await prisma.$transaction(async (tx) => {
      const completed = await tx.measurementCheckpoint.update({ where: { id: checkpoint.id }, data: { status: "completed", metricsJson: input.metrics as Prisma.InputJsonValue, diagnosis: input.diagnosis, completedAt: new Date() } });
      const nba = input.nextBestAction ? await tx.nextBestAction.create({ data: { projectId: checkpoint.projectId, sourceTaskId: checkpoint.taskId, sourceType: "measurement_checkpoint", sourceId: checkpoint.id, title: input.nextBestAction.title, recommendation: input.nextBestAction.recommendation, reasoningSummary: input.nextBestAction.reasoningSummary, expectedImpact: input.nextBestAction.expectedImpact, confidence: input.nextBestAction.confidence, estimatedEffort: input.nextBestAction.estimatedEffort, route: input.nextBestAction.route, priorityScore: input.nextBestAction.priorityScore, evidenceJson: { checkpointType: checkpoint.checkpointType, baseline: checkpoint.baselineJson, metrics: input.metrics, ...input.nextBestAction.evidence } as Prisma.InputJsonValue } }) : null;
      await tx.growthSignal.upsert({
        where: { fingerprint: `${checkpoint.projectId}:performance:measurement:${checkpoint.id}` },
        create: {
          projectId: checkpoint.projectId,
          fingerprint: `${checkpoint.projectId}:performance:measurement:${checkpoint.id}`,
          category: "performance",
          signalKey: checkpoint.checkpointType,
          sourceType: "measurement_checkpoint",
          sourceId: checkpoint.id,
          valueJson: { baseline: checkpoint.baselineJson, metrics: input.metrics, diagnosis: input.diagnosis } as Prisma.InputJsonValue,
          confidence: 95,
          collectedAt: new Date(),
          effectiveDate: new Date(),
          freshnessStatus: "fresh",
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
        update: {
          valueJson: { baseline: checkpoint.baselineJson, metrics: input.metrics, diagnosis: input.diagnosis } as Prisma.InputJsonValue,
          confidence: 95,
          collectedAt: new Date(),
          effectiveDate: new Date(),
          freshnessStatus: "fresh",
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.projectGrowthLearning.create({
        data: {
          projectId: checkpoint.projectId,
          sourceType: "measurement_checkpoint",
          sourceId: checkpoint.id,
          outcome: "measurement",
          summary: input.diagnosis,
          learningJson: { checkpointType: checkpoint.checkpointType, baseline: checkpoint.baselineJson, metrics: input.metrics } as Prisma.InputJsonValue,
        },
      });
      await recordWorkspaceActivity(tx, { context, action: "measurement.checkpoint_completed", entityType: "measurement_checkpoint", entityId: checkpoint.id, agencyClientId: checkpoint.project.agencyClientId, projectId: checkpoint.projectId, nextJson: { checkpointType: checkpoint.checkpointType, nextBestActionId: nba?.id ?? null } });
      if (nba) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "next_best_action_ready", title: "Next Best Action ready", body: `${checkpoint.project.name}: ${nba.title}`, actionUrl: `/guided-projects/${checkpoint.projectId}?tab=execution#optimization-workflow`, agencyClientId: checkpoint.project.agencyClientId, projectId: checkpoint.projectId });
      return { checkpoint: completed, nextBestAction: nba };
    });
    res.json(result);
  } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode ?? 400).json({ error: typed.message ?? "Could not complete checkpoint." }); }
});

optimizationWorkflowRouter.post("/next-best-actions/:id/decision", async (req, res) => {
  try {
    const input = decisionSchema.parse(req.body);
    const nba = await prisma.nextBestAction.findUnique({ where: { id: req.params.id }, include: { project: true } });
    if (!nba) return res.status(404).json({ error: "Next Best Action not found." });
    const context = await projectContext(req, nba.projectId);
    if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
    const route = input.route ?? nba.route;
    const accepted = input.decision !== "dismissed";
    const result = await prisma.$transaction(async (tx) => {
      let followupTaskId: string | null = nba.followupTaskId;
      if (accepted && !followupTaskId) {
        const task = await tx.executionTask.create({ data: { clientId: nba.project.clientId, websiteId: nba.project.websiteId, projectId: nba.projectId, moduleName: route, sourceType: "next_best_action", sourceId: nba.id, dedupeKey: `next-best-action:${nba.id}`, title: (input.title ?? nba.title).slice(0, 255), description: input.recommendation ?? nba.recommendation, expectedOutcome: nba.expectedImpact, priority: nba.priorityScore >= 80 ? "high" : nba.priorityScore >= 50 ? "medium" : "low", automationLevel: "recommend", status: "ready", requiresApproval: true, manualRequired: route !== "content", safetyCategory: "protected_change", approvalRisk: "medium", actionButtonLabel: route === "content" ? "Create Content" : "Review Recommended Action", relatedUrl: route === "content" ? `/ai-content?projectId=${nba.projectId}` : `/guided-projects/${nba.projectId}?tab=execution`, impact: nba.expectedImpact, approvalSnapshotJson: { nextBestActionId: nba.id, sourceEvidence: nba.evidenceJson, confidence: nba.confidence, reasoningSummary: nba.reasoningSummary } as Prisma.InputJsonValue } });
        followupTaskId = task.id;
        if (route === "content") await tx.executionTask.update({ where: { id: task.id }, data: { relatedUrl: `/ai-content?projectId=${nba.projectId}&taskId=${task.id}&open=1` } });
      }
      const updated = await tx.nextBestAction.update({ where: { id: nba.id }, data: { status: accepted ? "accepted" : "dismissed", decision: input.decision, decisionComment: input.comment, decidedByUserId: context.membership.userId, decidedAt: new Date(), title: input.title, recommendation: input.recommendation, route, followupTaskId } });
      await recordWorkspaceActivity(tx, { context, action: "next_best_action.decided", entityType: "next_best_action", entityId: nba.id, agencyClientId: nba.project.agencyClientId, projectId: nba.projectId, previousJson: { status: nba.status, route: nba.route }, nextJson: { decision: input.decision, route, followupTaskId, comment: input.comment } });
      return updated;
    });
    res.json({ nextBestAction: result });
  } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode ?? 400).json({ error: typed.message ?? "Could not decide Next Best Action." }); }
});
