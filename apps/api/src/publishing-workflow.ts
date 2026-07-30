import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Prisma, prisma } from "@webtummy/db";
import { publishingState, publishingValidationErrors, type PublishingTarget, type PublishingVerification } from "@webtummy/core/publishing";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "./workspace-access.js";

type Context = Awaited<ReturnType<typeof workspaceContext>>;
type JsonRecord = Record<string, unknown>;

const publishingTaskInclude = {
  project: { include: { agencyClient: true } },
  assignee: { include: { user: true } },
  manager: { include: { user: true } },
  approver: { include: { user: true } },
  dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } },
};

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function privateAddress(address: string) {
  if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return true;
  if (!isIP(address)) return true;
  if (address.includes(":")) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function verifyPublicHtmlUrl(expected: string, actual?: string | null) {
  if (!actual || actual !== expected) throw Object.assign(new Error("The verified HTML URL must match the deployment target."), { statusCode: 409 });
  const url = new URL(actual);
  if (!/^https?:$/.test(url.protocol) || ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw Object.assign(new Error("The deployment URL is not publicly verifiable."), { statusCode: 409 });
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw Object.assign(new Error("The deployment URL resolves to a private or unsafe address."), { statusCode: 409 });
  const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Object.assign(new Error(`The deployment URL could not be verified (${response.status}).`), { statusCode: 409 });
}

function autoPublishingEnabled(context: Context) {
  if (context.workspace.workspaceType === "personal") return true;
  const policy = jsonRecord(context.workspace.autoApprovalPolicyJson);
  const actions = Array.isArray(policy.enabledActions) ? policy.enabledActions : [];
  return policy.publishing === true || actions.includes("publishing");
}

function inferTarget(task: { moduleName: string; sourceType: string; title: string; project: { preferredPublishingMethod: string | null } | null }): PublishingTarget {
  const text = `${task.moduleName} ${task.sourceType} ${task.title} ${task.project?.preferredPublishingMethod ?? ""}`.toLowerCase();
  if (/shopify/.test(text)) return "shopify";
  if (/social/.test(text)) return "social";
  if (/wordpress|woocommerce/.test(text)) return "wordpress";
  return "html";
}

async function publishingTask(context: Context, taskId: string) {
  const task = await prisma.executionTask.findUnique({ where: { id: taskId }, include: publishingTaskInclude });
  if (!task?.projectId || !await canAccessProject(context, task.projectId)) throw Object.assign(new Error("Publishing task not found."), { statusCode: 404 });
  return task;
}

async function publishingRecipients(tx: Prisma.TransactionClient, context: Context, task: Awaited<ReturnType<typeof publishingTask>>, includeOwners: boolean) {
  const direct = [task.assignee?.userId, task.manager?.userId, task.createdByUserId].filter((id): id is string => Boolean(id));
  if (!includeOwners) return [...new Set(direct)];
  const owners = await tx.workspaceMembership.findMany({
    where: { workspaceId: context.workspace.id, status: "active", roles: { some: { role: { in: ["owner", "admin"] } } } },
    select: { userId: true },
  });
  return [...new Set([...direct, ...owners.map((member) => member.userId)])];
}

export async function startTaskPublishing(context: Context, taskId: string, input: {
  target?: PublishingTarget;
  targetReference?: string | null;
  previousVersionReference?: string | null;
  metadata?: JsonRecord;
  providerInitiated?: boolean;
}) {
  if (!hasWorkspacePermission(context, "publish")) throw Object.assign(new Error("Publishing permission is required."), { statusCode: 403 });
  const task = await publishingTask(context, taskId);
  const currentSnapshot = jsonRecord(task.approvalSnapshotJson);
  const currentPublishing = jsonRecord(currentSnapshot.publishing);
  if (task.status === "publishing" && currentPublishing.attemptId) return { task, publishing: currentPublishing, idempotent: true };

  const target = input.target ?? inferTarget(task);
  const targetReference = input.targetReference?.trim() || task.relatedAssetId || task.sourceId || null;
  const dependenciesComplete = task.dependencies.every((dependency) => ["completed", "published", "approved"].includes(dependency.requiredTask.status));
  const validationErrors = publishingValidationErrors({
    target,
    approvedAt: task.approvedAt,
    autoApprovalEnabled: autoPublishingEnabled(context),
    clientApprovalRequired: task.clientApprovalRequired,
    clientApprovedAt: task.clientApprovedAt,
    dependenciesComplete,
    targetReference,
  });
  if (target === "social" && !input.providerInitiated) validationErrors.push("Social publishing must be initiated through the connected social publishing module.");
  if (target === "shopify" && !input.providerInitiated) validationErrors.push("Shopify publishing is unavailable until a supported Shopify delivery integration is connected.");
  if (validationErrors.length) {
    await prisma.$transaction(async (tx) => recordWorkspaceActivity(tx, {
      context, action: "publishing.validation_failed", entityType: "execution_task", entityId: task.id,
      agencyClientId: task.project?.agencyClientId, projectId: task.projectId,
      previousJson: { status: task.status, publishedAt: task.publishedAt },
      nextJson: { target, targetReference, errors: validationErrors }, metadataJson: { phase: "validate" },
    }));
    throw Object.assign(new Error(validationErrors.join(" ")), { statusCode: 409 });
  }
  if (!["ready_to_publish", "ready", "approved"].includes(task.status) && !autoPublishingEnabled(context)) throw Object.assign(new Error("Work must be approved and ready before publishing."), { statusCode: 409 });

  const attemptId = randomUUID();
  const now = new Date();
  const publishing = {
    attemptId, target, targetReference, status: "pending", startedAt: now.toISOString(),
    previousVersionReference: input.previousVersionReference ?? currentPublishing.liveUrl ?? null,
    previousTaskState: { status: task.status, publishedAt: task.publishedAt?.toISOString() ?? null },
    metadata: input.metadata ?? {},
  };

  return prisma.$transaction(async (tx) => {
    if (target === "wordpress") {
      const job = await tx.wordPressPublishJob.findFirst({ where: { id: targetReference!, projectId: task.projectId! }, include: { integration: true } });
      if (!job) throw Object.assign(new Error("WordPress publishing job not found."), { statusCode: 404 });
      if (!job.integration || job.integration.connectionStatus !== "connected") throw Object.assign(new Error("A connected WordPress integration is required."), { statusCode: 409 });
      await tx.wordPressPublishJob.update({ where: { id: job.id }, data: { status: "queued", errorMessage: null, completedAt: null, rollbackNote: job.rollbackNote || `Keep ${input.previousVersionReference ?? "the current live version"} active until verification succeeds.` } });
    }
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: { status: "publishing", blockedReason: null, approvalSnapshotJson: { ...currentSnapshot, publishing } as Prisma.InputJsonValue } });
    if (task.sourceType === "growth_content_opportunity" && task.sourceId) {
      await tx.growthContentOpportunity.updateMany({
        where: { id: task.sourceId, projectId: task.projectId! },
        data: { lifecycleStatus: "publishing", executionTaskId: task.id },
      });
    }
    await recordWorkspaceActivity(tx, {
      context, action: "publishing.started", entityType: "execution_task", entityId: task.id,
      agencyClientId: task.project?.agencyClientId, projectId: task.projectId,
      previousJson: { status: task.status, publishedAt: task.publishedAt, versionReference: publishing.previousVersionReference },
      nextJson: { status: "publishing", attemptId, target, targetReference },
      metadataJson: { phase: "validate_publish", autoApproval: !task.approvedAt && autoPublishingEnabled(context) },
    });
    return { task: updated, publishing, idempotent: false };
  });
}

export async function verifyTaskPublishing(context: Context, taskId: string, input: PublishingVerification & { attemptId: string; trustedVerification?: boolean }) {
  if (!hasWorkspacePermission(context, "publish")) throw Object.assign(new Error("Publishing permission is required."), { statusCode: 403 });
  const task = await publishingTask(context, taskId);
  const currentSnapshot = jsonRecord(task.approvalSnapshotJson);
  const publishing = jsonRecord(currentSnapshot.publishing);
  if (publishing.attemptId !== input.attemptId) throw Object.assign(new Error("Publishing attempt does not match the active task attempt."), { statusCode: 409 });
  if (task.status === "published" && input.status === "verified") return { task, publishing, idempotent: true };
  if (task.status !== "publishing") throw Object.assign(new Error("This publishing attempt is no longer active."), { statusCode: 409 });

  const target = publishing.target as PublishingTarget;
  const targetReference = String(publishing.targetReference ?? "");
  if (input.status === "verified" && !input.trustedVerification) {
    if (target === "html") await verifyPublicHtmlUrl(targetReference, input.liveUrl);
    else if (target === "wordpress") {
      const job = await prisma.wordPressPublishJob.findFirst({ where: { id: targetReference, projectId: task.projectId!, status: "completed" }, select: { id: true } });
      if (!job) throw Object.assign(new Error("WordPress has not reported this publishing job as completed."), { statusCode: 409 });
    } else throw Object.assign(new Error(`${target} publishing must be verified by its connected provider.`), { statusCode: 409 });
  }

  const status = publishingState(input);
  const now = new Date();
  const nextPublishing = { ...publishing, ...input, verifiedAt: now.toISOString() };
  return prisma.$transaction(async (tx) => {
    if (target === "wordpress" && targetReference) await tx.wordPressPublishJob.updateMany({
      where: { id: targetReference, projectId: task.projectId! },
      data: { status: input.status === "verified" ? "completed" : input.status, externalPostId: input.externalId ?? undefined, errorMessage: input.error ?? null, completedAt: input.status === "verified" ? now : null },
    });
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: {
      status,
      publishedAt: input.status === "verified" ? now : task.publishedAt,
      blockedReason: input.status === "failed" ? input.error || "Publishing failed verification; the previous version remains active." : null,
      approvalSnapshotJson: { ...currentSnapshot, publishing: nextPublishing } as Prisma.InputJsonValue,
    } });
    if (task.sourceType === "growth_content_opportunity" && task.sourceId) {
      await tx.growthContentOpportunity.updateMany({
        where: { id: task.sourceId, projectId: task.projectId! },
        data: {
          lifecycleStatus: input.status === "verified"
            ? "measuring"
            : input.status === "failed"
              ? "needs_review"
              : "publishing",
          executionTaskId: task.id,
        },
      });
    }
    if (input.status === "verified" && task.projectId && ["content", "publishing", "local_seo"].includes(task.moduleName)) {
      const addDays = (days: number) => new Date(now.getTime() + days * 86_400_000);
      const baseline = { publishedAt: now.toISOString(), liveUrl: input.liveUrl ?? null, externalId: input.externalId ?? null, checksum: input.checksum ?? null, sourceTaskId: task.id };
      await tx.measurementCheckpoint.createMany({ data: [
        { projectId: task.projectId, taskId: task.id, checkpointType: "post_publish", dueAt: now, baselineJson: baseline },
        { projectId: task.projectId, taskId: task.id, checkpointType: "day_30", dueAt: addDays(30), baselineJson: baseline },
        { projectId: task.projectId, taskId: task.id, checkpointType: "day_60", dueAt: addDays(60), baselineJson: baseline },
        { projectId: task.projectId, taskId: task.id, checkpointType: "day_90", dueAt: addDays(90), baselineJson: baseline },
        { projectId: task.projectId, taskId: task.id, checkpointType: "recurring_180", dueAt: addDays(180), baselineJson: baseline },
      ], skipDuplicates: true });
      if (input.liveUrl) await tx.contentDiscoveryCheck.create({ data: { projectId: task.projectId, taskId: task.id, liveUrl: input.liveUrl, status: "pending", evidenceJson: { publishingAttemptId: input.attemptId, target } } });
    }
    await recordWorkspaceActivity(tx, {
      context, action: input.status === "verified" ? "publishing.completed" : input.status === "failed" ? "publishing.failed" : "publishing.verification_pending",
      entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId,
      previousJson: { status: task.status, versionReference: publishing.previousVersionReference == null ? null : String(publishing.previousVersionReference) },
      nextJson: { status, attemptId: input.attemptId, externalId: input.externalId, liveUrl: input.liveUrl, checksum: input.checksum, error: input.error },
      metadataJson: { phase: "verify", previousVersionRetained: input.status === "failed" },
    });
    const failed = input.status === "failed";
    for (const userId of await publishingRecipients(tx, context, task, failed)) await createWorkspaceNotification(tx, {
      context, userId, type: failed ? "publishing_failed" : input.status === "verified" ? "publishing_completed" : "publishing_verification_pending",
      title: failed ? "Publishing failed" : input.status === "verified" ? "Publishing completed" : "Publishing verification pending",
      body: failed ? `${task.title} was not published. The previous version remains active. ${input.error ?? "Review the publishing log and retry."}` : input.status === "verified" ? `${task.title} was published and verified.` : `${task.title} was sent to ${target} and is awaiting verification.`,
      actionUrl: task.relatedUrl ?? `/guided-projects/${task.projectId}#execution-tasks`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId,
    });
    if (input.status === "verified" && task.projectId && ["content", "publishing", "local_seo"].includes(task.moduleName)) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "measurement_checkpoints_scheduled", title: "Measurement checkpoints scheduled", body: `${task.title} is live. Discovery and post-publish, 30-day, 60-day, 90-day, and recurring reviews are scheduled.`, actionUrl: `/guided-projects/${task.projectId}?tab=execution#optimization-workflow`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId });
    return { task: updated, publishing: nextPublishing, idempotent: false };
  });
}
