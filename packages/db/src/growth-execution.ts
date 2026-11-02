import { ensureGrowthSocialContent } from "./growth-social-content.js";
export { ensureGrowthSocialContent } from "./growth-social-content.js";
import { ensureMonthlyLeadMagnets } from "./monthly-lead-magnets.js";
import { prisma, Prisma } from "./index.js";
import { contentPublishDate, growthReminder, growthTaskStage, growthGuide, growthSteps, inactiveGrowthItems, completedGrowthTasks, type GrowthExecutionView, type GrowthExecutionItem } from "../../core/src/growthExecution.js";
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};


export const GROWTH_LAUNCH_REQUIRED = "Publish your website and complete live verification before starting Growth Execution.";
type LaunchEvidence = { websiteId: string | null; websitePublications: Array<{releaseId:string;status:string;mode:string;target:string;publishedAt:Date|null;completedAt:Date|null;verificationJson:unknown}>; workflowEvents: Array<{eventType:string;sourceId:string|null;payloadJson:unknown;occurredAt:Date}> };
export function verifiedGrowthLaunch(project: LaunchEvidence) {
    const liveDates: Array<{ date: Date; source: string }> = [];
    for (const publication of project.websitePublications) {
      const verification = object(publication.verificationJson);
      const live = ["verified", "verified_with_warnings"].includes(verification.status) && !["download", "developer_handoff", "draft"].includes(publication.mode) && (publication.status === "published" || publication.status === "verified" || publication.target === "static_html" && publication.mode === "sftp" && publication.status === "completed");
      if (live && (publication.publishedAt || publication.completedAt)) liveDates.push({ date: (publication.publishedAt || publication.completedAt)!, source: `Published release ${publication.releaseId}` });
      if (["download", "developer_handoff"].includes(publication.mode) && publication.status === "completed" && publication.completedAt) {
        const reviewed = project.workflowEvents.find(e => e.eventType === "website.handoff_reviewed" && e.sourceId === publication.releaseId && object(e.payloadJson).websiteId === project.websiteId && Boolean(object(e.payloadJson).crawlId) && e.occurredAt >= publication.completedAt!);
        const applied = project.workflowEvents.find(e => e.eventType === "website.handoff_applied" && e.sourceId === publication.releaseId && object(e.payloadJson).websiteId === project.websiteId && e.occurredAt >= publication.completedAt! && (!reviewed || e.occurredAt <= reviewed.occurredAt));
        if (reviewed && applied) liveDates.push({ date: applied.occurredAt, source: `Confirmed and reviewed live handoff ${publication.releaseId}` });
      }
    }
    return liveDates.sort((a,b) => a.date.getTime()-b.date.getTime())[0] ?? null;
 }
export async function requireGrowthLaunch(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { websiteId: true, websitePublications: true, workflowEvents: { where: { eventType: { in: ["website.handoff_applied", "website.handoff_reviewed"] } } } } });
  const launch = project ? verifiedGrowthLaunch(project) : null;
  if (!launch) throw Object.assign(new Error(GROWTH_LAUNCH_REQUIRED), { statusCode: 409, code: "growth_website_launch_required" });
  return launch;
}

/** Reconcile saved evidence only. Never generate, approve or publish work in a background check. */
export async function reconcileGrowthExecution(projectId: string, options: { notify?: boolean; now?: Date } = {}): Promise<GrowthExecutionView | null> {
  const now = options.now ?? new Date();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`growth-execution:${projectId}`}, 0::bigint))::text`;
    const project = await tx.project.findUnique({ where: { id: projectId }, include: {
      client: { select: { workspace: { select: { id: true, ownerUserId: true } } } },
      agencyClient: { select: { workspace: { select: { id: true, ownerUserId: true } } } },
      website: { select: { id: true, trackingSite: { select: { lastVerifiedAt: true } }, crawlJobs: { where: { status: "completed", pagesCrawled: { gt: 0 } }, orderBy: { completedAt: "desc" }, take: 1, select: { id: true, completedAt: true } } } },
      websitePublications: { orderBy: { createdAt: "asc" }, select: { id: true, releaseId: true, status: true, mode: true, target: true, publishedAt: true, completedAt: true, verificationJson: true } },
      workflowEvents: { where: { eventType: { in: ["website.handoff_applied", "website.handoff_reviewed", "growth.content.rescheduled"] } }, orderBy: { occurredAt: "asc" } },
      executionTasks: { include: { dependencies: { include: { requiredTask: { select: { status: true, title: true } } } } } },
      nextBestActions: { where: { sourceType: "growth_engine", status: { notIn: ["rejected", "dismissed", "superseded"] } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }] },
      growthBlueprint: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
    } });
    if (!project) return null;
    const launch = verifiedGrowthLaunch(project);
    if (!launch) return { projectId, checkedAt: now.toISOString(), launchAt: null, launchSource: null, items: [], counts: {}, websiteChecks: [{ title: "Website launch and verification required", status: "needs_check", evidence: GROWTH_LAUNCH_REQUIRED, url: `/site-architect?projectId=${encodeURIComponent(projectId)}` }] };
    const query = `projectId=${encodeURIComponent(project.id)}`;
    const blueprint = project.growthBlueprint?.versions[0];
    const queueFor = (dedupeKey: string | null) => {
      for (const key of ["now", "next", "later", "conditional"] as const) if ((Array.isArray(blueprint?.[`${key}Json`]) ? blueprint![`${key}Json`] as any[] : []).some(row => row.dedupeKey === dedupeKey)) return key;
      return "next";
    };
    const items: GrowthExecutionItem[] = [];
    for (const action of project.nextBestActions) {
      const task = project.executionTasks.find(t => t.id === action.followupTaskId || t.sourceType === "next_best_action" && t.sourceId === action.id) ?? null;
      const dependencies = task?.dependencies.filter(d => !["completed", "approved", "published", "verified", "skipped"].includes(d.requiredTask.status)) ?? [];
      const blockedReason = dependencies.length ? `Finish first: ${dependencies.map(d=>d.requiredTask.title).join(", ")}` : task?.blockedReason || (Array.isArray(action.dependencyIdsJson) && action.dependencyIdsJson.length ? "This suggestion has unmet requirements. Review them in the saved plan before starting." : null);
      const stage = blockedReason ? "waiting" : growthTaskStage(task, action.status);
      const guide = growthGuide({ ...action, projectId, taskId: task?.id });
      if (task && action.actionType === "strategy_conversion-path" && !completedGrowthTasks.has(task.status) && (task.relatedUrl !== guide.url || task.actionButtonLabel !== guide.button)) await tx.executionTask.update({ where: { id: task.id }, data: { moduleName: "website_intelligence", relatedUrl: guide.url, actionButtonLabel: guide.button, title: guide.title, manualInstructions: `${guide.work} Finished when: ${guide.done}` } });
      if (task && completedGrowthTasks.has(task.status) && action.status !== "completed") await tx.nextBestAction.update({ where: { id: action.id }, data: { status: "completed" } });
      items.push({ id: action.id, source: "suggestion", sourceTitle: action.title, title: guide.title, why: action.recommendation, status: stage, taskId: task?.id ?? null, queue: queueFor(action.dedupeKey), dueAt: task?.dueAt?.toISOString() ?? null, evidence: stage === "done" ? "This task has a saved completion record." : task ? "Your existing task is linked here. Continue from its saved progress." : "This task has not been started yet.", steps: growthSteps(guide, stage, task?.id ?? null, Boolean(blockedReason)), blockedReason, canStart: !task && !blockedReason && stage !== "done", targetUrl: typeof object(action.evidenceJson).targetUrl === "string" ? object(action.evidenceJson).targetUrl : null });
    }
    await ensureMonthlyLeadMagnets(tx, projectId, launch?.date ?? null, now);
    await ensureGrowthSocialContent(tx, projectId);
    const opportunities = await tx.growthContentOpportunity.findMany({ where: { projectId, lifecycleStatus: { notIn: ["rejected", "superseded"] } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }] });
    const workspace = project.agencyClient?.workspace ?? project.client.workspace;
    for (const [index, opportunity] of opportunities.entries()) {
      const task = project.executionTasks.find(t => t.id === opportunity.executionTaskId) ?? null;
      const cancelled = task && inactiveGrowthItems.has(task.status);
      const published = ["published", "measuring", "completed"].includes(opportunity.lifecycleStatus) || Boolean(task?.publishedAt) || task?.status === "published" || task?.status === "verified";
      if (opportunity.contentType === "lead_magnet" && task) {
        const lifecycle = published ? "published" : task.status === "needs_review" ? "needs_review" : task.status === "ready_to_publish" ? "scheduled" : null;
        if (lifecycle && lifecycle !== opportunity.lifecycleStatus) await tx.growthContentOpportunity.update({ where: { id: opportunity.id }, data: { lifecycleStatus: lifecycle } });
      }
      const stage = published ? "done" : cancelled ? "waiting" : task?.status === "completed" ? "review" : growthTaskStage(task);
      const blockedReason = cancelled ? "The linked task was cancelled. Review the article before creating replacement work." : opportunity.queue === "conditional" ? "This article is waiting for the conditions recorded in your content plan." : task?.blockedReason ?? null;
      const status = blockedReason ? "waiting" : stage;
      let due = opportunity.plannedPublishAt;
      const explicit = project.workflowEvents.some(e => e.eventType === "growth.content.rescheduled" && e.sourceId === opportunity.id);
      if (!published && !explicit && !due && launch && opportunity.queue !== "conditional") {
        due = contentPublishDate(launch.date, opportunity.plannedPhase, index);
        await tx.growthContentOpportunity.update({ where: { id: opportunity.id }, data: { plannedPublishAt: due, evidenceJson: { ...object(opportunity.evidenceJson), growthSchedule: { anchor: launch.date.toISOString(), offsetDays: Math.round((due!.getTime() - new Date(launch.date).setUTCHours(0,0,0,0))/86400000), source: "verified_launch" } } } });
      }
      if (task && due && !published && task.dueAt?.getTime() !== due.getTime()) await tx.executionTask.update({ where: { id: task.id }, data: { dueAt: due } });
      const guide = growthGuide({ actionType: opportunity.contentType === "lead_magnet" ? "lead_capture" : opportunity.contentType === "social_post" ? "social_post" : "content_growth", route: "content", title: opportunity.title, projectId, taskId: task?.id, content: true });
      if (opportunity.contentType === "lead_magnet") guide.url += `&topic=${encodeURIComponent(opportunity.title)}${task?.relatedAssetId ? `&funnelId=${encodeURIComponent(task.relatedAssetId)}` : ""}`;
      if (opportunity.contentType === "social_post" && object(opportunity.evidenceJson).socialCalendarPostId) guide.url = `/social-strategy?projectId=${encodeURIComponent(projectId)}&campaignId=${encodeURIComponent(object(opportunity.evidenceJson).socialStrategyId)}&postId=${encodeURIComponent(object(opportunity.evidenceJson).socialCalendarPostId)}&mode=posting`;
      const item: GrowthExecutionItem = { id: opportunity.id, source: "content", contentType: opportunity.contentType, sourceTitle: opportunity.title, title: opportunity.contentType === "lead_magnet" ? `Prepare download: ${opportunity.title}` : guide.title, why: opportunity.businessPurpose, status, taskId: task?.id ?? null, queue: opportunity.queue, dueAt: due?.toISOString() ?? null, targetUrl: opportunity.internalLinkTargetUrl || opportunity.targetUrl, evidence: published ? "Publication is recorded for this article." : task ? "Your article task is saved. Publication has not been confirmed yet." : "Suggested topic only. No content has been created or published yet.", steps: growthSteps(guide, status, task?.id ?? null, Boolean(blockedReason)), blockedReason, canStart: !task && !blockedReason && !published };
      items.push(item);
      const reminder = growthReminder(due, status, now);
      if (reminder && opportunity.contentType === "lead_magnet") { reminder.title = reminder.title.replace(/Article|article/g, "Lead magnet"); reminder.next = "Prepare or review the download and check its sign-up tracking"; }
      if (reminder && opportunity.contentType === "social_post") { reminder.title = reminder.title.replace(/Article|article/g, "Social post"); reminder.next = "Review the post, check its live link and approve before publishing"; }
      if (options.notify && project.status === "active" && workspace && reminder && !blockedReason) {
        const key = `growth-content-reminder:${opportunity.id}:${due!.toISOString()}:${reminder.key}`;
        const already = await tx.projectWorkflowEvent.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
        if (!already) {
          const memberships = await tx.workspaceMembership.findMany({ where: { workspaceId: workspace.id, status: "active", OR: [{ id: { in: [task?.assigneeMembershipId,task?.managerMembershipId].filter((id): id is string=>Boolean(id)) } }, { userId: workspace.ownerUserId }] }, select: { userId: true } });
          for (const userId of new Set(memberships.map(m=>m.userId))) await tx.workspaceNotification.create({ data: { workspaceId: workspace.id, userId, projectId, agencyClientId: project.agencyClientId, type: opportunity.contentType === "lead_magnet" ? "growth_lead_magnet_due" : opportunity.contentType === "social_post" ? "growth_social_due" : "growth_content_due", title: reminder.title, body: `${opportunity.title} · ${due!.toISOString().slice(0,10)}. ${reminder.next}. Publication requires approval.`, actionUrl: `/growth?${query}&tab=execution&item=${opportunity.id}`, emailEligible: true, emailStatus: "pending" } });
          if (memberships.length) await tx.projectWorkflowEvent.create({ data: { projectId, eventType: "growth.content.reminded", sourceModule: "growth_execution", sourceId: opportunity.id, idempotencyKey: key, payloadJson: { dueAt: due!.toISOString(), stage: status }, occurredAt: now, processedAt: now } });
        }
      }
    }
    const plan = project.executionTasks.find(t => object(t.approvalSnapshotJson).contentPlan && ["approved","completed","published"].includes(t.status));
    const checks = [
      { title: "Website launch confirmed", status: launch ? "done" : "needs_check", evidence: launch ? "Your website launch has been confirmed and checked." : "Confirm and check your website launch to set Day 0.", url: `/site-architect?${query}` },
      { title: "Website pages and topics planned", status: plan ? "done" : "needs_check", evidence: plan ? "Your approved website page plan is already saved." : "Review the website plan before adding new pages.", url: `/seo-page-map?${query}` },
      { title: "Live website assessed", status: project.website?.crawlJobs[0] ? "done" : "needs_check", evidence: project.website?.crawlJobs[0] ? "A completed website check is saved. Later changes need a new check." : "No completed assessment is recorded.", url: `/site-analysis?${query}` },
      { title: "Website visits are tracked", status: project.website?.trackingSite?.lastVerifiedAt ? "done" : "needs_check", evidence: project.website?.trackingSite?.lastVerifiedAt ? "A tracking event has been received. Enquiry and sales tracking are separate checks." : "Website tracking not available.", url: `/projects/${projectId}/website/performance` },
    ];
    const view: GrowthExecutionView = { projectId, checkedAt: now.toISOString(), launchAt: launch?.date.toISOString() ?? null, launchSource: launch?.source ?? null, items, websiteChecks: checks, counts: items.reduce((counts,item)=>(counts[item.status]=(counts[item.status]??0)+1,counts),{} as Record<string,number>) };
    await tx.projectWorkflowEvent.upsert({ where: { idempotencyKey: `growth-execution-view:${projectId}` }, create: { projectId, eventType: "growth.execution.checked", sourceModule: "growth_execution", idempotencyKey: `growth-execution-view:${projectId}`, payloadJson: view as unknown as Prisma.InputJsonValue, occurredAt: now, processedAt: now }, update: { payloadJson: view as unknown as Prisma.InputJsonValue, occurredAt: now, processedAt: now } });
    return view;
  }, { maxWait: 10000, timeout: 30000 });
}
