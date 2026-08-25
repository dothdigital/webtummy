import { createHmac } from "node:crypto";
import { Worker } from "bullmq";
import { prisma } from "@webtummy/db";
import { putGeneratedObject } from "@webtummy/core/object-storage";
import { config, SOCIAL_IMAGE_QUEUE } from "./config.js";
import { connection, type SocialImageJobData } from "./queue.js";

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
  worker.on("completed", (job) => console.log(`[worker] generated social image for ${job.data.postId}`));
  worker.on("failed", (job, error) => {
    console.error(`[worker] social image ${job?.data.postId || "unknown"} failed:`, error.message);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) prisma.socialCalendarPost.updateMany({ where: { id: job.data.postId, imageUrl: null }, data: { imageStatus: "failed" } }).catch(() => undefined);
  });
  return worker;
}
