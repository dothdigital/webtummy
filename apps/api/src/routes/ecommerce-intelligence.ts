import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { buildEcommerceIntelligence, type EcommercePerformanceInput } from "@webtummy/core";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { publishProjectWorkflowEvent } from "../project-workflow-controller.js";

export const ecommerceIntelligenceRouter = Router();
ecommerceIntelligenceRouter.use(requireAuth);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function performanceRows(value: unknown): EcommercePerformanceInput[] {
  const parsed = z.array(z.object({
    productName: z.string().trim().min(1).max(255),
    sku: z.string().trim().max(120).nullish(),
    revenue: z.number().finite().nonnegative().nullish(),
    marginPercent: z.number().finite().min(-100).max(100).nullish(),
    conversionRate: z.number().finite().min(0).max(100).nullish(),
    inventory: z.number().int().min(0).nullish(),
    orders: z.number().int().min(0).nullish(),
    source: z.enum(["user_provided", "connected"]).default("user_provided"),
  })).max(2000).safeParse(value);
  return parsed.success ? parsed.data.map((row) => ({
    productName: String(row.productName),
    sku: row.sku ?? null,
    revenue: row.revenue ?? null,
    marginPercent: row.marginPercent ?? null,
    conversionRate: row.conversionRate ?? null,
    inventory: row.inventory ?? null,
    orders: row.orders ?? null,
    source: row.source ?? "user_provided",
  })) : [];
}

async function scopedProject(req: Request, projectId: string) {
  const context = await workspaceContext(req);
  const clientId = await projectClientIdForRequest(req);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(clientId ? { clientId } : {}) },
    include: {
      client: { select: { id: true, plan: true } },
      businessProfile: true,
      intakeAnswers: { orderBy: { updatedAt: "desc" }, take: 100 },
      website: {
        select: {
          id: true,
          rootUrl: true,
          domain: true,
          crawlJobs: {
            where: { status: "completed", pagesCrawled: { gt: 0 } },
            orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            include: {
              pages: {
                orderBy: [{ score: "asc" }, { createdAt: "asc" }],
                take: 2000,
                include: { seo: true, schemas: true, images: true, issues: { where: { status: "open" }, select: { id: true } } },
              },
            },
          },
        },
      },
      keywordResearchRuns: {
        where: { status: "completed" },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        take: 500,
        select: { seedKeyword: true, locationName: true, averageVolume: true, targetRank: true, rankingUrl: true, completedAt: true, createdAt: true },
      },
      aiRuns: { where: { moduleName: "ecommerce_intelligence" }, orderBy: { createdAt: "desc" }, take: 3 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, version: true, status: true, createdAt: true } },
      gapAnalysisRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  if (!project || (context.workspace.workspaceType !== "personal" && !(await canAccessProject(context, project.id)))) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const intake = Object.fromEntries(project.intakeAnswers.map((answer) => [answer.questionKey, answer.answerValue]));
  // Ecommerce is a project capability, not a workspace type. Require the
  // explicit project Business Type so a legacy workspace value, CMS name, or
  // incidental intake wording cannot activate store intelligence by mistake.
  const ecommerceContext = project.projectType === "ecommerce";
  return { context, project, ecommerceContext, intake };
}

function currentPerformance(project: { businessProfile: { intelligenceJson: unknown } | null }) {
  const intelligence = record(project.businessProfile?.intelligenceJson);
  return performanceRows(intelligence.ecommercePerformanceData);
}

function analyzeProject(project: Awaited<ReturnType<typeof scopedProject>>["project"], intake: Record<string, unknown>) {
  const crawl = project.website?.crawlJobs[0] ?? null;
  const pages = (crawl?.pages ?? []).map((page) => ({
    id: page.id,
    url: page.finalUrl || page.url,
    statusCode: page.statusCode,
    title: page.seo?.title,
    metaDescription: page.seo?.metaDescription,
    h1: Array.isArray(page.seo?.h1Text) ? page.seo.h1Text.map(String).filter(Boolean) : [],
    wordCount: page.wordCount,
    inlinkCount: page.inlinkCount,
    outlinkCount: page.outlinkCount,
    canonicalUrl: page.seo?.canonicalUrl,
    schemaTypes: page.schemas.map((schema) => schema.schemaType || "").filter(Boolean),
    imageCount: page.images.length,
    missingAltCount: page.images.filter((image) => !image.alt?.trim() || image.issueType === "missing_alt" || image.issueType === "empty_alt").length,
    issueCount: page.issues.length,
  }));
  const platformHint = String(project.cmsPlatform || intake.store_type || intake.cms_platform || "Unknown");
  return buildEcommerceIntelligence({
    pages,
    keywords: project.keywordResearchRuns.map((run) => ({ keyword: run.seedKeyword, location: run.locationName, averageVolume: run.averageVolume, rank: run.targetRank, rankingUrl: run.rankingUrl })),
    performance: currentPerformance(project),
    platformHint,
  });
}

function routes(path = "") {
  return `/projects/:projectId/ecommerce-intelligence${path}`;
}

ecommerceIntelligenceRouter.get(routes(), async (req, res) => {
  const scoped = await scopedProject(req, req.params.projectId);
  const crawl = scoped.project.website?.crawlJobs[0] ?? null;
  const current = analyzeProject(scoped.project, scoped.intake);
  const latestRun = scoped.project.aiRuns[0] ?? null;
  res.json({
    project: { id: scoped.project.id, name: scoped.project.name, projectType: scoped.project.projectType, workspaceType: scoped.context.workspace.workspaceType, storeUrl: scoped.project.website?.rootUrl || scoped.project.websiteUrl, ecommerceContext: scoped.ecommerceContext },
    readiness: {
      storeUrl: Boolean(scoped.project.website?.rootUrl || scoped.project.websiteUrl),
      publicCrawl: Boolean(crawl),
      keywordEvidence: scoped.project.keywordResearchRuns.length > 0,
      performanceEvidence: currentPerformance(scoped.project).length > 0,
      strategyStatus: scoped.project.strategyPlans[0]?.status ?? "not_started",
    },
    intelligence: current,
    latestSavedRun: latestRun ? { id: latestRun.id, status: latestRun.status, createdAt: latestRun.createdAt, outputJson: latestRun.outputJson } : null,
    capabilities: {
      sharedGrowthOperatingSystem: true,
      modules: ["Keyword Intelligence", "Competitor Research", "Website Development", "Website Intelligence", "Content", "Local SEO", "AI Citations", "Authority", "Lead Magnets", "Email", "Social", "Publishing", "Growth Blueprint", "Next Best Action"],
      canAnalyze: hasWorkspacePermission(scoped.context, "run_ai_analysis"),
      canApprove: hasWorkspacePermission(scoped.context, "approve"),
    },
  });
});

ecommerceIntelligenceRouter.post(routes("/analyze"), async (req, res) => {
  const scoped = await scopedProject(req, req.params.projectId);
  if (!hasWorkspacePermission(scoped.context, "run_ai_analysis")) return res.status(403).json({ error: "AI analysis permission is required." });
  if (!scoped.ecommerceContext) return res.status(409).json({ error: "Set this project’s Business Type to Ecommerce before running Ecommerce Intelligence.", action: { label: "Edit Business Type", url: `/projects/new?edit=${scoped.project.id}` } });
  const crawl = scoped.project.website?.crawlJobs[0] ?? null;
  if (!crawl) return res.status(409).json({ error: "Complete Site Analysis for the public store before running Ecommerce Intelligence.", action: { label: "Analyze store", url: `/site-analysis?projectId=${scoped.project.id}` } });
  const intelligence = analyzeProject(scoped.project, scoped.intake);
  const run = await prisma.aiRun.create({ data: {
    projectId: scoped.project.id,
    clientId: scoped.project.clientId,
    moduleName: "ecommerce_intelligence",
    promptVersion: intelligence.version,
    inputSnapshotJson: { crawlJobId: crawl.id, crawlCompletedAt: crawl.completedAt, keywordRunCount: scoped.project.keywordResearchRuns.length, performanceRecordCount: currentPerformance(scoped.project).length, evidencePolicy: "public_plus_user_provided" },
    outputJson: intelligence as unknown as Prisma.InputJsonValue,
    outputText: `${intelligence.store.productCount} products, ${intelligence.store.collectionCount} collections, and ${intelligence.recommendations.length} prioritized recommendations were evaluated from public and explicitly supplied evidence.`,
    status: "completed",
  } });
  await publishProjectWorkflowEvent({ projectId: scoped.project.id, eventType: "intelligence.ecommerce_completed", sourceModule: "ecommerce_intelligence", sourceId: run.id, idempotencyKey: `intelligence.ecommerce_completed:${run.id}`, payload: { crawlJobId: crawl.id, recommendationCount: intelligence.recommendations.length } });
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context: scoped.context, action: "ecommerce_intelligence.completed", entityType: "ai_run", entityId: run.id, agencyClientId: scoped.project.agencyClientId, projectId: scoped.project.id, nextJson: { products: intelligence.store.productCount, collections: intelligence.store.collectionCount, recommendations: intelligence.recommendations.length } }));
  res.status(201).json({ run: { id: run.id, status: run.status, createdAt: run.createdAt }, intelligence });
});

ecommerceIntelligenceRouter.post(routes("/performance-data"), async (req, res) => {
  const scoped = await scopedProject(req, req.params.projectId);
  if (!hasWorkspacePermission(scoped.context, "edit_project_settings")) return res.status(403).json({ error: "Project editing permission is required." });
  const input = z.object({ rows: z.array(z.object({
    productName: z.string().trim().min(1).max(255), sku: z.string().trim().max(120).nullish(), revenue: z.number().finite().nonnegative().nullish(), marginPercent: z.number().finite().min(-100).max(100).nullish(), conversionRate: z.number().finite().min(0).max(100).nullish(), inventory: z.number().int().min(0).nullish(), orders: z.number().int().min(0).nullish(),
  })).min(1).max(2000), replace: z.boolean().default(true) }).parse(req.body ?? {});
  const profile = scoped.project.businessProfile;
  if (!profile) return res.status(409).json({ error: "Complete Business Discovery before adding product performance evidence." });
  const intelligenceJson = record(profile.intelligenceJson);
  const previous = input.replace ? [] : performanceRows(intelligenceJson.ecommercePerformanceData);
  const rows: EcommercePerformanceInput[] = [...previous, ...input.rows.map((row) => ({
    productName: String(row.productName),
    sku: row.sku ?? null,
    revenue: row.revenue ?? null,
    marginPercent: row.marginPercent ?? null,
    conversionRate: row.conversionRate ?? null,
    inventory: row.inventory ?? null,
    orders: row.orders ?? null,
    source: "user_provided" as const,
  }))];
  await prisma.businessProfile.update({ where: { id: profile.id }, data: { intelligenceJson: { ...intelligenceJson, ecommercePerformanceData: rows, ecommercePerformanceUpdatedAt: new Date().toISOString(), ecommercePerformanceSource: "user_provided" } as Prisma.InputJsonValue } });
  await publishProjectWorkflowEvent({ projectId: scoped.project.id, eventType: "business_brain.updated", sourceModule: "ecommerce_intelligence", sourceId: profile.id, idempotencyKey: `business_brain.ecommerce_performance:${scoped.project.id}:${Date.now()}`, payload: { performanceRecordCount: rows.length, source: "user_provided" } });
  res.json({ saved: rows.length, source: "user_provided", message: "Product performance was saved as user-provided evidence. It will never be represented as connected store data." });
});

ecommerceIntelligenceRouter.post(routes("/recommendations/:key/approve"), async (req, res) => {
  const scoped = await scopedProject(req, req.params.projectId);
  if (!hasWorkspacePermission(scoped.context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  if (!scoped.ecommerceContext) return res.status(409).json({ error: "This recommendation belongs to an Ecommerce Business Type project." });
  const intelligence = analyzeProject(scoped.project, scoped.intake);
  const item = intelligence.recommendations.find((recommendation) => recommendation.key === req.params.key);
  if (!item) return res.status(404).json({ error: "Ecommerce recommendation not found in the current evidence." });
  const run = scoped.project.gapAnalysisRuns[0] ?? await prisma.gapAnalysisRun.create({ data: { projectId: scoped.project.id, clientId: scoped.project.clientId, createdByUserId: scoped.context.membership.userId, status: "completed", evidenceJson: { source: "ecommerce_public_intelligence" }, summaryJson: { ecommerce: true }, generatedBy: intelligence.version, completedAt: new Date() }, select: { id: true } });
  const dedupeKey = `ecommerce:${scoped.project.id}:${item.key}`.slice(0, 255);
  const recommendation = await prisma.gapRecommendation.upsert({
    where: { dedupeKey },
    update: { title: item.title, explanation: item.explanation, recommendedAction: item.recommendedAction, expectedImpact: item.expectedImpact, evidenceJson: { evidenceType: item.evidenceType, evidence: item.evidence, affectedUrls: item.affectedUrls, destination: item.destination }, priority: item.priority, impactScore: item.impactScore, confidenceScore: item.confidenceScore, status: "approved", approvedByUserId: scoped.context.membership.userId, approvedAt: new Date(), ignoredAt: null },
    create: { runId: run.id, projectId: scoped.project.id, category: `ecommerce_${item.category}`.slice(0, 60), title: item.title, explanation: item.explanation, recommendedAction: item.recommendedAction, expectedImpact: item.expectedImpact, evidenceJson: { evidenceType: item.evidenceType, evidence: item.evidence, affectedUrls: item.affectedUrls, destination: item.destination }, competitorEvidence: [], priority: item.priority, impactScore: item.impactScore, confidenceScore: item.confidenceScore, status: "approved", dedupeKey, approvedByUserId: scoped.context.membership.userId, approvedAt: new Date() },
  });
  await publishProjectWorkflowEvent({ projectId: scoped.project.id, eventType: "intelligence.ecommerce_recommendation_approved", sourceModule: "ecommerce_intelligence", sourceId: recommendation.id, idempotencyKey: `ecommerce.recommendation.approved:${recommendation.id}:${recommendation.updatedAt.getTime()}`, payload: { key: item.key, title: item.title, evidenceType: item.evidenceType, strategyAction: `/strategy?projectId=${scoped.project.id}` } });
  res.json({ recommendation, nextAction: { label: "Update Strategy", url: `/strategy?projectId=${scoped.project.id}` }, message: "Approved for the Unified Strategy. Execution work will be created only after Strategy approval." });
});
