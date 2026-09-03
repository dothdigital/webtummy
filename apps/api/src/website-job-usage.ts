import { prisma } from "@webtummy/db";
import { preflightUsage, refundUsage } from "./usage-engine.js";

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const websiteJobIsIncludedRevision = (value: unknown) => {
  const input = objectValue(value);
  return input.regenerate === true || input.regenerateImages === true;
};

export async function reserveWebsiteJobUsage(jobId: string) {
  const job = await prisma.websiteBuildJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Website build job not found.");
  if (job.usageEventId) return job;

  const input = objectValue(job.inputJson);
  const mode = String(input.mode || "website_generation");
  const revision = websiteJobIsIncludedRevision(input);
  // User-requested revisions replace previously generated work and are
  // included. They still run through the worker, but must not reserve or
  // commit Capacity a second time.
  if (revision) return job;
  const recovery = Boolean(input.resumedFromJobId);
  const pageCount = Math.max(1, stringList(input.pageIds).length);
  const generateImages = input.generateImages !== false;
  const billPageContent = mode === "content_generation" || input.generateMissingContent === true;
  const imageCount = mode === "image_generation"
    ? Math.max(1, Number(input.imageCount || pageCount))
    : generateImages ? pageCount + 2 : 0;
  const featureKey = mode === "image_generation" ? "website_image_generate" : "website_page_generate";
  const actionKey = mode === "image_generation"
    ? revision ? "Regenerate website images" : "Generate website images"
    : mode === "content_generation"
      ? revision ? "Regenerate website page content" : "Generate website page content"
      : revision ? "Regenerate complete website and images" : "Generate complete website";
  const baseIdempotencyKey = `website-build-job:${job.id}`;
  const existingUsage = await prisma.usageEvent.findUnique({
    where: { clientId_idempotencyKey: { clientId: job.clientId, idempotencyKey: baseIdempotencyKey } },
  });
  const reusableUsage = existingUsage && ["reserved", "committed"].includes(existingUsage.status) ? existingUsage : null;
  const idempotencyKey = reusableUsage ? baseIdempotencyKey : existingUsage ? `${baseIdempotencyKey}:retry:${Date.now()}` : baseIdempotencyKey;
  const reservation = reusableUsage
    ? { usageEventId: existingUsage.id }
    : await preflightUsage({
        clientId: job.clientId,
        userId: job.requestedByUserId,
        projectId: job.projectId,
        featureKey,
        actionKey,
        inputUnits: pageCount,
        idempotencyKey,
        metadata: { websiteBuildJobId: job.id, mode, pageCount, imageCount, generateImages, billPageContent, revision, recovery, billingReason: recovery ? "failed_job_recovery" : "new_generation", execution: "background_job" },
      });

  const linked = await prisma.$transaction(async (tx) => {
    const result = await tx.websiteBuildJob.updateMany({
      where: { id: job.id, usageEventId: null },
      data: { usageEventId: reservation.usageEventId },
    });
    if (!result.count) return false;
    await tx.usageEvent.update({
      where: { id: reservation.usageEventId },
      data: { approvalTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) },
    });
    return true;
  });
  if (!linked) {
    await refundUsage({ usageEventId: reservation.usageEventId, reason: "Website job already had a capacity reservation." });
  }
  return prisma.websiteBuildJob.findUniqueOrThrow({ where: { id: job.id } });
}

export async function refundWebsiteJobUsage(jobId: string, reason: string) {
  const job = await prisma.websiteBuildJob.findUnique({ where: { id: jobId }, select: { usageEventId: true } });
  if (!job?.usageEventId) return;
  const usage = await prisma.usageEvent.findUnique({ where: { id: job.usageEventId }, select: { status: true } });
  if (usage?.status === "reserved") await refundUsage({ usageEventId: job.usageEventId, reason });
}
