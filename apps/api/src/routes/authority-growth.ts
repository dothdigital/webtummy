import { Router, type NextFunction, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { backlinkRiskFinding, buildAuthorityOpportunityDrafts } from "../authority-growth-engine.js";
import { centralAiJson } from "../central-ai-service.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const authorityGrowthRouter = Router();

const backlinkLinkSchema = z.object({
  sourceUrl: z.string().url().nullable(),
  sourceDomain: z.string().max(255).nullable(),
  targetUrl: z.string().url().nullable(),
  anchor: z.string().max(5000).nullable(),
  dofollow: z.boolean().nullable(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  sourceRank: z.number().nullable(),
  pageRank: z.number().nullable(),
  toxicityScore: z.number().nullable(),
});

const snapshotSchema = z.object({
  summary: z.object({
    target: z.string().min(1).max(512),
    backlinks: z.number().nullable(),
    backlinksNew: z.number().nullable(),
    backlinksLost: z.number().nullable(),
    referringDomains: z.number().nullable(),
    dofollow: z.number().nullable(),
    nofollow: z.number().nullable(),
    brokenBacklinks: z.number().nullable(),
    spamScore: z.number().nullable(),
    source: z.string().max(80),
    fetchedAt: z.string(),
  }),
  links: z.array(backlinkLinkSchema).max(250).default([]),
});

const opportunityStatusSchema = z.object({
  status: z.enum(["shortlisted", "researching", "dismissed", "discovered"]),
});

const riskReviewSchema = z.object({
  status: z.enum(["reviewed_no_action", "monitor", "action_required"]),
  notes: z.string().trim().max(5000).optional(),
});

const outreachContactSchema = z.object({
  organizationName: z.string().trim().min(2).max(180),
  contactName: z.string().trim().max(180).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  websiteUrl: z.string().url().optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  relationshipNote: z.string().trim().max(5000).optional().nullable(),
});

const outreachMessageUpdateSchema = z.object({
  subject: z.string().trim().min(2).max(255),
  bodyText: z.string().trim().min(20).max(20_000),
});

const outreachVersionSchema = z.object({ version: z.coerce.number().int().min(1) });
const outreachAiRevisionSchema = z.object({
  mode: z.enum(["revise", "regenerate"]),
  instruction: z.string().trim().max(1000).optional(),
});
const outreachAiResultSchema = z.object({
  subject: z.string().trim().min(2).max(255),
  bodyText: z.string().trim().min(20).max(20_000),
});

const campaignStatusSchema = z.object({
  status: z.enum(["contacted", "responded", "earned", "declined", "closed"]),
  notes: z.string().trim().max(5000).optional(),
});

const contactPreferenceSchema = z.object({
  optOut: z.boolean(),
});

const earnedMentionSchema = z.object({
  opportunityId: z.string().optional().nullable(),
  sourceUrl: z.string().url(),
  targetUrl: z.string().url().optional().nullable(),
  mentionType: z.enum(["backlink", "unlinked_mention", "citation", "podcast", "press_coverage", "directory"]).default("backlink"),
  linkAttribute: z.enum(["follow", "nofollow", "sponsored", "ugc", "unknown"]).optional().nullable(),
  referralVisits: z.number().int().min(0).max(10_000_000).default(0),
  referralLeads: z.number().int().min(0).max(10_000_000).default(0),
  earnedAt: z.string().datetime().optional().nullable(),
});

function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

async function authorityProject(req: Request, projectId: string, permission?: string) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) fail("Project not found.", 404);
  if (permission && !hasWorkspacePermission(context, permission)) fail(`${permission === "approve" ? "Approval" : "AI analysis"} permission is required.`, 403);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(context.workspace.legacyClientId ? { clientId: context.workspace.legacyClientId } : {}) },
    include: {
      agencyClient: { select: { id: true } },
      businessProfile: true,
      website: { select: { id: true, rootUrl: true, domain: true } },
      keywordGroups: { where: { status: "approved" }, select: { keywords: true } },
      keywordResearchRuns: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 20, select: { seedKeyword: true, ideas: { take: 20, select: { keyword: true } } } },
      strategyPlans: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!project) fail("Project not found.", 404);
  return { context, project };
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function activeExecutionPlan(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  return existing ?? tx.executionPlan.create({ data: { projectId, title: "Authority growth execution plan", summary: "Approved authority assets, relationship outreach and measurable earned-media work." } });
}

authorityGrowthRouter.get("/projects/:projectId/authority-growth", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId);
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  const [snapshots, backlinks, riskFindings, opportunities, assets, campaigns, earnedMentions, performance, preparationFeature, monitoringRun] = await Promise.all([
    prisma.backlinkProfileSnapshot.findMany({ where: { projectId: project.id, profileType: "owned" }, orderBy: { capturedAt: "desc" }, take: 12 }),
    prisma.projectBacklink.findMany({ where: { projectId: project.id, snapshot: { profileType: "owned" } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.authorityRiskFinding.findMany({ where: { projectId: project.id, ...(clientViewer ? { status: { not: "needs_review" } } : {}) }, orderBy: [{ status: "asc" }, { severity: "asc" }, { createdAt: "desc" }], take: 100 }),
    prisma.authorityOpportunity.findMany({
      where: { projectId: project.id, status: clientViewer ? "approved" : { not: "superseded" } },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.authorityAsset.findMany({ where: { projectId: project.id }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }], take: 100 }),
    clientViewer ? Promise.resolve([]) : prisma.outreachCampaign.findMany({ where: { projectId: project.id }, include: { contact: true, messages: { orderBy: { sequenceOrder: "asc" }, include: { versions: { orderBy: { version: "desc" }, take: 20 } } }, opportunity: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.earnedMention.findMany({ where: { projectId: project.id }, orderBy: [{ earnedAt: "desc" }, { createdAt: "desc" }], take: 100 }),
    prisma.authorityPerformanceMetric.findMany({ where: { projectId: project.id }, orderBy: { periodEnd: "desc" }, take: 100 }),
    prisma.featureCostCatalog.findUnique({ where: { featureKey: "execution_content_generate" }, select: { featureKey: true, label: true, defaultCreditCost: true, requiresApproval: true } }),
    prisma.growthIntelligenceSourceRun.findFirst({ where: { projectId: project.id, sourceType: "backlinks" }, orderBy: { createdAt: "desc" }, select: { status: true, completedAt: true, nextScheduledAt: true, restrictionReason: true, errorMessage: true, snapshotJson: true } }),
  ]);
  res.json({
    project: { id: project.id, name: project.businessName ?? project.name, website: project.website?.rootUrl ?? project.websiteUrl },
    capabilities: {
      canResearch: hasWorkspacePermission(context, "run_ai_analysis"),
      canApprove: hasWorkspacePermission(context, "approve"),
      canExecute: hasWorkspacePermission(context, "execute_tasks"),
      readOnly: clientViewer || !hasWorkspacePermission(context, "run_ai_analysis"),
      hasApprovedStrategy: project.strategyPlans.length > 0,
    },
    snapshots,
    backlinks: snapshots[0] ? backlinks.filter((item) => item.snapshotId === snapshots[0].id) : [],
    riskFindings,
    opportunities,
    assets,
    campaigns,
    earnedMentions,
    performance,
    preparationEstimate: preparationFeature ? { featureKey: preparationFeature.featureKey, label: preparationFeature.label, capacityUnits: preparationFeature.defaultCreditCost, requiresApproval: preparationFeature.requiresApproval } : null,
    monitoringState: monitoringRun,
  });
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/snapshots", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const input = snapshotSchema.parse(req.body);
  const capturedAt = safeDate(input.summary.fetchedAt) ?? new Date();
  const collectionKey = `authority:manual:${project.id}:${createHash("sha256").update(`${input.summary.source}:${input.summary.target}:${capturedAt.toISOString()}`).digest("hex").slice(0, 32)}`;
  const existing = await prisma.backlinkProfileSnapshot.findFirst({
    where: { collectionKey },
  });
  if (existing) return res.json({ snapshot: existing, backlinkCount: 0, findingCount: 0, duplicate: true });
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.backlinkProfileSnapshot.findFirst({ where: { projectId: project.id, profileType: "owned" }, orderBy: { capturedAt: "desc" } });
    const snapshot = await tx.backlinkProfileSnapshot.create({
      data: {
        projectId: project.id,
        provider: input.summary.source,
        target: input.summary.target,
        profileType: "owned",
        collectionKey,
        dataStatus: input.summary.backlinks == null && input.summary.referringDomains == null ? "limited" : "available",
        totalBacklinks: input.summary.backlinks,
        referringDomains: input.summary.referringDomains,
        newBacklinks: input.summary.backlinksNew,
        lostBacklinks: input.summary.backlinksLost,
        dofollowBacklinks: input.summary.dofollow,
        nofollowBacklinks: input.summary.nofollow,
        brokenBacklinks: input.summary.brokenBacklinks,
        providerRiskSignal: input.summary.spamScore,
        rawSummaryJson: input.summary as Prisma.InputJsonValue,
        limitationsJson: ["Link details are limited to the provider sample saved with this snapshot.", "Provider authority and risk scores are third-party proxies, not Google ranking factors."],
        comparisonStartAt: previous?.capturedAt ?? null,
        comparisonEndAt: capturedAt,
        capturedAt,
      },
    });
    let findingCount = 0;
    let backlinkCount = 0;
    for (const link of input.links) {
      if (!link.sourceUrl || !link.targetUrl) continue;
      const backlink = await tx.projectBacklink.create({
        data: {
          projectId: project.id,
          snapshotId: snapshot.id,
          sourceUrl: link.sourceUrl,
          sourceDomain: link.sourceDomain || sourceDomain(link.sourceUrl),
          targetUrl: link.targetUrl,
          anchorText: link.anchor,
          linkType: link.dofollow == null ? "unknown" : link.dofollow ? "follow" : "nofollow",
          domainRank: link.sourceRank,
          providerRiskScore: link.toxicityScore,
          firstSeenAt: safeDate(link.firstSeen),
          lastSeenAt: safeDate(link.lastSeen),
          evidenceJson: { pageRank: link.pageRank, provider: input.summary.source },
        },
      });
      backlinkCount += 1;
      const finding = backlinkRiskFinding({
        sourceUrl: link.sourceUrl,
        sourceDomain: backlink.sourceDomain,
        targetUrl: link.targetUrl,
        anchorText: link.anchor,
        providerRiskScore: link.toxicityScore,
      });
      if (finding) {
        await tx.authorityRiskFinding.create({
          data: {
            projectId: project.id,
            snapshotId: snapshot.id,
            backlinkId: backlink.id,
            findingType: finding.findingType,
            severity: finding.severity,
            confidence: finding.confidence,
            summary: finding.summary,
            recommendedAction: finding.recommendedAction,
            evidenceJson: finding.evidence as Prisma.InputJsonValue,
          },
        });
        findingCount += 1;
      }
    }
    await tx.growthSignal.upsert({
      where: { fingerprint: `authority-profile:${project.id}:${snapshot.id}` },
      update: {},
      create: {
        projectId: project.id,
        fingerprint: `authority-profile:${project.id}:${snapshot.id}`,
        category: "authority",
        signalKey: "backlink_profile",
        sourceType: "backlink_profile_snapshot",
        sourceId: snapshot.id,
        valueJson: { referringDomains: snapshot.referringDomains, totalBacklinks: snapshot.totalBacklinks, newBacklinks: snapshot.newBacklinks, lostBacklinks: snapshot.lostBacklinks, reviewFindings: findingCount },
        confidence: input.links.length ? 92 : 75,
        collectedAt: new Date(),
        effectiveDate: snapshot.capturedAt,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await recordWorkspaceActivity(tx, { context, action: "authority.snapshot_captured", entityType: "backlink_profile_snapshot", entityId: snapshot.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { backlinkCount, findingCount, provider: snapshot.provider } });
    return { snapshot, backlinkCount, findingCount };
  });
  res.status(201).json(result);
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/discover", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const keywords = [...new Set([
    ...project.keywordGroups.flatMap((group) => stringList(group.keywords)),
    ...project.keywordResearchRuns.flatMap((run) => [run.seedKeyword, ...run.ideas.map((idea) => idea.keyword)]),
  ].map((item) => item.trim()).filter(Boolean))].slice(0, 50);
  const strategy = project.strategyPlans[0];
  const drafts = buildAuthorityOpportunityDrafts({
    businessName: project.businessName ?? project.name,
    niche: project.niche ?? project.businessProfile?.businessSummary ?? "the business category",
    audience: project.businessProfile?.targetAudience ?? "the target audience",
    primaryGoal: project.primaryGoal ?? "qualified growth",
    targetMarkets: stringList(project.targetLocations),
    competitors: stringList(project.competitors),
    targetPageUrl: project.website?.rootUrl ?? project.websiteUrl,
    approvedKeywords: keywords.length ? keywords : strategy?.seoStrategy ? [strategy.seoStrategy.slice(0, 180)] : [],
  });
  const result = await prisma.$transaction(async (tx) => {
    await tx.authorityOpportunity.updateMany({ where: { projectId: project.id, sourceType: { not: "verified_provider_gap" }, status: { in: ["discovered", "shortlisted", "researching"] } }, data: { status: "superseded" } });
    const opportunities = [];
    for (const draft of drafts) {
      opportunities.push(await tx.authorityOpportunity.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          opportunityType: draft.opportunityType,
          title: draft.title.slice(0, 255),
          opportunityUrl: draft.opportunityUrl,
          targetPageUrl: draft.targetPageUrl,
          sourceType: draft.sourceType,
          sourceName: draft.sourceName?.slice(0, 180),
          description: draft.description,
          valueExchange: draft.valueExchange,
          topicalRelevanceScore: draft.topicalRelevanceScore,
          businessRelevanceScore: draft.businessRelevanceScore,
          sourceQualityScore: draft.sourceQualityScore,
          earningLikelihoodScore: draft.earningLikelihoodScore,
          businessValueScore: draft.businessValueScore,
          effortScore: draft.effortScore,
          priorityScore: draft.priorityScore,
          scoreReason: draft.scoreReason,
          riskScore: draft.riskScore,
          riskLabel: draft.riskLabel,
          estimatedValue: draft.estimatedValue,
          evidenceJson: draft.evidence as Prisma.InputJsonValue,
          outreachRequired: draft.outreachRequired,
        },
      }));
    }
    const top = opportunities[0];
    if (top) {
      const existing = await tx.nextBestAction.findFirst({ where: { projectId: project.id, dedupeKey: "authority-growth:top-opportunity", status: { in: ["proposed", "selected"] } }, orderBy: { createdAt: "desc" } });
      const nextAction = {
        sourceType: "authority_opportunity",
        sourceId: top.id,
        title: top.title ?? "Review authority opportunity",
        recommendation: top.description,
        reasoningSummary: top.scoreReason ?? "Highest-scoring current authority opportunity.",
        expectedImpact: "Build relevant authority, qualified referral visibility and stronger brand evidence.",
        confidence: Math.min(95, Math.max(45, top.priorityScore)),
        estimatedEffort: top.effortScore >= 70 ? "high" : top.effortScore >= 40 ? "medium" : "low",
        route: "authority",
        priorityScore: top.priorityScore,
        evidenceJson: { opportunityId: top.id, sourceType: top.sourceType, scoreReason: top.scoreReason } as Prisma.InputJsonValue,
        actionType: "authority_growth",
        businessGoal: project.primaryGoal,
        targetEntitiesJson: [top.targetPageUrl].filter(Boolean) as Prisma.InputJsonValue,
        estimatedImpactJson: { authority: "high", referrals: "measurable" } as Prisma.InputJsonValue,
        scoreJson: { priority: top.priorityScore, risk: top.riskScore } as Prisma.InputJsonValue,
        approvalType: "user_approval",
        riskLevel: top.riskLabel === "low_risk" ? "low" : "medium",
        urgency: top.priorityScore,
        reviewAfter: new Date(Date.now() + 14 * 86_400_000),
        dedupeKey: "authority-growth:top-opportunity",
      };
      if (existing) await tx.nextBestAction.update({ where: { id: existing.id }, data: nextAction });
      else await tx.nextBestAction.create({ data: { projectId: project.id, ...nextAction } });
    }
    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "authority_growth",
        promptVersion: "dev-041-v1",
        inputSnapshotJson: { niche: project.niche, targetMarkets: project.targetLocations, competitors: project.competitors, keywordCount: keywords.length },
        outputJson: { opportunities: opportunities.map((item) => ({ id: item.id, type: item.opportunityType, score: item.priorityScore, status: item.status })) },
        outputText: `${opportunities.length} relevance-led authority opportunities generated for review.`,
        status: "completed",
      },
    });
    await recordWorkspaceActivity(tx, { context, action: "authority.opportunities_discovered", entityType: "authority_opportunity", agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { count: opportunities.length, topOpportunityId: top?.id ?? null } });
    return opportunities;
  });
  res.status(201).json({ opportunities: result });
});

authorityGrowthRouter.patch("/projects/:projectId/authority-growth/opportunities/:opportunityId", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const input = opportunityStatusSchema.parse(req.body);
  const opportunity = await prisma.authorityOpportunity.findFirst({ where: { id: req.params.opportunityId, projectId: project.id } });
  if (!opportunity) fail("Authority opportunity not found.", 404);
  if (opportunity.status === "approved") fail("Approved opportunities are locked to their execution record.", 409);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.authorityOpportunity.update({ where: { id: opportunity.id }, data: { status: input.status, dismissedAt: input.status === "dismissed" ? new Date() : null } });
    await recordWorkspaceActivity(tx, { context, action: `authority.opportunity_${input.status}`, entityType: "authority_opportunity", entityId: opportunity.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: opportunity.status }, nextJson: { status: input.status } });
    return next;
  });
  res.json({ opportunity: updated });
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/opportunities/:opportunityId/approve", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "approve");
  const opportunity = await prisma.authorityOpportunity.findFirst({ where: { id: req.params.opportunityId, projectId: project.id } });
  if (!opportunity) fail("Authority opportunity not found.", 404);
  if (!project.strategyPlans[0]) fail("Approve the current Strategy before creating authority execution work.", 409);
  if (opportunity.riskLabel === "avoid") fail("This opportunity cannot be approved because it conflicts with the authority safety policy.", 409);
  const result = await prisma.$transaction(async (tx) => {
    const plan = await activeExecutionPlan(tx, project.id);
    const task = await tx.executionTask.upsert({
      where: { dedupeKey: `authority-growth:${opportunity.id}` },
      update: {
        title: opportunity.title ?? `Authority: ${opportunity.opportunityType.replace(/_/g, " ")}`,
        description: opportunity.description,
        expectedOutcome: "Earn a relevant authority signal and measure resulting referral visibility and leads.",
        priority: opportunity.priorityScore >= 75 ? "high" : opportunity.priorityScore >= 50 ? "medium" : "low",
        status: "ready",
        relatedModule: "strategy",
        approvalSnapshotJson: { strategyId: project.strategyPlans[0]?.id ?? null, strategyVersion: project.strategyPlans[0]?.version ?? null, authorityOpportunityId: opportunity.id, evidence: opportunity.evidenceJson },
      },
      create: {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: plan.id,
        moduleName: "backlinks",
        sourceType: "authority_opportunity",
        sourceId: opportunity.id,
        dedupeKey: `authority-growth:${opportunity.id}`,
        title: opportunity.title ?? `Authority: ${opportunity.opportunityType.replace(/_/g, " ")}`,
        description: opportunity.description,
        expectedOutcome: "Earn a relevant authority signal and measure resulting referral visibility and leads.",
        priority: opportunity.priorityScore >= 75 ? "high" : opportunity.priorityScore >= 50 ? "medium" : "low",
        approvalRisk: opportunity.outreachRequired ? "medium" : "low",
        automationLevel: "manual_guided",
        status: "ready",
        requiresApproval: false,
        manualRequired: true,
        relatedModule: "strategy",
        approvalSnapshotJson: { strategyId: project.strategyPlans[0]?.id ?? null, strategyVersion: project.strategyPlans[0]?.version ?? null, authorityOpportunityId: opportunity.id, evidence: opportunity.evidenceJson },
        safetyCategory: opportunity.riskLabel,
        actionButtonLabel: opportunity.outreachRequired ? "Review Outreach Draft" : "Open Authority Task",
        relatedUrl: `/backlinks?projectId=${project.id}`,
        manualInstructions: `${opportunity.description}\n\nValue exchange: ${opportunity.valueExchange ?? "Define a legitimate audience benefit before outreach."}`,
        impact: opportunity.scoreReason,
      },
    });
    const assetType = opportunity.opportunityType === "research_asset" ? "original_research" : opportunity.opportunityType === "resource_page" ? "tool_or_guide" : "supporting_asset";
    const asset = await tx.authorityAsset.create({
      data: {
        projectId: project.id,
        opportunityId: opportunity.id,
        assetType,
        title: (opportunity.title ?? "Authority asset").slice(0, 220),
        rationale: opportunity.valueExchange,
        contentBriefJson: {
          objective: opportunity.description,
          valueExchange: opportunity.valueExchange,
          targetPageUrl: opportunity.targetPageUrl,
          evidence: opportunity.evidenceJson,
          requirements: ["Use verifiable sources", "Do not invent statistics, credentials or relationships", "Include a clear audience benefit", "Record source URLs and publication dates"],
        },
        status: "planned",
        approvalStatus: "draft",
        riskScore: opportunity.riskScore,
        priorityScore: opportunity.priorityScore,
        executionTaskId: task.id,
      },
    });
    let campaign = null;
    if (opportunity.outreachRequired) {
      campaign = await tx.outreachCampaign.create({
        data: {
          projectId: project.id,
          opportunityId: opportunity.id,
          title: opportunity.title ?? "Authority outreach",
          valueProposition: opportunity.valueExchange ?? "Offer a relevant, useful contribution to the recipient's audience.",
          status: "draft",
          approvalStatus: "draft",
          sendingLimit: 0,
          messages: {
            create: {
              projectId: project.id,
              sequenceOrder: 1,
              messageType: "initial",
              subject: `Resource idea for your audience: ${opportunity.title ?? project.name}`.slice(0, 255),
              bodyText: `Hello,\n\nI’m reaching out on behalf of ${project.businessName ?? project.name}. We prepared a resource for ${project.businessProfile?.targetAudience ?? "people interested in this topic"}: ${opportunity.title ?? "a practical authority resource"}.\n\nWhy it may be useful to your audience:\n${opportunity.valueExchange ?? "It provides practical, source-backed information without requiring a promotional placement."}\n\nIf it fits your editorial standards, would you be open to reviewing it? No automated placement or reciprocal link is expected.\n\nThank you.`,
              personalizationJson: { required: ["recipient name", "publication or organization", "specific relevant page", "why this audience benefits"], autoSend: false },
              versions: { create: {
                version: 1,
                subject: `Resource idea for your audience: ${opportunity.title ?? project.name}`.slice(0, 255),
                bodyText: `Hello,\n\nI’m reaching out on behalf of ${project.businessName ?? project.name}. We prepared a resource for ${project.businessProfile?.targetAudience ?? "people interested in this topic"}: ${opportunity.title ?? "a practical authority resource"}.\n\nWhy it may be useful to your audience:\n${opportunity.valueExchange ?? "It provides practical, source-backed information without requiring a promotional placement."}\n\nIf it fits your editorial standards, would you be open to reviewing it? No automated placement or reciprocal link is expected.\n\nThank you.`,
                changeType: "initial_draft",
                createdByUserId: context.membership.userId,
              } },
            },
          },
        },
        include: { messages: true },
      });
    }
    const approved = await tx.authorityOpportunity.update({ where: { id: opportunity.id }, data: { status: "approved", executionTaskId: task.id, approvedByUserId: context.membership.userId, approvedAt: new Date(), dismissedAt: null } });
    const nextAction = await tx.nextBestAction.findFirst({ where: { projectId: project.id, sourceType: "authority_opportunity", sourceId: opportunity.id, status: { in: ["proposed", "selected"] } }, orderBy: { createdAt: "desc" } });
    if (nextAction) await tx.nextBestAction.update({ where: { id: nextAction.id }, data: { status: "accepted", decision: "approved", decidedByUserId: context.membership.userId, decidedAt: new Date(), selectedAt: nextAction.selectedAt ?? new Date(), followupTaskId: task.id } });
    await recordWorkspaceActivity(tx, { context, action: "authority.opportunity_approved", entityType: "authority_opportunity", entityId: opportunity.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: opportunity.status }, nextJson: { status: "approved", executionTaskId: task.id, assetId: asset.id, campaignId: campaign?.id ?? null, autoSend: false } });
    return { opportunity: approved, task, asset, campaign };
  });
  res.json(result);
});

authorityGrowthRouter.patch("/projects/:projectId/authority-growth/risk-findings/:findingId", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const input = riskReviewSchema.parse(req.body);
  const finding = await prisma.authorityRiskFinding.findFirst({ where: { id: req.params.findingId, projectId: project.id } });
  if (!finding) fail("Risk finding not found.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.authorityRiskFinding.update({ where: { id: finding.id }, data: { status: input.status, reviewedByUserId: context.membership.userId, reviewedAt: new Date(), evidenceJson: { ...(finding.evidenceJson as Record<string, unknown>), reviewNotes: input.notes ?? null } } });
    await recordWorkspaceActivity(tx, { context, action: "authority.risk_reviewed", entityType: "authority_risk_finding", entityId: finding.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: finding.status }, nextJson: { status: input.status, notes: input.notes ?? null } });
    return next;
  });
  res.json({ finding: updated });
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/outreach/messages/:messageId/approve", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "approve");
  const message = await prisma.outreachMessage.findFirst({ where: { id: req.params.messageId, projectId: project.id }, include: { campaign: true } });
  if (!message) fail("Outreach message not found.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.outreachMessage.update({ where: { id: message.id }, data: { approvalStatus: "approved", status: "approved_not_sent", approvedVersion: message.currentVersion, approvedByUserId: context.membership.userId, approvedAt: new Date() } });
    await tx.outreachCampaign.update({ where: { id: message.campaignId }, data: { approvalStatus: "approved", status: "approved_not_sent", approvedByUserId: context.membership.userId, approvedAt: new Date(), sendingLimit: 0 } });
    await recordWorkspaceActivity(tx, { context, action: "authority.outreach_draft_approved", entityType: "outreach_message", entityId: message.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { approvalStatus: message.approvalStatus }, nextJson: { approvalStatus: "approved", status: "approved_not_sent", autoSend: false } });
    return next;
  });
  res.json({ message: updated, sendingEnabled: false });
});

authorityGrowthRouter.patch("/projects/:projectId/authority-growth/outreach/messages/:messageId", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const input = outreachMessageUpdateSchema.parse(req.body);
  const message = await prisma.outreachMessage.findFirst({ where: { id: req.params.messageId, projectId: project.id } });
  if (!message) fail("Outreach message not found.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const version = message.currentVersion + 1;
    await tx.outreachMessageVersion.create({ data: { messageId: message.id, version, subject: input.subject, bodyText: input.bodyText, changeType: "manual_edit", createdByUserId: context.membership.userId } });
    const next = await tx.outreachMessage.update({ where: { id: message.id }, data: { subject: input.subject, bodyText: input.bodyText, currentVersion: version, approvedVersion: null, status: "draft", approvalStatus: "draft", approvedAt: null, approvedByUserId: null } });
    await tx.outreachCampaign.update({ where: { id: message.campaignId }, data: { status: "draft", approvalStatus: "draft", approvedAt: null, approvedByUserId: null, sendingLimit: 0 } });
    await recordWorkspaceActivity(tx, { context, action: "authority.outreach_draft_edited", entityType: "outreach_message", entityId: message.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { subject: message.subject, approvalStatus: message.approvalStatus }, nextJson: { subject: input.subject, approvalStatus: "draft", autoSend: false } });
    return next;
  });
  res.json({ message: updated });
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/outreach/messages/:messageId/revise", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const input = outreachAiRevisionSchema.parse(req.body ?? {});
  const message = await prisma.outreachMessage.findFirst({
    where: { id: req.params.messageId, projectId: project.id },
    include: { campaign: { include: { opportunity: true, contact: true } } },
  });
  if (!message) fail("Outreach message not found.", 404);
  if (message.campaign.contact?.optOut) fail("This contact has opted out. Reopen the contact preference before preparing another draft.", 409);

  const generated = await centralAiJson({
    system: "Prepare one ethical, manually reviewed authority-outreach email. Never send it. Never invent a relationship, publication fit, credential, result, statistic, link placement, recipient detail, or completed asset. Use only supplied facts; omit anything unavailable. Do not offer payment, reciprocal links, bulk placement, or guaranteed coverage. Return valid JSON with subject and bodyText only.",
    prompt: JSON.stringify({
      task: input.mode === "regenerate" ? "Create a materially different outreach draft." : "Improve the current draft while preserving its factual meaning.",
      userInstruction: input.instruction || null,
      business: {
        name: project.businessName ?? project.name,
        website: project.website?.rootUrl ?? project.websiteUrl ?? null,
        audience: project.businessProfile?.targetAudience ?? null,
      },
      opportunity: message.campaign.opportunity ? {
        title: message.campaign.opportunity.title,
        description: message.campaign.opportunity.description,
        valueExchange: message.campaign.opportunity.valueExchange,
        evidence: message.campaign.opportunity.evidenceJson,
      } : null,
      recipient: message.campaign.contact ? {
        organizationName: message.campaign.contact.organizationName,
        contactName: message.campaign.contact.contactName,
        websiteUrl: message.campaign.contact.websiteUrl,
        relationshipNote: message.campaign.contact.relationshipNote,
      } : null,
      currentDraft: { subject: message.subject, bodyText: message.bodyText },
      requiredOutput: { subject: "string", bodyText: "plain-text email" },
    }),
    temperature: input.mode === "regenerate" ? 0.5 : 0.25,
    maxInputBytes: 48_000,
    maxOutputTokens: 1_500,
    validate: (value) => outreachAiResultSchema.parse(value),
  });

  const updated = await prisma.$transaction(async (tx) => {
    const version = message.currentVersion + 1;
    await tx.outreachMessageVersion.create({
      data: {
        messageId: message.id,
        version,
        subject: generated.result.subject,
        bodyText: generated.result.bodyText,
        changeType: input.mode === "regenerate" ? "ai_regenerate" : "ai_revise",
        createdByUserId: context.membership.userId,
        metadataJson: { model: generated.model, instruction: input.instruction ?? null },
      },
    });
    const next = await tx.outreachMessage.update({
      where: { id: message.id },
      data: { subject: generated.result.subject, bodyText: generated.result.bodyText, currentVersion: version, approvedVersion: null, status: "draft", approvalStatus: "draft", approvedAt: null, approvedByUserId: null },
    });
    await tx.outreachCampaign.update({ where: { id: message.campaignId }, data: { status: "draft", approvalStatus: "draft", approvedAt: null, approvedByUserId: null, sendingLimit: 0 } });
    await recordWorkspaceActivity(tx, {
      context,
      action: input.mode === "regenerate" ? "authority.outreach_draft_ai_regenerated" : "authority.outreach_draft_ai_revised",
      entityType: "outreach_message",
      entityId: message.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      previousJson: { version: message.currentVersion, approvalStatus: message.approvalStatus },
      nextJson: { version, approvalStatus: "draft", autoSend: false, model: generated.model },
    });
    return next;
  });
  res.json({ message: updated, usage: { inputTokens: generated.inputTokens, outputTokens: generated.outputTokens }, sendingEnabled: false });
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/outreach/messages/:messageId/versions/:version/restore", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const { version } = outreachVersionSchema.parse({ version: req.params.version });
  const message = await prisma.outreachMessage.findFirst({ where: { id: req.params.messageId, projectId: project.id } });
  if (!message) fail("Outreach message not found.", 404);
  const historical = await prisma.outreachMessageVersion.findUnique({ where: { messageId_version: { messageId: message.id, version } } });
  if (!historical) fail("Outreach draft version not found.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const nextVersion = message.currentVersion + 1;
    await tx.outreachMessageVersion.create({ data: { messageId: message.id, version: nextVersion, subject: historical.subject, bodyText: historical.bodyText, changeType: `restored_from_v${version}`, createdByUserId: context.membership.userId } });
    const next = await tx.outreachMessage.update({ where: { id: message.id }, data: { subject: historical.subject, bodyText: historical.bodyText, currentVersion: nextVersion, approvedVersion: null, status: "draft", approvalStatus: "draft", approvedAt: null, approvedByUserId: null } });
    await tx.outreachCampaign.update({ where: { id: message.campaignId }, data: { status: "draft", approvalStatus: "draft", approvedAt: null, approvedByUserId: null, sendingLimit: 0 } });
    await recordWorkspaceActivity(tx, { context, action: "authority.outreach_version_restored", entityType: "outreach_message", entityId: message.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { version: message.currentVersion }, nextJson: { version: nextVersion, restoredFromVersion: version, autoSend: false } });
    return next;
  });
  res.json({ message: updated, restoredFromVersion: version });
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/outreach/campaigns/:campaignId/contact", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const input = outreachContactSchema.parse(req.body);
  const campaign = await prisma.outreachCampaign.findFirst({ where: { id: req.params.campaignId, projectId: project.id } });
  if (!campaign) fail("Outreach campaign not found.", 404);
  const result = await prisma.$transaction(async (tx) => {
    const existing = input.email ? await tx.outreachContact.findFirst({ where: { projectId: project.id, email: input.email } }) : null;
    const contact = existing
      ? await tx.outreachContact.update({ where: { id: existing.id }, data: input })
      : await tx.outreachContact.create({
        data: {
          projectId: project.id,
          organizationName: input.organizationName,
          contactName: input.contactName,
          email: input.email,
          websiteUrl: input.websiteUrl,
          sourceUrl: input.sourceUrl,
          relationshipNote: input.relationshipNote,
        },
      });
    const updated = await tx.outreachCampaign.update({ where: { id: campaign.id }, data: { contactId: contact.id } });
    await recordWorkspaceActivity(tx, { context, action: "authority.outreach_contact_attached", entityType: "outreach_contact", entityId: contact.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { campaignId: campaign.id, organizationName: contact.organizationName, hasEmail: Boolean(contact.email), optOut: contact.optOut } });
    return { contact, campaign: updated };
  });
  res.status(201).json(result);
});

authorityGrowthRouter.patch("/projects/:projectId/authority-growth/outreach/campaigns/:campaignId/status", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "execute_tasks");
  const input = campaignStatusSchema.parse(req.body);
  const campaign = await prisma.outreachCampaign.findFirst({ where: { id: req.params.campaignId, projectId: project.id }, include: { contact: true } });
  if (!campaign) fail("Outreach campaign not found.", 404);
  if (input.status === "contacted") {
    if (campaign.approvalStatus !== "approved") fail("Approve the outreach draft before recording contact.", 409);
    if (!campaign.contact) fail("Add a verified contact before recording outreach.", 409);
    if (campaign.contact.optOut) fail("This contact has opted out and cannot be contacted.", 409);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.outreachCampaign.update({ where: { id: campaign.id }, data: { status: input.status } });
    if (campaign.contactId && input.status === "contacted") await tx.outreachContact.update({ where: { id: campaign.contactId }, data: { lastContactedAt: new Date() } });
    await recordWorkspaceActivity(tx, { context, action: `authority.outreach_${input.status}`, entityType: "outreach_campaign", entityId: campaign.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: campaign.status }, nextJson: { status: input.status, notes: input.notes ?? null, manuallyRecorded: true } });
    return next;
  });
  res.json({ campaign: updated, emailSentByPlatform: false });
});

authorityGrowthRouter.patch("/projects/:projectId/authority-growth/outreach/contacts/:contactId/preferences", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "run_ai_analysis");
  const input = contactPreferenceSchema.parse(req.body);
  const contact = await prisma.outreachContact.findFirst({ where: { id: req.params.contactId, projectId: project.id } });
  if (!contact) fail("Outreach contact not found.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.outreachContact.update({ where: { id: contact.id }, data: { optOut: input.optOut } });
    if (input.optOut) await tx.outreachCampaign.updateMany({ where: { projectId: project.id, contactId: contact.id, status: { notIn: ["earned", "declined", "closed"] } }, data: { status: "closed", sendingLimit: 0 } });
    await recordWorkspaceActivity(tx, { context, action: input.optOut ? "authority.contact_opted_out" : "authority.contact_opted_in", entityType: "outreach_contact", entityId: contact.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { optOut: contact.optOut }, nextJson: { optOut: input.optOut, sendingLimit: 0 } });
    return next;
  });
  res.json({ contact: updated });
});

authorityGrowthRouter.post("/projects/:projectId/authority-growth/earned-mentions", async (req, res) => {
  const { context, project } = await authorityProject(req, req.params.projectId, "execute_tasks");
  const input = earnedMentionSchema.parse(req.body);
  if (input.opportunityId && !await prisma.authorityOpportunity.findFirst({ where: { id: input.opportunityId, projectId: project.id, status: "approved" }, select: { id: true } })) fail("Approved authority opportunity not found.", 404);
  const result = await prisma.$transaction(async (tx) => {
    const mention = await tx.earnedMention.create({
      data: {
        projectId: project.id,
        opportunityId: input.opportunityId,
        sourceUrl: input.sourceUrl,
        sourceDomain: sourceDomain(input.sourceUrl),
        targetUrl: input.targetUrl,
        mentionType: input.mentionType,
        linkAttribute: input.linkAttribute,
        status: input.mentionType === "backlink" ? "pending_verification" : "recorded",
        verificationStatus: input.mentionType === "backlink" ? "pending_provider_verification" : "manual_evidence_only",
        referralVisits: input.referralVisits,
        referralLeads: input.referralLeads,
        earnedAt: input.earnedAt ? new Date(input.earnedAt) : new Date(),
        evidenceJson: { recordedByUserId: context.membership.userId },
      },
    });
    const period = mention.earnedAt ?? mention.createdAt;
    for (const metric of [
      { key: "earned_mentions", value: 1 },
      { key: "referral_visits", value: mention.referralVisits },
      { key: "referral_leads", value: mention.referralLeads },
    ]) {
      await tx.authorityPerformanceMetric.create({ data: { projectId: project.id, metricKey: metric.key, value: metric.value, sourceType: "earned_mention", sourceId: mention.id, periodStart: period, periodEnd: period, evidenceJson: { sourceUrl: mention.sourceUrl } } });
    }
    await tx.growthSignal.upsert({
      where: { fingerprint: `authority-earned:${mention.id}` },
      update: {},
      create: {
        projectId: project.id,
        fingerprint: `authority-earned:${mention.id}`,
        category: "authority",
        signalKey: "reported_earned_mention",
        sourceType: "earned_mention",
        sourceId: mention.id,
        valueJson: { mentionType: mention.mentionType, sourceDomain: mention.sourceDomain, referralVisits: mention.referralVisits, referralLeads: mention.referralLeads },
        confidence: input.mentionType === "backlink" ? 45 : 60,
        collectedAt: new Date(),
        effectiveDate: period,
        expiresAt: new Date(period.getTime() + 180 * 86_400_000),
      },
    });
    await recordWorkspaceActivity(tx, { context, action: "authority.earned_mention_recorded", entityType: "earned_mention", entityId: mention.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { sourceDomain: mention.sourceDomain, mentionType: mention.mentionType, referralVisits: mention.referralVisits, referralLeads: mention.referralLeads } });
    return mention;
  });
  res.status(201).json({ mention: result });
});

authorityGrowthRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.flatten().fieldErrors });
  next(error);
});
