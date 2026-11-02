import { Prisma, prisma, type GoogleSearchConsoleConnection } from "@webtummy/db";
import { Queue } from "bullmq";
import { queueConnection } from "./queue.js";
import { decryptSearchCredential, encryptSearchCredential, refreshSearchToken, searchAnalytics, inspectSearchUrl, searchDateRange, propertyMatchesWebsite, searchConsoleConfigured, searchConsoleRedirectUri, searchReviewOpportunities } from "./google-search-console-provider.js";

export const SEARCH_CONSOLE_QUEUE = "senuke-search-console-sync";
export const searchConsoleQueue = new Queue<{ connectionId: string; revision: number }>(SEARCH_CONSOLE_QUEUE, { connection: queueConnection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: true, removeOnFail: { age: 86400, count: 100 } } });
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export async function searchAccessToken(connection: GoogleSearchConsoleConnection) {
  if (connection.accessTokenCiphertext && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decryptSearchCredential(connection.accessTokenCiphertext);
  if (!connection.refreshTokenCiphertext) throw Object.assign(new Error("Reconnect Search Console to allow background data imports."), { reauthRequired: true });
  const result = await refreshSearchToken(decryptSearchCredential(connection.refreshTokenCiphertext));
  if (!result.access_token) throw Object.assign(new Error("Google did not return a valid access token. Reconnect Search Console."), { reauthRequired: true });
  const updated = await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision, status: { in: ["connected", "needs_property"] } }, data: { accessTokenCiphertext: encryptSearchCredential(result.access_token), ...(result.refresh_token ? { refreshTokenCiphertext: encryptSearchCredential(result.refresh_token) } : {}), accessTokenExpiresAt: new Date(Date.now() + (result.expires_in || 3600) * 1000) } });
  if (!updated.count) throw new Error("The Google connection changed. Refresh the page and try again.");
  return result.access_token;
}
export async function enqueueSearchSync(connectionId: string) {
  const connection = await prisma.googleSearchConsoleConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (connection.status !== "connected" || !connection.propertyUrl) throw Object.assign(new Error("Connect Google and select your website property first."), { statusCode: 409 });
  const jobId = `${connection.id}-${connection.revision}`;
  const previous = await searchConsoleQueue.getJob(jobId);
  if (previous && !["completed", "failed"].includes(await previous.getState())) return { queued: true };
  if (previous) await previous.remove();
  await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision, status: "connected" }, data: { syncStatus: "queued", lastSyncAttemptAt: new Date(), errorMessage: null } });
  try { await searchConsoleQueue.add("sync", { connectionId, revision: connection.revision }, { jobId }); }
  catch { await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision }, data: { syncStatus: "failed", errorMessage: "The sync could not be queued. Try Sync now again." } }); throw new Error("The sync could not be queued. Try again."); }
  return { queued: true };
}
export async function searchConsoleOverview(projectId: string) {
  const connection = await prisma.googleSearchConsoleConnection.findUnique({ where: { projectId } });
  const snapshot = connection?.propertyUrl ? await prisma.googleSearchConsoleSnapshot.findFirst({ where: { connectionId: connection.id, propertyUrl: connection.propertyUrl }, orderBy: { sourceFetchedAt: "desc" } }) : null;
  return { configured: searchConsoleConfigured(), callbackUrl: searchConsoleRedirectUri(), connection: connection ? { status: connection.status, propertyUrl: connection.propertyUrl, syncStatus: connection.syncStatus, lastSyncedAt: connection.lastSyncedAt, lastSyncAttemptAt: connection.lastSyncAttemptAt, errorMessage: connection.errorMessage } : null,
    snapshot: snapshot ? { startDate: snapshot.startDate, endDate: snapshot.endDate, fetchedAt: snapshot.sourceFetchedAt, data: snapshot.dataJson } : null };
}
export async function updateSearchMeasurementSource(projectId: string, websiteId: string, status: string, propertyUrl: string | null) {
  const source = JSON.stringify([{ key: "search_console", status, required: false, propertyUrl, verifiedAt: status === "connected" ? new Date().toISOString() : null, source: "google_search_console_api" }]);
  await prisma.$executeRaw`UPDATE "WebsiteMeasurementPlan" SET "dataSourcesJson" =
    (SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof("dataSourcesJson") = 'array' THEN "dataSourcesJson" ELSE '[]'::jsonb END) AS item WHERE item->>'key' IS DISTINCT FROM 'search_console') || ${source}::jsonb,
    "updatedAt" = NOW() WHERE "websiteId" = ${websiteId} AND "active" = true AND ("projectId" = ${projectId} OR "projectId" IS NULL)
    AND EXISTS (SELECT 1 FROM "GoogleSearchConsoleConnection" c WHERE c."projectId" = ${projectId} AND c."websiteId" = ${websiteId}
      AND ((${status} = 'connected' AND c."status" = 'connected' AND c."propertyUrl" = ${propertyUrl} AND c."lastSyncedAt" IS NOT NULL)
        OR (${status} = 'awaiting_data' AND c."status" = 'connected' AND c."propertyUrl" = ${propertyUrl} AND c."lastSyncedAt" IS NULL)
        OR (c."status" = ${status} AND ${status} NOT IN ('connected', 'awaiting_data'))))`;
}
export async function runSearchConsoleSync(connectionId: string, revision: number) {
  const connection = await prisma.googleSearchConsoleConnection.findUnique({ where: { id: connectionId }, include: { project: { select: { websiteId: true, website: { select: { rootUrl: true } }, websitePublications: { where: { status: { in: ["published", "completed"] }, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, take: 1, select: { release: { select: { immutableSnapshot: true } } } } } } } });
  if (!connection || connection.revision !== revision || connection.status !== "connected" || !connection.propertyUrl) return;
  const rootUrl = connection.project.website?.rootUrl;
  if (!rootUrl || connection.project.websiteId !== connection.websiteId || !propertyMatchesWebsite(connection.propertyUrl, rootUrl)) {
    await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connectionId, revision }, data: { status: "needs_property", syncStatus: "failed", errorMessage: "The project website changed. Select a matching Google property again." } });
    return;
  }
  await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connectionId, revision }, data: { syncStatus: "running", lastSyncAttemptAt: new Date(), errorMessage: null } });
  try {
    const token = await searchAccessToken(connection), range = searchDateRange();
    const [totals, daily, pages, queries, pageQueries] = await Promise.all([
      searchAnalytics(token, connection.propertyUrl, range, [], rootUrl), searchAnalytics(token, connection.propertyUrl, range, ["date"], rootUrl),
      searchAnalytics(token, connection.propertyUrl, range, ["page"], rootUrl), searchAnalytics(token, connection.propertyUrl, range, ["query"], rootUrl), searchAnalytics(token, connection.propertyUrl, range, ["page", "query"], rootUrl),
    ]);
    const model = record(connection.project.websitePublications[0]?.release.immutableSnapshot);
    const urls = [...new Set([rootUrl, ...(Array.isArray(model.pages) ? model.pages.map(value => {
      try { return new URL(String(record(value).slug || "/"), rootUrl).href; } catch { return ""; }
    }) : [])])].filter(url => propertyMatchesWebsite(connection.propertyUrl!, url)).slice(0, 10);
    const inspections: Array<Record<string, unknown>> = [];
    for (const url of urls) {
      try { const result = await inspectSearchUrl(token, connection.propertyUrl, url); inspections.push({ url, ...(result.inspectionResult?.indexStatusResult || {}), checkedAt: new Date().toISOString() }); }
      catch (error) { inspections.push({ url, error: error instanceof Error ? error.message : "Inspection unavailable" }); }
    }
    const data = { opportunities: searchReviewOpportunities(queries.rows ?? []), totals: totals.rows?.[0] ?? null, daily: daily.rows ?? [], pages: pages.rows ?? [], queries: queries.rows ?? [], pageQueries: pageQueries.rows ?? [], inspections,
      dataState: "final", searchType: "web", rowLimit: 5000, limited: [pages, queries, pageQueries].some(result => (result.rows?.length ?? 0) >= 5000),
      limitation: "Google returns available top rows, not every query. Missing dates or rows are not proof of zero traffic. URL inspections describe Google's stored version, not a live test." };
    const saved = await prisma.$transaction(async tx => {
      const current = await tx.googleSearchConsoleConnection.updateMany({ where: { id: connectionId, revision, status: "connected", propertyUrl: connection.propertyUrl }, data: { syncStatus: "completed", lastSyncedAt: new Date(), errorMessage: null } });
      if (!current.count) return false;
      await tx.googleSearchConsoleSnapshot.create({ data: { connectionId, propertyUrl: connection.propertyUrl!, ...range, dataJson: json(data) } });
      return true;
    });
    if (saved) await updateSearchMeasurementSource(connection.projectId, connection.websiteId, "connected", connection.propertyUrl);
  } catch (error) {
    const reauth = Boolean((error as { reauthRequired?: boolean }).reauthRequired);
    await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connectionId, revision, status: "connected" }, data: { ...(reauth ? { status: "reauth_required" } : {}), syncStatus: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 400) : "Google sync failed." } });
    if (reauth) await updateSearchMeasurementSource(connection.projectId, connection.websiteId, "reauth_required", connection.propertyUrl);
    throw error;
  }
}
