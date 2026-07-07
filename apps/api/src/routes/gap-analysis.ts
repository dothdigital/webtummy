import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { commitUsage, preflightUsage, refundUsage } from "../usage-engine.js";

export const gapAnalysisRouter = Router();
gapAnalysisRouter.use(requireAuth);

const terminalTaskStatuses = new Set(["completed", "skipped"]);

const approvalActions = ["approved", "rejected", "edited", "exported"] as const;

const localProfileSchema = z.object({
  businessName: z.string().min(1).max(180),
  businessType: z.string().min(1).max(120),
  primaryPhone: z.string().max(80).optional().nullable(),
  addressOrServiceArea: z.string().min(1).max(2000),
  citiesServed: z.array(z.string().min(1).max(120)).min(1).max(50),
  services: z.array(z.string().min(1).max(120)).min(1).max(100),
  gbpStatus: z.enum(["not_created", "claimed", "unclaimed", "unknown"]).optional().default("unknown"),
  reviewGoal: z.number().int().min(0).max(100000).optional().nullable(),
  citationStatus: z.enum(["unknown", "needs_audit", "partial", "complete"]).optional().default("unknown"),
});

const wordpressConnectSchema = z.object({
  siteUrl: z.string().url(),
  authMethod: z.enum(["oauth", "application_password", "plugin_token", "manual_export"]),
  connectionStatus: z.enum(["not_connected", "pending", "connected", "failed", "revoked"]).optional().default("pending"),
  permissionScope: z.array(z.enum(["draft_posts", "publish_posts", "update_pages", "media_uploads"])).optional().default(["draft_posts"]),
  defaultPublishMode: z.enum(["draft", "pending_review", "publish_after_approval"]).optional().default("draft"),
});

const wordpressPublishSchema = z.object({
  integrationId: z.string().optional().nullable(),
  aiOutputId: z.string().optional().nullable(),
  targetType: z.enum(["post", "page", "metadata", "block_update"]).default("page"),
  publishMode: z.enum(["draft", "pending_review", "publish"]).default("draft"),
  title: z.string().max(255).optional().nullable(),
  htmlContent: z.string().max(50000).optional().nullable(),
  approved: z.boolean().default(false),
});

const aiQueriesSchema = z.object({
  queries: z.array(z.object({
    queryText: z.string().min(4).max(512),
    targetBrand: z.string().min(1).max(180),
    targetUrl: z.string().url().optional().nullable(),
    competitors: z.array(z.string().min(1).max(180)).optional().default([]),
    scanFrequency: z.enum(["manual", "monthly", "weekly"]).optional().default("manual"),
  })).min(1).max(10),
});

const authoritySchema = z.object({
  targetPageUrl: z.string().url().optional().nullable(),
  niche: z.string().max(180).optional().nullable(),
});

const reportSchema = z.object({
  reportType: z.enum(["audit", "proposal", "local_seo", "ai_visibility", "growth", "execution_plan"]),
  clientName: z.string().max(180).optional().nullable(),
  exportFormat: z.enum(["pdf", "docx", "both"]).default("pdf"),
  agencyName: z.string().max(180).optional().nullable(),
  preparedByName: z.string().max(180).optional().nullable(),
  approvedSectionsOnly: z.boolean().default(false),
  includePricingSection: z.boolean().optional().default(false),
});

const demoSchema = z.object({
  template: z.enum(["existing_site_seo", "local_business", "new_business_launch", "agency_client", "ecommerce_export"]),
});

const adSuggestionSchema = z.object({
  campaignGoal: z.enum(["leads", "sales", "booking", "signup", "traffic", "awareness"]),
  offerSummary: z.string().min(1).max(4000),
  landingPageUrl: z.string().url().optional().nullable(),
  adPlatformTarget: z.enum(["google", "meta", "linkedin", "x", "tiktok", "manual"]).optional().nullable(),
  suggestionType: z.enum(["ad_copy", "landing_page", "CTA", "offer", "experiment"]),
});

const ecommerceSchema = z.object({
  storePlatform: z.enum(["shopify", "woocommerce", "other", "unknown"]),
  shopDomain: z.string().max(512).optional().nullable(),
  productOrCollectionType: z.enum(["product", "collection", "category", "homepage"]).optional().nullable(),
  targetName: z.string().max(220).optional().nullable(),
});

const approveFixSchema = z.object({
  action: z.enum(approvalActions).default("approved"),
  editedFix: z.string().max(5000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

async function routeAction(res: Response, action: () => Promise<unknown>) {
  try {
    res.json(await action());
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.flatten().fieldErrors });
    if (error instanceof Error) {
      const status = error.name.startsWith("usage_") ? 402 : error.message === "project not found" || error.message === "fix not found" ? 404 : error.message.includes("approved") ? 400 : 500;
      return res.status(status).json({ error: error.message });
    }
    return res.status(500).json({ error: "internal server error" });
  }
}

function gapRoutes(path = "") {
  return `/projects/:projectId/gap-analysis${path}`;
}

async function scopedProject(req: Request, projectId: string) {
  const clientId = await projectClientIdForRequest(req);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(clientId ? { clientId } : {}) },
    include: {
      client: { select: { id: true, plan: true } },
      website: { select: { id: true, domain: true, rootUrl: true } },
      businessProfile: true,
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!project) throw new Error("project not found");
  return project;
}

async function activeExecutionPlan(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return tx.executionPlan.create({
    data: {
      projectId,
      title: "Gap analysis execution plan",
      summary: "Approval-based SEO, local, AI visibility, authority, reporting, and publishing tasks.",
    },
  });
}

async function upsertExecutionTask(tx: Prisma.TransactionClient, input: {
  clientId: string;
  websiteId?: string | null;
  projectId: string;
  dedupeKey: string;
  moduleName: string;
  sourceType: string;
  sourceId?: string | null;
  title: string;
  description: string;
  priority?: "high" | "medium" | "low";
  automationLevel?: string;
  requiresApproval?: boolean;
  requiresIntegration?: boolean;
  manualRequired?: boolean;
  safetyCategory?: string;
  actionButtonLabel?: string;
  relatedUrl?: string;
  manualInstructions?: string | null;
  impact?: string | null;
}) {
  const plan = await activeExecutionPlan(tx, input.projectId);
  const data = {
    clientId: input.clientId,
    websiteId: input.websiteId ?? null,
    projectId: input.projectId,
    executionPlanId: plan.id,
    moduleName: input.moduleName,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    title: input.title,
    description: input.description,
    priority: input.priority ?? "medium",
    automationLevel: input.automationLevel ?? "manual_guided",
    status: "ready",
    requiresApproval: input.requiresApproval ?? true,
    requiresIntegration: input.requiresIntegration ?? false,
    manualRequired: input.manualRequired ?? true,
    safetyCategory: input.safetyCategory ?? "safe",
    actionButtonLabel: input.actionButtonLabel ?? "Open Task",
    relatedUrl: input.relatedUrl ?? `/gap-analysis?projectId=${input.projectId}`,
    manualInstructions: input.manualInstructions ?? input.description,
    impact: input.impact ?? null,
  };
  const existing = await tx.executionTask.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (!existing) return tx.executionTask.create({ data: { ...data, dedupeKey: input.dedupeKey } });
  if (terminalTaskStatuses.has(existing.status)) return existing;
  return tx.executionTask.update({ where: { id: existing.id }, data });
}

async function withUsage<T>(req: Request, project: { id: string; clientId: string; websiteId?: string | null }, featureKey: string, actionKey: string, inputUnits: number, fn: (usageEventId: string) => Promise<T>) {
  const usage = await preflightUsage({
    clientId: project.clientId,
    userId: req.user?.userId,
    projectId: project.id,
    websiteId: project.websiteId ?? null,
    featureKey,
    actionKey,
    inputUnits,
    idempotencyKey: `${featureKey}:${project.id}:${actionKey}:${Date.now()}`,
  });
  try {
    const result = await fn(usage.usageEventId);
    await commitUsage({ usageEventId: usage.usageEventId, provider: "internal", providerCostUsd: 0 });
    return { result, usage: { usageEventId: usage.usageEventId, creditsReserved: usage.creditsReserved } };
  } catch (error) {
    await refundUsage({ usageEventId: usage.usageEventId, reason: error instanceof Error ? error.message : "gap analysis action failed" });
    throw error;
  }
}

function normalizeIssueType(category: string, issueType: string) {
  if (category === "links") return "internal_link";
  if (category === "onpage") return "on_page";
  if (category === "ai_readiness") return "schema";
  if (category === "media") return "performance";
  return ["technical", "on_page", "content", "internal_link", "indexability", "conversion", "schema", "performance"].includes(category) ? category : issueType.includes("title") || issueType.includes("meta") ? "on_page" : "technical";
}

function riskForIssue(issueType: string, category: string) {
  if (issueType === "indexability" || category === "indexability") return "review_needed";
  if (issueType === "performance" || category === "performance") return "developer_needed";
  return "safe";
}

function creditForSeverity(severity: string) {
  if (severity === "high" || severity === "critical") return 10;
  if (severity === "medium") return 6;
  return 3;
}

function priorityForSeverity(severity: string): "high" | "medium" | "low" {
  return severity === "high" || severity === "critical" ? "high" : severity === "low" ? "low" : "medium";
}

function scoreAuthorityOpportunity(description: string) {
  const lower = description.toLowerCase();
  const banned = ["automated reciprocal link", "paid ranking link", "forum profile spam", "blog comment spam", "fake account", "mass link"];
  if (banned.some((pattern) => lower.includes(pattern))) return { riskScore: 100, riskLabel: "avoid" as const };
  if (lower.includes("outreach") || lower.includes("guest quote")) return { riskScore: 45, riskLabel: "review_needed" as const };
  return { riskScore: 15, riskLabel: "safe" as const };
}

function firstUseful(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function uniqueList(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function jsonStringList(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

gapAnalysisRouter.get(gapRoutes(), (req, res) => routeAction(res, async () => {
  const project = await scopedProject(req, req.params.projectId);
  const [fixes, localProfile, aiQueries, authority, reports, wp, demo, adSuggestions, ecommerceGuides, tasks, latestCompletedCrawl] = await Promise.all([
    prisma.seoFixQueueItem.findMany({ where: { projectId: project.id }, orderBy: [{ approvalStatus: "asc" }, { createdAt: "desc" }], take: 50 }),
    prisma.gapLocalSeoProfile.findUnique({ where: { projectId: project.id }, include: { tasks: { orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 20 } } }),
    prisma.aiVisibilityQuery.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 20, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } }),
    prisma.authorityOpportunity.findMany({ where: { projectId: project.id }, orderBy: [{ riskLabel: "asc" }, { createdAt: "desc" }], take: 20 }),
    prisma.gapReportExport.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.wordPressIntegration.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.demoProject.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.adLandingSuggestion.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.ecommerceExportGuide.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.executionTask.findMany({ where: { projectId: project.id, moduleName: "gap_analysis" }, orderBy: { createdAt: "desc" }, take: 25 }),
    project.websiteId ? prisma.crawlJob.findFirst({ where: { websiteId: project.websiteId, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], select: { id: true, pagesCrawled: true, siteScore: true, completedAt: true, createdAt: true } }) : Promise.resolve(null),
  ]);
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl);
  const readiness = {
    project: true,
    website: hasWebsite,
    siteAnalysis: Boolean(latestCompletedCrawl),
    localProfile: Boolean(localProfile),
    aiVisibilityQueries: aiQueries.length > 0,
    wordpress: wp.some((item) => item.connectionStatus === "connected"),
    approvedStrategy: project.strategyPlans.some((strategy) => strategy.status === "approved"),
  };
  return { project, readiness, latestCompletedCrawl, fixes, localProfile, aiQueries, authority, reports, wordpressIntegrations: wp, demoProjects: demo, adSuggestions, ecommerceGuides, tasks };
}));

gapAnalysisRouter.post(gapRoutes("/launch-strategy/generate"), (req, res) => routeAction(res, async () => {
  const project = await scopedProject(req, req.params.projectId);
  const existingLocalProfile = await prisma.gapLocalSeoProfile.findUnique({ where: { projectId: project.id } });
  const businessName = firstUseful(project.businessName, existingLocalProfile?.businessName, project.name);
  const niche = firstUseful(project.niche, existingLocalProfile?.businessType, project.businessProfile?.businessSummary, "the target market");
  const targetLocation = firstUseful(project.targetLocation, existingLocalProfile?.addressOrServiceArea, "primary service area");
  const offer = firstUseful(project.businessProfile?.offerSummary, project.primaryGoal, `services for ${niche}`);
  const services = uniqueList([
    ...jsonStringList(existingLocalProfile?.services),
    ...offer.split(/,|;|\band\b/gi),
    niche,
  ], 8);
  const cities = uniqueList([
    ...jsonStringList(existingLocalProfile?.citiesServed),
    ...targetLocation.split(/,|;|\band\b/gi),
  ], 6);
  const primaryService = services[0] || niche;
  const primaryCity = cities[0] || targetLocation;
  const keywordSeeds = uniqueList([
    `${primaryService} ${primaryCity}`,
    `${primaryService} near me`,
    `best ${primaryService}`,
    `${businessName} ${primaryService}`,
    `${primaryService} cost`,
    `${primaryService} company`,
    `${niche} services`,
    `${primaryService} consultation`,
  ], 8);
  const sitePages = uniqueList([
    "Home",
    `Services: ${primaryService}`,
    ...(services.slice(1, 5).map((service) => `Service: ${service}`)),
    ...(cities.slice(0, 4).map((city) => `Location: ${city}`)),
    "About",
    "Reviews",
    "Contact",
    "FAQ",
  ], 12);

  return withUsage(req, project, "pre_website_launch_strategy", "generate_pre_website_plan", 1, async () => {
    const result = await prisma.$transaction(async (tx) => {
      const strategy = await tx.strategyPlan.create({
        data: {
          projectId: project.id,
          strategySummary: `Launch ${businessName} with a focused website, local trust signals, keyword-led service pages, proof assets, and a measured execution plan before crawl data exists.`,
          positioningStatement: `${businessName} should position around ${offer} for ${targetLocation}, with clear proof, service-area relevance, and one primary conversion path.`,
          audienceProfile: `People searching for ${primaryService} in ${primaryCity}. Prioritize problem-aware and ready-to-book visitors before broad educational traffic.`,
          offerRecommendation: `Package the core offer clearly: who it helps, what outcome it creates, proof points, pricing or consultation path, and a direct call or booking CTA.`,
          businessModel: project.businessModel ?? "local_service",
          seoStrategy: `Start with these keyword seeds: ${keywordSeeds.join(", ")}. Map each seed to a homepage, service page, location page, FAQ, or proof section before running crawl-backed optimization.`,
          aiCitationStrategy: "Create entity clarity from day one: consistent NAP, service definitions, founder/business proof, FAQ answers, schema-ready page sections, and citations after GBP is live.",
          contentStrategy: `Initial site structure: ${sitePages.join("; ")}. Each service page needs intent-matched H1, benefit-led copy, FAQs, proof, internal links, and one CTA.`,
          authorityStrategy: "Begin with safe local citations, chamber/association listings, partner mentions, testimonials, and one link-worthy local resource.",
          socialStrategy: "Use launch content to validate service messaging: before/after proof, FAQs, service-area posts, reviews, and booking reminders.",
          publishingStrategy: "Build pages as drafts first, approve copy and metadata, then publish the core site before running Site Analysis and SEO Fix Queue.",
          status: "draft",
        },
      });

      const taskInputs = [
        {
          key: "website-blueprint",
          title: "Build initial website blueprint",
          description: `Create the first sitemap and page plan: ${sitePages.join(", ")}.`,
          priority: "high" as const,
          impact: "Gives the project a build path before a website exists.",
        },
        {
          key: "keyword-seeds",
          title: "Validate recommended keyword seeds",
          description: `Review and approve seed keywords: ${keywordSeeds.join(", ")}.`,
          priority: "high" as const,
          impact: "Creates keyword direction before paid keyword data or crawl data exists.",
        },
        {
          key: "gbp-setup",
          title: "Prepare Google Business Profile setup",
          description: `Prepare GBP category, service, description, photo, service-area, and review-request requirements for ${businessName}.`,
          priority: "high" as const,
          impact: "Makes the local presence launch-ready even if GBP is not created yet.",
        },
        {
          key: "core-copy",
          title: "Draft homepage and core service copy",
          description: `Draft copy around ${offer}, ${primaryService}, proof, FAQs, and a clear booking or contact CTA.`,
          priority: "medium" as const,
          impact: "Turns strategy into publishable website content.",
        },
        {
          key: "measurement",
          title: "Set launch measurement checklist",
          description: "Plan analytics, conversion events, call/form tracking, GBP tracking, and first crawl after the site is live.",
          priority: "medium" as const,
          impact: "Ensures the first crawl and reports have meaningful business context.",
        },
      ];

      const tasks = [];
      for (const task of taskInputs) {
        tasks.push(await upsertExecutionTask(tx, {
          clientId: project.clientId,
          websiteId: project.websiteId,
          projectId: project.id,
          dedupeKey: `gap-analysis:launch-strategy:${project.id}:${task.key}`,
          moduleName: "gap_analysis",
          sourceType: "pre_website_launch_strategy",
          sourceId: strategy.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          automationLevel: "manual_guided",
          safetyCategory: "safe",
          actionButtonLabel: "Open Launch Task",
          manualInstructions: task.description,
          impact: task.impact,
        }));
      }

      return { strategy, tasks, keywordSeeds, sitePages };
    });
    return { ready: true, ...result };
  });
}));

gapAnalysisRouter.post(gapRoutes("/seo-fix-queue/run"), (req, res) => routeAction(res, async () => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project.websiteId) return { ready: false, missing: ["website"], nextAction: "Connect a website or complete site analysis readiness first." };
  const latestCrawl = await prisma.crawlJob.findFirst({
    where: { websiteId: project.websiteId, status: "completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    include: { issues: { where: { status: "open" }, include: { page: { select: { url: true } } }, orderBy: [{ severity: "asc" }, { weightImpact: "desc" }], take: 40 } },
  });
  if (!latestCrawl) return { ready: false, missing: ["site_analysis"], nextAction: "Run Site Analysis before building the SEO Fix Queue." };
  return withUsage(req, project, "seo_fix_queue", "build_queue", Math.max(1, Math.ceil(latestCrawl.issues.length / 10)), async () => {
    const items = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const issue of latestCrawl.issues) {
        const issueType = normalizeIssueType(issue.category, issue.issueType);
        const riskLevel = riskForIssue(issueType, issue.category);
        const item = await tx.seoFixQueueItem.create({
          data: {
            projectId: project.id,
            clientId: project.clientId,
            websiteId: project.websiteId,
            sourceAnalysisId: latestCrawl.id,
            affectedUrl: issue.page?.url ?? project.website?.rootUrl ?? project.websiteUrl ?? "",
            issueType,
            severity: issue.severity,
            riskLevel,
            automationLevel: riskLevel === "safe" ? "one_click" : riskLevel === "developer_needed" ? "manual" : "integration_required",
            recommendedFix: issue.recommendation ?? `Resolve ${issue.message}`,
            plainEnglishReason: issue.message,
            expectedImpact: `Improves ${issue.category} health and reduces crawl issue weight by ${issue.weightImpact}.`,
            approvalStatus: "needs_review",
            creditCostEstimate: creditForSeverity(issue.severity),
          },
        });
        created.push(item);
      }
      return created;
    });
    return { ready: true, items };
  });
}));

gapAnalysisRouter.post(gapRoutes("/seo-fix-queue/:itemId/approve"), (req, res) => routeAction(res, async () => {
  const body = approveFixSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  const item = await prisma.seoFixQueueItem.findFirst({ where: { id: req.params.itemId, projectId: project.id } });
  if (!item) throw new Error("fix not found");
  if (item.riskLevel === "avoid") throw new Error("This fix is blocked by safety policy.");
  return withUsage(req, project, "seo_fix_queue", "approve_fix", Math.max(1, Math.ceil(item.creditCostEstimate / 5)), async () => {
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.seoFixApproval.create({
        data: { projectId: project.id, fixItemId: item.id, userId: req.user?.userId ?? null, action: body.action, editedFix: body.editedFix ?? null, notes: body.notes ?? null, snapshotJson: item },
      });
      if (body.action !== "approved" && body.action !== "edited") {
        const updated = await tx.seoFixQueueItem.update({ where: { id: item.id }, data: { approvalStatus: body.action === "rejected" ? "rejected" : "needs_review" } });
        return { item: updated, approval, task: null };
      }
      const description = body.editedFix?.trim() || item.recommendedFix;
      const task = await upsertExecutionTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        dedupeKey: `gap-analysis:fix:${item.id}`,
        moduleName: "gap_analysis",
        sourceType: "seo_fix_queue_item",
        sourceId: item.id,
        title: `SEO Fix: ${item.issueType} on ${item.affectedUrl}`,
        description,
        priority: priorityForSeverity(item.severity),
        automationLevel: item.automationLevel,
        requiresApproval: true,
        requiresIntegration: item.automationLevel === "integration_required",
        manualRequired: item.automationLevel !== "one_click",
        safetyCategory: item.riskLevel,
        actionButtonLabel: "Open SEO Fix",
        manualInstructions: description,
        impact: item.expectedImpact,
      });
      const updated = await tx.seoFixQueueItem.update({ where: { id: item.id }, data: { approvalStatus: "approved", executionTaskId: task.id, recommendedFix: description } });
      return { item: updated, approval, task };
    });
    return result;
  });
}));

gapAnalysisRouter.post(gapRoutes("/wordpress/connect"), (req, res) => routeAction(res, async () => {
  const body = wordpressConnectSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  const integration = await prisma.wordPressIntegration.create({ data: { projectId: project.id, clientId: project.clientId, siteUrl: body.siteUrl, authMethod: body.authMethod, connectionStatus: body.connectionStatus, permissionScope: body.permissionScope, defaultPublishMode: body.defaultPublishMode } });
  return { integration };
}));

gapAnalysisRouter.post(gapRoutes("/wordpress/publish"), (req, res) => routeAction(res, async () => {
  const body = wordpressPublishSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  if (!body.approved) throw new Error("AI output must be approved before WordPress publishing.");
  return withUsage(req, project, "wordpress_publish", body.publishMode, body.publishMode === "publish" ? 2 : 1, async () => {
    const result = await prisma.$transaction(async (tx) => {
      const hasIntegration = Boolean(body.integrationId);
      const job = await tx.wordPressPublishJob.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          integrationId: body.integrationId ?? null,
          aiOutputId: body.aiOutputId ?? null,
          targetType: body.targetType,
          publishMode: body.publishMode,
          title: body.title ?? null,
          htmlContent: body.htmlContent ?? null,
          status: hasIntegration ? "queued" : "manual_export",
          rollbackNote: "Save existing WordPress content/version before applying this update.",
        },
      });
      const task = await upsertExecutionTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        dedupeKey: `gap-analysis:wp:${job.id}`,
        moduleName: "gap_analysis",
        sourceType: "wordpress_publish_job",
        sourceId: job.id,
        title: hasIntegration ? `Queue WordPress ${body.publishMode}` : "Manual WordPress export",
        description: hasIntegration ? "Publish or update approved content through the WordPress integration queue." : "Copy approved HTML into WordPress as a draft, preview it, then publish only after final approval.",
        priority: "high",
        automationLevel: hasIntegration ? "integration_required" : "manual",
        requiresApproval: true,
        requiresIntegration: hasIntegration,
        manualRequired: !hasIntegration,
        safetyCategory: "review_needed",
        actionButtonLabel: hasIntegration ? "Review Publish Job" : "View Export Steps",
      });
      return { job, task, mode: hasIntegration ? "queued" : "manual_export" };
    });
    return result;
  });
}));

gapAnalysisRouter.post(gapRoutes("/local-seo/profile"), (req, res) => routeAction(res, async () => {
  const body = localProfileSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  const profile = await prisma.gapLocalSeoProfile.upsert({
    where: { projectId: project.id },
    update: { ...body, clientId: project.clientId, addressOrServiceArea: body.addressOrServiceArea, citiesServed: body.citiesServed, services: body.services },
    create: { projectId: project.id, clientId: project.clientId, ...body, addressOrServiceArea: body.addressOrServiceArea, citiesServed: body.citiesServed, services: body.services },
  });
  return { profile };
}));

gapAnalysisRouter.post(gapRoutes("/local-seo/generate-plan"), (req, res) => routeAction(res, async () => {
  const project = await scopedProject(req, req.params.projectId);
  const profile = await prisma.gapLocalSeoProfile.findUnique({ where: { projectId: project.id } });
  if (!profile) return { ready: false, missing: ["local_seo_profile"], nextAction: "Complete Local SEO setup fields." };
  const cities = Array.isArray(profile.citiesServed) ? profile.citiesServed.map(String) : [];
  const services = Array.isArray(profile.services) ? profile.services.map(String) : [];
  if (!profile.businessName || !cities.length || !services.length) return { ready: false, missing: ["business_name", "cities_served", "services"], nextAction: "Complete Local SEO setup fields." };
  return withUsage(req, project, "local_seo_launch_plan", "generate_plan", 1, async () => {
    const taskInputs = [
      ["service_area_pages", "Create city/service landing pages", `Create or improve pages for ${services.slice(0, 3).join(", ")} in ${cities.slice(0, 3).join(", ")}.`],
      ["gbp_checklist", "Complete Google Business Profile checklist", "Review categories, services, description, photos, Q&A, booking links, and update cadence."],
      ["citations", "Run NAP/citation consistency tasks", "Check name, address/service area, phone, website, and category consistency across major directories."],
      ["reviews", "Generate review request templates", "Create approved templates and a manual review-request workflow."],
      ["local_authority", "Create local authority opportunities", "Identify chambers, associations, sponsorships, resource pages, and local PR assets."],
      ["conversion", "Improve booking/call CTA on local pages", "Make phone, booking, quote, and service-area CTAs easier to find and measure."],
    ] as const;
    const result = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const [taskType, title, description] of taskInputs) {
        const localTask = await tx.gapLocalSeoTask.create({ data: { projectId: project.id, profileId: profile.id, taskType, title, description, priority: taskType === "service_area_pages" ? "high" : "medium" } });
        const executionTask = await upsertExecutionTask(tx, { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, dedupeKey: `gap-analysis:local:${localTask.id}`, moduleName: "gap_analysis", sourceType: "local_seo_task", sourceId: localTask.id, title, description, priority: localTask.priority as "high" | "medium" | "low", automationLevel: "manual_guided", safetyCategory: "safe", actionButtonLabel: "Open Local Task" });
        created.push(await tx.gapLocalSeoTask.update({ where: { id: localTask.id }, data: { executionTaskId: executionTask.id } }));
      }
      return created;
    });
    return { ready: true, tasks: result };
  });
}));

gapAnalysisRouter.post(gapRoutes("/ai-visibility/queries"), (req, res) => routeAction(res, async () => {
  const body = aiQueriesSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  const queries = await prisma.$transaction(body.queries.map((query) => prisma.aiVisibilityQuery.create({ data: { projectId: project.id, clientId: project.clientId, ...query } })));
  return { queries };
}));

gapAnalysisRouter.post(gapRoutes("/ai-visibility/run-scan"), (req, res) => routeAction(res, async () => {
  const project = await scopedProject(req, req.params.projectId);
  const queries = await prisma.aiVisibilityQuery.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 });
  if (!queries.length) return { ready: false, missing: ["ai_visibility_queries"], nextAction: "Create 5-10 priority AI visibility questions first." };
  return withUsage(req, project, "ai_visibility_scan", "run_scan", queries.length, async () => {
    const snapshots = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const query of queries) {
        const recommendedActions = ["Create stronger proof section", "Add FAQ block", "Build comparison page", "Improve entity profile"];
        const snapshot = await tx.aiVisibilitySnapshot.create({ data: { projectId: project.id, queryId: query.id, visibilityStatus: "citation_gap", recommendedActions, creditCost: 5, competitorsVisible: query.competitors, citedUrls: [] } });
        await tx.aiVisibilityQuery.update({ where: { id: query.id }, data: { lastScanStatus: "complete", visibilityStatus: "citation_gap", recommendedAction: recommendedActions[0] } });
        await upsertExecutionTask(tx, { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, dedupeKey: `gap-analysis:ai-visibility:${query.id}`, moduleName: "gap_analysis", sourceType: "ai_visibility_query", sourceId: query.id, title: `Improve AI visibility for "${query.queryText}"`, description: recommendedActions.join("; "), priority: "medium", automationLevel: "prepare", safetyCategory: "safe", actionButtonLabel: "Open AI Visibility Task" });
        created.push(snapshot);
      }
      return created;
    });
    return { ready: true, snapshots };
  });
}));

gapAnalysisRouter.post(gapRoutes("/authority/opportunities"), (req, res) => routeAction(res, async () => {
  const body = authoritySchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  const niche = body.niche || project.niche || project.businessProfile?.businessSummary || "the niche";
  const ideas = [
    { opportunityType: "research_asset", description: `Create original statistics page for ${niche}`, estimatedValue: "high" },
    { opportunityType: "citation", description: "Submit accurate listing to relevant local chamber or directory", estimatedValue: "medium" },
    { opportunityType: "resource_page", description: "Pitch a useful resource page with a calculator or checklist", estimatedValue: "high" },
    { opportunityType: "guest_quote", description: "Draft approved expert quote contribution for industry article outreach", estimatedValue: "medium" },
    { opportunityType: "partner", description: "Avoid automated reciprocal link network", estimatedValue: "low" },
  ];
  return withUsage(req, project, "safe_authority_builder", "generate_opportunities", 1, async () => {
    const opportunities = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const idea of ideas) {
        const score = scoreAuthorityOpportunity(idea.description);
        const opportunity = await tx.authorityOpportunity.create({ data: { projectId: project.id, clientId: project.clientId, opportunityType: idea.opportunityType, targetPageUrl: body.targetPageUrl ?? null, description: idea.description, riskScore: score.riskScore, riskLabel: score.riskLabel, estimatedValue: idea.estimatedValue, outreachRequired: idea.description.toLowerCase().includes("outreach") || idea.description.toLowerCase().includes("pitch") } });
        if (score.riskLabel !== "avoid") {
          const task = await upsertExecutionTask(tx, { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, dedupeKey: `gap-analysis:authority:${opportunity.id}`, moduleName: "gap_analysis", sourceType: "authority_opportunity", sourceId: opportunity.id, title: `Authority: ${idea.opportunityType.replace(/_/g, " ")}`, description: idea.description, priority: idea.estimatedValue === "high" ? "high" : "medium", automationLevel: opportunity.outreachRequired ? "manual_guided" : "prepare", requiresApproval: opportunity.outreachRequired, manualRequired: true, safetyCategory: score.riskLabel, actionButtonLabel: "Review Opportunity" });
          created.push(await tx.authorityOpportunity.update({ where: { id: opportunity.id }, data: { executionTaskId: task.id } }));
        } else {
          created.push(opportunity);
        }
      }
      return created;
    });
    return { opportunities };
  });
}));

gapAnalysisRouter.post(gapRoutes("/reports/generate"), (req, res) => routeAction(res, async () => {
  const body = reportSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  if (!body.approvedSectionsOnly) throw new Error("Client-facing reports must use approved sections only.");
  return withUsage(req, project, "white_label_report", body.reportType, 1, async () => {
    const report = await prisma.gapReportExport.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        reportType: body.reportType,
        clientName: body.clientName ?? project.businessName ?? project.name,
        exportFormat: body.exportFormat,
        approvalStatus: "approved",
        status: "queued",
        contentJson: { title: `${body.clientName ?? project.businessName ?? project.name} SEO Opportunity Report`, agencyName: body.agencyName, preparedByName: body.preparedByName, includePricingSection: body.includePricingSection, sections: ["Executive Summary", "Top Opportunities", "SEO Fix Queue Summary", "Local SEO / AI Visibility / Authority Findings", "Prioritized Execution Plan", "Next 30 Days"] },
      },
    });
    return { report };
  });
}));

gapAnalysisRouter.post(gapRoutes("/demo-projects/create"), (req, res) => routeAction(res, async () => {
  const body = demoSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  return withUsage(req, project, "demo_proof_project", body.template, 1, async () => {
    const demo = await prisma.demoProject.create({ data: { projectId: project.id, clientId: project.clientId, demoTemplate: body.template, includedAssets: ["sample audit", "sample strategy", "sample execution plan", "sample report", "before/after page example"] } });
    return { demo, warning: "Sample data only. Do not present as real client results." };
  });
}));

gapAnalysisRouter.post(gapRoutes("/ad-suggestions/generate"), (req, res) => routeAction(res, async () => {
  const body = adSuggestionSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  return withUsage(req, project, "ad_landing_suggestions", body.suggestionType, 1, async () => {
    const suggestions = [
      { type: "ad_copy", text: `Get ${body.offerSummary.slice(0, 80)} without guesswork. Book a fast audit today.` },
      { type: "CTA", text: body.campaignGoal === "booking" ? "Book a consultation" : "Get the plan" },
      { type: "landing_page", text: "Add proof, FAQs, offer clarity, and one visible primary CTA above the fold." },
      { type: "experiment", text: "Test proof-first headline against outcome-first headline for 14 days." },
    ];
    const record = await prisma.adLandingSuggestion.create({ data: { projectId: project.id, clientId: project.clientId, campaignGoal: body.campaignGoal, offerSummary: body.offerSummary, landingPageUrl: body.landingPageUrl ?? null, adPlatformTarget: body.adPlatformTarget ?? "manual", suggestionType: body.suggestionType, suggestionsJson: suggestions } });
    return { suggestion: record };
  });
}));

gapAnalysisRouter.post(gapRoutes("/ecommerce/export-guidance"), (req, res) => routeAction(res, async () => {
  const body = ecommerceSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  return withUsage(req, project, "ecommerce_export_guidance", body.storePlatform, 1, async () => {
    const manualPublishSteps = [
      "Review generated title, meta description, body copy, internal links, and collection/product target.",
      `Open ${body.storePlatform === "shopify" ? "Shopify admin" : "the ecommerce CMS"} and find the matching product, collection, category, or homepage.`,
      "Paste approved content as draft or unpublished changes first.",
      "Preview the page, check mobile layout, confirm canonical/URL settings, then publish after approval.",
    ].join("\n");
    const guide = await prisma.ecommerceExportGuide.create({ data: { projectId: project.id, clientId: project.clientId, storePlatform: body.storePlatform, shopDomain: body.shopDomain ?? null, productOrCollectionType: body.productOrCollectionType ?? null, targetName: body.targetName ?? null, manualPublishSteps, contentJson: { seoTitle: `${body.targetName ?? project.name} | ${project.businessName ?? project.name}`, metaDescription: `Improve visibility and conversions for ${body.targetName ?? project.name}.`, futureFields: ["shop_domain", "product_ids", "collection_ids", "publish_jobs"] } } });
    return { guide };
  });
}));
