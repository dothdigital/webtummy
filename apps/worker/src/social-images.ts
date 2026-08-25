import { createHmac } from "node:crypto";
import { Worker } from "bullmq";
import { prisma } from "@webtummy/db";
import { putGeneratedObject } from "@webtummy/core/object-storage";
import { config, SOCIAL_IMAGE_QUEUE } from "./config.js";
import { connection, type SocialImageJobData } from "./queue.js";
import { actionEmail, sendMail } from "./email.js";

async function notifyCampaignImagesReady(input: SocialImageJobData) {
  const post = await prisma.socialCalendarPost.findUnique({
    where: { id: input.postId },
    include: { strategy: { include: { project: true, posts: { select: { imageStatus: true, imageUrl: true } } } } },
  });
  const strategy = post?.strategy;
  if (!strategy?.projectId || !strategy.project) return;
  if (strategy.posts.some((item) => ["queued", "generating"].includes(item.imageStatus))) return;
  const readyCount = strategy.posts.filter((item) => Boolean(item.imageUrl)).length;
  if (!readyCount) return;
  const actionUrl = `/social-strategy?projectId=${encodeURIComponent(strategy.projectId)}`;
  const type = `social_images_ready:${strategy.id}`;
  const existing = await prisma.workspaceNotification.findFirst({ where: { workspaceId: input.workspaceId, userId: input.createdByUserId, type }, select: { id: true } });
  if (existing) return;
  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.createdByUserId } },
    select: { status: true, permissionOverrides: true, user: { select: { email: true, name: true } } },
  });
  if (!membership || membership.status !== "active") return;
  const overrides = membership.permissionOverrides && typeof membership.permissionOverrides === "object" && !Array.isArray(membership.permissionOverrides)
    ? membership.permissionOverrides as { notificationPreferences?: unknown }
    : {};
  const preferences = overrides.notificationPreferences && typeof overrides.notificationPreferences === "object" && !Array.isArray(overrides.notificationPreferences)
    ? overrides.notificationPreferences as { nonCriticalEmail?: unknown; emailFrequency?: unknown }
    : {};
  const emailEligible = preferences.nonCriticalEmail !== false;
  const notification = await prisma.workspaceNotification.create({ data: {
    workspaceId: input.workspaceId,
    userId: input.createdByUserId,
    agencyClientId: strategy.project.agencyClientId,
    projectId: strategy.projectId,
    type,
    title: "Social campaign images are ready",
    body: `${strategy.campaignName || strategy.project.name}: ${readyCount} image${readyCount === 1 ? " is" : "s are"} ready for review. Approve the content and visuals before scheduling.`,
    actionUrl,
    emailEligible,
    emailStatus: emailEligible ? "pending" : "disabled",
  } });
  if (emailEligible && preferences.emailFrequency === "immediate") {
    const reviewUrl = `${config.webAppUrl.replace(/\/$/, "")}${actionUrl}`;
    const content = actionEmail({
      greeting: membership.user.name?.trim() ? `Hi ${membership.user.name.trim()},` : "Hello,",
      title: "Your social campaign images are ready",
      message: `${strategy.campaignName || strategy.project.name}: ${readyCount} image${readyCount === 1 ? " is" : "s are"} ready. Review the captions, CTAs, hashtags, and visuals before scheduling.`,
      ctaLabel: "Review social campaign",
      ctaUrl: reviewUrl,
      previewText: "Review captions, CTAs, hashtags and visuals before scheduling.",
      completedAt: new Date(),
      preferencesUrl: `${config.webAppUrl.replace(/\/$/, "")}/reports`,
      supportEmail: config.supportEmail,
      reason: "You are receiving this email because you requested AI image generation and selected immediate workspace notifications.",
    });
    try {
      await sendMail({ to: membership.user.email, subject: "Your SEnuke AI social campaign images are ready", ...content });
      await prisma.workspaceNotification.update({ where: { id: notification.id }, data: { emailStatus: "sent" } });
    } catch (error) {
      console.error(`[worker] immediate social campaign email failed for ${notification.id}:`, error);
    }
  }
}

function deliveryUrl(assetId: string) {
  const token = createHmac("sha256", config.appEncryptionKey).update(`generated-asset:${assetId}`).digest("hex");
  return `${config.publicApiUrl.replace(/\/$/, "")}/api/public/generated-assets/${encodeURIComponent(assetId)}/content?token=${token}`;
}

async function generateSocialImage(postId: string, workspaceId: string, createdByUserId: string) {
  const post = await prisma.socialCalendarPost.findUnique({ where: { id: postId }, include: { strategy: { include: { project: true } } } });
  if (!post?.strategy.projectId || !post.strategy.project) throw new Error(`Social post ${postId} is unavailable.`);
  if (post.imageUrl || ["scheduled", "published"].includes(post.status)) return;
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is not configured on the worker.");
  await prisma.socialCalendarPost.update({ where: { id: post.id }, data: { imageStatus: "generating" } });
  const businessName = post.strategy.businessNameBrief || post.strategy.project.businessName || post.strategy.project.name;
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openaiImageModel,
      size: post.platform === "instagram" ? "1024x1024" : "1536x1024",
      quality: "medium",
      output_format: "png",
      n: 1,
      prompt: [
        `Create an original, polished ${post.platform} campaign image for ${businessName}.`,
        `Campaign: ${post.strategy.campaignName || "social campaign"}. Post type: ${post.postType}. Topic: ${post.topic}.`,
        `Target keyword: ${post.targetKeyword || "not assigned"}. Target location: ${post.targetLocation || "not location-specific"}.`,
        `Audience: ${post.strategy.audience || "the verified project audience"}. Caption: ${post.caption.slice(0, 4_000)}.`,
        `Required visual direction: ${post.imageSuggestion || post.strategy.imageDirection || "Specific, credible editorial imagery with a clear focal subject."}`,
        "Do not add logos, watermarks, URLs, fake testimonials, unsupported statistics, fabricated local details, or dense text.",
      ].join("\n"),
    }),
  });
  const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerError = raw.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : {};
    throw new Error(typeof providerError.message === "string" ? providerError.message : `Image generation returned HTTP ${response.status}.`);
  }
  const first = Array.isArray(raw.data) && raw.data[0] && typeof raw.data[0] === "object" ? raw.data[0] as Record<string, unknown> : {};
  if (typeof first.b64_json !== "string" || !first.b64_json) throw new Error("The image provider returned no image data.");
  const body = Buffer.from(first.b64_json, "base64");
  const uploaded = await putGeneratedObject({ workspaceId, projectId: post.strategy.projectId, assetType: "generated-images", filename: `social-post-${post.id}.png`, contentType: "image/png", body, source: "openai_generated", metadata: { post: post.id, platform: post.platform } });
  await prisma.$transaction(async (tx) => {
    await tx.generatedAsset.create({ data: { id: uploaded.assetId, workspaceId, projectId: post.strategy.projectId, bucket: uploaded.bucket, objectKey: uploaded.objectKey, versionId: uploaded.versionId, etag: uploaded.etag, assetType: "generated-images", mimeType: "image/png", sizeBytes: uploaded.sizeBytes, checksumSha256: uploaded.checksumSha256, visibility: "private", source: "openai_generated", originalFilename: `social-post-${post.id}.png`, altText: post.imageAltText, sourceEntityType: "social_calendar_post", sourceEntityId: post.id, createdByUserId, metadataJson: { model: config.openaiImageModel, platform: post.platform } } });
    await tx.socialCalendarPost.update({ where: { id: post.id }, data: { imageUrl: deliveryUrl(uploaded.assetId), imageStatus: "image_generated", status: "needs_review" } });
    await tx.executionTask.updateMany({ where: { projectId: post.strategy.projectId!, sourceType: "social_calendar_post", sourceId: post.id }, data: { status: "needs_review", approvedAt: null, approverMembershipId: null, blockedReason: "Background image generation completed; review the final image before approval." } });
  });
}

export function startSocialImageWorker() {
  const worker = new Worker<SocialImageJobData>(SOCIAL_IMAGE_QUEUE, async (job) => generateSocialImage(job.data.postId, job.data.workspaceId, job.data.createdByUserId), { connection, concurrency: 2 });
  worker.on("completed", (job) => {
    console.log(`[worker] generated social image for ${job.data.postId}`);
    void notifyCampaignImagesReady(job.data).catch((error) => console.error(`[worker] social campaign notification failed for ${job.data.postId}:`, error));
  });
  worker.on("failed", (job, error) => {
    console.error(`[worker] social image ${job?.data.postId || "unknown"} failed:`, error.message);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) prisma.socialCalendarPost.updateMany({ where: { id: job.data.postId, imageUrl: null }, data: { imageStatus: "failed" } }).catch(() => undefined);
  });
  return worker;
}
