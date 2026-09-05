import { prisma } from "@webtummy/db";
import { metricChange, type EmailTable } from "./email.js";
import { searchPerformanceEmailTables } from "./report-email.js";

export async function collectReportEmailEvidence(projectId: string, start: Date, end: Date): Promise<EmailTable[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { websiteId: true, website: { select: { trackingSite: true } } } });
  const tracker = project?.website?.trackingSite;
  const previousStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  const enabled = !!tracker?.enabled && !!tracker.lastVerifiedAt;
  const count = (eventName: string, from: Date, to: Date) => enabled ? prisma.websiteTrackingEvent.count({ where: { projectId, trackingSiteId: tracker!.id, eventName, occurredAt: { gte: from, lt: to } } }) : Promise.resolve(null);
  const rows = await Promise.all(["page_view", "form_success"].map(async event => {
    const current = await count(event, start, end);
    const previous = tracker?.createdAt && tracker.createdAt <= previousStart ? await count(event, previousStart, start) : null;
    return [event === "page_view" ? "Recorded page views" : "Recorded form submissions", String(current ?? "Not available"), String(previous ?? "Not available"), metricChange(current, previous)];
  }));
  const tables: EmailTable[] = [{ title: "Website activity", columns: ["Metric", "Current", "Previous", "Change"], rows, note: `Current: ${start.toISOString()} to ${end.toISOString()}. Previous equal-length window: ${previousStart.toISOString()} to ${start.toISOString()}. Recorded events only; collection gaps and blocked tracking can undercount activity. Form submissions are not verified sales.` }];
  const connection = await prisma.googleSearchConsoleConnection.findUnique({ where: { projectId }, select: { id: true, websiteId: true, propertyUrl: true } });
  const snapshot = connection && connection.websiteId === project?.websiteId && connection.propertyUrl ? await prisma.googleSearchConsoleSnapshot.findFirst({ where: { connectionId: connection.id, propertyUrl: connection.propertyUrl, sourceFetchedAt: { lte: end } }, orderBy: { sourceFetchedAt: "desc" } }) : null;
  if (!snapshot) return [...tables, ...searchPerformanceEmailTables(null, null, "No imported snapshot")];
  // Compare adjacent equal-length windows only, never two overlapping rolling imports.
  const days = Math.round((Date.parse(snapshot.endDate) - Date.parse(snapshot.startDate)) / 86400000) + 1;
  const previousEnd = new Date(Date.parse(snapshot.startDate) - 86400000).toISOString().slice(0, 10);
  const previousBeginning = new Date(Date.parse(snapshot.startDate) - days * 86400000).toISOString().slice(0, 10);
  const prior = await prisma.googleSearchConsoleSnapshot.findFirst({ where: { connectionId: snapshot.connectionId, propertyUrl: snapshot.propertyUrl, startDate: previousBeginning, endDate: previousEnd, sourceFetchedAt: { lte: end } }, orderBy: { sourceFetchedAt: "desc" } });
  return [...tables, ...searchPerformanceEmailTables(snapshot.dataJson, prior?.dataJson, `${snapshot.startDate} – ${snapshot.endDate} (imported ${snapshot.sourceFetchedAt.toISOString()})`, prior ? `${prior.startDate} – ${prior.endDate}` : undefined)];
}
