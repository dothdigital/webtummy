import { prisma, type Prisma } from "@webtummy/db";
import { commitUsage, preflightUsage, refundUsage } from "./usage-engine.js";

type Plan = "mini" | "starter" | "basic" | "growth" | "pro" | "internal" | "agency" | "enterprise";
type FeatureVisibility = "hidden_intelligence" | "visible_module" | "advanced_agency";

type CompetitiveFeatureConfig = {
  key: string;
  label: string;
  visibility: FeatureVisibility;
  minPlan: Plan;
  creditCost: number;
  requiresApproval: boolean;
  requiresReadiness: string[];
};

export const competitiveFeatures: CompetitiveFeatureConfig[] = [
  { key: "revenue_keyword_score", label: "Revenue-Focused Keyword Scoring", visibility: "hidden_intelligence", minPlan: "starter", creditCost: 2, requiresApproval: false, requiresReadiness: ["project", "strategy_or_goal"] },
  { key: "improve_page_stack", label: "Improve This Page Intelligence Stack", visibility: "hidden_intelligence", minPlan: "starter", creditCost: 5, requiresApproval: true, requiresReadiness: ["project", "page_or_url", "site_crawl"] },
  { key: "authority_asset_builder", label: "Authority Asset Builder v1", visibility: "advanced_agency", minPlan: "growth", creditCost: 10, requiresApproval: true, requiresReadiness: ["project", "strategy", "keyword_data"] },
  { key: "ai_citation_gap", label: "AI Citation Competitor Gap v1", visibility: "advanced_agency", minPlan: "growth", creditCost: 15, requiresApproval: true, requiresReadiness: ["project", "competitors", "target_ai_queries"] },
  { key: "community_intelligence", label: "Community Intelligence v1", visibility: "advanced_agency", minPlan: "growth", creditCost: 8, requiresApproval: true, requiresReadiness: ["project", "niche", "allowed_sources"] },
  { key: "moat_tracker", label: "Competitive Moat Tracker v1", visibility: "visible_module", minPlan: "growth", creditCost: 3, requiresApproval: false, requiresReadiness: ["project"] },
];

type IntelligenceProject = Prisma.ProjectGetPayload<{
  include: {
    website: true;
    businessProfile: true;
    opportunities: { take: 1; orderBy: { createdAt: "desc" } };
    strategyPlans: { take: 1; orderBy: { createdAt: "desc" } };
  };
}>;

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function priorityFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function planRank(plan: string | null | undefined) {
  const order = ["mini", "starter", "basic", "growth", "pro", "internal", "agency", "enterprise"];
  const normalized = (plan ?? "mini").toLowerCase();
  const index = order.indexOf(normalized);
  return index === -1 ? 0 : index;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function revenueOpportunityScore(input: {
  searchVolume?: number | null;
  difficulty?: number | null;
  buyerIntentScore?: number | null;
  offerFitScore?: number | null;
  authorityGapScore?: number | null;
  aiCitationPotentialScore?: number | null;
  effortScore?: number | null;
}) {
  const volume = Math.min((input.searchVolume ?? 0) / 1000, 10) * 10;
  const difficultyPenalty = Math.max(0, 100 - ((input.difficulty ?? 50) * 1.2));
  const intent = (input.buyerIntentScore ?? 5) * 10;
  const offerFit = (input.offerFitScore ?? 5) * 10;
  const authorityGap = Math.max(0, 100 - ((input.authorityGapScore ?? 5) * 10));
  const aiPotential = (input.aiCitationPotentialScore ?? 5) * 10;
  const effortPenalty = Math.max(0, 100 - ((input.effortScore ?? 5) * 10));

  return Math.round(clamp(
    volume * 0.10 +
    difficultyPenalty * 0.15 +
    intent * 0.25 +
    offerFit * 0.20 +
    authorityGap * 0.10 +
    aiPotential * 0.10 +
    effortPenalty * 0.10,
  ));
}

function pageMonetizationFitScore(input: {
  hasClearCta: boolean;
  hasLeadMagnet: boolean;
  hasTrustSignals: boolean;
  hasProof: boolean;
  matchesIntent: boolean;
  hasInternalLinks: boolean;
}) {
  let score = 0;
  if (input.hasClearCta) score += 20;
  if (input.hasLeadMagnet) score += 15;
  if (input.hasTrustSignals) score += 15;
  if (input.hasProof) score += 20;
  if (input.matchesIntent) score += 20;
  if (input.hasInternalLinks) score += 10;
  return clamp(score);
}

function refreshPriorityScore(contentAgeDays = 0, trafficDeclinePct = 0, rankingDeclinePct = 0) {
  const age = Math.min(contentAgeDays / 365, 1) * 35;
  const traffic = Math.min(Math.max(trafficDeclinePct, 0), 100) * 0.35;
  const ranking = Math.min(Math.max(rankingDeclinePct, 0), 100) * 0.30;
  return Math.round(clamp(age + traffic + ranking));
}

async function latestCrawl(websiteId: string | null) {
  if (!websiteId) return null;
  return prisma.crawlJob.findFirst({
    where: { websiteId, status: "completed" },
    orderBy: { completedAt: "desc" },
    include: {
      pages: {
        include: {
          seo: true,
          schemas: true,
          issues: true,
          links: { take: 40 },
          images: { take: 20 },
        },
      },
      issues: true,
    },
  });
}

async function loadProject(projectId: string, clientId: string | null) {
  return prisma.project.findFirst({
    where: { id: projectId, ...(clientId ? { clientId } : {}) },
    include: {
      website: true,
      businessProfile: true,
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

async function readinessForProject(project: IntelligenceProject) {
  const crawl = await latestCrawl(project.websiteId);
  const keywordRuns = await prisma.keywordResearchRun.count({ where: { clientId: project.clientId, ...(project.websiteId ? { websiteId: project.websiteId } : {}) } });
  const competitors = await prisma.keywordSerpCompetitor.count({
    where: { run: { clientId: project.clientId, ...(project.websiteId ? { websiteId: project.websiteId } : {}) } },
  });
  return {
    crawl,
    keywordRuns,
    competitors,
    readiness: {
      project: true,
      strategy_or_goal: Boolean(project.strategyPlans.length || project.primaryGoal || project.businessProfile?.offerSummary),
      strategy: project.strategyPlans.some((strategy) => strategy.status === "approved"),
      page_or_url: Boolean(project.websiteUrl || project.website?.rootUrl || crawl?.pages.length),
      site_crawl: Boolean(crawl),
      keyword_data: keywordRuns > 0,
      competitors: competitors > 0,
      target_ai_queries: keywordRuns > 0 || Boolean(project.niche),
      niche: Boolean(project.niche || project.businessProfile?.businessSummary),
      allowed_sources: false,
    },
  };
}

function featureAccess(featureKey: string, project: IntelligenceProject, readiness: Record<string, boolean>) {
  const feature = competitiveFeatures.find((item) => item.key === featureKey);
  if (!feature) return { ok: false as const, reason: "Unknown intelligence feature.", missing: [] as string[] };
  if (planRank(project.client.plan) < planRank(feature.minPlan)) {
    return { ok: false as const, reason: `This feature requires ${feature.minPlan} plan or higher.`, missing: [] as string[] };
  }
  const missing = feature.requiresReadiness.filter((key) => !readiness[key]);
  if (missing.length) return { ok: false as const, reason: "Missing required data.", missing };
  return { ok: true as const, feature, missing: [] as string[] };
}

function pageByIdOrUrl(crawl: NonNullable<Awaited<ReturnType<typeof latestCrawl>>>, input: { pageId?: string | null; url?: string | null }) {
  if (input.pageId) {
    const byId = crawl.pages.find((page) => page.id === input.pageId);
    if (byId) return byId;
  }
  if (input.url) {
    const normalized = input.url.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
    const byUrl = crawl.pages.find((page) => page.normalizedUrl.toLowerCase().includes(normalized) || page.url.toLowerCase().includes(normalized));
    if (byUrl) return byUrl;
  }
  return crawl.pages[0] ?? null;
}

function pageSignals(page: NonNullable<ReturnType<typeof pageByIdOrUrl>>, project: IntelligenceProject) {
  const title = page.seo?.title ?? "";
  const meta = page.seo?.metaDescription ?? "";
  const h1 = jsonArray(page.seo?.h1Text).join(" ");
  const text = `${title} ${meta} ${h1}`.toLowerCase();
  const hasCta = /(book|call|quote|contact|demo|consult|download|start|buy|trial|subscribe|schedule)/i.test(text);
  const hasLeadMagnet = /(checklist|guide|ebook|template|report|download|whitepaper)/i.test(text);
  const hasTrust = page.schemas.some((schema) => /organization|localbusiness|review|aggregate|product|service/i.test(schema.schemaType ?? "")) || /(review|testimonial|certified|trusted|award|case study)/i.test(text);
  const hasProof = /(case study|result|customer|client|stat|data|proof|testimonial|review)/i.test(text);
  const hasInternalLinks = page.inlinkCount > 0 && page.outlinkCount > 0;
  const targetTerms = [project.niche, project.primaryGoal, project.businessProfile?.offerSummary].filter(Boolean).join(" ").toLowerCase().split(/[\s,|]+/).filter((word) => word.length > 4);
  const matchesIntent = targetTerms.length ? targetTerms.some((word) => text.includes(word)) : true;
  return { hasCta, hasLeadMagnet, hasTrust, hasProof, hasInternalLinks, matchesIntent };
}

function recommendedPageActions(input: {
  project: IntelligenceProject;
  page: NonNullable<ReturnType<typeof pageByIdOrUrl>>;
  proofGapScore: number;
  monetizationFitScore: number;
  refreshScore: number;
  internalLinkScore: number;
  aiCitationScore: number;
}) {
  const actions: Array<{ title: string; rationale: string; priority: "low" | "medium" | "high"; automationLevel: string; safetyLabel: string }> = [];
  if (input.monetizationFitScore < 70) {
    actions.push({
      title: "Improve page CTA and offer clarity",
      rationale: "This page can convert better if the primary offer, CTA, and next step are clearer above the fold.",
      priority: priorityFromScore(100 - input.monetizationFitScore),
      automationLevel: "approval_required",
      safetyLabel: "review_required",
    });
  }
  if (input.proofGapScore > 45) {
    actions.push({
      title: "Add proof blocks to strengthen trust",
      rationale: "Add testimonials, screenshots, case study snippets, stats, certifications, or customer examples before pushing more traffic to this page.",
      priority: priorityFromScore(input.proofGapScore),
      automationLevel: "approval_required",
      safetyLabel: "review_required",
    });
  }
  if (input.internalLinkScore > 45) {
    actions.push({
      title: "Add internal links to support this page",
      rationale: "The crawl shows weak internal linking signals. Add relevant links from supporting pages and route users toward the conversion path.",
      priority: priorityFromScore(input.internalLinkScore),
      automationLevel: "manual_guided",
      safetyLabel: "safe",
    });
  }
  if (input.aiCitationScore > 45) {
    actions.push({
      title: "Add AI citation-ready structure",
      rationale: "Structured summary, FAQ, entity details, and schema can make this page easier for AI search systems to understand and cite.",
      priority: priorityFromScore(input.aiCitationScore),
      automationLevel: "approval_required",
      safetyLabel: "review_required",
    });
  }
  if (input.refreshScore > 55) {
    actions.push({
      title: "Refresh page content",
      rationale: "The page has signs of content freshness or intent mismatch risk. Review headings, examples, FAQ coverage, and competitor expectations.",
      priority: priorityFromScore(input.refreshScore),
      automationLevel: "approval_required",
      safetyLabel: "review_required",
    });
  }
  return actions.slice(0, 5);
}

async function activeExecutionPlan(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return tx.executionPlan.create({
    data: { projectId, title: "Competitive growth execution plan", summary: "Tasks generated from competitive SEO and growth intelligence." },
  });
}

async function createActionTasks(tx: Prisma.TransactionClient, input: {
  project: IntelligenceProject;
  runId: string;
  pageUrl: string;
  pageGrowthScoreId: string;
  actions: ReturnType<typeof recommendedPageActions>;
}) {
  const plan = await activeExecutionPlan(tx, input.project.id);
  const tasks = [];
  for (const [index, action] of input.actions.entries()) {
    const task = await tx.executionTask.upsert({
      where: { dedupeKey: `competitive:${input.project.id}:${input.pageGrowthScoreId}:${index}` },
      update: {
        title: action.title,
        description: action.rationale,
        priority: action.priority,
        status: "ready",
        relatedAssetId: input.pageGrowthScoreId,
      },
      create: {
        clientId: input.project.clientId,
        websiteId: input.project.websiteId,
        projectId: input.project.id,
        executionPlanId: plan.id,
        moduleName: "competitive_intelligence",
        sourceType: "competitive_intelligence",
        sourceId: input.runId,
        dedupeKey: `competitive:${input.project.id}:${input.pageGrowthScoreId}:${index}`,
        title: action.title,
        description: action.rationale,
        priority: action.priority,
        automationLevel: action.automationLevel,
        status: "ready",
        requiresApproval: action.automationLevel === "approval_required",
        requiresIntegration: false,
        manualRequired: true,
        safetyCategory: action.safetyLabel,
        relatedModule: "site_analysis",
        relatedAssetId: input.pageGrowthScoreId,
        actionButtonLabel: "Review Fix",
        relatedUrl: "/site-analysis",
        manualInstructions: `Review the recommendation for ${input.pageUrl}. Approve generated copy or make the update manually before changing the live page.`,
      },
    });
    tasks.push(task);
  }
  return tasks;
}

export async function runImprovePageStack(input: {
  projectId: string;
  clientId: string | null;
  userId?: string | null;
  pageId?: string | null;
  url?: string | null;
}) {
  const project = await loadProject(input.projectId, input.clientId);
  if (!project) {
    const error = new Error("project not found");
    error.name = "not_found";
    throw error;
  }
  const context = await readinessForProject(project);
  const access = featureAccess("improve_page_stack", project, context.readiness);
  if (!access.ok) {
    return {
      ok: false,
      reason: access.reason,
      missing: access.missing,
      readiness: context.readiness,
    };
  }
  const page = pageByIdOrUrl(context.crawl!, input);
  if (!page) {
    return { ok: false, reason: "No crawled page found for this project.", missing: ["page_or_url"], readiness: context.readiness };
  }

  let usageEventId: string | null = null;
  try {
    const usage = await preflightUsage({
      clientId: project.clientId,
      userId: input.userId,
      projectId: project.id,
      websiteId: project.websiteId,
      featureKey: "improve_page_stack",
      actionKey: "Improve this page",
      idempotencyKey: `improve-page:${project.id}:${page.id}:${Date.now()}`,
      metadata: { pageId: page.id, url: page.url },
    });
    usageEventId = usage.usageEventId;

    const signals = pageSignals(page, project);
    const monetizationFitScore = pageMonetizationFitScore(signals);
    const proofGapScore = clamp(100 - ((signals.hasProof ? 45 : 0) + (signals.hasTrust ? 35 : 0) + (page.schemas.length ? 20 : 0)));
    const internalLinkOpportunityScore = clamp(100 - (page.internalLinkScore ?? (page.inlinkCount > 0 ? 60 : 20)));
    const aiCitationPotentialScore = clamp(100 - ((page.schemas.length ? 35 : 0) + ((page.seo?.h1Count ?? 0) > 0 ? 20 : 0) + (signals.hasProof ? 20 : 0) + (page.wordCount && page.wordCount > 700 ? 25 : 0)));
    const contentAgeDays = Math.max(0, Math.round((Date.now() - page.createdAt.getTime()) / 86400000));
    const refreshScore = refreshPriorityScore(contentAgeDays, 0, 0);
    const overallScore = Math.round(clamp((monetizationFitScore + (100 - proofGapScore) + (100 - internalLinkOpportunityScore) + (100 - aiCitationPotentialScore) + (100 - refreshScore)) / 5));
    const actions = recommendedPageActions({
      project,
      page,
      proofGapScore,
      monetizationFitScore,
      refreshScore,
      internalLinkScore: internalLinkOpportunityScore,
      aiCitationScore: aiCitationPotentialScore,
    });

    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.competitiveIntelligenceRun.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          userId: input.userId ?? null,
          websiteId: project.websiteId,
          featureKey: "improve_page_stack",
          status: "completed",
          inputJson: { pageId: page.id, url: page.url },
          outputJson: {
            pageUrl: page.url,
            scores: { proofGapScore, monetizationFitScore, refreshScore, internalLinkOpportunityScore, aiCitationPotentialScore, overallScore },
            actions,
          },
          creditsReserved: usage.creditsReserved,
          creditsUsed: usage.creditsReserved,
          estimatedCostUsd: usage.estimatedProviderCostUsd,
          actualCostUsd: 0,
          usageEventId: usage.usageEventId,
          completedAt: new Date(),
        },
      });
      const pageGrowthScore = await tx.pageGrowthScore.create({
        data: {
          projectId: project.id,
          pageId: page.id,
          url: page.url.slice(0, 512),
          proofGapScore,
          monetizationFitScore,
          refreshPriorityScore: refreshScore,
          internalLinkOpportunityScore,
          aiCitationPotentialScore,
          overallScore,
          recommendedActions: actions,
        },
      });
      const tasks = await createActionTasks(tx, { project, runId: run.id, pageUrl: page.url, pageGrowthScoreId: pageGrowthScore.id, actions });
      return { run, pageGrowthScore, tasks };
    });

    await commitUsage({ usageEventId, provider: "internal", providerCostUsd: 0, metadata: { runId: result.run.id, pageGrowthScoreId: result.pageGrowthScore.id } });
    usageEventId = null;

    return {
      ok: true,
      readiness: context.readiness,
      page: { id: page.id, url: page.url, title: page.seo?.title ?? null, score: page.score },
      scores: result.pageGrowthScore,
      actions,
      tasks: result.tasks,
      run: result.run,
    };
  } catch (error) {
    if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Improve page intelligence failed" }).catch(() => undefined);
    throw error;
  }
}

export async function competitiveMoatSnapshot(projectId: string, clientId: string | null) {
  const project = await loadProject(projectId, clientId);
  if (!project) return null;
  const [latestMoat, pageScores, authorityAssets, citationGaps, communityInsights] = await Promise.all([
    prisma.moatScore.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.pageGrowthScore.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.authorityAsset.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.aiCitationGap.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.communityInsight.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return { latestMoat, pageScores, authorityAssets, citationGaps, communityInsights };
}
