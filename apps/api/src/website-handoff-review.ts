import { prisma } from "@webtummy/db";
import { resolveHandoffReview } from "./website-handoff-review-state.js";

export async function getWebsiteHandoffReview(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: {
    websiteId: true, websiteUrl: true,
    websiteBuilds: { orderBy: { updatedAt: "desc" }, take: 1, select: { settingsJson: true } },
    website: { select: { rootUrl: true, crawlJobs: { where: { status: "completed", pagesCrawled: { gt: 0 } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, pagesCrawled: true, createdAt: true, completedAt: true } } } },
    workflowEvents: { where: { eventType: { in: ["website.handoff_applied", "website.handoff_reviewed"] } }, orderBy: { occurredAt: "desc" }, select: { eventType: true, sourceId: true, occurredAt: true, payloadJson: true } },
  } });
  if (!project) return null;
  const settings = project.websiteBuilds[0]?.settingsJson as Record<string, unknown> | undefined;
  if ((settings?.hostingHandoff as Record<string, unknown> | undefined)?.destination !== "developer_handoff") return null;
  const releaseId = String(settings?.currentApprovedReleaseId || "");
  if (!releaseId) return null;
  const delivery = await prisma.websitePublication.findFirst({ where: { projectId, releaseId, target: "static_html", mode: { in: ["download", "developer_handoff"] }, status: "completed", completedAt: { not: null } }, orderBy: { completedAt: "asc" }, select: { completedAt: true } });
  if (!delivery?.completedAt) return null;
  const review = resolveHandoffReview({ releaseId, websiteId: project.websiteId, deliveredAt: delivery.completedAt, events: project.workflowEvents, crawls: project.website?.crawlJobs ?? [] });
  return { releaseId, websiteId: project.websiteId, websiteUrl: project.website?.rootUrl || project.websiteUrl, deliveredAt: delivery.completedAt, ...review };
}
