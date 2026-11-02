import { createHash } from "node:crypto";
import { Prisma, prisma } from "@webtummy/db";
import {
  BACKLINK_PROVIDER,
  backlinkProviderConfigured,
  backlinkProviderCost,
  parseBacklinkProviderLinks,
  parseBacklinkProviderSummary,
  requestBacklinkProvider,
  type BacklinkProviderPayload,
} from "@webtummy/core/backlink-provider";
import { backlinkRiskFinding } from "../../api/src/authority-growth-engine.js";

const DAY = 24 * 60 * 60 * 1000;
const configuredAuthorityCadenceDays = Number(process.env.AUTHORITY_BACKLINK_CADENCE_DAYS ?? 14);
export const AUTHORITY_CADENCE_MS = Math.max(7, Math.min(90, Number.isFinite(configuredAuthorityCadenceDays) ? configuredAuthorityCadenceDays : 14)) * DAY;
// Three bounded 120-second provider attempts plus retry backoff must fit
// inside the lease or another process could purchase the same request.
const CACHE_LEASE_MS = 7 * 60 * 1000;
const LINK_LIMIT = Math.max(25, Math.min(250, Number(process.env.AUTHORITY_BACKLINK_LINK_LIMIT ?? 100)));
const COMPETITOR_LIMIT = Math.max(0, Math.min(3, Number(process.env.AUTHORITY_BACKLINK_COMPETITOR_LIMIT ?? 3)));

type CollectionResult = {
  status: "collected" | "current" | "unavailable" | "failed";
  snapshotId: string | null;
  provider: string;
  collectedAt: Date | null;
  limitation: string | null;
};

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function domain(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function linkKey(sourceUrl: string, targetUrl: string) {
  return `${sourceUrl.trim().toLowerCase()}\u0000${targetUrl.trim().toLowerCase()}`;
}

export function backlinkCollectionKey(projectId: string, profileType: string, target: string, scheduledAt: Date) {
  const bucket = Math.floor(scheduledAt.getTime() / AUTHORITY_CADENCE_MS);
  return `authority:${projectId}:${profileType}:${hash(target).slice(0, 16)}:${bucket}`;
}

export function compareBacklinkKeys(currentKeys: Iterable<string>, previousKeys: Iterable<string>) {
  const current = new Set(currentKeys);
  const previous = new Set(previousKeys);
  return {
    gained: [...current].filter((item) => !previous.has(item)),
    retained: [...current].filter((item) => previous.has(item)),
    lost: [...previous].filter((item) => !current.has(item)),
  };
}

async function cachedProviderRequest(path: string, body: unknown, context: { clientId: string; workspaceId: string | null; projectId: string; websiteId: string | null }) {
  const cacheKey = hash({ path, body });
  const now = new Date();
  let cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
  if (cached?.status === "ok" && cached.expiresAt > now) return { payload: cached.responseJson as unknown as BacklinkProviderPayload, cacheHit: true };

  const leaseExpiry = new Date(now.getTime() + CACHE_LEASE_MS);
  let ownsLease = false;
  if (!cached) {
    try {
      await prisma.externalApiCache.create({ data: { provider: "search_data", endpoint: path, cacheKey, requestJson: json(body), responseJson: json({}), status: "pending", fetchedAt: now, expiresAt: leaseExpiry } });
      ownsLease = true;
    } catch {
      cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
    }
  } else if (cached.status !== "pending" || cached.expiresAt <= now) {
    const claimed = await prisma.externalApiCache.updateMany({ where: { id: cached.id, fetchedAt: cached.fetchedAt }, data: { status: "pending", fetchedAt: now, expiresAt: leaseExpiry, requestJson: json(body) } });
    ownsLease = claimed.count === 1;
  }

  if (!ownsLease) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      cached = await prisma.externalApiCache.findUnique({ where: { cacheKey } });
      if (cached?.status === "ok" && cached.expiresAt > new Date()) return { payload: cached.responseJson as unknown as BacklinkProviderPayload, cacheHit: true };
      if (cached?.status === "error") throw new Error(String((cached.responseJson as Record<string, unknown>)?.error ?? "Backlink provider collection failed."));
    }
    throw new Error("Another backlink provider request is still running. This job will retry without creating a duplicate request.");
  }

  try {
    const payload = await requestBacklinkProvider(path, body);
    await prisma.externalApiCache.update({ where: { cacheKey }, data: { responseJson: json(payload), status: "ok", fetchedAt: now, expiresAt: new Date(now.getTime() + AUTHORITY_CADENCE_MS) } });
    const costUsd = backlinkProviderCost(payload);
    if (costUsd > 0) {
      await prisma.providerCostEvent.upsert({
        where: { idempotencyKey: `authority-provider:${cacheKey}` },
        update: {},
        create: {
          clientId: context.clientId,
          featureKey: "backlink_snapshot",
          provider: BACKLINK_PROVIDER,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          websiteId: context.websiteId,
          idempotencyKey: `authority-provider:${cacheKey}`,
          costUsd,
          metadataJson: json({ endpoint: path, passiveMonitoring: true, customerCapacityUnits: 0, cacheKey }),
        },
      }).catch((error) => console.error("[authority-monitoring] provider cost attribution failed", { projectId: context.projectId, cacheKey, error: error instanceof Error ? error.message : String(error) }));
    }
    return { payload, cacheHit: false };
  } catch (error) {
    await prisma.externalApiCache.update({ where: { cacheKey }, data: { status: "error", responseJson: json({ error: error instanceof Error ? error.message : "Provider request failed." }), expiresAt: new Date(Date.now() + CACHE_LEASE_MS) } }).catch(() => undefined);
    throw error;
  }
}

async function collectProfile(input: {
  projectId: string;
  clientId: string;
  workspaceId: string | null;
  websiteId: string | null;
  target: string;
  profileType: "owned" | "competitor";
  scheduledAt: Date;
}) {
  const key = backlinkCollectionKey(input.projectId, input.profileType, input.target, input.scheduledAt);
  const duplicate = await prisma.backlinkProfileSnapshot.findUnique({ where: { collectionKey: key } });
  if (duplicate) return duplicate;

  const requestContext = { clientId: input.clientId, workspaceId: input.workspaceId, projectId: input.projectId, websiteId: input.websiteId };
  const summaryRequest = { target: input.target, include_subdomains: true };
  const linksRequest = { target: input.target, include_subdomains: true, limit: LINK_LIMIT, order_by: ["rank,desc"] };
  const [summaryResponse, linksResponse] = await Promise.all([
    cachedProviderRequest("/v3/backlinks/summary/live", [summaryRequest], requestContext),
    cachedProviderRequest("/v3/backlinks/backlinks/live", [linksRequest], requestContext),
  ]);
  const summary = parseBacklinkProviderSummary(input.target, summaryResponse.payload);
  const links = parseBacklinkProviderLinks(linksResponse.payload);
  const capturedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.backlinkProfileSnapshot.findUnique({ where: { collectionKey: key } });
    if (existing) return existing;
    const previous = await tx.backlinkProfileSnapshot.findFirst({
      where: { projectId: input.projectId, profileType: input.profileType, target: input.target },
      orderBy: { capturedAt: "desc" },
      include: { backlinks: { where: { status: { in: ["active", "new"] } }, include: { riskFindings: { where: { status: { in: ["needs_review", "monitor", "action_required"] } } } } } },
    });
    const previousByKey = new Map((previous?.backlinks ?? []).map((item) => [linkKey(item.sourceUrl, item.targetUrl), item]));
    const current = new Map<string, (typeof links)[number]>();
    for (const item of links) if (item.sourceUrl && item.targetUrl) current.set(linkKey(item.sourceUrl, item.targetUrl), item);
    const comparison = compareBacklinkKeys(current.keys(), previousByKey.keys());
    const gained = previous ? comparison.gained.length : 0;
    const lostRows = previous ? comparison.lost.map((item) => previousByKey.get(item)!).filter(Boolean) : [];
    const snapshot = await tx.backlinkProfileSnapshot.create({
      data: {
        projectId: input.projectId,
        provider: BACKLINK_PROVIDER,
        target: input.target,
        profileType: input.profileType,
        competitorDomain: input.profileType === "competitor" ? input.target : null,
        collectionKey: key,
        dataStatus: "available",
        totalBacklinks: summary.backlinks,
        referringDomains: summary.referringDomains,
        newBacklinks: summary.backlinksNew ?? gained,
        lostBacklinks: summary.backlinksLost ?? lostRows.length,
        dofollowBacklinks: summary.dofollow,
        nofollowBacklinks: summary.nofollow,
        brokenBacklinks: summary.brokenBacklinks,
        providerRiskSignal: summary.spamScore,
        rawSummaryJson: json({ summary, providerPayload: summaryResponse.payload, linkSampleSize: current.size }),
        limitationsJson: json([`Link-level comparison uses the top ${LINK_LIMIT} provider results and may not represent the provider's full link index.`, "Provider authority and risk scores are third-party proxies, not Google ranking factors."]),
        comparisonStartAt: previous?.capturedAt ?? null,
        comparisonEndAt: capturedAt,
        capturedAt,
      },
    });
    for (const item of current.values()) {
      if (!item.sourceUrl || !item.targetUrl) continue;
      const wasPresent = previousByKey.has(linkKey(item.sourceUrl, item.targetUrl));
      const backlink = await tx.projectBacklink.create({ data: {
        projectId: input.projectId,
        snapshotId: snapshot.id,
        sourceUrl: item.sourceUrl,
        sourceDomain: item.sourceDomain || domain(item.sourceUrl) || "unknown",
        targetUrl: item.targetUrl,
        anchorText: item.anchor,
        linkType: item.dofollow == null ? "unknown" : item.dofollow ? "follow" : "nofollow",
        domainRank: item.sourceRank,
        providerRiskScore: item.toxicityScore,
        firstSeenAt: safeDate(item.firstSeen),
        lastSeenAt: safeDate(item.lastSeen),
        status: previous && !wasPresent ? "new" : "active",
        evidenceJson: json({ provider: BACKLINK_PROVIDER, pageRank: item.pageRank, lifecycleComparedWithSnapshotId: previous?.id ?? null }),
      } });
      const risk = input.profileType === "owned" ? backlinkRiskFinding({ sourceUrl: item.sourceUrl, sourceDomain: backlink.sourceDomain, targetUrl: item.targetUrl, anchorText: item.anchor, providerRiskScore: item.toxicityScore }) : null;
      if (risk) {
        const priorFinding = previousByKey.get(linkKey(item.sourceUrl, item.targetUrl))?.riskFindings.find((finding) => finding.findingType === risk.findingType);
        if (priorFinding) await tx.authorityRiskFinding.update({ where: { id: priorFinding.id }, data: { snapshotId: snapshot.id, backlinkId: backlink.id, severity: risk.severity, confidence: risk.confidence, summary: risk.summary, recommendedAction: risk.recommendedAction, evidenceJson: json({ ...risk.evidence, refreshedAt: capturedAt.toISOString() }) } });
        else await tx.authorityRiskFinding.create({ data: { projectId: input.projectId, snapshotId: snapshot.id, backlinkId: backlink.id, findingType: risk.findingType, severity: risk.severity, confidence: risk.confidence, summary: risk.summary, recommendedAction: risk.recommendedAction, evidenceJson: json(risk.evidence) } });
      }
    }
    for (const item of lostRows) {
      await tx.projectBacklink.create({ data: {
        projectId: input.projectId,
        snapshotId: snapshot.id,
        sourceUrl: item.sourceUrl,
        sourceDomain: item.sourceDomain,
        targetUrl: item.targetUrl,
        anchorText: item.anchorText,
        linkType: item.linkType,
        domainRank: item.domainRank,
        providerRiskScore: item.providerRiskScore,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        status: "lost",
        evidenceJson: json({ provider: BACKLINK_PROVIDER, lifecycleComparedWithSnapshotId: previous?.id ?? null, missingFromSnapshotId: snapshot.id }),
      } });
    }
    if (input.profileType === "owned") {
      const mentions = await tx.earnedMention.findMany({
        where: { projectId: input.projectId, mentionType: "backlink", status: { not: "lost" } },
        include: { opportunity: { select: { executionTaskId: true } } },
      });
      for (const mention of mentions) {
        const matches = [...current.values()].some((item) => item.sourceUrl === mention.sourceUrl && (!mention.targetUrl || item.targetUrl === mention.targetUrl));
        const updated = await tx.earnedMention.update({ where: { id: mention.id }, data: matches
          ? { status: "verified", verificationStatus: "verified_by_provider", verifiedAt: capturedAt, lostAt: null, evidenceJson: json({ provider: BACKLINK_PROVIDER, snapshotId: snapshot.id, verifiedAt: capturedAt.toISOString() }) }
          : mention.status === "verified" ? { status: "lost", verificationStatus: "lost_in_provider_comparison", lostAt: capturedAt, evidenceJson: json({ provider: BACKLINK_PROVIDER, snapshotId: snapshot.id, lostAt: capturedAt.toISOString() }) }
            : { verificationStatus: "not_found_in_latest_provider_sample", evidenceJson: json({ provider: BACKLINK_PROVIDER, snapshotId: snapshot.id, limitation: `Checked the top ${LINK_LIMIT} provider links.` }) } });
        await tx.growthSignal.upsert({
          where: { fingerprint: `authority-earned:${mention.id}` },
          update: { signalKey: matches ? "verified_earned_backlink" : updated.status === "lost" ? "verified_lost_backlink" : "reported_earned_mention", valueJson: json({ mentionType: mention.mentionType, sourceDomain: mention.sourceDomain, verificationStatus: updated.verificationStatus, snapshotId: snapshot.id }), confidence: matches || updated.status === "lost" ? 95 : 35, collectedAt: capturedAt, effectiveDate: capturedAt },
          create: { projectId: input.projectId, fingerprint: `authority-earned:${mention.id}`, category: "authority", signalKey: matches ? "verified_earned_backlink" : "reported_earned_mention", sourceType: "earned_mention", sourceId: mention.id, valueJson: json({ mentionType: mention.mentionType, sourceDomain: mention.sourceDomain, verificationStatus: updated.verificationStatus, snapshotId: snapshot.id }), confidence: matches ? 95 : 35, collectedAt: capturedAt, effectiveDate: capturedAt, expiresAt: new Date(capturedAt.getTime() + 180 * DAY) },
        });
        const taskId = mention.opportunity?.executionTaskId;
        if (taskId && (matches || updated.status === "lost")) {
          const task = await tx.executionTask.findUnique({ where: { id: taskId } });
          if (task) {
            const approvedMessage = mention.opportunityId ? await tx.outreachMessage.findFirst({
              where: { projectId: input.projectId, campaign: { opportunityId: mention.opportunityId }, approvedVersion: { not: null } },
              orderBy: { approvedAt: "desc" },
              select: { id: true, approvedVersion: true },
            }) : null;
            const priorSnapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
            await tx.executionTask.update({
              where: { id: task.id },
              data: {
                ...(matches && task.status !== "completed" ? { status: "completed", completedAt: capturedAt } : {}),
                impact: matches
                  ? `The scheduled backlink check verified the earned backlink from ${mention.sourceDomain} in snapshot ${snapshot.id}. No ranking or revenue causation is claimed.`
                  : `The previously verified backlink from ${mention.sourceDomain} was not present in the latest provider sample. Review the linked Growth Intelligence finding before deciding on recovery work.`,
                approvalSnapshotJson: json({ ...priorSnapshot, authorityVerification: { earnedMentionId: mention.id, snapshotId: snapshot.id, provider: BACKLINK_PROVIDER, status: updated.status, verificationStatus: updated.verificationStatus, verifiedAt: capturedAt.toISOString(), executionMethod: task.automationLevel, responsibleUserId: task.createdByUserId, outreachMessageId: approvedMessage?.id ?? null, approvedOutreachVersion: approvedMessage?.approvedVersion ?? null } }),
              },
            });
            if (matches) await tx.nextBestAction.updateMany({ where: { followupTaskId: task.id, status: { notIn: ["superseded", "stale", "completed"] } }, data: { status: "completed", decision: "verified_authority_outcome", decidedAt: capturedAt } });
          }
        }
      }
    }
    return snapshot;
  });
}

async function updateVerifiedCompetitorGaps(projectId: string, clientId: string, ownedSnapshotId: string, competitorSnapshots: Array<{ id: string; target: string; capturedAt: Date; comparisonStartAt: Date | null; comparisonEndAt: Date | null; limitationsJson: Prisma.JsonValue }>) {
  const ownedLinks = await prisma.projectBacklink.findMany({ where: { snapshotId: ownedSnapshotId, status: { not: "lost" } }, select: { sourceDomain: true } });
  const ownedDomains = new Set(ownedLinks.map((item) => item.sourceDomain));
  for (const competitor of competitorSnapshots) {
    const competitorLinks = await prisma.projectBacklink.findMany({ where: { snapshotId: competitor.id, status: { not: "lost" } }, select: { sourceDomain: true, sourceUrl: true, domainRank: true } });
    const gaps = competitorLinks.filter((item) => !ownedDomains.has(item.sourceDomain));
    const uniqueGaps = [...new Map(gaps.map((item) => [item.sourceDomain, item])).values()].sort((a, b) => (b.domainRank ?? 0) - (a.domainRank ?? 0)).slice(0, 20);
    if (!uniqueGaps.length) continue;
    const score = Math.max(45, Math.min(90, 50 + uniqueGaps.length * 2));
    const dedupeKey = `authority-competitor-gap:${projectId}:${hash(competitor.target).slice(0, 20)}`;
    const existingOpportunity = await prisma.authorityOpportunity.findUnique({ where: { dedupeKey }, select: { status: true } });
    const opportunity = await prisma.authorityOpportunity.upsert({
      where: { dedupeKey },
      update: {
        title: `Review ${uniqueGaps.length} verified referring-domain gaps against ${competitor.target}`,
        description: `Backlink analysis found ${uniqueGaps.length} sampled domains linking to ${competitor.target} but not to the current owned-site snapshot. Review relevance before creating any asset or outreach task.`,
        sourceName: competitor.target,
        status: existingOpportunity?.status === "approved" ? "approved" : "discovered",
        sourceQualityScore: Math.min(90, Math.round(uniqueGaps.reduce((sum, item) => sum + (item.domainRank ?? 40), 0) / uniqueGaps.length)),
        priorityScore: score,
        scoreReason: "Prioritized from a verified provider comparison; relevance and relationship fit still require human review.",
        evidenceJson: json({ provider: BACKLINK_PROVIDER, confirmedGap: true, verificationRequired: false, ownedSnapshotId, competitorSnapshotId: competitor.id, collectedAt: competitor.capturedAt.toISOString(), comparisonPeriodStart: competitor.comparisonStartAt?.toISOString() ?? null, comparisonPeriodEnd: competitor.comparisonEndAt?.toISOString() ?? competitor.capturedAt.toISOString(), limitations: competitor.limitationsJson, gapDomains: uniqueGaps }),
      },
      create: {
        projectId,
        clientId,
        dedupeKey,
        opportunityType: "competitor_backlink_gap",
        title: `Review ${uniqueGaps.length} verified referring-domain gaps against ${competitor.target}`,
        targetPageUrl: null,
        sourceType: "verified_provider_gap",
        sourceName: competitor.target,
        description: `Backlink analysis found ${uniqueGaps.length} sampled domains linking to ${competitor.target} but not to the current owned-site snapshot. Review relevance before creating any asset or outreach task.`,
        valueExchange: "Create a useful, evidence-backed resource only for relevant sources; do not copy competitor tactics or automate outreach.",
        topicalRelevanceScore: 60,
        businessRelevanceScore: 65,
        sourceQualityScore: Math.min(90, Math.round(uniqueGaps.reduce((sum, item) => sum + (item.domainRank ?? 40), 0) / uniqueGaps.length)),
        earningLikelihoodScore: 45,
        businessValueScore: 65,
        effortScore: 55,
        priorityScore: score,
        scoreReason: "Prioritized from a verified provider comparison; relevance and relationship fit still require human review.",
        riskScore: 20,
        riskLabel: "review_required",
        estimatedValue: "medium",
        evidenceJson: json({ provider: BACKLINK_PROVIDER, confirmedGap: true, verificationRequired: false, ownedSnapshotId, competitorSnapshotId: competitor.id, collectedAt: competitor.capturedAt.toISOString(), comparisonPeriodStart: competitor.comparisonStartAt?.toISOString() ?? null, comparisonPeriodEnd: competitor.comparisonEndAt?.toISOString() ?? competitor.capturedAt.toISOString(), limitations: competitor.limitationsJson, gapDomains: uniqueGaps }),
        outreachRequired: true,
      },
    });
    const nbaDedupeKey = `authority-gap:${opportunity.id}`;
    const existingAction = await prisma.nextBestAction.findFirst({ where: { projectId, dedupeKey: nbaDedupeKey, status: { in: ["proposed", "recommended", "selected"] } }, orderBy: { createdAt: "desc" } });
    const actionData = {
      sourceType: "authority_opportunity",
      sourceId: opportunity.id,
      title: opportunity.title ?? "Review verified authority gap",
      recommendation: opportunity.description,
      reasoningSummary: opportunity.scoreReason ?? "Verified competitor backlink comparison requires relevance review.",
      expectedImpact: "Identify relevant authority relationships or assets without automating link placement or outreach.",
      confidence: 85,
      estimatedEffort: "medium",
      route: "authority",
      priorityScore: opportunity.priorityScore,
      evidenceJson: json({ opportunityId: opportunity.id, provider: BACKLINK_PROVIDER, confirmedGap: true }),
      actionType: "authority_growth",
      targetEntitiesJson: json([competitor.target]),
      estimatedImpactJson: json({ authority: "potential", causationClaimed: false }),
      scoreJson: json({ priority: opportunity.priorityScore, risk: opportunity.riskScore }),
      approvalType: "user_approval",
      riskLevel: "medium",
      urgency: opportunity.priorityScore,
      reviewAfter: new Date(Date.now() + AUTHORITY_CADENCE_MS),
      dedupeKey: nbaDedupeKey,
    };
    if (existingAction) await prisma.nextBestAction.update({ where: { id: existingAction.id }, data: actionData });
    else await prisma.nextBestAction.create({ data: { projectId, ...actionData } });
  }
}

export async function collectScheduledBacklinkEvidence(projectId: string, scheduledAt: Date): Promise<CollectionResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientId: true,
      websiteId: true,
      competitors: true,
      website: { select: { domain: true, rootUrl: true } },
      agencyClient: { select: { workspaceId: true } },
      client: { select: { workspace: { select: { id: true } } } },
      keywordResearchRuns: { where: { status: "completed" }, orderBy: { completedAt: "desc" }, take: 20, select: { competitors: { orderBy: { rank: "asc" }, take: 5, select: { domain: true } } } },
    },
  });
  if (!project) return { status: "unavailable", snapshotId: null, provider: BACKLINK_PROVIDER, collectedAt: null, limitation: "Project no longer exists." };
  const target = domain(project.website?.domain) || domain(project.website?.rootUrl);
  const recentOwned = await prisma.backlinkProfileSnapshot.findMany({ where: { projectId, profileType: "owned" }, orderBy: { capturedAt: "desc" }, take: 2 });
  const latest = recentOwned[0];
  if (!target) return { status: "unavailable", snapshotId: latest?.id ?? null, provider: BACKLINK_PROVIDER, collectedAt: latest?.capturedAt ?? null, limitation: "Connect a website domain before backlink monitoring can run." };
  if (!backlinkProviderConfigured()) return { status: "unavailable", snapshotId: latest?.id ?? null, provider: BACKLINK_PROVIDER, collectedAt: latest?.capturedAt ?? null, limitation: "Backlink monitoring is temporarily unavailable. The last verified snapshot is preserved." };
  try {
    const workspaceId = project.agencyClient?.workspaceId ?? project.client.workspace?.id ?? null;
    const ownedWasCurrent = Boolean(latest && scheduledAt.getTime() - latest.capturedAt.getTime() < AUTHORITY_CADENCE_MS);
    const owned = ownedWasCurrent ? latest! : await collectProfile({ projectId, clientId: project.clientId, workspaceId, websiteId: project.websiteId, target, profileType: "owned", scheduledAt });
    const stableOwnedProfile = recentOwned.length >= 2 && recentOwned.every((snapshot) => snapshot.newBacklinks === 0 && snapshot.lostBacklinks === 0);
    const optionalCompetitorCadence = stableOwnedProfile ? AUTHORITY_CADENCE_MS * 2 : AUTHORITY_CADENCE_MS;
    const suppliedCompetitors = Array.isArray(project.competitors) ? project.competitors.map(String) : [];
    const rankingCompetitors = project.keywordResearchRuns.flatMap((run) => run.competitors.map((item) => item.domain));
    const competitorDomains = [...new Set([...rankingCompetitors, ...suppliedCompetitors].map((item) => domain(item)).filter((item): item is string => Boolean(item) && item !== target))].slice(0, COMPETITOR_LIMIT);
    const competitorSnapshots = [];
    const competitorErrors: string[] = [];
    for (const competitor of competitorDomains) {
      try {
        const currentCompetitor = await prisma.backlinkProfileSnapshot.findFirst({ where: { projectId, profileType: "competitor", target: competitor }, orderBy: { capturedAt: "desc" } });
        competitorSnapshots.push(currentCompetitor && scheduledAt.getTime() - currentCompetitor.capturedAt.getTime() < optionalCompetitorCadence
          ? currentCompetitor
          : await collectProfile({ projectId, clientId: project.clientId, workspaceId, websiteId: project.websiteId, target: competitor, profileType: "competitor", scheduledAt }));
      } catch (error) {
        competitorErrors.push(`${competitor}: ${error instanceof Error ? error.message : "collection failed"}`);
      }
    }
    await updateVerifiedCompetitorGaps(projectId, project.clientId, owned.id, competitorSnapshots.map((item) => ({ id: item.id, target: item.target, capturedAt: item.capturedAt, comparisonStartAt: item.comparisonStartAt, comparisonEndAt: item.comparisonEndAt, limitationsJson: item.limitationsJson })));
    return { status: competitorErrors.length ? "failed" : ownedWasCurrent ? "current" : "collected", snapshotId: owned.id, provider: owned.provider, collectedAt: owned.capturedAt, limitation: competitorErrors.length ? `Owned-site evidence is current, but competitor collection needs retry: ${competitorErrors.join("; ")}` : null };
  } catch (error) {
    return { status: "failed", snapshotId: latest?.id ?? null, provider: latest?.provider ?? BACKLINK_PROVIDER, collectedAt: latest?.capturedAt ?? null, limitation: `${error instanceof Error ? error.message : "Backlink collection failed."} The last verified snapshot is preserved and the next durable monitoring cycle will retry.` };
  }
}
