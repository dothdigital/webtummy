import { createHash } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { Prisma, prisma } from "@webtummy/db";
import { config, GROWTH_INTELLIGENCE_QUEUE } from "./config.js";
import { connection, growthIntelligenceQueue, type GrowthIntelligenceJobData } from "./queue.js";
import { classifyContinuousMetric } from "./growth-intelligence-policy.js";
import { AUTHORITY_CADENCE_MS, collectScheduledBacklinkEvidence } from "./backlink-monitoring.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ENGINE_VERSION = "continuous-growth-v1";
const configuredAuthorityChangeThreshold = Number(process.env.AUTHORITY_BACKLINK_MEANINGFUL_CHANGE ?? 3);

function isPrismaWriteConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2034");
}

async function withWriteConflictRetry<T>(action: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isPrismaWriteConflict(error) || attempt === attempts) throw error;
      // Serializable claims can overlap when several scheduler slots wake at
      // once. Short jittered backoff preserves one owner without failing the
      // durable BullMQ job for a normal database contention event.
      await new Promise((resolve) => setTimeout(resolve, 75 * attempt + Math.floor(Math.random() * 75)));
    }
  }
  throw lastError;
}

type SourceDefinition = { key: string; cadenceMs: number; minimumSample: number; thresholdAbsolute: number; thresholdPercent: number };
type SourceSnapshot = {
  status: "available" | "limited" | "unavailable";
  observedAt: string | null;
  recordCount: number;
  primaryMetric: number | null;
  metricLabel: string;
  sampleSize: number;
  details: Record<string, unknown>;
  limitation?: string;
};

const SOURCES: SourceDefinition[] = [
  { key: "analytics", cadenceMs: DAY, minimumSample: 30, thresholdAbsolute: 10, thresholdPercent: 20 },
  { key: "search_console", cadenceMs: DAY, minimumSample: 30, thresholdAbsolute: 10, thresholdPercent: 20 },
  { key: "google_business_profile", cadenceMs: DAY, minimumSample: 1, thresholdAbsolute: 1, thresholdPercent: 10 },
  { key: "reviews", cadenceMs: 12 * HOUR, minimumSample: 1, thresholdAbsolute: 1, thresholdPercent: 10 },
  { key: "website_crawl", cadenceMs: 7 * DAY, minimumSample: 1, thresholdAbsolute: 5, thresholdPercent: 10 },
  { key: "publish_verification", cadenceMs: 15 * 60 * 1000, minimumSample: 1, thresholdAbsolute: 1, thresholdPercent: 1 },
  { key: "technical_health", cadenceMs: 7 * DAY, minimumSample: 1, thresholdAbsolute: 5, thresholdPercent: 20 },
  { key: "rankings", cadenceMs: 7 * DAY, minimumSample: 1, thresholdAbsolute: 3, thresholdPercent: 10 },
  { key: "local_visibility", cadenceMs: 7 * DAY, minimumSample: 1, thresholdAbsolute: 3, thresholdPercent: 10 },
  { key: "competitors", cadenceMs: 7 * DAY, minimumSample: 1, thresholdAbsolute: 1, thresholdPercent: 10 },
  { key: "backlinks", cadenceMs: AUTHORITY_CADENCE_MS, minimumSample: 1, thresholdAbsolute: Math.max(1, Math.min(100, Number.isFinite(configuredAuthorityChangeThreshold) ? configuredAuthorityChangeThreshold : 3)), thresholdPercent: 10 },
  { key: "content_decay", cadenceMs: 7 * DAY, minimumSample: 1, thresholdAbsolute: 1, thresholdPercent: 10 },
  { key: "ai_visibility", cadenceMs: 7 * DAY, minimumSample: 1, thresholdAbsolute: 1, thresholdPercent: 10 },
  { key: "conversions", cadenceMs: DAY, minimumSample: 5, thresholdAbsolute: 2, thresholdPercent: 20 },
  { key: "measurement_checkpoints", cadenceMs: DAY, minimumSample: 1, thresholdAbsolute: 1, thresholdPercent: 1 },
];

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function dateBucket(at: Date) {
  return at.toISOString().slice(0, 13);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function sourceDue(definition: SourceDefinition, latest: { completedAt: Date | null; status?: string } | undefined, cycleTrigger: string, now: Date) {
  if (cycleTrigger === "event" && ["publish_verification", "website_crawl", "technical_health", "measurement_checkpoints", "conversions"].includes(definition.key)) return true;
  if (definition.key === "backlinks" && latest?.status === "limited") return true;
  if (!latest?.completedAt) return true;
  return now.getTime() - latest.completedAt.getTime() >= definition.cadenceMs;
}

type GrowthBacklinkSnapshot = {
  id: string;
  provider: string;
  referringDomains: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
  limitationsJson: Prisma.JsonValue;
  comparisonStartAt: Date | null;
  comparisonEndAt: Date | null;
  capturedAt: Date;
  backlinkCount: bigint | number;
};

async function recentOwnedBacklinkSnapshots(projectId: string) {
  // Read this nullable provider evidence directly. Earlier generated Prisma
  // clients treated the count columns as required and could throw P2032 when
  // a legitimate unavailable snapshot stored NULL. The SQL result preserves
  // NULL as unavailable evidence while a fresh client is rolled out.
  const rows = await prisma.$queryRaw<GrowthBacklinkSnapshot[]>(Prisma.sql`
    SELECT
      snapshot."id",
      snapshot."provider",
      snapshot."referringDomains",
      snapshot."newBacklinks",
      snapshot."lostBacklinks",
      snapshot."limitationsJson",
      snapshot."comparisonStartAt",
      snapshot."comparisonEndAt",
      snapshot."capturedAt",
      (SELECT COUNT(*) FROM "ProjectBacklink" backlink WHERE backlink."snapshotId" = snapshot."id") AS "backlinkCount"
    FROM "BacklinkProfileSnapshot" snapshot
    WHERE snapshot."projectId" = ${projectId}
      AND snapshot."profileType" = 'owned'
    ORDER BY snapshot."capturedAt" DESC
    LIMIT 2
  `);
  return rows.map((row) => ({
    ...row,
    _count: { backlinks: Number(row.backlinkCount || 0) },
  }));
}

async function collectSnapshots(projectId: string, now: Date): Promise<{ project: Awaited<ReturnType<typeof loadProject>>; snapshots: Record<string, SourceSnapshot> }> {
  const currentPeriodStart = new Date(now.getTime() - DAY);
  const previousPeriodStart = new Date(now.getTime() - 2 * DAY);
  const project = await loadProject(projectId);
  if (!project) return { project: null, snapshots: {} };

  const backlinkCollection = await collectScheduledBacklinkEvidence(projectId, now);

  const websiteId = project.websiteId ?? "__none__";
  const localBusinessIds = project.localBusinessProfiles.map((item) => item.id);
  const conversionNames = ["conversion", "lead", "form_submit", "contact", "phone_call", "booking", "purchase"];
  const [currentEvents, previousEvents, currentConversions, previousConversions, crawls, discoveryChecks, publications, backlinks, aiCurrent, aiPrevious, aiLatest, keywordRuns, checkpoints, localRankRows, localGridRows] = await Promise.all([
    prisma.websiteTrackingEvent.count({ where: { projectId, occurredAt: { gte: currentPeriodStart, lt: now } } }),
    prisma.websiteTrackingEvent.count({ where: { projectId, occurredAt: { gte: previousPeriodStart, lt: currentPeriodStart } } }),
    prisma.websiteTrackingEvent.count({ where: { projectId, eventName: { in: conversionNames }, occurredAt: { gte: currentPeriodStart, lt: now } } }),
    prisma.websiteTrackingEvent.count({ where: { projectId, eventName: { in: conversionNames }, occurredAt: { gte: previousPeriodStart, lt: currentPeriodStart } } }),
    prisma.crawlJob.findMany({ where: { websiteId, status: "completed" }, orderBy: { completedAt: "desc" }, take: 2, include: { _count: { select: { pages: true, issues: true } } } }),
    prisma.contentDiscoveryCheck.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.websitePublication.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 100 }),
    recentOwnedBacklinkSnapshots(projectId),
    prisma.aiVisibilitySnapshot.count({ where: { projectId, mentionDetected: true, createdAt: { gte: new Date(now.getTime() - 7 * DAY), lt: now } } }),
    prisma.aiVisibilitySnapshot.count({ where: { projectId, mentionDetected: true, createdAt: { gte: new Date(now.getTime() - 14 * DAY), lt: new Date(now.getTime() - 7 * DAY) } } }),
    prisma.aiVisibilitySnapshot.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.keywordResearchRun.findMany({ where: { projectId, status: "completed" }, orderBy: { completedAt: "desc" }, take: 100 }),
    prisma.measurementCheckpoint.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: 500 }),
    localBusinessIds.length ? prisma.localRankSnapshot.findMany({ where: { keyword: { businessId: { in: localBusinessIds } } }, orderBy: { scanDate: "desc" }, take: 500 }) : Promise.resolve([]),
    localBusinessIds.length ? prisma.localGridScan.findMany({ where: { configuration: { keyword: { businessId: { in: localBusinessIds } } }, status: "completed" }, orderBy: { completedAt: "desc" }, take: 100 }) : Promise.resolve([]),
  ]);

  const measurementSources = project.website?.measurementPlans[0]?.dataSourcesJson;
  const sourceList: Record<string, unknown>[] = Array.isArray(measurementSources)
    ? measurementSources.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [item as unknown as Record<string, unknown>] : [])
    : [];
  const sourceStatus = (key: string) => sourceList.find((item) => item.key === key)?.status;
  const trackingAvailable = Boolean(project.website?.trackingSite?.enabled || currentEvents || previousEvents);
  const latestCrawl = crawls[0];
  const priorCrawl = crawls[1];
  const latestBacklink = backlinks[0];
  const priorBacklink = backlinks[1];
  const currentRankValues = keywordRuns.map((run) => run.manualRank ?? run.targetRank).filter((value): value is number => typeof value === "number");
  const localRankValues = localRankRows.map((row) => row.localPackPosition ?? row.mapsPosition ?? row.organicPosition).filter((value): value is number => typeof value === "number");
  const averageRank = currentRankValues.length ? currentRankValues.reduce((sum, value) => sum + value, 0) / currentRankValues.length : null;
  const averageLocalRank = localRankValues.length ? localRankValues.reduce((sum, value) => sum + value, 0) / localRankValues.length : null;
  const reviewRows = project.localBusinessProfiles.flatMap((business) => business.reviews);
  const ratings = reviewRows.map((review) => review.rating).filter((value): value is number => typeof value === "number");
  const averageRating = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
  const gbpSnapshots = project.localBusinessProfiles.flatMap((business) => business.googleBusinessConnection?.snapshots ?? []);
  const failedPublications = publications.filter((item) => item.status === "failed").length;
  const verifiedPublications = publications.filter((item) => item.status === "verified" || item.completedAt).length;
  const discoveryIssues = discoveryChecks.filter((item) => item.status === "issue" || item.errorMessage).length;
  const dueCheckpoints = checkpoints.filter((item) => item.status === "scheduled" && item.dueAt <= now).length;
  const completedCheckpoints = checkpoints.filter((item) => item.status === "completed").length;

  const snapshots: Record<string, SourceSnapshot> = {
    analytics: trackingAvailable
      ? { status: currentEvents >= 30 ? "available" : "limited", observedAt: project.website?.trackingSite?.lastEventAt?.toISOString() ?? null, recordCount: currentEvents, primaryMetric: currentEvents, metricLabel: "tracked events in 24 hours", sampleSize: currentEvents, details: { currentEvents, previousEvents, source: "first_party_tracking", ga4Status: sourceStatus("ga4") ?? "not_connected" }, ...(currentEvents < 30 ? { limitation: "Fewer than 30 first-party events were observed in the current period." } : {}) }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "tracked events in 24 hours", sampleSize: 0, details: { ga4Status: sourceStatus("ga4") ?? "not_connected" }, limitation: "No connected analytics feed or first-party tracking events are available." },
    search_console: sourceStatus("search_console") === "connected"
      ? { status: "limited", observedAt: project.website?.measurementPlans[0]?.lastVerifiedAt?.toISOString() ?? null, recordCount: 0, primaryMetric: null, metricLabel: "search clicks", sampleSize: 0, details: { connectionStatus: "connected" }, limitation: "Search Console is connected, but no imported performance snapshot is stored yet." }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "search clicks", sampleSize: 0, details: { connectionStatus: sourceStatus("search_console") ?? "not_connected" }, limitation: "Connect Search Console to collect clicks, impressions and query evidence." },
    google_business_profile: gbpSnapshots.length
      ? { status: "available", observedAt: gbpSnapshots[0].sourceFetchedAt.toISOString(), recordCount: gbpSnapshots.length, primaryMetric: gbpSnapshots.length, metricLabel: "GBP snapshots", sampleSize: gbpSnapshots.length, details: { connectedProfiles: project.localBusinessProfiles.filter((item) => item.googleBusinessConnection?.status === "connected").length } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "GBP snapshots", sampleSize: 0, details: {}, limitation: "No Google Business Profile snapshot is available." },
    reviews: reviewRows.length
      ? { status: "available", observedAt: reviewRows[0]?.reviewDate?.toISOString() ?? reviewRows[0]?.createdAt.toISOString() ?? null, recordCount: reviewRows.length, primaryMetric: averageRating, metricLabel: "average review rating", sampleSize: ratings.length, details: { reviewCount: reviewRows.length, averageRating, unreplied: reviewRows.filter((item) => item.replyStatus !== "replied").length } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "average review rating", sampleSize: 0, details: {}, limitation: "No review feed is available." },
    website_crawl: latestCrawl
      ? { status: "available", observedAt: latestCrawl.completedAt?.toISOString() ?? latestCrawl.createdAt.toISOString(), recordCount: latestCrawl._count.pages, primaryMetric: latestCrawl.siteScore, metricLabel: "site health score", sampleSize: latestCrawl._count.pages, details: { siteScore: latestCrawl.siteScore, previousSiteScore: priorCrawl?.siteScore ?? null, pages: latestCrawl._count.pages, issues: latestCrawl._count.issues } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "site health score", sampleSize: 0, details: {}, limitation: "No completed website crawl is available." },
    publish_verification: publications.length || discoveryChecks.length
      ? { status: failedPublications || discoveryIssues ? "limited" : "available", observedAt: publications[0]?.updatedAt.toISOString() ?? discoveryChecks[0]?.updatedAt.toISOString() ?? null, recordCount: publications.length + discoveryChecks.length, primaryMetric: failedPublications + discoveryIssues, metricLabel: "publication verification issues", sampleSize: publications.length + discoveryChecks.length, details: { publications: publications.length, verifiedPublications, failedPublications, discoveryChecks: discoveryChecks.length, discoveryIssues }, ...(failedPublications || discoveryIssues ? { limitation: "One or more publication or discovery checks need attention." } : {}) }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "publication verification issues", sampleSize: 0, details: {}, limitation: "No published asset is waiting for verification." },
    technical_health: latestCrawl
      ? { status: "available", observedAt: latestCrawl.completedAt?.toISOString() ?? latestCrawl.createdAt.toISOString(), recordCount: latestCrawl._count.issues, primaryMetric: latestCrawl._count.issues, metricLabel: "crawl issues", sampleSize: latestCrawl._count.pages, details: { issues: latestCrawl._count.issues, previousIssues: priorCrawl?._count.issues ?? null, pages: latestCrawl._count.pages } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "crawl issues", sampleSize: 0, details: {}, limitation: "Technical comparison requires a completed crawl." },
    rankings: averageRank != null
      ? { status: "available", observedAt: keywordRuns[0]?.completedAt?.toISOString() ?? keywordRuns[0]?.createdAt.toISOString() ?? null, recordCount: currentRankValues.length, primaryMetric: averageRank, metricLabel: "average tracked rank", sampleSize: currentRankValues.length, details: { averageRank, trackedTargets: currentRankValues.length } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "average tracked rank", sampleSize: 0, details: {}, limitation: "No completed ranking observations exist for tracked targets." },
    local_visibility: averageLocalRank != null || localGridRows.length
      ? { status: "available", observedAt: localGridRows[0]?.completedAt?.toISOString() ?? localRankRows[0]?.scanDate.toISOString() ?? null, recordCount: localRankRows.length + localGridRows.length, primaryMetric: localGridRows[0]?.averageRank ?? averageLocalRank, metricLabel: "average local rank", sampleSize: localRankRows.length + localGridRows.length, details: { averageLocalRank, gridAverageRank: localGridRows[0]?.averageRank ?? null, weakAreas: localGridRows[0]?.weakAreaCount ?? null } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "average local rank", sampleSize: 0, details: {}, limitation: "No completed local ranking or grid scan is available." },
    competitors: keywordRuns.some((run) => run.competitorCount > 0)
      ? { status: "available", observedAt: keywordRuns[0]?.completedAt?.toISOString() ?? null, recordCount: keywordRuns.reduce((sum, run) => sum + run.competitorCount, 0), primaryMetric: keywordRuns.reduce((sum, run) => sum + run.competitorCount, 0), metricLabel: "competitor observations", sampleSize: keywordRuns.length, details: { markets: new Set(keywordRuns.map((run) => run.locationName)).size } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "competitor observations", sampleSize: 0, details: {}, limitation: "No ranking competitor observations are saved." },
    backlinks: latestBacklink && latestBacklink.referringDomains != null
      ? {
          status: backlinkCollection.status === "failed" ? "limited" : "available",
          observedAt: latestBacklink.capturedAt.toISOString(),
          recordCount: latestBacklink._count.backlinks,
          primaryMetric: latestBacklink.referringDomains,
          metricLabel: "referring domains",
          sampleSize: 1,
          details: {
            provider: latestBacklink.provider,
            referringDomains: latestBacklink.referringDomains,
            previousReferringDomains: priorBacklink?.referringDomains ?? null,
            newBacklinks: latestBacklink.newBacklinks,
            lostBacklinks: latestBacklink.lostBacklinks,
            comparisonStartAt: latestBacklink.comparisonStartAt?.toISOString() ?? null,
            comparisonEndAt: latestBacklink.comparisonEndAt?.toISOString() ?? latestBacklink.capturedAt.toISOString(),
            limitations: latestBacklink.limitationsJson,
          },
          ...(backlinkCollection.limitation ? { limitation: backlinkCollection.limitation } : {}),
        }
      : { status: "unavailable", observedAt: backlinkCollection.collectedAt?.toISOString() ?? null, recordCount: 0, primaryMetric: null, metricLabel: "referring domains", sampleSize: 0, details: { provider: backlinkCollection.provider }, limitation: backlinkCollection.limitation ?? "No verified backlink profile snapshot is available." },
    content_decay: { status: "limited", observedAt: latestCrawl?.completedAt?.toISOString() ?? null, recordCount: 0, primaryMetric: null, metricLabel: "decaying pages", sampleSize: 0, details: { crawlAvailable: Boolean(latestCrawl), analyticsAvailable: trackingAvailable }, limitation: "Content decay needs comparable page-level traffic and ranking snapshots; current evidence is insufficient." },
    ai_visibility: aiCurrent || aiPrevious
      ? { status: aiCurrent >= 1 ? "available" : "limited", observedAt: aiLatest?.createdAt.toISOString() ?? null, recordCount: aiCurrent, primaryMetric: aiCurrent, metricLabel: "AI answer mentions in 7 days", sampleSize: aiCurrent + aiPrevious, details: { currentMentions: aiCurrent, previousMentions: aiPrevious } }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "AI answer mentions in 7 days", sampleSize: 0, details: {}, limitation: "No AI visibility observations are available." },
    conversions: trackingAvailable
      ? { status: currentConversions >= 5 ? "available" : "limited", observedAt: project.website?.trackingSite?.lastEventAt?.toISOString() ?? null, recordCount: currentConversions, primaryMetric: currentConversions, metricLabel: "conversion events in 24 hours", sampleSize: currentEvents, details: { currentConversions, previousConversions, currentEvents, previousEvents }, ...(currentConversions < 5 ? { limitation: "Fewer than five conversion events were observed; do not infer performance yet." } : {}) }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "conversion events in 24 hours", sampleSize: 0, details: {}, limitation: "No conversion event source is connected." },
    measurement_checkpoints: checkpoints.length
      ? { status: dueCheckpoints ? "limited" : "available", observedAt: checkpoints[0]?.updatedAt.toISOString() ?? null, recordCount: checkpoints.length, primaryMetric: dueCheckpoints, metricLabel: "overdue measurement checkpoints", sampleSize: checkpoints.length, details: { total: checkpoints.length, completed: completedCheckpoints, due: dueCheckpoints }, ...(dueCheckpoints ? { limitation: `${dueCheckpoints} measurement checkpoint(s) are due.` } : {}) }
      : { status: "unavailable", observedAt: null, recordCount: 0, primaryMetric: null, metricLabel: "overdue measurement checkpoints", sampleSize: 0, details: {}, limitation: "No measurement checkpoints have been scheduled." },
  };
  return { project, snapshots };
}

async function loadProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, name: true, status: true, clientId: true, agencyClientId: true, websiteId: true, primaryGoal: true,
      strategyPlans: { where: { status: "approved" }, orderBy: { approvedAt: "desc" }, take: 1, select: { id: true, version: true } },
      website: { select: { trackingSite: true, measurementPlans: { where: { active: true }, orderBy: { version: "desc" }, take: 1 } } },
      localBusinessProfiles: { select: { id: true, reviews: { orderBy: { createdAt: "desc" }, take: 500 }, googleBusinessConnection: { select: { status: true, snapshots: { orderBy: { sourceFetchedAt: "desc" }, take: 100 } } } } },
    },
  });
}

function buildFinding(input: { projectId: string; cycleId: string; source: SourceDefinition; current: SourceSnapshot; previous?: SourceSnapshot; periodStart?: Date | null; periodEnd?: Date | null }) {
  const { source, current, previous } = input;
  if (source.key === "backlinks" && previous) {
    const gained = typeof current.details.newBacklinks === "number" ? current.details.newBacklinks : 0;
    const lost = typeof current.details.lostBacklinks === "number" ? current.details.lostBacklinks : 0;
    if (gained >= source.thresholdAbsolute || lost >= source.thresholdAbsolute) {
      const decline = lost > gained;
      return {
        fingerprint: `${input.cycleId}:backlinks:gained-lost`,
        sourceType: source.key,
        findingType: decline ? "meaningful_links_lost" : "meaningful_links_gained",
        severity: decline ? "high" : "medium",
        status: "open",
        observedEvidenceJson: asJson(current.details),
        currentValueJson: asJson({ gained, lost, referringDomains: current.primaryMetric }),
        previousValueJson: asJson({ referringDomains: previous.primaryMetric }),
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        absoluteChange: gained - lost,
        percentChange: null,
        confidence: current.status === "available" ? 90 : 65,
        limitationsJson: asJson(current.limitation ? [current.limitation] : []),
        observedFact: `${gained} sampled backlink${gained === 1 ? " was" : "s were"} gained and ${lost} ${lost === 1 ? "was" : "were"} lost in the latest provider comparison.`,
        interpretation: decline ? "The verified sampled profile lost more links than it gained; no ranking causation has been assumed." : "The verified sampled profile gained at least as many links as it lost; no ranking causation has been assumed.",
        importance: "Material link changes can alter authority evidence, referral reach and approved opportunity priorities.",
        affectedObjective: null,
        recommendedResponse: decline ? "Review the lost source and target evidence, then approve a recovery or replacement task only when the source remains relevant." : "Verify relevance and referral quality, then retain or update the current authority priority.",
      };
    }
  }
  const worseningWhenHigher = ["technical_health", "publish_verification", "measurement_checkpoints", "rankings", "local_visibility"].includes(source.key);
  const metricDecision = classifyContinuousMetric({
    current: { status: current.status, value: current.primaryMetric, sampleSize: current.sampleSize },
    previous: previous ? { status: previous.status, value: previous.primaryMetric, sampleSize: previous.sampleSize } : undefined,
    minimumSample: source.minimumSample,
    thresholdAbsolute: source.thresholdAbsolute,
    thresholdPercent: source.thresholdPercent,
    worseningWhenHigher,
  });
  if (metricDecision.classification === "insufficient_evidence") {
    return {
      fingerprint: `${input.cycleId}:${source.key}:insufficient`, sourceType: source.key, findingType: "insufficient_evidence", severity: "info", status: "insufficient_evidence",
      observedEvidenceJson: asJson(current.details), currentValueJson: asJson({ value: current.primaryMetric, label: current.metricLabel }), previousValueJson: asJson(previous ? { value: previous.primaryMetric } : {}),
      periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, confidence: 25, limitationsJson: asJson([current.limitation ?? `At least ${source.minimumSample} observations are required.`]),
      observedFact: current.limitation ?? `${source.key} does not have enough current evidence.`, interpretation: "No performance conclusion was made.", importance: "More evidence is required before changing Strategy or execution priorities.", affectedObjective: null, recommendedResponse: null,
    };
  }
  if (metricDecision.classification === "baseline_recorded") {
    return {
      fingerprint: `${input.cycleId}:${source.key}:baseline`, sourceType: source.key, findingType: "baseline_recorded", severity: "info", status: "baseline",
      observedEvidenceJson: asJson(current.details), currentValueJson: asJson({ value: current.primaryMetric, label: current.metricLabel }), previousValueJson: asJson({}),
      periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, confidence: 80, limitationsJson: asJson([]), observedFact: `Recorded a baseline of ${current.primaryMetric} for ${current.metricLabel}.`, interpretation: "A later comparable snapshot is required before measuring change.", importance: "This baseline enables future evidence-backed comparisons.", affectedObjective: null, recommendedResponse: null,
    };
  }
  if (metricDecision.classification === "no_material_change" || !previous || current.primaryMetric == null || previous.primaryMetric == null || metricDecision.absoluteChange == null || metricDecision.percentChange == null) return null;
  const absolute = metricDecision.absoluteChange;
  const percent = metricDecision.percentChange;
  const worsened = metricDecision.classification === "material_decline";
  return {
    fingerprint: `${input.cycleId}:${source.key}:material`, sourceType: source.key, findingType: worsened ? "material_decline" : "material_improvement", severity: worsened ? "high" : "medium", status: "open",
    observedEvidenceJson: asJson(current.details), currentValueJson: asJson({ value: current.primaryMetric, label: current.metricLabel }), previousValueJson: asJson({ value: previous.primaryMetric, label: previous.metricLabel }),
    periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, absoluteChange: absolute, percentChange: percent, confidence: current.status === "available" ? 85 : 60,
    limitationsJson: asJson(current.limitation ? [current.limitation] : []), observedFact: `${current.metricLabel} changed from ${previous.primaryMetric} to ${current.primaryMetric} (${percent.toFixed(1)}%).`,
    interpretation: worsened ? "The observed metric moved in an unfavorable direction; causality has not been assumed." : "The observed metric moved in a favorable direction; causality has not been assumed.",
    importance: worsened ? "This change may affect the project's approved growth objective and should be verified before reprioritizing work." : "This improvement is worth preserving and measuring through the next comparable period.",
    affectedObjective: null, recommendedResponse: worsened ? "Open the linked evidence, verify tracking and sample quality, then approve a scoped corrective action if the change is confirmed." : "Retain the current direction and confirm the improvement in the next measurement window.",
  };
}

async function updateBlueprintLearning(projectId: string, cycleId: string, findingIds: string[], now: Date) {
  const blueprint = await prisma.growthBlueprint.findUnique({ where: { projectId }, include: { versions: { orderBy: { version: "desc" }, take: 50 } } });
  const existingCycleVersion = blueprint?.versions.find((version) => {
    const evidence = version.evidenceJson;
    return Boolean(evidence && typeof evidence === "object" && !Array.isArray(evidence) && (evidence as Record<string, unknown>).continuousGrowthCycleId === cycleId);
  });
  if (existingCycleVersion) return existingCycleVersion.version;
  const latest = blueprint?.versions[0];
  if (!blueprint || !latest) return null;
  const nextVersion = blueprint.currentVersion + 1;
  await prisma.$transaction([
    prisma.growthBlueprintVersion.create({ data: { blueprintId: blueprint.id, version: nextVersion, status: "active", goalsJson: latest.goalsJson ?? asJson([]), nowJson: latest.nowJson ?? asJson([]), nextJson: latest.nextJson ?? asJson([]), laterJson: latest.laterJson ?? asJson([]), conditionalJson: latest.conditionalJson ?? asJson([]), evidenceJson: asJson({ inheritedFromVersion: latest.version, continuousGrowthCycleId: cycleId, findingIds, learnedAt: now.toISOString() }), reason: "Updated from verified continuous-monitoring evidence without changing the approved Strategy.", engineVersion: ENGINE_VERSION, approvedAt: now } }),
    prisma.growthBlueprint.update({ where: { id: blueprint.id }, data: { currentVersion: nextVersion, status: "active", nextReviewAt: new Date(now.getTime() + 7 * DAY), explainabilityJson: asJson({ continuousGrowthCycleId: cycleId, findingIds, strategyUnchanged: true, updatedAt: now.toISOString() }) } }),
  ]);
  return nextVersion;
}

export async function processGrowthIntelligenceCycle(cycleId: string, job?: Job<GrowthIntelligenceJobData>) {
  const now = new Date();
  const cycle = await prisma.growthIntelligenceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error(`growth intelligence cycle ${cycleId} not found`);
  if (["completed", "skipped"].includes(cycle.status)) return;

  const claimed = await withWriteConflictRetry(() => prisma.$transaction(async (tx) => {
    const otherRunning = await tx.growthIntelligenceCycle.findFirst({ where: { projectId: cycle.projectId, id: { not: cycleId }, status: "running" }, select: { id: true } });
    if (otherRunning) return false;
    const result = await tx.growthIntelligenceCycle.updateMany({ where: { id: cycleId, status: { in: ["queued", "retrying"] } }, data: { status: "running", startedAt: cycle.startedAt ?? now, heartbeatAt: now, retryCount: Math.max(cycle.retryCount, Math.max(0, (job?.attemptsMade ?? 0))) } });
    return result.count === 1;
  }, { isolationLevel: "Serializable" }));
  if (!claimed) {
    const current = await prisma.growthIntelligenceCycle.findUnique({ where: { id: cycleId }, select: { status: true } });
    if (current?.status === "running") return;
    throw new Error(`Project ${cycle.projectId} already has an active Growth Intelligence evaluation; this cycle will retry.`);
  }
  const eligibleProject = await loadProject(cycle.projectId);
  if (!eligibleProject || eligibleProject.status !== "active") {
    await prisma.growthIntelligenceCycle.update({ where: { id: cycleId }, data: { status: "skipped", completedAt: now, skipReason: "Project is no longer active.", nextScheduledAt: null } });
    return;
  }
  if (!eligibleProject.strategyPlans.length) {
    await prisma.growthIntelligenceCycle.update({ where: { id: cycleId }, data: { status: "skipped", completedAt: now, skipReason: "An approved Strategy is required before continuous reprioritization begins.", nextScheduledAt: new Date(now.getTime() + 12 * HOUR) } });
    return;
  }
  const { project, snapshots } = await collectSnapshots(cycle.projectId, now);
  if (!project) throw new Error(`Project ${cycle.projectId} became unavailable during monitoring collection.`);

  const previousRuns = await prisma.growthIntelligenceSourceRun.findMany({ where: { projectId: cycle.projectId, cycleId: { not: cycle.id }, status: { in: ["completed", "baseline", "limited"] } }, orderBy: { completedAt: "desc" }, take: 250 });
  const previousBySource = new Map<string, (typeof previousRuns)[number]>();
  for (const row of previousRuns) if (!previousBySource.has(row.sourceType)) previousBySource.set(row.sourceType, row);
  const dueSources = SOURCES.filter((source) => sourceDue(source, previousBySource.get(source.key), cycle.triggerType, now));
  const collected: Record<string, SourceSnapshot> = {};
  let recordCount = 0;
  for (const source of SOURCES) {
    const current = snapshots[source.key];
    if (!current) continue;
    const isDue = dueSources.some((item) => item.key === source.key);
    const status = !isDue ? "skipped" : current.status === "available" ? "completed" : current.status === "limited" ? "limited" : "restricted";
    const snapshotVersion = fingerprint(current);
    const previous = previousBySource.get(source.key);
    await prisma.growthIntelligenceSourceRun.upsert({
      where: { cycleId_sourceType: { cycleId, sourceType: source.key } },
      update: { status, completedAt: now, nextScheduledAt: new Date(now.getTime() + source.cadenceMs), recordCount: current.recordCount, snapshotVersion, snapshotJson: asJson(current), countsJson: asJson(current.details), restrictionReason: current.status === "unavailable" ? current.limitation : null, skipReason: isDue ? null : "Source is not due for collection yet." },
      create: { cycleId, projectId: cycle.projectId, sourceType: source.key, jobType: "collect_compare", status, scheduledAt: cycle.scheduledAt, startedAt: now, completedAt: now, previousSuccessfulAt: previous?.completedAt ?? null, nextScheduledAt: new Date(now.getTime() + source.cadenceMs), periodStart: cycle.periodStart, periodEnd: cycle.periodEnd ?? now, recordCount: current.recordCount, snapshotVersion, snapshotJson: asJson(current), countsJson: asJson(current.details), restrictionReason: current.status === "unavailable" ? current.limitation : null, skipReason: isDue ? null : "Source is not due for collection yet." },
    });
    if (isDue) {
      collected[source.key] = current;
      recordCount += current.recordCount;
    }
  }

  // The version describes all currently saved source evidence, not only the
  // subset due on this cadence. This makes an unchanged retry or schedule a
  // true no-op even when different source cadences share the same cycle.
  const dataVersionFingerprint = fingerprint(snapshots);
  const previousCycle = await prisma.growthIntelligenceCycle.findFirst({ where: { projectId: cycle.projectId, id: { not: cycle.id }, status: { in: ["completed", "skipped"] }, dataVersionFingerprint: { not: null } }, orderBy: { completedAt: "desc" } });
  const unchanged = previousCycle?.dataVersionFingerprint === dataVersionFingerprint;
  const findingRows: Array<NonNullable<ReturnType<typeof buildFinding>>> = [];
  if (!unchanged) {
    for (const source of dueSources) {
      const current = snapshots[source.key];
      if (!current) continue;
      const priorRow = previousBySource.get(source.key);
      const prior = priorRow?.snapshotJson as unknown as SourceSnapshot | undefined;
      const finding = buildFinding({ projectId: cycle.projectId, cycleId, source, current, previous: prior, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd ?? now });
      if (finding) findingRows.push(finding);
    }
  }
  const hasAuthorityFinding = findingRows.some((finding) => finding.sourceType === "backlinks");
  const [authorityTask, authorityAction] = hasAuthorityFinding ? await Promise.all([
    prisma.executionTask.findFirst({ where: { projectId: cycle.projectId, moduleName: "backlinks" }, orderBy: { updatedAt: "desc" }, select: { id: true } }),
    prisma.nextBestAction.findFirst({ where: { projectId: cycle.projectId, OR: [{ route: "authority" }, { sourceType: "authority_opportunity" }] }, orderBy: { updatedAt: "desc" }, select: { id: true } }),
  ]) : [null, null];
  const savedFindings = findingRows.length ? await prisma.$transaction(findingRows.map((finding) => prisma.growthIntelligenceFinding.upsert({
    where: { fingerprint: finding.fingerprint }, update: {}, create: {
      cycleId,
      projectId: cycle.projectId,
      ...finding,
      affectedObjective: project.primaryGoal,
      approvalRequired: false,
      approvalStatus: "not_required",
      relatedStrategyId: project.strategyPlans[0].id,
      relatedExecutionTaskId: finding.sourceType === "backlinks" ? authorityTask?.id ?? null : null,
      relatedNextBestActionId: finding.sourceType === "backlinks" ? authorityAction?.id ?? null : null,
    },
  }))) : [];
  const materialFindings = savedFindings.filter((finding) => ["material_decline", "material_improvement", "meaningful_links_gained", "meaningful_links_lost"].includes(finding.findingType));
  const meaningful = materialFindings.length > 0;
  let blueprintVersion: number | null = null;
  if (meaningful) {
    const existingDiagnosis = await prisma.growthDiagnosis.findFirst({ where: { projectId: cycle.projectId, runType: "continuous", evidenceJson: { path: ["cycleId"], equals: cycleId } }, select: { id: true } });
    if (!existingDiagnosis) await prisma.growthDiagnosis.create({ data: { projectId: cycle.projectId, bottleneckType: materialFindings.find((item) => item.findingType === "material_decline")?.sourceType ?? "growth_evidence", scoreJson: asJson({ findingCount: materialFindings.length }), summary: `${materialFindings.length} meaningful change${materialFindings.length === 1 ? " was" : "s were"} detected from comparable monitoring evidence.`, dataSnapshot: asJson(collected), findingsJson: asJson(materialFindings.map((item) => ({ id: item.id, sourceType: item.sourceType, findingType: item.findingType, observedFact: item.observedFact, confidence: item.confidence }))), evidenceJson: asJson({ cycleId, dataVersionFingerprint, strategyId: project.strategyPlans[0].id }), confidence: Math.round(materialFindings.reduce((sum, item) => sum + item.confidence, 0) / materialFindings.length), engineVersion: ENGINE_VERSION, runType: "continuous" } });
    blueprintVersion = await updateBlueprintLearning(cycle.projectId, cycle.id, materialFindings.map((item) => item.id), now);
  }

  const currentAction = await prisma.nextBestAction.findFirst({ where: { projectId: cycle.projectId, status: { in: ["selected", "recommended", "proposed"] } }, orderBy: [{ selectedAt: "desc" }, { priorityScore: "desc" }, { createdAt: "desc" }] });
  const outcome = meaningful ? (currentAction ? "Update" : "No action") : (currentAction ? "Retain" : "No action");
  const reason = unchanged ? "The saved evidence version did not change, so Growth and Next Best Action evaluation were skipped." : meaningful ? (currentAction ? "New material evidence was recorded. Keep the current action available, but review its priority against the linked findings." : "Material evidence changed, but no supported executable candidate exists; the system did not invent an action.") : (currentAction ? "No qualifying material change was detected, so the current Next Best Action remains valid." : "No qualifying material change or supported action was found.");
  await prisma.growthIntelligenceDecision.upsert({ where: { cycleId }, update: {}, create: { cycleId, projectId: cycle.projectId, outcome, previousNextBestActionId: currentAction?.id ?? null, currentNextBestActionId: currentAction?.id ?? null, reason, evidenceJson: asJson({ findingIds: materialFindings.map((item) => item.id), blueprintVersion, strategyId: project.strategyPlans[0].id, strategyChanged: false }), dataVersionFingerprint } });

  const weeklyCutoff = new Date(now.getTime() - 7 * DAY);
  const [priorWeekly, priorWeeklyReport] = await Promise.all([
    prisma.growthIntelligenceCycle.findFirst({ where: { projectId: cycle.projectId, id: { not: cycle.id }, weeklySummaryCreated: true, completedAt: { gte: weeklyCutoff } }, select: { id: true } }),
    prisma.growthReport.findFirst({ where: { projectId: cycle.projectId, reportType: "continuous_growth_weekly", createdAt: { gte: weeklyCutoff } }, select: { id: true } }),
  ]);
  const weeklySummaryCreated = !priorWeekly && !priorWeeklyReport;
  if (weeklySummaryCreated) {
    const periodStart = new Date(now.getTime() - 7 * DAY);
    const [weeklyCycles, weeklyFindings] = await Promise.all([
      prisma.growthIntelligenceCycle.count({ where: { projectId: cycle.projectId, completedAt: { gte: periodStart }, status: { in: ["completed", "skipped"] } } }),
      prisma.growthIntelligenceFinding.findMany({ where: { projectId: cycle.projectId, detectedAt: { gte: periodStart } }, orderBy: { detectedAt: "desc" }, take: 50 }),
    ]);
    const declines = weeklyFindings.filter((item) => item.findingType === "material_decline");
    const improvements = weeklyFindings.filter((item) => item.findingType === "material_improvement");
    const limitations = weeklyFindings.filter((item) => item.status === "insufficient_evidence");
    await prisma.growthReport.create({ data: { projectId: cycle.projectId, clientId: project.clientId, reportType: "continuous_growth_weekly", status: "ready", htmlContent: `<h1>Weekly Growth Intelligence Summary</h1><p>${weeklyCycles} monitoring cycle${weeklyCycles === 1 ? "" : "s"} completed for ${escapeHtml(project.name)}.</p><h2>Verified changes</h2><p>${improvements.length} improvement${improvements.length === 1 ? "" : "s"}; ${declines.length} decline${declines.length === 1 ? "" : "s"}.</p><h2>Evidence limitations</h2><p>${limitations.length} source${limitations.length === 1 ? "" : "s"} need more or connected evidence.</p><h2>Next Best Action</h2><p>${escapeHtml(outcome)}: ${escapeHtml(reason)}</p><p>No customer AI Capacity was charged for monitoring.</p>` } });
  }
  const monthKey = now.toISOString().slice(0, 7);
  await prisma.projectWorkflowEvent.upsert({
    where: { idempotencyKey: `growth-intelligence.strategy-review:${cycle.projectId}:${monthKey}` },
    update: {},
    create: { projectId: cycle.projectId, eventType: "growth_intelligence.strategy_review_evaluated", sourceModule: "continuous_growth", sourceId: cycle.id, idempotencyKey: `growth-intelligence.strategy-review:${cycle.projectId}:${monthKey}`, payloadJson: asJson({ strategyId: project.strategyPlans[0].id, materialChangeDetected: meaningful, outcome: meaningful ? "review_recommended" : "no_strategy_change", strategySilentlyRewritten: false, evaluatedAt: now.toISOString() }), occurredAt: now, processedAt: now },
  });

  let notificationCreated = false;
  const criticalDeclines = materialFindings.filter((item) => item.findingType === "material_decline" && item.severity === "high");
  if (criticalDeclines.length) {
    const workspace = await prisma.workspace.findUnique({ where: { id: cycle.workspaceId }, select: { ownerUserId: true } });
    if (workspace) {
      const notificationKey = `growth-intelligence:${cycle.id}`;
      const existing = await prisma.workspaceNotification.findFirst({ where: { workspaceId: cycle.workspaceId, projectId: cycle.projectId, type: notificationKey } });
      if (!existing) {
        await prisma.workspaceNotification.create({ data: { workspaceId: cycle.workspaceId, userId: workspace.ownerUserId, agencyClientId: cycle.agencyClientId, projectId: cycle.projectId, type: notificationKey, title: `${project.name}: meaningful growth change detected`, body: `${criticalDeclines.length} evidence-backed decline${criticalDeclines.length === 1 ? " needs" : "s need"} review. No Strategy or paid execution work was changed automatically.`, actionUrl: `/growth?projectId=${cycle.projectId}&tab=overview`, emailEligible: true, emailStatus: "pending" } });
        notificationCreated = true;
      }
    }
  }
  if (weeklySummaryCreated) {
    const workspace = await prisma.workspace.findUnique({ where: { id: cycle.workspaceId }, select: { ownerUserId: true } });
    const weeklyType = `growth-weekly:${cycle.id}`;
    const existingWeeklyNotification = await prisma.workspaceNotification.findFirst({ where: { workspaceId: cycle.workspaceId, projectId: cycle.projectId, type: weeklyType } });
    if (workspace && !existingWeeklyNotification) await prisma.workspaceNotification.create({ data: { workspaceId: cycle.workspaceId, userId: workspace.ownerUserId, agencyClientId: cycle.agencyClientId, projectId: cycle.projectId, type: weeklyType, title: `${project.name}: weekly growth summary ready`, body: meaningful ? `${materialFindings.length} meaningful change${materialFindings.length === 1 ? " was" : "s were"} recorded with an ${outcome} Next Best Action decision.` : `Monitoring completed without a qualifying priority change. ${outcome} is the current decision.`, actionUrl: `/growth?projectId=${cycle.projectId}&tab=report`, emailEligible: true, emailStatus: "pending" } });
  }
  const activityAction = meaningful ? "growth_intelligence.material_change" : "growth_intelligence.checked";
  const existingActivity = await prisma.workspaceActivity.findFirst({ where: { workspaceId: cycle.workspaceId, entityType: "growth_intelligence_cycle", entityId: cycle.id, action: activityAction }, select: { id: true } });
  if (!existingActivity) await prisma.workspaceActivity.create({ data: { workspaceId: cycle.workspaceId, agencyClientId: cycle.agencyClientId, projectId: cycle.projectId, action: activityAction, entityType: "growth_intelligence_cycle", entityId: cycle.id, nextJson: asJson({ status: unchanged ? "skipped" : "completed", recordCount, meaningful, materialFindingCount: materialFindings.length, decision: outcome, dataVersionFingerprint, customerCapacityUnits: 0 }) } });
  await prisma.growthIntelligenceSourceRun.updateMany({ where: { cycleId, sourceType: { in: dueSources.map((item) => item.key) } }, data: { meaningfulChangeDetected: meaningful, growthEvaluationTriggered: meaningful, nextBestActionTriggered: !unchanged } });
  await prisma.growthIntelligenceCycle.update({ where: { id: cycleId }, data: { status: unchanged ? "skipped" : "completed", completedAt: now, heartbeatAt: now, previousSuccessfulAt: previousCycle?.completedAt ?? null, nextScheduledAt: new Date(now.getTime() + 12 * HOUR), dataVersionFingerprint, sourceSummaryJson: asJson(Object.fromEntries(Object.entries(snapshots).map(([key, value]) => [key, { status: value.status, recordCount: value.recordCount, observedAt: value.observedAt, limitation: value.limitation ?? null }]))), snapshotJson: asJson(snapshots), recordCount, skipReason: unchanged ? "Data version is unchanged; Growth and NBA evaluation were not repeated." : null, restrictionsJson: asJson(Object.entries(snapshots).filter(([, value]) => value.status !== "available").map(([source, value]) => ({ source, status: value.status, reason: value.limitation }))), meaningfulChangeDetected: meaningful, growthEvaluationTriggered: meaningful, nextBestActionTriggered: !unchanged, notificationCreated, weeklySummaryCreated } });
}

async function enqueueCycle(cycleId: string, scheduledAt: Date, maxAttempts = 5) {
  await growthIntelligenceQueue.add("growth-intelligence:evaluate", { cycleId }, { jobId: `growth-intelligence-${cycleId}`, delay: Math.max(0, scheduledAt.getTime() - Date.now()), attempts: maxAttempts, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: { age: DAY / 1000, count: 5_000 }, removeOnFail: { age: 7 * DAY / 1000, count: 10_000 } });
}

export async function recoverGrowthIntelligenceCycles() {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  await prisma.growthIntelligenceCycle.updateMany({ where: { status: "running", heartbeatAt: { lt: staleBefore } }, data: { status: "retrying", errorMessage: "Recovered after an interrupted worker lease." } });
  const rows = await prisma.growthIntelligenceCycle.findMany({ where: { status: { in: ["queued", "retrying"] } }, orderBy: { scheduledAt: "asc" }, take: config.growthIntelligenceScheduleBatchSize });
  for (const row of rows) await enqueueCycle(row.id, row.scheduledAt, row.maxAttempts).catch((error) => console.error(`[growth-intelligence] recovery enqueue failed for ${row.id}`, error));
  return rows.length;
}

export async function scheduleDueGrowthIntelligenceCycles() {
  const now = new Date();
  const due = await prisma.growthIntelligenceCycle.findMany({ where: { status: { in: ["completed", "skipped"] }, nextScheduledAt: { lte: now } }, orderBy: { nextScheduledAt: "asc" }, distinct: ["projectId"], take: config.growthIntelligenceScheduleBatchSize, select: { projectId: true, workspaceId: true, agencyClientId: true } });
  const remaining = Math.max(0, config.growthIntelligenceScheduleBatchSize - due.length);
  const seeded = remaining ? await prisma.project.findMany({ where: { status: "active", growthIntelligenceCycles: { none: {} }, OR: [{ agencyClient: { workspace: { status: "active" } } }, { client: { workspace: { status: "active" } } }] }, orderBy: { createdAt: "asc" }, take: remaining, select: { id: true, agencyClientId: true, agencyClient: { select: { workspaceId: true } }, client: { select: { workspace: { select: { id: true } } } } } }) : [];
  const targets = [...due.map((item) => ({ projectId: item.projectId, workspaceId: item.workspaceId, agencyClientId: item.agencyClientId })), ...seeded.map((item) => ({ projectId: item.id, workspaceId: item.agencyClient?.workspaceId ?? item.client.workspace?.id ?? "", agencyClientId: item.agencyClientId }))].filter((item) => item.workspaceId);
  let queued = 0;
  for (const target of targets) {
    // A cycle owns the project's next-due marker. Clear consumed markers before
    // creating the successor so historical rows cannot re-enqueue the project
    // every scheduler minute at 1,000+ project scale.
    await prisma.growthIntelligenceCycle.updateMany({ where: { projectId: target.projectId, status: { in: ["completed", "skipped"] }, nextScheduledAt: { lte: now } }, data: { nextScheduledAt: null } });
    const key = `scheduled:${target.projectId}:${dateBucket(now)}`;
    const cycle = await prisma.growthIntelligenceCycle.upsert({ where: { idempotencyKey: key }, update: {}, create: { projectId: target.projectId, workspaceId: target.workspaceId, agencyClientId: target.agencyClientId, triggerType: "scheduled", triggerSource: "continuous_growth_scheduler", idempotencyKey: key, status: "queued", scheduledAt: now, periodStart: new Date(now.getTime() - 12 * HOUR), periodEnd: now } });
    await enqueueCycle(cycle.id, cycle.scheduledAt, cycle.maxAttempts);
    queued += 1;
  }
  await recoverGrowthIntelligenceCycles();
  return queued;
}

export function startGrowthIntelligenceWorker() {
  const worker = new Worker<GrowthIntelligenceJobData>(GROWTH_INTELLIGENCE_QUEUE, async (job) => processGrowthIntelligenceCycle(job.data.cycleId, job), {
    connection,
    concurrency: config.growthIntelligenceConcurrency,
    limiter: { max: config.growthIntelligenceJobsPerMinute, duration: 60_000 },
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 30_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  worker.on("failed", async (job, error) => {
    const cycleId = job?.data.cycleId;
    console.error(`[growth-intelligence] cycle ${cycleId ?? "unknown"} failed`, error);
    if (!cycleId) return;
    const exhausted = (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 5);
    await prisma.growthIntelligenceCycle.updateMany({ where: { id: cycleId, status: { notIn: ["completed", "skipped"] } }, data: { status: exhausted ? "failed" : "retrying", retryCount: job?.attemptsMade ?? 1, errorMessage: error.message, heartbeatAt: new Date(), ...(exhausted ? { completedAt: new Date() } : {}) } }).catch(() => undefined);
  });
  return worker;
}

export function startGrowthIntelligenceScheduler() {
  const run = () => scheduleDueGrowthIntelligenceCycles().catch((error) => console.error("[growth-intelligence] scheduler failed", error));
  setTimeout(run, 5_000);
  return setInterval(run, config.growthIntelligenceScheduleIntervalMs);
}
