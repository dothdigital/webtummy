import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { approvedKeywordEntries, dev053Capabilities, logicalPageIdentityKeys, missingApprovedKeywordResearch, splitKeywordEntries, urlAliasKey } from "@webtummy/core";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { commitUsage, preflightUsage, refundUsage } from "../usage-engine.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { GENERIC_SYSTEM_ERROR } from "../api-errors.js";
import { resolveStrategyEvidenceWorkflow } from "../strategy-evidence-workflow.js";
import { publishProjectWorkflowEvent } from "../project-workflow-controller.js";
import { isUtilityKeywordOwnerUrl, meaningfulKeywordOverlap } from "../gap-keyword-owner.js";
import { cleanGeographicTargetMarkets, projectAnalysisLocationLabels } from "../project-location.js";

export const gapAnalysisRouter = Router();
gapAnalysisRouter.use(requireAuth);

const terminalTaskStatuses = new Set(["completed", "skipped"]);

const approvalActions = ["approved", "rejected", "edited", "exported"] as const;

const localProfileSchema = z.object({
  businessName: z.string().min(1).max(180),
  businessType: z.string().min(1).max(120),
  primaryPhone: z.string().min(4).max(80),
  addressOrServiceArea: z.string().min(1).max(2000),
  citiesServed: z.array(z.string().min(1).max(120)).min(1).max(50),
  services: z.array(z.string().min(1).max(120)).min(1).max(100),
  serviceAreas: z.array(z.string().min(1).max(180)).max(100).default([]),
  country: z.string().min(2).max(120),
  region: z.string().max(120).optional().nullable(),
  postalCode: z.string().max(40).optional().nullable(),
  googleBusinessProfileUrl: z.string().url().max(512).optional().nullable().or(z.literal("")),
  businessHours: z.record(z.unknown()).default({}),
  gbpStatus: z.enum(["not_created", "claimed", "unclaimed", "unknown"]).optional().default("unknown"),
  reviewGoal: z.number().int().min(0).max(100000).optional().nullable(),
  citationStatus: z.enum(["unknown", "needs_audit", "partial", "complete"]).optional().default("unknown"),
});

const localPlanApprovalSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(50).optional(),
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

const stageFindingsSchema = z.object({
  findingKeys: z.array(z.string().min(1).max(191)).min(1).max(250),
});

type RecommendationFinding = {
  key: string;
  affectedUrl: string;
  issueType: string;
  severity: "high" | "medium" | "low";
  evidence: string;
  recommendedFix: string;
  whyItMatters: string;
  expectedImpact: string;
  sourceAnalysisId: string;
  details?: Array<{ issueType: string; severity: "high" | "medium" | "low"; evidence: string; recommendedFix: string; relatedUrls?: string[] }>;
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function routeAction(res: Response, action: () => Promise<unknown>) {
  try {
    res.json(await action());
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.flatten().fieldErrors });
    if (error instanceof Error) {
      const status = error.name.startsWith("usage_") ? 402 : error.name === "workflow_incomplete" ? 409 : error.message === "project not found" || error.message === "fix not found" || error.message === "recommendation not found" ? 404 : error.message.includes("permission") || error.message.includes("unavailable") ? 403 : error.message.includes("approved") ? 400 : 500;
      return res.status(status).json({ error: error.message });
    }
    return res.status(500).json({ error: GENERIC_SYSTEM_ERROR });
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
      keywordGroups: { select: { category: true, status: true, keywords: true } },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 1 },
      executionPlans: { select: { id: true }, take: 1 },
    },
  });
  if (!project) throw new Error("project not found");
  return project;
}

type CanonicalLocalProfile = Awaited<ReturnType<typeof findCanonicalLocalProfile>>;
type LegacyLocalProfile = Awaited<ReturnType<typeof findLegacyLocalProfile>>;

async function findCanonicalLocalProfile(project: { id: string; websiteId?: string | null }) {
  return prisma.localBusinessProfile.findFirst({
    where: {
      OR: [
        { projectId: project.id },
        ...(project.websiteId ? [{ websiteId: project.websiteId }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      keywords: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 100 },
      scores: { orderBy: { scoreDate: "desc" }, take: 20 },
      recommendations: { where: { status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 30 },
      citations: { orderBy: { source: "asc" } },
      reviews: { orderBy: { reviewDate: "desc" }, take: 100 },
    },
  });
}

async function findLegacyLocalProfile(projectId: string) {
  return prisma.gapLocalSeoProfile.findUnique({
    where: { projectId },
    include: { tasks: { orderBy: [{ planVersion: "desc" }, { priority: "asc" }, { createdAt: "asc" }], take: 100 } },
  });
}

function mergedLocalProfile(legacy: LegacyLocalProfile, canonical: CanonicalLocalProfile) {
  if (!legacy && !canonical) return null;
  const citations = canonical?.citations ?? [];
  const matchedCitations = citations.filter((item) => item.found && item.nameMatch && item.phoneMatch && item.websiteMatch).length;
  const citationStatus = legacy?.citationStatus
    ?? (citations.length && matchedCitations === citations.length ? "complete" : citations.length ? "partial" : "unknown");
  const inferredGbpStatus = legacy?.gbpStatus
    ?? (canonical?.googleBusinessProfileUrl ? "claimed" : "unknown");
  const latestScore = canonical?.scores[0] ?? null;
  return {
    id: legacy?.id ?? canonical!.id,
    canonicalBusinessId: canonical?.id ?? legacy?.canonicalBusinessId ?? null,
    businessName: canonical?.businessName ?? legacy!.businessName,
    businessType: canonical?.mainCategory ?? legacy!.businessType,
    primaryPhone: canonical?.phone ?? legacy?.primaryPhone ?? null,
    addressOrServiceArea: canonical?.address ?? legacy!.addressOrServiceArea,
    citiesServed: canonical?.targetLocations ?? legacy?.citiesServed ?? [],
    services: canonical?.services ?? legacy?.services ?? [],
    serviceAreas: canonical?.serviceAreas ?? legacy?.serviceAreas ?? [],
    country: canonical?.country ?? legacy?.country ?? null,
    region: canonical?.region ?? legacy?.region ?? null,
    postalCode: canonical?.postalCode ?? legacy?.postalCode ?? null,
    googleBusinessProfileUrl: canonical?.googleBusinessProfileUrl ?? legacy?.googleBusinessProfileUrl ?? null,
    googleBusinessConnectionStatus: canonical?.googleBusinessConnectionStatus ?? "not_connected",
    businessHours: canonical?.businessHours ?? legacy?.businessHours ?? {},
    gbpStatus: inferredGbpStatus,
    citationStatus,
    reviewGoal: legacy?.reviewGoal ?? null,
    planVersion: legacy?.planVersion ?? 0,
    planStatus: legacy?.planStatus ?? "not_created",
    planApprovedAt: legacy?.planApprovedAt ?? null,
    tasks: legacy?.tasks ?? [],
    audit: canonical ? {
      lastScore: latestScore?.totalScore ?? null,
      scoreStatus: latestScore?.statusLabel ?? "not_run",
      keywordCount: canonical.keywords.length,
      recommendationCount: canonical.recommendations.length,
      citationCount: citations.length,
      matchedCitationCount: matchedCitations,
      reviewCount: canonical.googleReviewCount ?? canonical.reviews.length,
    } : null,
  };
}

function localTaskRoute(projectId: string, taskType: string, businessId?: string | null) {
  if (taskType === "service_area_pages") return `/guided-projects/${projectId}?tab=execution`;
  if (taskType === "local_content") {
    const topic = "Locally relevant FAQs and supporting content";
    return "/ai-content?projectId=" + projectId + "&type=article&contentMode=seo&topic=" + encodeURIComponent(topic) + "&source=local_seo&open=1";
  }
  if (taskType === "local_schema") return "/ai-content?projectId=" + projectId + "&type=page_schema&contentMode=seo&topic=" + encodeURIComponent("Verified LocalBusiness schema") + "&source=local_seo&open=1";
  return `/local-seo?projectId=${projectId}${businessId ? `&businessId=${businessId}` : ""}`;
}

async function approveLocalPlanTask(tx: Prisma.TransactionClient, input: {
  context: Awaited<ReturnType<typeof workspaceContext>>;
  project: Awaited<ReturnType<typeof scopedProject>>;
  taskId: string;
}) {
  const localTask = await tx.gapLocalSeoTask.findFirst({ where: { id: input.taskId, projectId: input.project.id }, include: { profile: true } });
  if (!localTask) throw new Error("local recommendation not found");
  if (localTask.status === "approved" && localTask.executionTaskId) return localTask;
  const preliminaryRoute = localTask.actionRoute || localTaskRoute(input.project.id, localTask.taskType, localTask.profile.canonicalBusinessId);
  const executionTask = await upsertExecutionTask(tx, {
    clientId: input.project.clientId,
    websiteId: input.project.websiteId,
    projectId: input.project.id,
    dedupeKey: `local-seo:plan:${localTask.id}`,
    moduleName: localTask.taskType === "local_content" ? "content" : "local_seo",
    sourceType: "local_seo_plan_action",
    sourceId: localTask.id,
    title: localTask.title,
    description: localTask.description,
    priority: localTask.priority === "high" ? "high" : localTask.priority === "low" ? "low" : "medium",
    automationLevel: "prepare",
    requiresApproval: false,
    manualRequired: !["service_area_pages", "local_content", "local_schema"].includes(localTask.taskType),
    safetyCategory: ["service_area_pages", "local_content", "local_schema", "gbp_checklist", "citations", "reviews"].includes(localTask.taskType) ? "review_needed" : "safe",
    actionButtonLabel: localTask.taskType === "service_area_pages" ? "Prepare SEO Page Map" : ["local_content", "local_schema"].includes(localTask.taskType) ? "Create approved asset" : "Open Local SEO",
    relatedUrl: preliminaryRoute,
    impact: localTask.expectedImpact,
  });
  const route = localTask.taskType === "service_area_pages"
    ? `/guided-projects/${input.project.id}?tab=execution&actionTask=${executionTask.id}#execution-tasks`
    : localTask.taskType === "local_content"
      ? `${preliminaryRoute}&taskId=${executionTask.id}`
      : preliminaryRoute;
  if (route !== preliminaryRoute) await tx.executionTask.update({ where: { id: executionTask.id }, data: { relatedUrl: route } });
  const approved = await tx.gapLocalSeoTask.update({ where: { id: localTask.id }, data: { status: "approved", executionTaskId: executionTask.id, actionRoute: route } });
  const dedupeKey = `local-seo-plan:${localTask.id}`;
  const existingNba = await tx.nextBestAction.findFirst({ where: { projectId: input.project.id, dedupeKey } });
  const nbaData = {
    projectId: input.project.id,
    sourceTaskId: executionTask.id,
    sourceType: "local_seo_plan_action",
    sourceId: localTask.id,
    title: localTask.title,
    recommendation: localTask.description,
    reasoningSummary: localTask.reason || "Approved from the evidence-backed Local Growth Plan.",
    expectedImpact: localTask.expectedImpact || "Improve local visibility and execution readiness.",
    confidence: localTask.confidence,
    estimatedEffort: localTask.effort,
    route: "local_seo",
    priorityScore: localTask.priority === "high" ? 85 : localTask.priority === "low" ? 45 : 65,
    evidenceJson: { localTaskId: localTask.id, planVersion: localTask.planVersion, actionRoute: route },
    actionType: "local_seo",
    approvalType: "approved_plan_action",
    riskLevel: "low",
    dedupeKey,
    status: "proposed",
  } as const;
  if (existingNba) await tx.nextBestAction.update({ where: { id: existingNba.id }, data: nbaData });
  else await tx.nextBestAction.create({ data: nbaData });
  await tx.growthSignal.upsert({
    where: { fingerprint: `local-plan:${input.project.id}:${localTask.id}` },
    create: { projectId: input.project.id, fingerprint: `local-plan:${input.project.id}:${localTask.id}`, category: "local_seo", signalKey: "approved_local_plan_action", sourceType: "local_seo_plan_action", sourceId: localTask.id, valueJson: { taskType: localTask.taskType, planVersion: localTask.planVersion, executionTaskId: executionTask.id }, confidence: localTask.confidence, collectedAt: new Date(), effectiveDate: new Date() },
    update: { valueJson: { taskType: localTask.taskType, planVersion: localTask.planVersion, executionTaskId: executionTask.id }, confidence: localTask.confidence, collectedAt: new Date(), effectiveDate: new Date(), freshnessStatus: "fresh" },
  });
  await recordWorkspaceActivity(tx, { context: input.context, action: "local_seo.plan_action_approved", entityType: "local_seo_plan_action", entityId: localTask.id, agencyClientId: input.project.agencyClientId, projectId: input.project.id, previousJson: { status: localTask.status }, nextJson: { status: "approved", executionTaskId: executionTask.id, planVersion: localTask.planVersion, actionRoute: route } });
  return approved;
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
  approvalSnapshotJson?: Prisma.InputJsonValue;
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
    ...(input.approvalSnapshotJson !== undefined ? { approvalSnapshotJson: input.approvalSnapshotJson } : {}),
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

function findingDetailLabel(issueType: string) {
  if (issueType === "url_aliases_not_redirected") return "URL aliases";
  if (issueType === "exact_duplicate_content" || /word_count|thin_content/i.test(issueType)) return "Content";
  if (/meta/i.test(issueType)) return "Meta description";
  if (/title/i.test(issueType)) return "Title";
  if (/h1|heading/i.test(issueType)) return "H1 heading";
  if (/canonical/i.test(issueType)) return "Canonical URL";
  if (/schema/i.test(issueType)) return "Schema";
  return issueType.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function conciseFindingEvidence(issueType: string, evidence: string) {
  if (issueType === "long_title") return evidence.replace(/^Title is\s*/i, "");
  if (issueType === "long_meta_description") return evidence.replace(/^Meta description\s*/i, "");
  return evidence;
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

function gapPriority(score: number): "critical" | "high" | "medium" | "low" {
  return score >= 92 ? "critical" : score >= 78 ? "high" : score >= 55 ? "medium" : "low";
}

function gapTaskDestination(category: string, projectId: string) {
  const query = `projectId=${encodeURIComponent(projectId)}`;
  if (category === "connected_coverage") return { moduleName: "site_analysis", actionButtonLabel: "Resolve Connected Gaps", relatedUrl: `/site-analysis?${query}` };
  if (category === "technical") return { moduleName: "site_analysis", actionButtonLabel: "Review Technical Findings", relatedUrl: `/site-analysis?${query}` };
  if (category === "site_structure") return { moduleName: "site_analysis", actionButtonLabel: "Review Page & Link Findings", relatedUrl: `/gap-analysis?${query}` };
  if (category === "ai_citation" || category === "entity") return { moduleName: "ai_citations", actionButtonLabel: "Review AI Citation Work", relatedUrl: `/ai-citations?${query}` };
  if (category === "backlink") return { moduleName: "backlinks", actionButtonLabel: "Review Authority Work", relatedUrl: `/backlinks?${query}` };
  if (category === "local") return { moduleName: "local_seo", actionButtonLabel: "Review Local SEO Work", relatedUrl: `/local-seo?${query}` };
  if (category === "keyword" || category === "keyword_mapping") return { moduleName: "keyword_research", actionButtonLabel: category === "keyword_mapping" ? "Review Keyword-to-Page Map" : "Review Keyword Work", relatedUrl: `/keywords?${query}` };
  if (category === "topic") return { moduleName: "content", actionButtonLabel: "Review Content Opportunity", relatedUrl: `/ai-content?${query}` };
  if (category === "content") return { moduleName: "gap_analysis", actionButtonLabel: "Select Page Updates", relatedUrl: `/gap-analysis?${query}` };
  return { moduleName: "gap_analysis", actionButtonLabel: "Review Recommendation", relatedUrl: `/gap-analysis?${query}` };
}

function contentIssueMatches(issue: { category: string; issueType: string; message: string; page?: { statusCode?: number | null } | null }) {
  return (!issue.page || issue.page.statusCode === 200)
    && (/content|onpage/i.test(issue.category)
      || /title|meta|heading|h1|thin|duplicate_content|conversion/i.test(issue.issueType));
}

function technicalIssueMatches(issue: { category: string; issueType: string; message: string }) {
  return /technical|index|crawl|canonical|robot|sitemap|redirect|performance/i.test(`${issue.category} ${issue.issueType} ${issue.message}`);
}

type KeywordMappingPage = {
  id: string;
  url: string;
  statusCode: number | null;
  contentType: string | null;
  depth: number;
  wordCount: number | null;
  seo: { title: string | null; metaDescription: string | null; h1Text: Prisma.JsonValue; h2Json: Prisma.JsonValue } | null;
};

type CanonicalPageAssignment = {
  canonicalKeyword: string;
  secondaryKeywords: string[];
  targetUrl: string;
  pageName: string;
  searchIntent: string;
  recommendedAction: string;
  location: string | null;
};

const keywordStopWords = new Set(["a", "an", "and", "are", "at", "best", "by", "for", "from", "in", "is", "near", "of", "on", "or", "the", "to", "with"]);

function searchText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function keywordTerms(value: string) {
  return [...new Set(searchText(value).split(/\s+/).filter((term) => term.length > 1 && !keywordStopWords.has(term)))];
}

function headingText(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value.map(String).join(" ") : "";
}

function termCoverage(terms: string[], value: unknown) {
  if (!terms.length) return 0;
  const words = new Set(searchText(value).split(/\s+/).filter(Boolean));
  return terms.filter((term) => words.has(term)).length / terms.length;
}

function pageMapUrlKey(value: string, rootUrl = "") {
  try { return canonicalFindingUrl(new URL(value, rootUrl || undefined).toString()); } catch { return searchText(value); }
}

function pageMapUrlPath(value: string) {
  try { return new URL(value).pathname; } catch { return value; }
}

function keywordPageScore(keyword: string, page: KeywordMappingPage) {
  const terms = keywordTerms(keyword);
  const normalizedKeyword = searchText(keyword);
  const title = searchText(page.seo?.title);
  const h1 = searchText(headingText(page.seo?.h1Text));
  const meta = searchText(page.seo?.metaDescription);
  const h2 = searchText(headingText(page.seo?.h2Json));
  const url = searchText(pageMapUrlPath(page.url));
  const titleCoverage = termCoverage(terms, title);
  const h1Coverage = termCoverage(terms, h1);
  const metaCoverage = termCoverage(terms, meta);
  const h2Coverage = termCoverage(terms, h2);
  const urlCoverage = termCoverage(terms, url);
  const exactTitle = Boolean(normalizedKeyword && title.includes(normalizedKeyword));
  const exactH1 = Boolean(normalizedKeyword && h1.includes(normalizedKeyword));
  const overlap = meaningfulKeywordOverlap(terms, [url, title, h1, meta, h2]);
  const score = Math.min(100, Math.round(
    titleCoverage * 30
    + h1Coverage * 30
    + metaCoverage * 15
    + h2Coverage * 10
    + urlCoverage * 15
    + (exactTitle ? 8 : 0)
    + (exactH1 ? 8 : 0),
  ));
  return { score, titleCoverage, h1Coverage, metaCoverage, h2Coverage, urlCoverage, ...overlap };
}

function keywordPageFindings(crawlId: string, rootUrl: string, keywords: string[], targetLocations: string[], rawPages: KeywordMappingPage[], canonicalAssignments: CanonicalPageAssignment[] = []) {
  const pages = rawPages.filter((page) => page.statusCode === 200 && (!page.contentType || /html/i.test(page.contentType)));
  const approvedKeywords = uniqueStrings(keywords, 150);
  const markets = uniqueStrings(targetLocations.flatMap((location) => location.split(/[,;|]/)).map((location) => location.trim()), 30);
  const assignedPageIds = new Set<string>();
  const findings: RecommendationFinding[] = [];

  const pageLocationMatches = (page: KeywordMappingPage) => {
    const pageSignals = `${page.url} ${page.seo?.title ?? ""} ${headingText(page.seo?.h1Text)} ${headingText(page.seo?.h2Json)}`;
    return markets.filter((market) => {
      const terms = keywordTerms(market);
      return terms.length > 0 && termCoverage(terms, pageSignals) >= .7;
    });
  };

  approvedKeywords.forEach((keyword, keywordIndex) => {
    const assignment = canonicalAssignments.find((item) => {
      const assignedKeywords = [item.canonicalKeyword, ...item.secondaryKeywords];
      return assignedKeywords.some((assignedKeyword) => searchText(assignedKeyword) === searchText(keyword)
        || termCoverage(keywordTerms(keyword), assignedKeyword) >= .8
        || termCoverage(keywordTerms(assignedKeyword), keyword) >= .8);
    });
    const assignmentUrl = assignment?.targetUrl ? (() => { try { return new URL(assignment.targetUrl, rootUrl || undefined).toString(); } catch { return assignment.targetUrl; } })() : null;
    const ranked = pages
      .filter((page) => !isUtilityKeywordOwnerUrl(page.url) || Boolean(assignmentUrl && pageMapUrlKey(page.url, rootUrl) === pageMapUrlKey(assignmentUrl, rootUrl)))
      .map((page) => ({ page, match: keywordPageScore(keyword, page) }))
      .sort((left, right) => right.match.score - left.match.score);
    const assignedPage = assignmentUrl ? pages.find((page) => pageMapUrlKey(page.url, rootUrl) === pageMapUrlKey(assignmentUrl, rootUrl)) ?? null : null;
    const best = assignedPage ? { page: assignedPage, match: keywordPageScore(keyword, assignedPage) } : ranked[0];
    const strongMatches = ranked.filter((item) => item.match.credible && item.match.score >= 55);
    const keyPart = searchText(keyword).replace(/\s+/g, "-").slice(0, 80) || String(keywordIndex);
    const keywordMarkets = markets.filter((market) => {
      const terms = keywordTerms(market);
      return terms.length > 0 && termCoverage(terms, keyword) >= .7;
    });
    if (assignment && !assignedPage) {
      findings.push({
        key: `planned-page-missing:${keyPart}`,
        affectedUrl: assignmentUrl || assignment.targetUrl,
        issueType: "approved_page_map_target_not_in_crawl",
        severity: assignment.recommendedAction === "update_existing" ? "high" : "medium",
        evidence: `The saved SEO Page Map assigns “${keyword}” to ${assignment.targetUrl} (${assignment.pageName}), but that target was not found as a successful HTML page in the latest crawl.`,
        recommendedFix: assignment.recommendedAction === "create_new" ? "Create and publish the approved page, then recrawl it before measuring keyword alignment." : "Verify the saved target URL, redirect/canonical behavior, and crawl accessibility; update the canonical map if the owning page changed.",
        whyItMatters: "Gap Analysis, Growth, content generation, internal links, and rank tracking must use the same approved target URL.",
        expectedImpact: "Restores one shared keyword-to-page owner across Strategy, Execution, Growth, Publishing, and measurement.",
        sourceAnalysisId: crawlId,
      });
      return;
    }
    if (!best || (!assignment && (!best.match.credible || best.match.score < 25))) {
      findings.push({
        key: `keyword-unmapped:${keyPart}`,
        affectedUrl: "No matching existing page",
        issueType: "approved_keyword_without_page",
        severity: "high",
        evidence: `Approved keyword “${keyword}” has no credible match in the latest crawl's URL, title, H1, meta description, or H2 signals.`,
        recommendedFix: "Choose one existing page as the canonical target and update its search signals, or plan one useful new page when no current page serves this intent.",
        whyItMatters: "An approved keyword without one owning page cannot guide content updates, internal links, publishing, or ranking measurement.",
        expectedImpact: "Creates explicit page ownership for an approved search intent while avoiding duplicate pages and keyword cannibalization.",
        sourceAnalysisId: crawlId,
      });
      return;
    }

    const missingSignals = [
      best.match.titleCoverage < .65 ? "title" : "",
      best.match.h1Coverage < .65 ? "H1" : "",
      best.match.metaCoverage < .5 ? "meta description" : "",
      keywordMarkets.length && !keywordMarkets.some((market) => pageLocationMatches(best.page).includes(market)) ? `target location (${keywordMarkets.join(", ")})` : "",
    ].filter(Boolean);
    if (best.match.score >= 55) assignedPageIds.add(best.page.id);
    if (best.match.score < 55 || missingSignals.length) {
      const issueType = keywordMarkets.length && !keywordMarkets.some((market) => pageLocationMatches(best.page).includes(market)) ? "keyword_location_page_mismatch" : best.match.score < 55 ? "weak_keyword_page_match" : "missing_on_page_keyword_signals";
      findings.push({
      key: `keyword-alignment:${keyPart}:${best.page.id}`.slice(0, 191),
      affectedUrl: best.page.url,
      issueType,
      severity: best.match.score < 40 ? "high" : "medium",
      evidence: `${assignment ? "The saved SEO Page Map assigns" : "The crawl-inferred best match for"} “${keyword}” ${assignment ? "to" : "is"} ${best.page.url}. Current crawl-visible URL, title, H1, meta description, and H2 alignment is ${best.match.score}/100.${assignment ? ` Approved intent: ${assignment.searchIntent}${assignment.location ? ` · location: ${assignment.location}` : ""}.` : " This fallback remains unconfirmed until saved in the SEO Page Map."}${keywordMarkets.length ? ` Keyword location intent: ${keywordMarkets.join(", ")}. Page location signals: ${pageLocationMatches(best.page).join(", ") || "none"}.` : ""}${missingSignals.length ? ` Weak or missing signals: ${missingSignals.join(", ")}.` : ""}`,
      recommendedFix: issueType === "keyword_location_page_mismatch"
        ? `Choose the page that should represent “${keyword}” in ${keywordMarkets.join(", ")}. If this page is the right choice, confirm it as the owner. Leave any writing changes for Content Suggestions.`
        : `Confirm whether this is the right page for “${keyword}”. Keep it as the owner or choose a better page. Leave title, heading, and copy changes for Content Suggestions.`,
      whyItMatters: "Keyword Research becomes actionable only when each approved intent has one clearly aligned canonical page.",
      expectedImpact: "Improves keyword-to-page clarity, content briefing, internal linking, and future rank tracking after the update is published and recrawled.",
      sourceAnalysisId: crawlId,
      details: [
        { issueType: "title_alignment", severity: best.match.titleCoverage < .65 ? "medium" : "low", evidence: `${Math.round(best.match.titleCoverage * 100)}% meaningful-term coverage`, recommendedFix: "Use a natural title that clearly represents the page's approved intent." },
        { issueType: "h1_alignment", severity: best.match.h1Coverage < .65 ? "medium" : "low", evidence: `${Math.round(best.match.h1Coverage * 100)}% meaningful-term coverage`, recommendedFix: "Make the visible H1 accurately state the page's primary subject." },
        { issueType: "meta_alignment", severity: best.match.metaCoverage < .5 ? "medium" : "low", evidence: `${Math.round(best.match.metaCoverage * 100)}% meaningful-term coverage`, recommendedFix: "Write a useful meta description aligned with the page intent and value." },
      ],
      });
    }

    if (strongMatches.length > 1 && strongMatches[1].match.score >= best.match.score - 12) findings.push({
      key: `keyword-overlap:${keyPart}`,
      affectedUrl: best.page.url,
      issueType: "possible_keyword_cannibalization",
      severity: "medium",
      evidence: `“${keyword}” strongly matches more than one page: ${strongMatches.slice(0, 4).map((item) => `${item.page.url} (${item.match.score}/100)`).join(" · ")}.`,
      recommendedFix: "Choose one canonical owner page. Reposition the other pages around distinct supporting intents and link them to the owner page.",
      whyItMatters: "Multiple pages competing for the same primary intent can confuse page ownership and split internal relevance.",
      expectedImpact: "Clarifies canonical intent and reduces avoidable keyword overlap without deleting useful supporting pages.",
      sourceAnalysisId: crawlId,
    });
  });

  for (const page of pages) {
    if (assignedPageIds.has(page.id) || isUtilityKeywordOwnerUrl(page.url)) continue;
    const bestKeyword = approvedKeywords.map((keyword) => ({ keyword, match: keywordPageScore(keyword, page) })).sort((left, right) => right.match.score - left.match.score)[0];
    findings.push({
      key: `page-without-keyword:${page.id}`,
      affectedUrl: page.url,
      issueType: "page_without_approved_keyword_owner",
      severity: page.depth <= 1 ? "high" : "medium",
      evidence: bestKeyword ? `No approved keyword maps strongly to this page. Its closest approved keyword is “${bestKeyword.keyword}” at ${bestKeyword.match.score}/100.` : "No approved keyword is available to evaluate this page.",
      recommendedFix: "Confirm the page's real search purpose, assign one suitable approved keyword or entity/topic direction, or mark it as a non-search utility page. Do not invent a keyword merely to fill the field.",
      whyItMatters: "Pages without an explicit purpose cannot be reliably prioritized, optimized, internally linked, or measured.",
      expectedImpact: "Creates an accountable page map and exposes pages that need repositioning, consolidation, or an intentional non-search classification.",
      sourceAnalysisId: crawlId,
    });
  }

  for (const market of markets) {
    const matchingPages = pages.filter((page) => pageLocationMatches(page).includes(market));
    if (matchingPages.length) continue;
    const marketPart = searchText(market).replace(/\s+/g, "-").slice(0, 80);
    findings.push({
      key: `market-coverage:${marketPart}`,
      affectedUrl: rootUrl || "No matching existing page",
      issueType: "target_market_without_page_evidence",
      severity: "medium",
      evidence: `Target market “${market}” is approved for the project, but the latest crawl found no clear ${market} signal in page URLs, titles, H1s, or H2s.`,
      recommendedFix: "Decide whether this market needs a distinct service/location page based on real services, audience need, and search intent. If not, add verified service-area context to the most relevant existing pages. Do not create thin keyword × location doorway pages.",
      whyItMatters: "A target market needs a deliberate website destination or a documented non-page strategy before local keyword work can be measured.",
      expectedImpact: "Clarifies geographic coverage and produces a defensible location plan without automatically multiplying every keyword by every market.",
      sourceAnalysisId: crawlId,
    });
  }

  return findings.slice(0, 250);
}

function localMarketFindings(
  crawlId: string,
  rootUrl: string,
  targetLocations: string[],
  pages: KeywordMappingPage[],
  profile: { gbpStatus?: string | null; citationStatus?: string | null } | null,
) {
  const markets = uniqueStrings(targetLocations.flatMap((location) => location.split(/[,;|]/)).map((location) => location.trim()), 50);
  const findings: RecommendationFinding[] = [];
  const gbpStatus = profile?.gbpStatus ?? "not configured";
  const citationStatus = profile?.citationStatus ?? "not configured";
  if (gbpStatus !== "claimed" || citationStatus !== "complete") findings.push({
    key: "local-business-foundation",
    affectedUrl: rootUrl || "Business-wide local profile",
    issueType: "local_business_profile_readiness",
    severity: "high",
    evidence: `Business-wide local foundation - Google Business Profile: ${gbpStatus}; citation consistency: ${citationStatus}. This shared status applies to the business and is not duplicated as a separate failure for every market.`,
    recommendedFix: "Confirm the verified business identity, GBP ownership, primary category, services, service areas, and priority citation consistency once before planning market-specific execution.",
    whyItMatters: "Every city and service-area recommendation depends on one accurate business identity and profile foundation.",
    expectedImpact: "Creates a reliable shared local foundation for market pages, citations, reviews, schema, and future local measurement.",
    sourceAnalysisId: crawlId,
  });
  for (const market of markets) {
    const terms = keywordTerms(market);
    const matchingPages = pages.filter((page) => page.statusCode === 200 && terms.length > 0 && termCoverage(terms, `${page.url} ${page.seo?.title ?? ""} ${headingText(page.seo?.h1Text)} ${headingText(page.seo?.h2Json)}`) >= .7);
    const marketKey = searchText(market).replace(/\s+/g, "-").slice(0, 100);
    findings.push({
      key: `local-market:${marketKey}`,
      affectedUrl: matchingPages[0]?.url ?? rootUrl ?? "No matching market page",
      issueType: matchingPages.length ? "local_market_page_needs_validation" : "local_market_without_page_evidence",
      severity: matchingPages.length ? "medium" : "high",
      evidence: matchingPages.length
        ? `${market} - ${matchingPages.length} matching page${matchingPages.length === 1 ? "" : "s"} found: ${matchingPages.slice(0, 5).map((page) => page.url).join(" | ")}. Confirm that one page owns the market intent and the others serve distinct purposes.`
        : `${market} - no clear market signal was found in successful page URLs, titles, H1s, or H2s in the latest crawl. This is a planning gap, not an instruction to create an automatic city page.`,
      recommendedFix: matchingPages.length
        ? "Choose one canonical owner for the market's main intent, verify factual service availability, distinguish supporting pages, and validate local copy, internal links, schema, and conversion paths."
        : "Decide whether verified service availability and distinct audience/search intent justify a useful market page. Otherwise document this as a service area and strengthen the most relevant existing page without creating a thin doorway page.",
      whyItMatters: "Each target market needs an explicit, evidence-based website and local-search decision that can be implemented and measured independently.",
      expectedImpact: "Clarifies market coverage and prevents both missing local relevance and low-value location-page duplication.",
      sourceAnalysisId: crawlId,
    });
  }
  return findings;
}

function canonicalFindingUrl(rawUrl: string) {
  return urlAliasKey(rawUrl);
}

function logicalCrawlPages<T extends {
  id: string;
  url: string;
  finalUrl?: string | null;
  statusCode: number | null;
  depth: number;
  seo?: { canonicalUrl?: string | null; contentSimhash?: bigint | number | string | null } | null;
  internalLinkScore?: number | null;
  inlinkCount?: number | null;
  brokenInternalLinkCount?: number | null;
  weakAnchorCount?: number | null;
  isOrphan?: boolean;
}>(pages: T[], rootUrl: string): T[] {
  const preferredHost = (() => { try { return new URL(rootUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const score = (page: T) => {
    try {
      const url = new URL(page.url);
      return (url.hostname.toLowerCase() === preferredHost ? 100000 : 0)
        + (page.internalLinkScore != null ? 10000 : 0)
        + (url.protocol === "https:" ? 100 : 0)
        + (!/\/index\.(?:html?|php)$/i.test(url.pathname) ? 50 : 0)
        + (url.search ? 0 : 20)
        + Math.max(0, 10 - page.depth);
    } catch { return 0; }
  };
  const identityKeys = logicalPageIdentityKeys(pages.map((page) => ({
    id: page.id,
    url: page.url,
    finalUrl: page.finalUrl,
    canonicalUrl: page.seo?.canonicalUrl,
    contentFingerprint: page.seo?.contentSimhash,
  })));
  const groups = new Map<string, T[]>();
  for (const page of pages) {
    const key = identityKeys.get(page.id) ?? urlAliasKey(page.url);
    const group = groups.get(key) ?? [];
    group.push(page);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const representative = [...group].sort((left, right) => score(right) - score(left))[0];
    const inlinkCount = group.reduce((sum, page) => sum + (page.inlinkCount ?? 0), 0);
    return {
      ...representative,
      inlinkCount,
      isOrphan: inlinkCount === 0,
      brokenInternalLinkCount: Math.max(...group.map((page) => page.brokenInternalLinkCount ?? 0)),
      weakAnchorCount: Math.max(...group.map((page) => page.weakAnchorCount ?? 0)),
    };
  });
}

function preferredFindingUrl(urls: string[], preferredRoot: string) {
  const preferredHost = (() => { try { return new URL(preferredRoot).hostname.toLowerCase(); } catch { return ""; } })();
  return [...new Set(urls)].sort((left, right) => {
    const score = (value: string) => {
      try {
        const url = new URL(value);
        return (url.protocol === "https:" ? 2 : 0) + (url.hostname.toLowerCase() === preferredHost ? 4 : 0) + (!/\/index\.(?:html?|php)$/i.test(url.pathname) ? 2 : 0) + (!/\/$/.test(url.pathname) || url.pathname === "/" ? 1 : 0);
      } catch { return 0; }
    };
    return score(right) - score(left) || left.length - right.length;
  })[0] ?? preferredRoot;
}

function urlsFromFindingText(value: string) {
  return [...new Set((value.match(/https?:\/\/[^\s·]+/gi) ?? []).map((url) => url.replace(/[),.;]+$/g, "")).filter(Boolean))];
}

function logicalPathsFromUrls(urls: string[]) {
  return [...new Set(urls.flatMap((value) => {
    try { return [new URL(value).pathname || "/"]; } catch { return []; }
  }))].sort((left, right) => left === "/" ? -1 : right === "/" ? 1 : left.localeCompare(right));
}

type GapInput = { category: string; title: string; explanation: string; action: string; impact: string; score: number; confidence: number; evidence: string[]; competitors?: string[] };

type CitationGapEvidence = {
  query: string;
  gapSummary: string | null;
  competitorUrl: string | null;
  citedPageUrl: string | null;
  isInference: boolean;
};

function uniqueStrings(values: string[], limit = 12) {
  return [...new Map(values.map((value) => value.trim()).filter(Boolean).map((value) => [value.toLowerCase(), value])).values()].slice(0, limit);
}

function urlHostname(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

function aiCitationRecommendation(citationGaps: CitationGapEvidence[], approvedKeywords: string[]): GapInput | null {
  const observed = citationGaps.filter((item) => !item.isInference);
  if (observed.length) {
    const observedDomains = uniqueStrings(observed.flatMap((item) => [urlHostname(item.competitorUrl), urlHostname(item.citedPageUrl)].filter((value): value is string => Boolean(value))), 20);
    return {
      category: "ai_citation",
      title: `${observed.length} observed AI citation gap${observed.length === 1 ? "" : "s"} detected`,
      explanation: "Recorded answer-engine observations show that the project was absent, inaccurate, or outranked by other cited sources for these questions.",
      action: "Review the recorded answers and cited sources, then strengthen the best matching page with a direct, evidence-backed answer and clearer source support.",
      impact: "Improves answer clarity and source readiness for the exact monitored questions without guaranteeing future citation inclusion.",
      score: 85,
      confidence: 90,
      evidence: uniqueStrings(observed.map((item) => item.gapSummary || item.query), 6),
      competitors: observedDomains,
    };
  }

  const inferred = citationGaps.filter((item) => item.isInference);
  if (inferred.length) return {
    category: "ai_citation",
    title: `${inferred.length} AI answer opportunit${inferred.length === 1 ? "y" : "ies"} need validation`,
    explanation: "These buyer questions were inferred from approved project topics. No answer-engine result has been recorded for them yet, so they are opportunities—not detected citation gaps.",
    action: "Review the proposed questions, map each one to the best existing or planned page, and run a permitted visibility check before treating it as a citation gap.",
    impact: "Creates a defensible question set for future answer content and visibility measurement without claiming that competitors are currently being cited.",
    score: 64,
    confidence: 68,
    evidence: uniqueStrings(inferred.map((item) => item.query), 6),
    competitors: [],
  };

  if (!approvedKeywords.length) return null;
  return {
    category: "ai_citation",
    title: "AI answer opportunities need validation",
    explanation: "Approved keywords exist, but no buyer questions or answer-engine observations have been recorded yet.",
    action: "Create buyer questions from approved keywords and validate them before prioritizing citation work.",
    impact: "Establishes a measured AI visibility baseline before content work is prioritized.",
    score: 58,
    confidence: 62,
    evidence: uniqueStrings(approvedKeywords, 6),
    competitors: [],
  };
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function canonicalAssignmentsFromTasks(tasks: Array<{ status: string; approvalSnapshotJson: Prisma.JsonValue }>) {
  for (const task of tasks) {
    const snapshot = jsonObject(task.approvalSnapshotJson);
    const planStatus = String(snapshot.contentPlanStatus ?? "");
    if (!["saved", "confirmed", "approved"].includes(planStatus) && !["completed", "approved"].includes(task.status)) continue;
    const contentPlan = jsonObject(snapshot.contentPlan as Prisma.JsonValue | undefined);
    const rawAssignments = Array.isArray(contentPlan.pageAssignments) ? contentPlan.pageAssignments : [];
    const assignments = rawAssignments.flatMap((value): CanonicalPageAssignment[] => {
      const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      if (!item || typeof item.canonicalKeyword !== "string" || typeof item.targetUrl !== "string") return [];
      return [{
        canonicalKeyword: item.canonicalKeyword,
        secondaryKeywords: Array.isArray(item.secondaryKeywords) ? item.secondaryKeywords.map(String).filter(Boolean) : [],
        targetUrl: item.targetUrl,
        pageName: typeof item.pageName === "string" ? item.pageName : item.canonicalKeyword,
        searchIntent: typeof item.searchIntent === "string" ? item.searchIntent : "unknown",
        recommendedAction: typeof item.recommendedAction === "string" ? item.recommendedAction : "update_existing",
        location: typeof item.location === "string" ? item.location : null,
      }];
    });
    if (assignments.length) return assignments;
  }
  return [];
}

async function gapEvidence(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { website: { select: { rootUrl: true } }, businessProfile: true, keywordGroups: true, strategyPlans: { orderBy: { version: "desc" }, take: 1 }, opportunities: { where: { status: { in: ["selected", "confirmed"] } }, take: 1 } } });
  if (!project) throw new Error("project not found");
  const [crawl, competitiveRuns, citationGaps, authority, pageScores, legacyLocalProfile, canonicalLocalProfile, keywordRuns, pageMapTasks, capabilityRun] = await Promise.all([
    project.websiteId ? prisma.crawlJob.findFirst({ where: { websiteId: project.websiteId, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], include: { issues: { where: { status: "open" }, take: 500, select: { category: true, issueType: true, severity: true, message: true, recommendation: true, page: { select: { url: true, statusCode: true } } } }, pages: { take: 500, select: { id: true, url: true, finalUrl: true, isOrphan: true, inlinkCount: true, brokenInternalLinkCount: true, weakAnchorCount: true, wordCount: true, statusCode: true, contentType: true, depth: true, internalLinkScore: true, seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true, canonicalUrl: true, contentSimhash: true } } } } } }) : null,
    prisma.competitiveIntelligenceRun.findMany({ where: { projectId, status: "completed" }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.aiCitationGap.findMany({ where: { projectId, status: { not: "superseded" } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.authorityOpportunity.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.pageGrowthScore.findMany({ where: { projectId }, orderBy: [{ overallScore: "desc" }, { createdAt: "desc" }], take: 30 }),
    findLegacyLocalProfile(projectId),
    findCanonicalLocalProfile(project),
    prisma.keywordResearchRun.findMany({ where: { projectId, status: "completed" }, orderBy: { createdAt: "desc" }, take: 100, include: { competitors: { take: 15 }, ideas: { take: 30 } } }),
    prisma.executionTask.findMany({ where: { projectId, OR: [{ title: { contains: "SEO Page Map", mode: "insensitive" } }, { title: { contains: "Content Plan", mode: "insensitive" } }, { title: { contains: "Website Plan", mode: "insensitive" } }, { actionButtonLabel: { contains: "SEO Page Map", mode: "insensitive" } }, { sourceType: { in: ["seo_plan", "website_launch_plan"] } }] }, orderBy: { updatedAt: "desc" }, take: 10, select: { status: true, approvalSnapshotJson: true } }),
    prisma.dev053VerificationRun.findFirst({
      where: { projectId, status: "completed" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      include: { results: { where: { capabilityId: { startsWith: "SEO-" }, status: { in: ["BLOCKED", "MISSING", "PARTIAL"] }, NOT: { OR: [{ workflowDestination: { startsWith: "/gap-analysis" } }, { workflowDestination: { startsWith: "/reports" } }] } }, orderBy: { capabilityId: "asc" } } },
    }),
  ]);
  const localProfile = mergedLocalProfile(legacyLocalProfile, canonicalLocalProfile);
  const rootUrl = project.website?.rootUrl ?? project.websiteUrl ?? crawl?.pages[0]?.url ?? "";
  const logicalCrawl = crawl ? { ...crawl, pages: logicalCrawlPages(crawl.pages, rootUrl) } : null;
  return { project, crawl: logicalCrawl, competitiveRuns, citationGaps, authority, pageScores, localProfile, keywordRuns, canonicalAssignments: canonicalAssignmentsFromTasks(pageMapTasks), capabilityRun };
}

export async function recommendationFindings(projectId: string, category: string): Promise<RecommendationFinding[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { websiteId: true, websiteUrl: true, targetLocations: true, targetLocation: true, website: { select: { rootUrl: true } }, keywordGroups: { where: { status: "approved" }, select: { keywords: true } } },
  });
  if (!project?.websiteId) return [];
  const crawl = await prisma.crawlJob.findFirst({
    where: { websiteId: project.websiteId, status: "completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    include: {
      issues: { where: { status: "open" }, include: { page: { select: { id: true, url: true, statusCode: true } } }, orderBy: [{ severity: "asc" }, { weightImpact: "desc" }], take: 500 },
      pages: {
        orderBy: [{ internalLinkScore: "asc" }, { url: "asc" }],
        take: 500,
        include: { seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true, contentSimhash: true } } },
      },
    },
  });
  if (!crawl) return [];
  const rootUrl = project.website?.rootUrl ?? project.websiteUrl ?? "";
  const pages = logicalCrawlPages(crawl.pages, rootUrl);
  const canonicalAssignments = category === "keyword_mapping" ? canonicalAssignmentsFromTasks(await prisma.executionTask.findMany({
    where: { projectId, OR: [{ title: { contains: "SEO Page Map", mode: "insensitive" } }, { title: { contains: "Content Plan", mode: "insensitive" } }, { title: { contains: "Website Plan", mode: "insensitive" } }, { actionButtonLabel: { contains: "SEO Page Map", mode: "insensitive" } }, { sourceType: { in: ["seo_plan", "website_launch_plan"] } }] },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { status: true, approvalSnapshotJson: true },
  })) : [];
  if (category === "keyword_mapping") return keywordPageFindings(
    crawl.id,
    rootUrl,
    splitKeywordEntries(project.keywordGroups.flatMap((group) => jsonStringList(group.keywords))),
    uniqueStrings([...cleanGeographicTargetMarkets(jsonStringList(project.targetLocations)), project.targetLocation ?? ""], 30),
    pages,
    canonicalAssignments,
  );
  if (category === "technical") {
    const grouped = new Map<string, { issues: typeof crawl.issues; urls: string[] }>();
    for (const issue of crawl.issues.filter(technicalIssueMatches)) {
      const affectedUrl = issue.page?.url ?? rootUrl;
      const groupKey = issue.page?.url
        ? canonicalFindingUrl(issue.page.url)
        : issue.issueType === "url_aliases_not_redirected"
          ? "site:url_aliases_not_redirected"
          : `site:${issue.issueType}`;
      const current = grouped.get(groupKey) ?? { issues: [], urls: [] };
      current.issues.push(issue);
      current.urls.push(affectedUrl);
      grouped.set(groupKey, current);
    }
    return [...grouped.values()].map((group) => {
      const siteWideAliasIssues = group.issues.filter((issue) => issue.issueType === "url_aliases_not_redirected" && !issue.pageId);
      if (siteWideAliasIssues.length === group.issues.length) {
        const aliasUrls = [...new Set(siteWideAliasIssues.flatMap((issue) => urlsFromFindingText(issue.message)))];
        const logicalPaths = logicalPathsFromUrls(aliasUrls);
        const affectedPathSummary = logicalPaths.slice(0, 12).join(" · ");
        const recommendedFix = "Choose one preferred hostname and configure one host-level 301 redirect so every URL on the alternate hostname resolves to the same path on the preferred hostname. Then use only the preferred hostname in internal links, canonical tags, and sitemap.xml.";
        return {
          key: `technical-domain-aliases:${crawl.id}`,
          affectedUrl: rootUrl,
          issueType: "domain_hostname_redirect",
          severity: siteWideAliasIssues.some((issue) => ["critical", "high"].includes(issue.severity)) ? "high" as const : "medium" as const,
          evidence: `One domain-wide hostname issue affects ${logicalPaths.length} logical page${logicalPaths.length === 1 ? "" : "s"}: both www and non-www URLs are accessible without a redirect.${affectedPathSummary ? ` Affected paths: ${affectedPathSummary}.` : ""}`,
          recommendedFix,
          whyItMatters: "This is one server or hosting redirect configuration, not a separate content update for every affected page.",
          expectedImpact: "Consolidates indexing and link signals under one preferred hostname and prevents the same issue from becoming repeated page-level work.",
          sourceAnalysisId: crawl.id,
          details: [{
            issueType: "url_aliases_not_redirected",
            severity: "high" as const,
            evidence: `${siteWideAliasIssues.length} crawl checks share the same hostname-redirect cause across ${logicalPaths.length} logical page${logicalPaths.length === 1 ? "" : "s"}.`,
            recommendedFix,
            ...(aliasUrls.length ? { relatedUrls: aliasUrls } : {}),
          }],
        };
      }
      const detailMap = new Map<string, NonNullable<RecommendationFinding["details"]>[number]>();
      for (const issue of group.issues) {
        const detail = {
          issueType: issue.issueType,
          severity: priorityForSeverity(issue.severity),
          evidence: issue.message,
          recommendedFix: issue.recommendation ?? `Resolve ${issue.message}`,
        };
        detailMap.set(`${detail.issueType}|${detail.evidence.toLowerCase()}|${detail.recommendedFix.toLowerCase()}`, detail);
      }
      const details = [...detailMap.values()];
      const severity = details.some((detail) => detail.severity === "high") ? "high" as const : details.some((detail) => detail.severity === "medium") ? "medium" as const : "low" as const;
      const aliases = [...new Set(group.urls)];
      return {
        key: `technical-page:${group.issues[0].id}`,
        affectedUrl: preferredFindingUrl(aliases, rootUrl),
        issueType: "technical_page_update",
        severity,
        evidence: `${details.length} technical check${details.length === 1 ? "" : "s"} need attention on this page${aliases.length > 1 ? ` · ${aliases.length} URL aliases grouped` : ""}: ${details.map((detail) => `${findingDetailLabel(detail.issueType)} — ${detail.evidence}`).join(" · ")}`,
        recommendedFix: uniqueStrings(details.map((detail) => `${findingDetailLabel(detail.issueType)} — ${detail.recommendedFix}`), 20).join(" · "),
        whyItMatters: "The exact crawl checks are grouped by affected page so the technical change can be implemented once and verified against the same URL.",
        expectedImpact: "Improves crawlability, indexability, canonical consistency, or technical reliability after implementation and recrawl verification.",
        sourceAnalysisId: crawl.id,
        details,
      };
    }).sort((left, right) => {
      const severityRank = { high: 0, medium: 1, low: 2 } as const;
      return severityRank[left.severity] - severityRank[right.severity] || left.affectedUrl.localeCompare(right.affectedUrl);
    });
  }
  if (category === "content") {
    const rawPageIdentityKeys = logicalPageIdentityKeys(crawl.pages.map((page) => ({
      id: page.id,
      url: page.url,
      finalUrl: page.finalUrl,
      canonicalUrl: page.seo?.canonicalUrl,
      contentFingerprint: page.seo?.contentSimhash,
    })));
    const logicalKeyByObservedUrl = new Map(crawl.pages.map((page) => [urlAliasKey(page.url), rawPageIdentityKeys.get(page.id) ?? urlAliasKey(page.url)]));
    const relatedUrlsByIssue = new Map<string, string[]>();
    const registerDuplicateGroups = (
      issueType: string,
      valueFor: (page: (typeof pages)[number]) => string | null,
    ) => {
      const valueGroups = new Map<string, (typeof pages)[number][]>();
      for (const page of pages) {
        if (page.statusCode !== 200) continue;
        const value = valueFor(page)?.trim().toLowerCase();
        if (!value) continue;
        const current = valueGroups.get(value) ?? [];
        current.push(page);
        valueGroups.set(value, current);
      }
      for (const pages of valueGroups.values()) {
        if (pages.length < 2) continue;
        const urls = [...new Set(pages.map((page) => page.url))].sort();
        for (const page of pages) relatedUrlsByIssue.set(`${issueType}:${page.id}`, urls);
      }
    };
    const firstH1 = (page: (typeof pages)[number]) => {
      const headings = Array.isArray(page.seo?.h1Text) ? page.seo.h1Text : [];
      return typeof headings[0] === "string" ? headings[0] : null;
    };
    registerDuplicateGroups("duplicate_title", (page) => page.seo?.title ?? null);
    registerDuplicateGroups("duplicate_meta_description", (page) => page.seo?.metaDescription ?? null);
    registerDuplicateGroups("duplicate_h1", firstH1);
    registerDuplicateGroups("exact_duplicate_content", (page) => page.seo?.contentSimhash?.toString() ?? null);

    const grouped = new Map<string, { issues: typeof crawl.issues; urls: string[] }>();
    for (const issue of crawl.issues.filter(contentIssueMatches)) {
      if (["duplicate_title", "duplicate_meta_description", "duplicate_h1", "exact_duplicate_content"].includes(issue.issueType)) {
        const duplicateUrls = urlsFromFindingText(issue.message);
        const logicalDuplicatePages = new Set(duplicateUrls.map((url) => logicalKeyByObservedUrl.get(urlAliasKey(url)) ?? urlAliasKey(url)));
        if (duplicateUrls.length > 1 && logicalDuplicatePages.size === 1) continue;
      }
      const affectedUrl = issue.page?.url ?? rootUrl;
      const groupKey = issue.page?.url ? canonicalFindingUrl(issue.page.url) : `site:${issue.issueType}`;
      const current = grouped.get(groupKey) ?? { issues: [], urls: [] };
      current.issues.push(issue);
      current.urls.push(affectedUrl);
      grouped.set(groupKey, current);
    }
    return [...grouped.values()].map((group) => {
      const detailMap = new Map<string, NonNullable<RecommendationFinding["details"]>[number]>();
      for (const issue of group.issues) {
        const rawRelatedUrls = issue.pageId ? relatedUrlsByIssue.get(`${issue.issueType}:${issue.pageId}`) ?? [] : [];
        const isDuplicateCheck = ["duplicate_title", "duplicate_meta_description", "duplicate_h1", "exact_duplicate_content"].includes(issue.issueType);
        const relatedCanonicalPages = new Map<string, string[]>();
        for (const url of rawRelatedUrls) {
          const canonicalKey = canonicalFindingUrl(url);
          const current = relatedCanonicalPages.get(canonicalKey) ?? [];
          current.push(url);
          relatedCanonicalPages.set(canonicalKey, current);
        }
        if (isDuplicateCheck && rawRelatedUrls.length > 1 && relatedCanonicalPages.size === 1) {
          const aliasUrls = [...new Set(rawRelatedUrls)].sort();
          const aliasDetail = {
            issueType: "url_aliases_not_redirected",
            severity: "medium" as const,
            evidence: `The same page is accessible at ${aliasUrls.length} URL aliases: ${aliasUrls.join(" · ")}.`,
            recommendedFix: "Choose one preferred canonical URL, 301 redirect every alias to it, and use only the preferred URL in internal links, canonical tags, and sitemap.xml.",
          };
          detailMap.set(`url_aliases_not_redirected|${aliasUrls.join("|")}`, aliasDetail);
          continue;
        }
        const relatedUrls = [...relatedCanonicalPages.values()]
          .map((urls) => preferredFindingUrl(urls, rootUrl))
          .sort();
        const detail = {
          issueType: issue.issueType,
          severity: issue.severity,
          evidence: issue.message,
          recommendedFix: issue.recommendation ?? `Resolve ${issue.message}`,
          ...(relatedUrls.length > 1 ? { relatedUrls } : {}),
        };
        detailMap.set(`${detail.issueType}|${detail.evidence.toLowerCase()}|${detail.recommendedFix.toLowerCase()}|${relatedUrls.join("|")}`, detail);
      }
      const details = [...detailMap.values()];
      const duplicateUrlGroups = [...new Map(
        details
          .filter((detail) => detail.relatedUrls && detail.relatedUrls.length > 1)
          .map((detail) => [detail.relatedUrls!.join("|"), detail.relatedUrls!]),
      ).values()];
      const severity = details.some((detail) => detail.severity === "high") ? "high" as const : details.some((detail) => detail.severity === "medium") ? "medium" as const : "low" as const;
      const aliases = [...new Set(group.urls)];
      const weightImpact = group.issues.reduce((sum, issue) => sum + issue.weightImpact, 0);
      const checkSummary = details
        .map((detail) => `${findingDetailLabel(detail.issueType)} — ${conciseFindingEvidence(detail.issueType, detail.evidence)}`)
        .join(" · ");
      const recommendedUpdates = [...new Set(details.map((detail) => `${findingDetailLabel(detail.issueType)} — ${detail.recommendedFix.replace(/\bchars\b/gi, "characters")}`))];
      return {
        key: `content-page:${group.issues[0].id}`,
        affectedUrl: preferredFindingUrl(aliases, rootUrl),
        issueType: "content_page_update",
        severity,
        evidence: `${details.length} check${details.length === 1 ? "" : "s"} need attention on this page${aliases.length > 1 ? ` · ${aliases.length} URL aliases grouped` : ""}: ${checkSummary}${duplicateUrlGroups.length ? ` Matching duplicate URLs: ${duplicateUrlGroups.map((urls) => urls.join(" · ")).join(" | ")}.` : ""}`,
        recommendedFix: recommendedUpdates.join(" · "),
        whyItMatters: "Multiple checks and URL aliases are grouped into one page update so the team can fix and publish the page once instead of creating duplicate work.",
        expectedImpact: `Improves on-page quality and recovers approximately ${Number(weightImpact.toFixed(2))} weighted audit points when the grouped change is verified.`,
        sourceAnalysisId: crawl.id,
        details,
      };
    }).sort((left, right) => {
      const severityRank = { high: 0, medium: 1, low: 2 } as const;
      return severityRank[left.severity] - severityRank[right.severity]
        || left.affectedUrl.localeCompare(right.affectedUrl);
    });
  }
  if (category === "site_structure") {
    return pages
      .filter((page) => page.isOrphan || page.inlinkCount === 0 || page.brokenInternalLinkCount > 0 || page.weakAnchorCount > 0)
      .map((page) => {
        const incomingCount = page.inlinkCount ?? 0;
        const brokenCount = page.brokenInternalLinkCount ?? 0;
        const weakOutgoingCount = page.weakAnchorCount ?? 0;
        const evidence = [
          page.isOrphan ? "Orphan page" : "",
          incomingCount === 0 ? "No internal links point to this page" : `${incomingCount} internal link${incomingCount === 1 ? "" : "s"} ${incomingCount === 1 ? "points" : "point"} to this page`,
          brokenCount ? `This page contains ${brokenCount} broken internal link${brokenCount === 1 ? "" : "s"}` : "",
          weakOutgoingCount ? `This page contains ${weakOutgoingCount} outgoing link${weakOutgoingCount === 1 ? "" : "s"} with generic anchor text` : "",
        ].filter(Boolean);
        const actions = [
          brokenCount ? `Repair the ${brokenCount} broken internal target${brokenCount === 1 ? "" : "s"} linked from this page.` : "",
          weakOutgoingCount ? `Replace the ${weakOutgoingCount} generic outgoing anchor${weakOutgoingCount === 1 ? "" : "s"} on this page with text that names the destination topic.` : "",
          incomingCount <= 2 ? `Add one or two relevant contextual links from related pages to this page; use this page's actual service or topic as the anchor.` : "",
        ].filter(Boolean);
        return {
          key: `page:${page.id}`,
          affectedUrl: page.url,
          issueType: "site_structure_internal_links",
          severity: page.isOrphan || page.brokenInternalLinkCount > 0 ? "high" as const : "medium" as const,
          evidence: evidence.join(" · "),
          recommendedFix: actions.join(" "),
          whyItMatters: "Pages that are isolated or linked poorly are harder for visitors and crawlers to discover, and receive less internal authority.",
          expectedImpact: "Improves discovery, navigation, internal authority flow, and keyword-to-page clarity after the links are published and recrawled.",
          sourceAnalysisId: crawl.id,
        };
      });
  }
  return [];
}

function buildGapRecommendations(evidence: Awaited<ReturnType<typeof gapEvidence>>): GapInput[] {
  const { project, crawl, citationGaps, authority, pageScores, localProfile, keywordRuns, competitiveRuns, canonicalAssignments, capabilityRun } = evidence;
  const groups = project.keywordGroups.filter((group) => group.status === "approved");
  const approvedKeywords = uniqueStrings(splitKeywordEntries(groups.flatMap((group) => jsonStringList(group.keywords))), 100);
  const savedKeywordGaps = uniqueStrings(groups.flatMap((group) => jsonStringList(group.gapKeywords)), 30);
  const competitors = uniqueStrings([
    ...jsonStringList(project.competitors),
    ...keywordRuns.flatMap((run) => run.competitors.map((item) => item.domain)),
  ], 20);
  const competitorTopics = uniqueStrings(keywordRuns.flatMap((run) => run.competitors.flatMap((item) => jsonStringList(item.missingTopicsJson))), 30);
  const issues = crawl?.issues ?? [];
  const technical = issues.filter(technicalIssueMatches);
  const technicalImplementationAreas = new Map<string, typeof technical>();
  for (const issue of technical) {
    const key = issue.issueType === "url_aliases_not_redirected" && !issue.page?.url
      ? "site:url_aliases_not_redirected"
      : issue.page?.url
        ? `page:${canonicalFindingUrl(issue.page.url)}`
        : `site:${issue.issueType}`;
    const current = technicalImplementationAreas.get(key) ?? [];
    current.push(issue);
    technicalImplementationAreas.set(key, current);
  }
  const technicalEvidence = [...technicalImplementationAreas.entries()].map(([key, area]) => {
    if (key === "site:url_aliases_not_redirected") {
      const paths = logicalPathsFromUrls(area.flatMap((item) => urlsFromFindingText(item.message)));
      return `Domain-wide hostname redirect — ${area.length} repeated URL-alias checks share one implementation fix across ${paths.length} logical page${paths.length === 1 ? "" : "s"}.`;
    }
    const affectedUrl = area[0]?.page?.url ?? "Site-wide";
    return `${affectedUrl} — ${area.length} technical check${area.length === 1 ? "" : "s"}: ${uniqueStrings(area.map((item) => findingDetailLabel(item.issueType)), 8).join(", ")}.`;
  });
  const content = issues.filter(contentIssueMatches);
  const contentPageCount = new Set(content.map((item) => item.page?.url ? canonicalFindingUrl(item.page.url) : `site:${item.issueType}`)).size;
  const structurePages = (crawl?.pages ?? []).filter((page) => page.isOrphan || (page.inlinkCount ?? 1) === 0 || (page.brokenInternalLinkCount ?? 0) > 0 || (page.weakAnchorCount ?? 0) > 0);
  const markets = cleanGeographicTargetMarkets(jsonStringList(project.targetLocations));
  const mappingMarkets = uniqueStrings([...markets.flatMap((market) => market.split(/[,;|]/)), project.targetLocation ?? ""], 30);
  const keywordMappingFindings = crawl && approvedKeywords.length ? keywordPageFindings(
    crawl.id,
    project.websiteUrl ?? crawl.pages[0]?.url ?? "",
    approvedKeywords,
    mappingMarkets,
    crawl.pages,
    canonicalAssignments,
  ) : [];
  const result: GapInput[] = [];
  if (capabilityRun?.results.length) {
    const definitions = new Map(dev053Capabilities.map((item) => [item.id, item]));
    const actionAreas = [...new Map(capabilityRun.results.map((item) => {
      const definition = definitions.get(item.capabilityId as (typeof dev053Capabilities)[number]["id"]);
      const key = `${item.status}:${item.workflowDestination}:${item.message}`;
      return [key, { item, definition }];
    })).values()];
    const blocked = capabilityRun.results.filter((item) => item.status === "BLOCKED").length;
    const missing = capabilityRun.results.filter((item) => item.status === "MISSING").length;
    const partial = capabilityRun.results.filter((item) => item.status === "PARTIAL").length;
    const sections = uniqueStrings(capabilityRun.results.flatMap((item) => {
      const section = definitions.get(item.capabilityId as (typeof dev053Capabilities)[number]["id"])?.section;
      return section ? [section] : [];
    }), 8);
    result.push({
      category: "connected_coverage",
      title: `${actionAreas.length} connected SEO and growth action areas need attention`,
      explanation: `Site Analysis found ${blocked} blocked, ${missing} missing, and ${partial} partially supported capability checks across ${sections.length || 1} applicable areas. Those ${capabilityRun.results.length} checks consolidate into ${actionAreas.length} distinct actions because several capabilities share the same prerequisite or workflow destination.`,
      action: "Resolve the highest-impact prerequisites and evidence gaps in Site Analysis, approve this recommendation into Strategy, and complete the resulting Execution Plan task before refreshing the checks.",
      impact: "Connects site, content, local, authority, AI-search, publishing, and measurement evidence to the approved growth workflow and verifies progress after implementation.",
      score: blocked ? 94 : missing ? 88 : 78,
      confidence: 95,
      evidence: actionAreas.slice(0, 8).map(({ item, definition }) => {
        const covered = capabilityRun.results.filter((candidate) => candidate.status === item.status && candidate.workflowDestination === item.workflowDestination && candidate.message === item.message).length;
        return `${definition?.title ?? "Connected capability"}${covered > 1 ? ` (+${covered - 1} related checks)` : ""} — ${item.message}`;
      }),
      competitors: [],
    });
  }
  if (!groups.length || savedKeywordGaps.length) result.push({ category: "keyword", title: groups.length ? `${savedKeywordGaps.length} keyword opportunities need coverage` : "Approved keyword direction is missing", explanation: groups.length ? "Approved keyword research contains relevant phrases that are not yet fully covered by the project direction." : "Strategy cannot reliably prioritize search demand without at least one approved keyword group.", action: groups.length ? "Map the highest-intent gap keywords to existing or new pages and validate them through Keyword Research." : "Generate Keyword Intelligence recommendations and approve at least one relevant group.", impact: "Improves intent coverage and gives Strategy and Execution a defensible search-demand direction.", score: groups.length ? 84 : 94, confidence: groups.length ? 88 : 99, evidence: groups.length ? savedKeywordGaps.slice(0, 6) : ["No approved keyword groups"], competitors });
  if (keywordMappingFindings.length) result.push({
    category: "keyword_mapping",
    title: `${keywordMappingFindings.length} keyword, location, and page-alignment decisions need review`,
    explanation: `${approvedKeywords.length} approved keyword${approvedKeywords.length === 1 ? " was" : "s were"} compared with ${crawl?.pages.filter((page) => page.statusCode === 200).length ?? 0} live page${(crawl?.pages.filter((page) => page.statusCode === 200).length ?? 0) === 1 ? "" : "s"}${mappingMarkets.length ? ` and ${mappingMarkets.length} target market${mappingMarkets.length === 1 ? "" : "s"}` : ""}. ${canonicalAssignments.length ? `${canonicalAssignments.length} saved SEO Page Map assignment${canonicalAssignments.length === 1 ? " was" : "s were"} used as the source of truth; the crawl was used to validate the live implementation.` : "No saved SEO Page Map was available, so crawl matches are shown as suggestions that still require confirmation."} The result identifies missing page ownership, weak page signals, possible overlap, and geographic coverage decisions without automatically creating every keyword × location combination.`,
    action: "Open the exact mapping, confirm one owner page per approved intent, repair weak title/H1/meta alignment, decide justified market coverage, and create a new page only when no existing page serves the intent.",
    impact: "Turns Keyword Research and Site Analysis into a page-by-page SEO plan that can be implemented, published, recrawled, and measured.",
    score: Math.min(96, 76 + keywordMappingFindings.filter((finding) => finding.severity === "high").length),
    confidence: 88,
    evidence: keywordMappingFindings.slice(0, 8).map((finding) => `${finding.affectedUrl} — ${finding.evidence}`),
    competitors: [],
  });
  if (competitorTopics.length || competitors.length) result.push({ category: "topic", title: competitorTopics.length ? `${competitorTopics.length} competitor topic gaps detected` : "Competitor topic coverage needs comparison", explanation: competitorTopics.length ? "Competitor pages cover useful subtopics that the current project evidence does not yet address." : "Competitors are known, but their topic and content coverage has not been converted into prioritized opportunities.", action: competitorTopics.length ? `Review and map these topics first: ${competitorTopics.slice(0, 5).join(", ")}.` : "Run competitor content analysis and identify differentiated topics that support the Primary Goal.", impact: "Closes useful topical gaps without copying competitor messaging.", score: competitorTopics.length ? 82 : 68, confidence: competitorTopics.length ? 90 : 70, evidence: competitorTopics.slice(0, 8), competitors });
  if (content.length || pageScores.some((page) => page.refreshPriorityScore >= 60)) result.push({ category: "content", title: `${contentPageCount || pageScores.filter((page) => page.refreshPriorityScore >= 60).length} pages need content improvements`, explanation: `${content.length || pageScores.filter((page) => page.refreshPriorityScore >= 60).length} distinct content checks are grouped by canonical page so URL aliases and multiple checks do not appear as separate page updates.`, action: "Refresh the highest-value pages with intent-matched sections, current proof, clearer CTAs, FAQs, and better keyword-to-page alignment.", impact: "Improves relevance, conversion readiness, freshness, and performance against stronger competitor pages.", score: Math.min(95, 72 + content.length), confidence: crawl ? 91 : 72, evidence: content.slice(0, 6).map((item) => item.message), competitors });
  if (!authority.length || authority.some((item) => item.estimatedValue === "high")) result.push({ category: "backlink", title: authority.length ? "High-value authority opportunities are not yet executed" : "Backlink and authority evidence is missing", explanation: authority.length ? "Safe authority opportunities exist but have not yet become completed work." : "The project has no saved authority opportunities, so competitor link advantages and trusted citation sources remain unknown.", action: authority.length ? "Prioritize safe, high-value citations, partnerships, resource mentions, and approval-based outreach." : "Compare competitor referring domains and generate safe authority opportunities; exclude paid ranking links and spam patterns.", impact: "Builds discoverability and trust without unsafe automated link schemes.", score: authority.length ? 78 : 66, confidence: authority.length ? 86 : 65, evidence: authority.slice(0, 5).map((item) => item.description), competitors });
  const schemaIssues = issues.filter((item) => /schema|entity|organization|author|trust|eeat/i.test(`${item.category} ${item.message}`));
  if (schemaIssues.length || !project.businessProfile?.businessSummary) result.push({ category: "entity", title: schemaIssues.length ? "Entity and trust signals need clarification" : "Business entity context is incomplete", explanation: "Search engines and AI systems need consistent relationships between the brand, services, people, locations, and proof.", action: "Open each affected page below, then strengthen organization, service, location, author, breadcrumb, article, and proof relationships using accurate copy, internal links, and valid schema.", impact: "Improves entity understanding, trust, and eligibility for rich and AI-generated answers.", score: schemaIssues.length ? 80 : 70, confidence: schemaIssues.length ? 88 : 82, evidence: uniqueStrings(schemaIssues.map((item) => `${item.page?.url ?? "Site-wide"} — ${findingDetailLabel(item.issueType)}: ${item.message}`), 50).concat(project.businessProfile?.businessSummary ? [] : ["Site-wide — Business summary is missing"]), competitors });
  const citationRecommendation = aiCitationRecommendation(citationGaps, approvedKeywords);
  if (citationRecommendation) result.push(citationRecommendation);
  if (technical.length) result.push({ category: "technical", title: `${technicalImplementationAreas.size} technical implementation area${technicalImplementationAreas.size === 1 ? "" : "s"} need attention`, explanation: `${technical.length} crawl check${technical.length === 1 ? " was" : "s were"} consolidated into ${technicalImplementationAreas.size} implementation area${technicalImplementationAreas.size === 1 ? "" : "s"}. Repeated page evidence that shares one domain, redirect, or hosting fix is shown once.`, action: "Open the consolidated implementation areas, fix each page-level or domain-wide cause once, and verify the result with a recrawl.", impact: "Improves crawlability, indexability, site health, and the reliability of downstream SEO work without creating duplicate tasks.", score: Math.min(98, 76 + [...technicalImplementationAreas.values()].filter((area) => area.some((item) => /critical|high/i.test(item.severity))).length * 3), confidence: 96, evidence: technicalEvidence.slice(0, 8), competitors: [] });
  if (markets.length && (!localProfile || localProfile.gbpStatus !== "claimed" || localProfile.citationStatus !== "complete")) result.push({ category: "local", title: "Local market coverage is incomplete", explanation: `The project targets ${markets.join(", ")}, but its Google Business Profile, citation, review, or market-specific readiness is incomplete.`, action: "Confirm GBP ownership, business identity, service areas, citations, reviews, and market-specific pages for each relevant target market.", impact: "Improves local relevance and visibility while keeping Business Location separate from Target Markets.", score: project.projectType === "local_seo" ? 90 : 74, confidence: 92, evidence: [`Target markets: ${markets.join(", ")}`, `GBP: ${localProfile?.gbpStatus ?? "not configured"}`, `Citations: ${localProfile?.citationStatus ?? "not configured"}`], competitors });
  if (structurePages.length) result.push({ category: "site_structure", title: `${structurePages.length} pages have site-structure or internal-link gaps`, explanation: "Orphan pages, weak anchors, broken internal links, or zero-inlink pages prevent users and authority from reaching priority content efficiently.", action: "Repair broken targets, assign owning pages, and create contextual internal links from relevant authority pages to priority conversion and topic pages.", impact: "Improves discovery, link equity, navigation, and keyword-to-page clarity.", score: Math.min(94, 75 + structurePages.length), confidence: 95, evidence: structurePages.slice(0, 8).map((page) => page.url), competitors: [] });
  if (!result.length) result.push({ category: "validation", title: "No material evidence-backed gaps detected", explanation: "Available project, competitor, keyword, and site evidence did not produce a high-confidence actionable gap.", action: "Keep the project evidence current and rerun after new keyword, competitor, crawl, authority, or AI visibility data is available.", impact: "Avoids creating unnecessary or duplicate recommendations.", score: 30, confidence: 80, evidence: [`${competitiveRuns.length} competitive runs`, `${approvedKeywords.length} approved keywords`, `${crawl?.pagesCrawled ?? 0} crawled pages`], competitors });
  return result.sort((left, right) => right.score - left.score || right.confidence - left.confidence);
}

gapAnalysisRouter.post(gapRoutes("/run"), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "run_ai_analysis")) throw new Error("insufficient permission to run analysis");
  const evidence = await gapEvidence(req.params.projectId);
  const completedKeywordRuns = await prisma.keywordResearchRun.findMany({ where: { projectId: evidence.project.id }, select: { seedKeyword: true, status: true, locationName: true, languageCode: true, device: true, createdAt: true } });
  const approvedKeywords = approvedKeywordEntries(evidence.project.keywordGroups);
  const missingKeywordResearch = missingApprovedKeywordResearch(evidence.project.keywordGroups, completedKeywordRuns, projectAnalysisLocationLabels(evidence.project.targetLocations, evidence.project.businessLocationJson));
  if (!approvedKeywords.length || missingKeywordResearch.length) {
    const error = new Error(!approvedKeywords.length
      ? "Approve Primary or Secondary keywords and complete Keyword Analysis before running SEO & Gap Analysis."
      : `Complete Keyword Analysis for all approved Primary and Secondary keywords before running SEO & Gap Analysis. ${missingKeywordResearch.length} still need analysis: ${missingKeywordResearch.slice(0, 8).join(", ")}${missingKeywordResearch.length > 8 ? "…" : ""}`);
    error.name = "workflow_incomplete";
    throw error;
  }
  const recommendations = buildGapRecommendations(evidence);
  const highImpact = recommendations.filter((item) => item.score >= 78);
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.gapAnalysisRun.create({ data: {
      projectId: evidence.project.id, clientId: evidence.project.clientId, createdByUserId: context.membership.userId, status: "completed", completedAt: new Date(),
      evidenceJson: { approvedKeywordGroups: evidence.project.keywordGroups.filter((item) => item.status === "approved").length, competitors: jsonStringList(evidence.project.competitors).length, crawlId: evidence.crawl?.id ?? null, competitiveRuns: evidence.competitiveRuns.length, citationGaps: evidence.citationGaps.length, connectedCoverageRunId: evidence.capabilityRun?.id ?? null, connectedCoverageGaps: evidence.capabilityRun?.results.length ?? 0 },
      summaryJson: { total: recommendations.length, highImpact: highImpact.length, categories: recommendations.map((item) => item.category) },
    } });
    const saved = [];
    for (const item of recommendations) {
      const dedupeKey = `gap:${evidence.project.id}:${item.category}`;
      saved.push(await tx.gapRecommendation.upsert({ where: { dedupeKey }, create: {
        runId: run.id, projectId: evidence.project.id, category: item.category, title: item.title, explanation: item.explanation, recommendedAction: item.action, expectedImpact: item.impact,
        evidenceJson: item.evidence, competitorEvidence: item.competitors ?? [], priority: gapPriority(item.score), impactScore: item.score, confidenceScore: item.confidence, dedupeKey,
      }, update: {
        runId: run.id, title: item.title, explanation: item.explanation, recommendedAction: item.action, expectedImpact: item.impact, evidenceJson: item.evidence,
        competitorEvidence: item.competitors ?? [], priority: gapPriority(item.score), impactScore: item.score, confidenceScore: item.confidence,
      } }));
    }
    await tx.aiRun.create({ data: { projectId: evidence.project.id, clientId: evidence.project.clientId, moduleName: "gap_analysis", promptVersion: "dev-011a-evidence-v1", inputSnapshotJson: run.evidenceJson, outputJson: { runId: run.id, recommendations: saved.map((item) => ({ id: item.id, category: item.category, priority: item.priority, impactScore: item.impactScore })) }, outputText: `${saved.length} explainable gap recommendations generated.`, status: "completed" } });
    await recordWorkspaceActivity(tx, { context, action: "gap_analysis.completed", entityType: "gap_analysis_run", entityId: run.id, agencyClientId: evidence.project.agencyClientId, projectId: evidence.project.id, nextJson: { recommendationCount: saved.length, highImpactCount: highImpact.length, categories: saved.map((item) => item.category) } });
    const recipients = [...new Set([context.membership.userId, context.workspace.ownerUserId])];
    for (const userId of recipients) await createWorkspaceNotification(tx, { context, userId, type: "gap_analysis_completed", title: "Gap Analysis completed", body: `${evidence.project.name}: ${saved.length} gaps analyzed across ${saved.length} applicable categories.`, actionUrl: `/gap-analysis?projectId=${evidence.project.id}`, agencyClientId: evidence.project.agencyClientId, projectId: evidence.project.id, emailEligible: false });
    if (highImpact.length) for (const userId of recipients) await createWorkspaceNotification(tx, { context, userId, type: "high_impact_gaps_detected", title: "High-impact gaps detected", body: `${evidence.project.name} has ${highImpact.length} high-impact gap${highImpact.length === 1 ? "" : "s"} ready for review.`, actionUrl: `/gap-analysis?projectId=${evidence.project.id}`, agencyClientId: evidence.project.agencyClientId, projectId: evidence.project.id });
    const latestStrategy = evidence.project.strategyPlans[0];
    for (const userId of recipients) await createWorkspaceNotification(tx, {
      context,
      userId,
      type: latestStrategy ? "strategy_evidence_changed" : "strategy_evidence_ready",
      title: latestStrategy ? "Update Strategy with new SEO evidence" : "SEO evidence is ready for Strategy",
      body: latestStrategy
        ? `${evidence.project.name}'s latest Gap Analysis is newer than Strategy v${latestStrategy.version}. Review the findings, then update and approve Strategy before continuing with the Execution Plan.`
        : `${evidence.project.name}'s SEO and Gap Analysis evidence is ready. Review the findings, then create and approve Strategy before continuing with the Execution Plan.`,
      actionUrl: `/strategy?projectId=${evidence.project.id}`,
      agencyClientId: evidence.project.agencyClientId,
      projectId: evidence.project.id,
      emailEligible: false,
    });
    return { run, recommendations: saved };
  });
  const workflow = await publishProjectWorkflowEvent({ projectId: evidence.project.id, eventType: "intelligence.gap_analysis_completed", sourceModule: "gap_analysis", sourceId: result.run.id, idempotencyKey: `gap-analysis.completed:${result.run.id}`, payload: { recommendationCount: result.recommendations.length, categories: result.recommendations.map((item) => item.category) } });
  return { ready: true, ...result, workflow };
}));

gapAnalysisRouter.get(gapRoutes("/recommendations/:recommendationId/findings"), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  const recommendation = await prisma.gapRecommendation.findFirst({ where: { id: req.params.recommendationId, projectId: req.params.projectId } });
  if (!recommendation) throw new Error("recommendation not found");
  const findings = await recommendationFindings(recommendation.projectId, recommendation.category);
  const existing = findings.length ? await prisma.seoFixQueueItem.findMany({
    where: { projectId: recommendation.projectId, sourceAnalysisId: { in: [...new Set(findings.map((finding) => finding.sourceAnalysisId))] } },
    select: { id: true, affectedUrl: true, issueType: true, plainEnglishReason: true, approvalStatus: true, executionTaskId: true, aiOutputId: true },
  }) : [];
  const websiteBuild = recommendation.category === "content" ? await prisma.websiteBuild.findFirst({ where: { projectId: recommendation.projectId }, orderBy: { updatedAt: "desc" }, select: { id: true } }) : null;
  const destination = recommendation.category === "content" && websiteBuild
    ? { key: "website_content", label: "Website Development Plan", route: "/site-architect?projectId=" + recommendation.projectId + "&step=content" }
    : recommendation.category === "content"
      ? { key: "seo_plan", label: "SEO Plan", route: "/seo-page-map?projectId=" + recommendation.projectId }
      : { key: "execution", label: "Execution Plan", route: `/guided-projects/${recommendation.projectId}?tab=execution#execution-tasks` };
  return {
    recommendation: { id: recommendation.id, category: recommendation.category, title: recommendation.title, status: recommendation.status },
    destination,
    findings: findings.map((finding) => {
      const staged = existing.find((item) => item.affectedUrl === finding.affectedUrl
        && item.issueType === finding.issueType
        && (recommendation.category !== "keyword_mapping" || item.plainEnglishReason === finding.evidence));
      return { ...finding, fixItemId: staged?.id ?? null, taskId: staged?.executionTaskId ?? null, generationId: staged?.aiOutputId ?? null, workflowStatus: staged?.approvalStatus ?? "not_staged" };
    }),
  };
}));

gapAnalysisRouter.post(gapRoutes("/recommendations/:recommendationId/findings/stage"), (req, res) => routeAction(res, async () => {
  const body = stageFindingsSchema.parse(req.body);
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "execute_tasks")) throw new Error("insufficient permission to save governed planning work");
  const recommendation = await prisma.gapRecommendation.findFirst({ where: { id: req.params.recommendationId, projectId: req.params.projectId }, include: { project: true } });
  if (!recommendation) throw new Error("recommendation not found");
  if (recommendation.status !== "approved") throw new Error("Approve this recommendation before sending its page findings to execution.");
  if (!["content", "site_structure", "technical", "keyword_mapping"].includes(recommendation.category)) throw new Error("This recommendation does not contain page-level execution work.");
  const available = await recommendationFindings(recommendation.projectId, recommendation.category);
  const selectedKeys = new Set(body.findingKeys);
  const selected = available.filter((finding) => selectedKeys.has(finding.key));
  if (!selected.length || selected.length !== selectedKeys.size) throw new Error("One or more selected findings are no longer available. Refresh the findings and try again.");
  const websiteBuild = recommendation.category === "content" ? await prisma.websiteBuild.findFirst({
    where: { projectId: recommendation.projectId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, settingsJson: true, pages: { where: { status: { not: "deferred" } }, select: { id: true, slug: true, targetUrl: true, remoteUrl: true, briefJson: true, status: true } } },
  }) : null;
  const normalizedTarget = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try { return new URL(raw, "https://senuke.local").pathname.replace(/\/+$/, "").toLowerCase() || "/"; }
    catch { return raw.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "").toLowerCase() || "/"; }
  };
  const websitePageBriefState = new Map((websiteBuild?.pages ?? []).map((page) => [page.id, jsonRecord(page.briefJson)]));
  const synchronizedWebsitePageIds = new Set<string>();
  const staged = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const finding of selected) {
      let item = await tx.seoFixQueueItem.findFirst({ where: {
        projectId: recommendation.projectId,
        sourceAnalysisId: finding.sourceAnalysisId,
        affectedUrl: finding.affectedUrl,
        issueType: finding.issueType,
        ...(recommendation.category === "keyword_mapping" ? { plainEnglishReason: finding.evidence } : {}),
      } });
      if (!item) item = await tx.seoFixQueueItem.create({ data: {
        projectId: recommendation.projectId,
        clientId: recommendation.project.clientId,
        websiteId: recommendation.project.websiteId,
        sourceAnalysisId: finding.sourceAnalysisId,
        affectedUrl: finding.affectedUrl,
        issueType: finding.issueType,
        severity: finding.severity,
        riskLevel: recommendation.category === "content" ? "review_needed" : "manual_review",
        automationLevel: recommendation.category === "content" ? "prepare" : "manual_guided",
        recommendedFix: finding.recommendedFix,
        plainEnglishReason: finding.evidence,
        expectedImpact: finding.expectedImpact,
        approvalStatus: "approved_for_work",
        creditCostEstimate: creditForSeverity(finding.severity),
      } });
      if (item.executionTaskId) {
        const existingTask = await tx.executionTask.findUnique({ where: { id: item.executionTaskId } });
        if (existingTask) { results.push({ item, task: existingTask, existing: true }); continue; }
      }
      const isContent = recommendation.category === "content";
      const isTechnical = recommendation.category === "technical";
      const isKeywordMapping = recommendation.category === "keyword_mapping";
      const findingTarget = normalizedTarget(finding.affectedUrl);
      const mappedWebsitePage = isContent ? websiteBuild?.pages.find((page) => {
        const pageTargets = [page.targetUrl, page.remoteUrl, page.slug ? `/${page.slug}` : "/"].map(normalizedTarget).filter(Boolean);
        return pageTargets.includes(findingTarget);
      }) ?? null : null;
      const task = await upsertExecutionTask(tx, {
        clientId: recommendation.project.clientId,
        websiteId: recommendation.project.websiteId,
        projectId: recommendation.projectId,
        dedupeKey: `publishing:seo-finding:${item.id}`,
        moduleName: isContent ? "content" : isKeywordMapping ? "keyword_research" : "site_analysis",
        sourceType: "seo_fix_queue_item",
        sourceId: item.id,
        title: isContent ? `Update page content: ${finding.affectedUrl}` : isTechnical ? `Implement technical SEO update: ${finding.affectedUrl}` : isKeywordMapping ? `Resolve keyword-to-page mapping: ${finding.affectedUrl}` : `Implement site-structure update: ${finding.affectedUrl}`,
        description: `${finding.evidence}\n\nRecommended update: ${finding.recommendedFix}`,
        priority: finding.severity === "high" ? "high" : finding.severity === "low" ? "low" : "medium",
        automationLevel: isContent ? "prepare" : "manual_guided",
        requiresApproval: true,
        manualRequired: !isContent,
        safetyCategory: "review_needed",
        actionButtonLabel: isContent ? (websiteBuild ? "Open in Website Development Plan" : "Review in SEO Plan") : "Review Implementation Package",
        relatedUrl: isContent ? (websiteBuild ? "/site-architect?projectId=" + recommendation.projectId + "&step=content" : "/seo-page-map?projectId=" + recommendation.projectId) : "/ai-content?projectId=" + recommendation.projectId + "#publishing",
        manualInstructions: `${finding.recommendedFix}\n\nUse the exact affected page: ${finding.affectedUrl}. Keep the current version available until the approved update is published and verified.`,
        impact: finding.expectedImpact,
        approvalSnapshotJson: {
          publishingWorkflow: { enabled: true, sourceModule: "seo", sourceCategory: recommendation.category, sourceRecommendationId: recommendation.id, sourceFindingKey: finding.key, affectedUrl: finding.affectedUrl, stage: "draft_needed" },
          currentEvidence: { issueType: finding.issueType, severity: finding.severity, evidence: finding.evidence },
          targetUrl: finding.affectedUrl,
        },
      });
      const relatedUrl = isContent
        ? mappedWebsitePage
          ? `/site-architect?projectId=${recommendation.projectId}&step=content&pageId=${mappedWebsitePage.id}`
          : websiteBuild ? "/site-architect?projectId=" + recommendation.projectId + "&step=content" : "/seo-page-map?projectId=" + recommendation.projectId
        : `/guided-projects/${recommendation.projectId}?tab=execution&actionTask=${task.id}#execution-tasks`;
      const updatedTask = await tx.executionTask.update({ where: { id: task.id }, data: { relatedUrl } });
      item = await tx.seoFixQueueItem.update({ where: { id: item.id }, data: { executionTaskId: task.id, approvalStatus: "approved_for_work" } });
      if (mappedWebsitePage) {
        const brief = websitePageBriefState.get(mappedWebsitePage.id) ?? jsonRecord(mappedWebsitePage.briefJson);
        const seoPlan = jsonRecord(brief.seoPlan);
        const currentRequirements = Array.isArray(seoPlan.gapRequirements) ? seoPlan.gapRequirements.map(jsonRecord) : [];
        const gapRequirement = {
          recommendationId: recommendation.id,
          gapAnalysisRunId: recommendation.runId,
          findingKey: finding.key,
          executionTaskId: task.id,
          affectedUrl: finding.affectedUrl,
          issueType: finding.issueType,
          severity: finding.severity,
          evidence: finding.evidence,
          recommendedFix: finding.recommendedFix,
          whyItMatters: finding.whyItMatters,
          expectedImpact: finding.expectedImpact,
          details: finding.details ?? [],
          approvedAt: new Date().toISOString(),
        };
        const gapRequirements = [...currentRequirements.filter((requirement) => String(requirement.findingKey ?? "") !== finding.key), gapRequirement];
        const executionTaskIds = [...new Set([
          ...jsonStringList(seoPlan.executionTaskIds),
          String(seoPlan.executionTaskId ?? "").trim(),
          ...gapRequirements.map((requirement) => String(requirement.executionTaskId ?? "").trim()),
        ].filter(Boolean))];
        const nextBrief = {
          ...brief,
          seoPlan: { ...seoPlan, gapRequirements, executionTaskIds },
          executionTrace: { ...jsonRecord(brief.executionTrace), executionTaskIds, status: "ready" },
        };
        websitePageBriefState.set(mappedWebsitePage.id, nextBrief);
        synchronizedWebsitePageIds.add(mappedWebsitePage.id);
        await tx.websiteBuildPage.update({
          where: { id: mappedWebsitePage.id },
          data: {
            briefJson: nextBrief as Prisma.InputJsonValue,
            ...(["approved", "deployed", "published"].includes(mappedWebsitePage.status) ? { status: "review", approvedAt: null } : {}),
          },
        });
      }
      await tx.seoFixApproval.create({ data: { projectId: recommendation.projectId, fixItemId: item.id, userId: context.membership.userId, action: "approved", snapshotJson: { recommendationId: recommendation.id, finding } } });
      results.push({ item, task: updatedTask, existing: false });
    }
    if (websiteBuild && synchronizedWebsitePageIds.size) {
      const changedAt = new Date().toISOString();
      await tx.websiteBuild.update({
        where: { id: websiteBuild.id },
        data: {
          status: "content",
          settingsJson: {
            ...jsonRecord(websiteBuild.settingsJson),
            currentValidationResultId: null,
            currentApprovedReleaseId: null,
            pendingWebsiteChange: {
              category: "page_content",
              section: "content",
              summary: `${synchronizedWebsitePageIds.size} page${synchronizedWebsitePageIds.size === 1 ? "" : "s"} received approved Gap Analysis requirements.`,
              pageIds: [...synchronizedWebsitePageIds],
              sourceRecommendationId: recommendation.id,
              changedAt,
              changedByUserId: context.membership.userId,
            },
          } as Prisma.InputJsonValue,
        },
      });
    }
    await recordWorkspaceActivity(tx, { context, action: "seo_findings.added_to_planning", entityType: "gap_recommendation", entityId: recommendation.id, agencyClientId: recommendation.project.agencyClientId, projectId: recommendation.projectId, nextJson: { destination: recommendation.category === "content" ? (websiteBuild ? "website_development" : "seo_plan") : "execution_plan", category: recommendation.category, findingKeys: [...selectedKeys], taskIds: results.map((result) => result.task.id) } });
    return results;
  }, { timeout: 120_000, maxWait: 10_000 });
  return recommendation.category === "content" && websiteBuild
    ? { staged, destinationUrl: "/site-architect?projectId=" + recommendation.projectId + "&step=content", destination: "website_content" }
    : recommendation.category === "content"
      ? { staged, destinationUrl: "/seo-page-map?projectId=" + recommendation.projectId, destination: "seo_plan" }
      : { staged, destinationUrl: `/guided-projects/${recommendation.projectId}?tab=execution#execution-tasks`, destination: "execution" };
}));

gapAnalysisRouter.post(gapRoutes("/recommendations/:recommendationId/approve"), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "approve")) throw new Error("insufficient permission to approve recommendations");
  const recommendation = await prisma.gapRecommendation.findFirst({ where: { id: req.params.recommendationId, projectId: req.params.projectId }, include: { project: true } });
  if (!recommendation) throw new Error("recommendation not found");
  const currentCitationRecommendation = recommendation.category === "ai_citation" ? aiCitationRecommendation(await prisma.aiCitationGap.findMany({
    where: { projectId: recommendation.projectId, status: { not: "superseded" } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { query: true, gapSummary: true, competitorUrl: true, citedPageUrl: true, isInference: true },
  }), []) : null;
  const recommendationContent = currentCitationRecommendation ? {
    title: currentCitationRecommendation.title,
    explanation: currentCitationRecommendation.explanation,
    recommendedAction: currentCitationRecommendation.action,
    expectedImpact: currentCitationRecommendation.impact,
  } : {
    title: recommendation.title,
    explanation: recommendation.explanation,
    recommendedAction: recommendation.recommendedAction,
    expectedImpact: recommendation.expectedImpact,
  };
  if (recommendation.status === "approved") {
    const updatedRecommendation = currentCitationRecommendation ? await prisma.gapRecommendation.update({ where: { id: recommendation.id }, data: {
      title: currentCitationRecommendation.title, explanation: currentCitationRecommendation.explanation, recommendedAction: currentCitationRecommendation.action,
      expectedImpact: currentCitationRecommendation.impact, evidenceJson: currentCitationRecommendation.evidence, competitorEvidence: currentCitationRecommendation.competitors ?? [],
      impactScore: currentCitationRecommendation.score, confidenceScore: currentCitationRecommendation.confidence, priority: gapPriority(currentCitationRecommendation.score),
    } }) : recommendation;
    return { recommendation: updatedRecommendation, task: null, duplicate: true };
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.gapRecommendation.update({ where: { id: recommendation.id }, data: {
      status: "approved", executionTaskId: null, approvedByUserId: context.membership.userId, approvedAt: new Date(), ignoredAt: null,
      ...(currentCitationRecommendation ? {
        title: currentCitationRecommendation.title, explanation: currentCitationRecommendation.explanation, recommendedAction: currentCitationRecommendation.action,
        expectedImpact: currentCitationRecommendation.impact, evidenceJson: currentCitationRecommendation.evidence, competitorEvidence: currentCitationRecommendation.competitors ?? [],
        impactScore: currentCitationRecommendation.score, confidenceScore: currentCitationRecommendation.confidence, priority: gapPriority(currentCitationRecommendation.score),
      } : {}),
    } });
    const strategy = await tx.strategyPlan.findFirst({ where: { projectId: recommendation.projectId }, orderBy: { version: "desc" } });
    if (strategy?.status === "draft") {
      const current = Array.isArray(strategy.prioritizedRecommendations) ? strategy.prioritizedRecommendations : [];
      const retained = current.filter((item) => !(item && typeof item === "object" && "gapRecommendationId" in item && (item as { gapRecommendationId?: unknown }).gapRecommendationId === recommendation.id));
      await tx.strategyPlan.update({ where: { id: strategy.id }, data: { prioritizedRecommendations: [...retained, { gapRecommendationId: recommendation.id, category: recommendation.category, title: recommendationContent.title, why: recommendationContent.explanation, action: recommendationContent.recommendedAction, expectedImpact: recommendationContent.expectedImpact, priority: currentCitationRecommendation ? gapPriority(currentCitationRecommendation.score) : recommendation.priority }] as Prisma.InputJsonValue } });
    }
    await recordWorkspaceActivity(tx, { context, action: "gap_recommendation.approved", entityType: "gap_recommendation", entityId: recommendation.id, agencyClientId: recommendation.project.agencyClientId, projectId: recommendation.projectId, previousJson: { status: recommendation.status }, nextJson: { status: "approved", executionTaskId: null, strategyUpdated: strategy?.status === "draft" } });
    return { recommendation: updated, task: null, strategyUpdated: strategy?.status === "draft", nextBestActionEligible: true };
  });
}));

gapAnalysisRouter.post(gapRoutes("/recommendations/:recommendationId/ignore"), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "run_ai_analysis")) throw new Error("insufficient permission to update recommendations");
  const recommendation = await prisma.gapRecommendation.findFirst({ where: { id: req.params.recommendationId, projectId: req.params.projectId }, include: { project: { select: { agencyClientId: true } } } });
  if (!recommendation) throw new Error("recommendation not found");
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.gapRecommendation.update({ where: { id: recommendation.id }, data: { status: "ignored", ignoredAt: new Date() } });
    await recordWorkspaceActivity(tx, { context, action: "gap_recommendation.ignored", entityType: "gap_recommendation", entityId: recommendation.id, agencyClientId: recommendation.project.agencyClientId, projectId: recommendation.projectId, previousJson: { status: recommendation.status }, nextJson: { status: "ignored" } });
    return row;
  });
  return { recommendation: updated };
}));

gapAnalysisRouter.get(gapRoutes(), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  const project = await scopedProject(req, req.params.projectId);
  const clientViewerOnly = context.roles.size === 1 && context.roles.has("client_viewer");
  const [fixes, legacyLocalProfile, canonicalLocalProfile, aiQueries, authority, reports, wp, demo, adSuggestions, ecommerceGuides, citationGaps, tasks, latestCompletedCrawl, latestGapRun, latestCapabilityRun] = await Promise.all([
    prisma.seoFixQueueItem.findMany({ where: { projectId: project.id }, orderBy: [{ approvalStatus: "asc" }, { createdAt: "desc" }], take: 50 }),
    findLegacyLocalProfile(project.id),
    findCanonicalLocalProfile(project),
    prisma.aiVisibilityQuery.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 20, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } }),
    prisma.authorityOpportunity.findMany({ where: { projectId: project.id }, orderBy: [{ riskLabel: "asc" }, { createdAt: "desc" }], take: 20 }),
    prisma.gapReportExport.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.wordPressIntegration.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.demoProject.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.adLandingSuggestion.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.ecommerceExportGuide.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.aiCitationGap.findMany({ where: { projectId: project.id, status: { not: "superseded" } }, orderBy: { createdAt: "desc" }, take: 30, select: { query: true, gapSummary: true, competitorUrl: true, citedPageUrl: true, isInference: true } }),
    prisma.executionTask.findMany({ where: { projectId: project.id, OR: [{ moduleName: { in: ["gap_analysis", "local_seo"] } }, { sourceType: "local_seo_plan_action" }] }, orderBy: { createdAt: "desc" }, take: 50 }),
    project.websiteId ? prisma.crawlJob.findFirst({ where: { websiteId: project.websiteId, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], select: { id: true, pagesCrawled: true, siteScore: true, completedAt: true, createdAt: true, issues: { where: { status: "open" }, take: 500, select: { category: true, issueType: true, severity: true, message: true, page: { select: { url: true } } } } } }) : Promise.resolve(null),
    prisma.gapAnalysisRun.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, include: { recommendations: { where: clientViewerOnly ? { status: "approved" } : {}, orderBy: [{ impactScore: "desc" }, { confidenceScore: "desc" }] } } }),
    prisma.dev053VerificationRun.findFirst({ where: { projectId: project.id, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], include: { results: { where: { capabilityId: { startsWith: "SEO-" }, status: { in: ["BLOCKED", "MISSING", "PARTIAL"] }, NOT: { OR: [{ workflowDestination: { startsWith: "/gap-analysis" } }, { workflowDestination: { startsWith: "/reports" } }] } } } } }),
  ]);
  const localProfile = mergedLocalProfile(legacyLocalProfile, canonicalLocalProfile);
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
  const currentCitationRecommendation = aiCitationRecommendation(citationGaps, []);
  const currentTechnicalIssues = (latestCompletedCrawl?.issues ?? []).filter(technicalIssueMatches);
  const currentTechnicalAreas = new Map<string, typeof currentTechnicalIssues>();
  for (const issue of currentTechnicalIssues) {
    const key = issue.issueType === "url_aliases_not_redirected" && !issue.page?.url
      ? "site:url_aliases_not_redirected"
      : issue.page?.url
        ? `page:${canonicalFindingUrl(issue.page.url)}`
        : `site:${issue.issueType}`;
    const area = currentTechnicalAreas.get(key) ?? [];
    area.push(issue);
    currentTechnicalAreas.set(key, area);
  }
  const currentTechnicalEvidence = [...currentTechnicalAreas.entries()].map(([key, area]) => key === "site:url_aliases_not_redirected"
    ? `Domain-wide hostname redirect — ${area.length} repeated alias checks share one hosting or server fix.`
    : `${area[0]?.page?.url ?? "Site-wide"} — ${area.length} technical check${area.length === 1 ? "" : "s"}: ${uniqueStrings(area.map((item) => findingDetailLabel(item.issueType)), 8).join(", ")}.`);
  const currentEntityIssues = (latestCompletedCrawl?.issues ?? []).filter((item) => /schema|entity|organization|author|trust|eeat/i.test(`${item.category} ${item.issueType} ${item.message}`));
  const currentCapabilityResults = latestCapabilityRun?.results ?? [];
  const currentCapabilityActionCount = new Set(currentCapabilityResults.map((item) => `${item.status}:${item.workflowDestination}:${item.message}`)).size;
  const latestCompletedCrawlSummary = latestCompletedCrawl ? {
    id: latestCompletedCrawl.id,
    pagesCrawled: latestCompletedCrawl.pagesCrawled,
    siteScore: latestCompletedCrawl.siteScore,
    completedAt: latestCompletedCrawl.completedAt,
    createdAt: latestCompletedCrawl.createdAt,
  } : null;
  const recommendations = (latestGapRun?.recommendations ?? []).map((recommendation) => {
    if (recommendation.category === "connected_coverage" && currentCapabilityResults.length) return {
      ...recommendation,
      title: `${currentCapabilityActionCount} connected SEO and growth action areas need attention`,
      explanation: `${currentCapabilityResults.length} unresolved capability checks consolidate into ${currentCapabilityActionCount} distinct actions because several checks share the same prerequisite or workflow destination. Open the findings to see every grouped action and resolve it in the owning workspace.`,
    };
    if (recommendation.category === "ai_citation" && currentCitationRecommendation) return {
      ...recommendation,
      title: currentCitationRecommendation.title,
      explanation: currentCitationRecommendation.explanation,
      recommendedAction: currentCitationRecommendation.action,
      expectedImpact: currentCitationRecommendation.impact,
      evidenceJson: currentCitationRecommendation.evidence,
      competitorEvidence: currentCitationRecommendation.competitors ?? [],
      impactScore: currentCitationRecommendation.score,
      confidenceScore: currentCitationRecommendation.confidence,
      priority: gapPriority(currentCitationRecommendation.score),
    };
    if (recommendation.category === "technical" && currentTechnicalIssues.length) return {
      ...recommendation,
      title: `${currentTechnicalAreas.size} technical implementation area${currentTechnicalAreas.size === 1 ? "" : "s"} need attention`,
      recommendedAction: "Open the exact affected-page list, select the critical and high-impact fixes, and verify each completed change with a recrawl.",
      evidenceJson: currentTechnicalEvidence.slice(0, 8),
      competitorEvidence: [],
    };
    if (recommendation.category === "entity" && currentEntityIssues.length) return {
      ...recommendation,
      title: "Entity and trust signals need clarification",
      recommendedAction: "Open each affected page below, then strengthen organization, service, location, author, breadcrumb, article, and proof relationships using accurate copy, internal links, and valid schema.",
      evidenceJson: uniqueStrings(currentEntityIssues.map((item) => `${item.page?.url ?? "Site-wide"} — ${findingDetailLabel(item.issueType)}: ${item.message}`), 50),
      competitorEvidence: [],
    };
    return recommendation;
  });
  const latestStrategy = project.strategyPlans[0] ?? null;
  const latestApprovedGapAt = (latestGapRun?.recommendations ?? []).reduce<Date | null>((latest, recommendation) => {
    if (!recommendation.approvedAt) return latest;
    return !latest || recommendation.approvedAt > latest ? recommendation.approvedAt : latest;
  }, null);
  const strategyWorkflow = resolveStrategyEvidenceWorkflow({
    latestStrategy,
    latestCrawlAt: latestCompletedCrawl?.completedAt ?? latestCompletedCrawl?.createdAt,
    latestGapAnalysisAt: latestGapRun?.status === "completed" ? latestGapRun.completedAt ?? latestGapRun.createdAt : null,
    latestApprovedGapAt,
    hasExecutionPlan: project.executionPlans.length > 0,
  });
  return { project, readiness, strategyWorkflow, latestCompletedCrawl: latestCompletedCrawlSummary, latestGapRun, recommendations, capabilities: { canRun: hasWorkspacePermission(context, "run_ai_analysis"), canApprove: hasWorkspacePermission(context, "approve"), canExportReports: hasWorkspacePermission(context, "export_reports"), readOnly: !hasWorkspacePermission(context, "run_ai_analysis"), clientViewer: clientViewerOnly }, fixes: clientViewerOnly ? fixes.filter((item) => item.approvalStatus === "approved") : fixes, localProfile: clientViewerOnly ? null : localProfile, aiQueries: clientViewerOnly ? [] : aiQueries, authority: clientViewerOnly ? [] : authority, reports, wordpressIntegrations: clientViewerOnly ? [] : wp, demoProjects: clientViewerOnly ? [] : demo, adSuggestions: clientViewerOnly ? [] : adSuggestions, ecommerceGuides: clientViewerOnly ? [] : ecommerceGuides, tasks: clientViewerOnly ? [] : tasks };
}));

gapAnalysisRouter.post(gapRoutes("/launch-strategy/generate"), (req, res) => routeAction(res, async () => {
  const project = await scopedProject(req, req.params.projectId);
  const completedKeywordRuns = await prisma.keywordResearchRun.findMany({ where: { projectId: project.id }, select: { seedKeyword: true, status: true, locationName: true, languageCode: true, device: true, createdAt: true } });
  const approvedKeywords = approvedKeywordEntries(project.keywordGroups);
  const missingKeywordResearch = missingApprovedKeywordResearch(project.keywordGroups, completedKeywordRuns, projectAnalysisLocationLabels(project.targetLocations, project.businessLocationJson));
  if (!approvedKeywords.length || missingKeywordResearch.length) {
    const error = new Error(!approvedKeywords.length
      ? "Approve Primary or Secondary keywords and complete Keyword Analysis before generating a launch Strategy."
      : `Complete Keyword Analysis for all approved Primary and Secondary keywords before generating a launch Strategy. ${missingKeywordResearch.length} still need analysis.`);
    error.name = "workflow_incomplete";
    throw error;
  }
  const existingLocalProfile = await prisma.gapLocalSeoProfile.findUnique({ where: { projectId: project.id } });
  const businessName = firstUseful(project.businessName, existingLocalProfile?.businessName, project.name);
  const niche = firstUseful(project.niche, existingLocalProfile?.businessType, project.businessProfile?.businessSummary, "the target market");
  const projectTargetLocations = cleanGeographicTargetMarkets(jsonStringList(project.targetLocations));
  const targetLocation = firstUseful(projectTargetLocations.join(", "), project.targetLocation, existingLocalProfile?.addressOrServiceArea, "primary service area");
  const offer = firstUseful(project.businessProfile?.offerSummary, project.primaryGoal, `services for ${niche}`);
  const cities = uniqueList([
    ...projectTargetLocations,
    ...jsonStringList(existingLocalProfile?.citiesServed),
    ...targetLocation.split(/,|;|\band\b/gi),
  ], 6);
  const primaryService = approvedKeywords[0];
  const primaryCity = cities[0] || targetLocation;
  const keywordSeeds = approvedKeywords.slice(0, 12);
  const sitePages = uniqueList([
    "Home",
    ...keywordSeeds.map((keyword) => `SEO owner page: ${keyword}`),
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
          businessModel: project.strategyPlans[0]?.businessModel ?? "local_service",
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
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "run_ai_analysis")) throw new Error("insufficient permission to update Local SEO");
  const project = await scopedProject(req, req.params.projectId);
  const existingCanonical = await findCanonicalLocalProfile(project);
  let domain = project.website?.domain || "";
  if (!domain && project.websiteUrl) {
    try { domain = new URL(project.websiteUrl.startsWith("http") ? project.websiteUrl : `https://${project.websiteUrl}`).hostname; } catch { domain = ""; }
  }
  const saved = await prisma.$transaction(async (tx) => {
    let canonical = existingCanonical;
    if (domain) {
      const canonicalData = {
        clientId: project.clientId,
        projectId: project.id,
        websiteId: project.websiteId,
        businessName: body.businessName.trim(),
        domain,
        phone: body.primaryPhone.trim(),
        address: body.addressOrServiceArea.trim(),
        city: body.citiesServed[0],
        region: body.region?.trim() || null,
        country: body.country.trim(),
        postalCode: body.postalCode?.trim() || null,
        mainCategory: body.businessType.trim(),
        services: body.services,
        targetLocations: body.citiesServed,
        serviceAreas: body.serviceAreas.length ? body.serviceAreas : body.citiesServed,
        businessHours: body.businessHours as Prisma.InputJsonValue,
        locationName: body.businessName.trim(),
        locationType: body.addressOrServiceArea.toLowerCase().includes("service area") ? "service_area" : "physical",
        googleBusinessProfileUrl: body.googleBusinessProfileUrl || null,
      };
      canonical = existingCanonical
        ? await tx.localBusinessProfile.update({ where: { id: existingCanonical.id }, data: canonicalData }) as typeof existingCanonical
        : await tx.localBusinessProfile.create({ data: canonicalData, include: { keywords: true, scores: true, recommendations: true, citations: true, reviews: true } });
    }
    const legacyData = {
      clientId: project.clientId,
      businessName: body.businessName,
      businessType: body.businessType,
      primaryPhone: body.primaryPhone,
      addressOrServiceArea: body.addressOrServiceArea,
      citiesServed: body.citiesServed,
      services: body.services,
      gbpStatus: body.gbpStatus,
      reviewGoal: body.reviewGoal ?? null,
      citationStatus: body.citationStatus,
      canonicalBusinessId: canonical?.id ?? null,
      country: body.country,
      region: body.region ?? null,
      postalCode: body.postalCode ?? null,
      googleBusinessProfileUrl: body.googleBusinessProfileUrl || null,
      businessHours: body.businessHours as Prisma.InputJsonValue,
      serviceAreas: body.serviceAreas,
    };
    const legacy = await tx.gapLocalSeoProfile.upsert({ where: { projectId: project.id }, update: legacyData, create: { projectId: project.id, ...legacyData } });
    await recordWorkspaceActivity(tx, { context, action: "local_seo.profile_synchronized", entityType: "local_business_profile", entityId: canonical?.id ?? legacy.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { canonicalBusinessId: canonical?.id ?? null, businessName: body.businessName, locations: body.citiesServed, services: body.services, hasBusinessHours: Object.keys(body.businessHours).length > 0, gbpStatus: body.gbpStatus } });
    return { legacy, canonical };
  });
  return { ready: true, profile: mergedLocalProfile(await findLegacyLocalProfile(project.id), await findCanonicalLocalProfile(project)), synchronized: Boolean(saved.canonical) };
}));

gapAnalysisRouter.post(gapRoutes("/local-seo/generate-plan"), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "run_ai_analysis")) throw new Error("insufficient permission to generate Local SEO plans");
  const project = await scopedProject(req, req.params.projectId);
  const profile = await findLegacyLocalProfile(project.id);
  if (!profile) return { ready: false, missing: ["local_seo_profile"], nextAction: "Complete Local SEO setup fields." };
  const cities = Array.isArray(profile.citiesServed) ? profile.citiesServed.map(String) : [];
  const services = Array.isArray(profile.services) ? profile.services.map(String) : [];
  if (!profile.businessName || !cities.length || !services.length) return { ready: false, missing: ["business_name", "cities_served", "services"], nextAction: "Complete Local SEO setup fields." };
  return withUsage(req, project, "local_seo_launch_plan", "generate_plan", 1, async () => {
    const canonical = await findCanonicalLocalProfile(project);
    const auditRecommendations = canonical?.recommendations ?? [];
    const latestScore = canonical?.scores[0] ?? null;
    const planVersion = profile.planVersion + 1;
    const taskInputs = [
      { taskType: "local_keyword_intelligence", title: "Validate local keyword and location targets", description: `Review service, city, neighbourhood, near-me and commercial-intent targets for ${services.slice(0, 4).join(", ")} across ${cities.slice(0, 4).join(", ")}.`, reason: canonical?.keywords.length ? `${canonical.keywords.length} local keyword/location targets are currently tracked.` : "No canonical local keyword targets have been audited yet.", expectedImpact: "Creates defensible location-specific search targets before content or ranking work.", confidence: canonical?.keywords.length ? 90 : 72, effort: "low", priority: canonical?.keywords.length ? "medium" : "high" },
      { taskType: "service_area_pages", title: "Map local keyword opportunities and page coverage", description: `Map each approved service/location intent to an existing page first. Create a new page only when it serves a distinct audience need; do not create duplicate or low-value doorway pages for ${cities.slice(0, 4).join(", ")}.`, reason: auditRecommendations.find((item) => item.category === "organic" || item.category === "content")?.recommendation || "Local services and target markets require explicit page ownership and duplication checks.", expectedImpact: "Improves relevant local coverage without cannibalization or thin location pages.", confidence: latestScore ? 88 : 72, effort: "high", priority: "high" },
      { taskType: "gbp_checklist", title: "Review Google Business Profile readiness", description: "Review ownership, primary and secondary categories, services, hours, service areas, description, photos, Q&A, booking links and update cadence. Prepare changes for approval; never publish automatically.", reason: `Saved GBP state: ${profile.gbpStatus}. Owner-account connection: ${canonical?.googleBusinessConnectionStatus ?? "not connected"}.`, expectedImpact: "Improves profile completeness and alignment with verified business information.", confidence: 88, effort: "medium", priority: profile.gbpStatus === "claimed" ? "medium" : "high" },
      { taskType: "citations", title: "Correct priority citation and NAP inconsistencies", description: "Review major directories, verify name, address/service area, phone, website and category, then prepare a prioritized correction or submission list.", reason: canonical?.citations.length ? `${canonical.citations.length} citation sources have evidence; ${canonical.citations.filter((item) => item.status !== "consistent").length} require review.` : "No canonical citation scan has been completed.", expectedImpact: "Strengthens consistent local identity and directory discoverability.", confidence: canonical?.citations.length ? 92 : 68, effort: "medium", priority: profile.citationStatus === "complete" ? "low" : "high" },
      { taskType: "reviews", title: "Prepare review and reputation actions", description: "Identify recurring verified review strengths or complaints, prepare response guidance and approved review-request templates, and keep all public responses subject to approval.", reason: canonical?.reviews.length ? `${canonical.reviews.length} detailed reviews are available for theme analysis.` : "Only public rating aggregates may be available; detailed themes require connected or imported review evidence.", expectedImpact: "Improves reputation follow-up without fabricating review themes or customer claims.", confidence: canonical?.reviews.length ? 90 : 55, effort: "medium", priority: canonical?.reviews.length ? "medium" : "low" },
      { taskType: "local_content", title: "Create approved local FAQs and supporting content", description: `Prepare evidence-grounded local FAQs, GBP posts and supporting content for ${services.slice(0, 3).join(", ")} in ${cities.slice(0, 3).join(", ")}. Use verified business facts and local sources only.`, reason: "Local content should answer real location-specific buyer needs and support mapped service pages.", expectedImpact: "Improves local relevance, internal linking and answer visibility.", confidence: latestScore ? 84 : 70, effort: "medium", priority: "medium" },
      { taskType: "local_schema", title: "Generate and validate LocalBusiness schema", description: "Generate the appropriate LocalBusiness subtype from the verified profile, location, services, hours and URLs. Validate it before sending it to Website Development or the existing-site implementation workflow.", reason: "Structured business identity must match the canonical Local SEO profile and website evidence.", expectedImpact: "Improves consistent machine-readable business and location understanding.", confidence: profile.canonicalBusinessId ? 92 : 65, effort: "low", priority: "medium" },
      { taskType: "tracking", title: "Configure local performance measurement", description: "Track organic, Maps, local-pack and grid movement by approved keyword/location. Add GBP actions and location-level leads only after a permitted analytics or GBP connection exists.", reason: latestScore ? `Latest local visibility score: ${latestScore.totalScore}/100 (${latestScore.statusLabel}).` : "No completed canonical Local SEO audit score exists yet.", expectedImpact: "Feeds measured local performance into Growth Intelligence and Next Best Action.", confidence: latestScore ? 94 : 70, effort: "medium", priority: latestScore ? "medium" : "high" },
    ] as const;
    const result = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const item of taskInputs) {
        created.push(await tx.gapLocalSeoTask.create({ data: { projectId: project.id, profileId: profile.id, planVersion, taskType: item.taskType, title: item.title, description: item.description, reason: item.reason, expectedImpact: item.expectedImpact, confidence: item.confidence, effort: item.effort, priority: item.priority, status: "needs_review", actionRoute: localTaskRoute(project.id, item.taskType, profile.canonicalBusinessId) } }));
      }
      await tx.gapLocalSeoProfile.update({ where: { id: profile.id }, data: { planVersion, planStatus: "needs_review", planApprovedAt: null } });
      await recordWorkspaceActivity(tx, { context, action: "local_seo.growth_plan_generated", entityType: "local_growth_plan", entityId: profile.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { planVersion, actionCount: created.length, latestAuditScore: latestScore?.totalScore ?? null, canonicalBusinessId: canonical?.id ?? null } });
      await createWorkspaceNotification(tx, { context, userId: context.membership.userId, type: "local_growth_plan_ready", title: "Local Growth Plan ready for review", body: `${project.name}: ${created.length} evidence-led Local SEO actions are ready for approval.`, actionUrl: `/gap-analysis?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id, emailEligible: false });
      return created;
    });
    return { ready: true, planVersion, planStatus: "needs_review", tasks: result };
  });
}));

gapAnalysisRouter.post(gapRoutes("/local-seo/tasks/:taskId/approve"), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "approve")) throw new Error("insufficient permission to approve Local SEO actions");
  const project = await scopedProject(req, req.params.projectId);
  const task = await prisma.$transaction(async (tx) => {
    const row = await approveLocalPlanTask(tx, { context, project, taskId: req.params.taskId });
    const profile = await tx.gapLocalSeoProfile.findUnique({ where: { projectId: project.id } });
    if (profile) {
      const remaining = await tx.gapLocalSeoTask.count({ where: { profileId: profile.id, planVersion: profile.planVersion, status: "needs_review" } });
      await tx.gapLocalSeoProfile.update({ where: { id: profile.id }, data: { planStatus: remaining ? "partially_approved" : "approved", planApprovedAt: remaining ? null : new Date() } });
    }
    return row;
  });
  return { ready: true, task };
}));

gapAnalysisRouter.post(gapRoutes("/local-seo/tasks/:taskId/ignore"), (req, res) => routeAction(res, async () => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "run_ai_analysis")) throw new Error("insufficient permission to update Local SEO actions");
  const project = await scopedProject(req, req.params.projectId);
  const task = await prisma.gapLocalSeoTask.findFirst({ where: { id: req.params.taskId, projectId: project.id } });
  if (!task) throw new Error("local recommendation not found");
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.gapLocalSeoTask.update({ where: { id: task.id }, data: { status: "ignored" } });
    await recordWorkspaceActivity(tx, { context, action: "local_seo.plan_action_ignored", entityType: "local_seo_plan_action", entityId: task.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: task.status }, nextJson: { status: "ignored", planVersion: task.planVersion } });
    return row;
  });
  return { ready: true, task: updated };
}));

gapAnalysisRouter.post(gapRoutes("/local-seo/plan/approve"), (req, res) => routeAction(res, async () => {
  const body = localPlanApprovalSchema.parse(req.body ?? {});
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) throw new Error("project unavailable");
  if (!hasWorkspacePermission(context, "approve")) throw new Error("insufficient permission to approve the Local Growth Plan");
  const project = await scopedProject(req, req.params.projectId);
  const profile = await findLegacyLocalProfile(project.id);
  if (!profile || !profile.planVersion) return { ready: false, missing: ["local_growth_plan"], nextAction: "Generate the Local Growth Plan first." };
  const selectedIds = body.taskIds ? new Set(body.taskIds) : null;
  const pending = profile.tasks.filter((item) => item.planVersion === profile.planVersion && item.status === "needs_review" && (!selectedIds || selectedIds.has(item.id)));
  if (selectedIds && pending.length !== selectedIds.size) throw new Error("One or more selected Local SEO actions are unavailable or already reviewed.");
  const result = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const task of pending) rows.push(await approveLocalPlanTask(tx, { context, project, taskId: task.id }));
    const remaining = await tx.gapLocalSeoTask.count({ where: { profileId: profile.id, planVersion: profile.planVersion, status: "needs_review" } });
    const planStatus = remaining ? "partially_approved" : "approved";
    await tx.gapLocalSeoProfile.update({ where: { id: profile.id }, data: { planStatus, planApprovedAt: remaining ? null : new Date() } });
    await recordWorkspaceActivity(tx, { context, action: selectedIds ? "local_seo.growth_plan_group_approved" : "local_seo.growth_plan_approved", entityType: "local_growth_plan", entityId: profile.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { planStatus: profile.planStatus }, nextJson: { planStatus, planVersion: profile.planVersion, approvedActions: rows.length, remainingActions: remaining } });
    await createWorkspaceNotification(tx, { context, userId: context.membership.userId, type: "local_growth_plan_approved", title: remaining ? "Local SEO actions added to execution" : "Local Growth Plan approved", body: `${rows.length} approved action${rows.length === 1 ? "" : "s"} added to the project execution plan.`, actionUrl: `/guided-projects/${project.id}?tab=execution`, agencyClientId: project.agencyClientId, projectId: project.id, emailEligible: false });
    return { rows, planStatus };
  });
  return { ready: true, planVersion: profile.planVersion, planStatus: result.planStatus, approvedActions: result.rows.length };
}));

gapAnalysisRouter.post(gapRoutes("/ai-visibility/queries"), (req, res) => routeAction(res, async () => {
  const body = aiQueriesSchema.parse(req.body);
  const project = await scopedProject(req, req.params.projectId);
  const queries = await prisma.$transaction(body.queries.map((query) => prisma.aiVisibilityQuery.create({ data: {
    projectId: project.id,
    clientId: project.clientId,
    queryText: query.queryText!,
    targetBrand: query.targetBrand!,
    targetUrl: query.targetUrl ?? null,
    competitors: query.competitors ?? [],
    scanFrequency: query.scanFrequency ?? "manual",
  } })));
  return { queries };
}));

gapAnalysisRouter.post(gapRoutes("/ai-visibility/run-scan"), (req, res) => routeAction(res, async () => {
  const project = await scopedProject(req, req.params.projectId);
  const queries = await prisma.aiVisibilityQuery.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 });
  if (!queries.length) return { ready: false, missing: ["ai_visibility_queries"], nextAction: "Create 5-10 priority AI visibility questions first." };
  await prisma.aiVisibilityQuery.updateMany({
    where: { id: { in: queries.map((query) => query.id) } },
    data: {
      lastScanStatus: "provider_required",
      visibilityStatus: "not_assessed",
      recommendedAction: "Open AI Citation Optimization and record a permitted provider result or documented manual observation.",
    },
  });
  return {
    ready: false,
    missing: ["monitoring_provider_or_manual_observation"],
    nextAction: `/ai-citations?projectId=${project.id}`,
    message: "No result was fabricated and no usage was charged. Record an observed AI answer in the citation workspace before creating a visibility finding or execution task.",
  };
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
