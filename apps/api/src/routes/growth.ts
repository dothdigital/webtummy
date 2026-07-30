import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { approvalRequiredForLevel, policyForModule, type AutomationLevel } from "../automation-policy.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext, type WorkspaceContext } from "../workspace-access.js";
import {
  GROWTH_ENGINE_VERSION,
  buildBlueprintPhases,
  findingsFromScores,
  generateGrowthCandidates,
  selectNextBestAction,
  signalFingerprint,
  signalFreshness,
  type GrowthSignalDraft,
} from "../growth-engine.js";

export const growthRouter = Router();
growthRouter.use(requireAuth);

const terminalStatuses = new Set(["completed", "skipped", "cancelled", "canceled"]);
type GrowthReadinessAction = { label: string; url: string };
type GrowthReadinessItem = {
  key: string;
  title: string;
  description: string;
  status: "complete" | "missing";
  required: boolean;
  actions: GrowthReadinessAction[];
};

async function scopedProject(req: Request, projectId: string) {
  const clientId = await projectClientIdForRequest(req);
  return prisma.project.findFirst({
    where: { id: projectId, ...(clientId ? { clientId } : {}) },
    include: {
      website: {
        include: {
          crawlJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { issues: { where: { status: "open" }, take: 50 } },
          },
          socialStrategies: { orderBy: { createdAt: "desc" }, take: 1, include: { posts: { take: 10 } } },
        },
      },
      keywordResearchRuns: { orderBy: { createdAt: "desc" }, take: 5, include: { ideas: { take: 200 } } },
      keywordGroups: { orderBy: { updatedAt: "desc" }, take: 100 },
      websiteBuilds: { orderBy: { updatedAt: "desc" }, take: 1, include: { pages: { where: { status: { not: "deferred" } }, orderBy: { sortOrder: "asc" }, take: 500 } } },
      businessProfile: true,
      intakeAnswers: true,
      opportunities: { orderBy: { createdAt: "desc" }, take: 5 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
      executionTasks: { orderBy: { createdAt: "desc" }, take: 80 },
      backlinkProfileSnapshots: { orderBy: { capturedAt: "desc" }, take: 2 },
      authorityOpportunities: { where: { status: { not: "superseded" } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }] },
      authorityAssets: { orderBy: { createdAt: "desc" }, take: 50 },
      earnedMentions: { orderBy: [{ earnedAt: "desc" }, { createdAt: "desc" }] },
      authorityPerformanceMetrics: { orderBy: { periodEnd: "desc" }, take: 100 },
      aiRuns: { where: { moduleName: "ai_citation_visibility", status: "completed" }, orderBy: { createdAt: "desc" }, take: 1 },
      aiVisibilityQueries: { where: { status: "active" }, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } },
      citationRecommendations: { where: { status: { not: "superseded" } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }], take: 50 },
    },
  });
}

async function authorizeProject(req: Request, projectId: string, permission?: string) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  if (permission && !hasWorkspacePermission(context, permission)) {
    throw Object.assign(new Error(`${permission === "run_ai_analysis" ? "AI analysis" : "Task execution"} permission is required.`), { statusCode: 403 });
  }
  return context;
}

function jsonList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function boundedText(value: unknown, maximumLength: number) {
  const text = String(value ?? "").trim();
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`;
}

function normalizedTopic(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function topicTokens(value: unknown) {
  const ignored = new Set(["a", "an", "and", "are", "at", "best", "for", "from", "how", "in", "is", "of", "on", "the", "to", "what", "with"]);
  return normalizedTopic(value).split(" ").filter((token) => token.length > 2 && !ignored.has(token));
}

function topicTitle(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return "Supporting content opportunity";
  return text.split(" ").map((word) => /^[A-Z0-9]{2,}$/.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

function contentSearchIntent(keyword: string) {
  const value = normalizedTopic(keyword);
  if (/\b(vs|versus|best|compare|comparison|cost|price|pricing|review|alternative)\b/.test(value)) return "commercial_investigation";
  if (/\b(near me|in [a-z]|local)\b/.test(value)) return "local_informational";
  if (/\b(buy|book|quote|apply|consultation)\b/.test(value)) return "transactional";
  return "informational";
}

type ContentOpportunityDraft = {
  dedupeKey: string;
  title: string;
  primaryKeyword: string;
  searchIntent: string;
  clusterName: string;
  serviceName: string | null;
  locationName: string | null;
  targetPageId: string | null;
  targetUrl: string | null;
  internalLinkTargetPageId: string | null;
  internalLinkTargetUrl: string | null;
  businessPurpose: string;
  recommendationReason: string;
  expectedImpact: string;
  priorityScore: number;
  confidence: number;
  queue: "now" | "next" | "later" | "conditional";
  plannedPhase: "launch_foundation" | "early_authority" | "expansion" | "growth_optimization";
  plannedPublishAt: Date | null;
  conditionsJson: string[];
  evidenceJson: Record<string, unknown>;
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function projectContext(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const targetMarkets = jsonList(project.targetLocations);
  const secondaryGoals = jsonList(project.secondaryGoals);
  const primaryGoal = project.primaryGoal?.trim() || "growth";
  return {
    name: project.businessName ?? project.name,
    website: project.website?.rootUrl ?? project.websiteUrl ?? null,
    niche: project.niche ?? project.businessProfile?.businessSummary ?? "this market",
    audience: project.businessProfile?.targetAudience ?? "the target audience",
    offer: project.businessProfile?.offerSummary ?? project.primaryGoal ?? "the main offer",
    primaryGoal,
    goal: [primaryGoal, ...secondaryGoals].filter(Boolean).join("; "),
    secondaryGoals,
    businessLocation: project.businessLocation,
    targetMarkets,
    market: targetMarkets.join(", ") || project.targetLocation || "the target market",
    outputs: jsonList(project.preferredOutputs),
    strategy: project.strategyPlans[0] ?? null,
    approvedStrategy: project.strategyPlans.find((strategy) => strategy.status === "approved") ?? null,
  };
}

function growthReadiness(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const intakeComplete = Boolean(project.businessProfile || project.intakeAnswers.length > 0);
  const opportunityExists = project.opportunities.length > 0;
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const hasWebsite = Boolean(project.website);
  const latestCrawl = project.website?.crawlJobs[0] ?? null;
  const siteAnalysisComplete = Boolean(latestCrawl && latestCrawl.status === "completed");

  const items: GrowthReadinessItem[] = [
    {
      key: "intake",
      title: "Project intake required",
      description: "SEnuke AI needs the business profile, audience, offer, goal, and project context before advanced growth analysis can run.",
      status: intakeComplete ? "complete" : "missing",
      required: true,
      actions: [{ label: "Complete Intake", url: `/guided-projects/${project.id}/intake` }],
    },
    {
      key: "opportunity",
      title: "Opportunity required",
      description: "SEnuke AI needs to know what direction this project is targeting before it can create growth recommendations.",
      status: opportunityExists ? "complete" : "missing",
      required: true,
      actions: [{ label: "Find Opportunity", url: `/opportunities?projectId=${project.id}` }],
    },
    {
      key: "strategy",
      title: "Strategy required",
      description: "SEnuke AI needs an approved strategy before it can diagnose growth bottlenecks or create experiments.",
      status: strategyApproved ? "complete" : "missing",
      required: true,
      actions: [{ label: "Generate Strategy", url: `/strategy?projectId=${project.id}` }],
    },
  ];

  if (!hasWebsite) {
    items.push({
      key: "website",
      title: "No website found",
      description: "Create or connect a website first so SEnuke AI can analyze and optimize it.",
      status: "missing",
      required: true,
      actions: [
        { label: "Create Website", url: `/site-architect?projectId=${project.id}` },
        { label: "Add Website URL", url: `/guided-projects/${project.id}/intake` },
      ],
    });
  } else {
    items.push({
      key: "site_analysis",
      title: "Site analysis required",
      description: "SEnuke AI needs to analyze your website before it can evaluate funnel gaps, conversion issues, SEO issues, internal links, AI citations, or page improvements.",
      status: siteAnalysisComplete ? "complete" : "missing",
      required: true,
      actions: [{ label: "Analyze Site", url: `/site-analysis?projectId=${project.id}` }],
    });
  }

  const missing = items.filter((item) => item.required && item.status === "missing");
  return {
    canRun: missing.length === 0,
    status: missing.length === 0 ? "ready" : "blocked",
    message: missing.length === 0
      ? "Growth Engine has the required foundation data for this project."
      : "Before SEnuke AI can run this, we need to complete these missing steps.",
    items,
    missing,
  };
}

function scoreProject(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const latestCrawl = project.website?.crawlJobs[0] ?? null;
  const openTasks = project.executionTasks.filter((task) => !terminalStatuses.has(task.status));
  const highIssues = latestCrawl?.issues.filter((issue) => issue.severity === "high").length ?? 0;
  const keywordRuns = project.keywordResearchRuns.length;
  const socialPosts = project.website?.socialStrategies[0]?.posts.length ?? 0;
  const hasLeadMagnetTask = project.executionTasks.some((task) => task.moduleName.includes("lead") || task.title.toLowerCase().includes("lead magnet"));
  const strategyApproved = Boolean(project.strategyPlans.find((strategy) => strategy.status === "approved"));

  const traffic = Math.min(100, 35 + keywordRuns * 16 + (latestCrawl ? 18 : 0) + Math.max(0, 20 - highIssues * 4));
  const conversion = Math.min(100, 30 + (strategyApproved ? 18 : 0) + (hasLeadMagnetTask ? 14 : 0) + (project.businessProfile?.offerSummary ? 12 : 0));
  const leadCapture = Math.min(100, 25 + (hasLeadMagnetTask ? 24 : 0) + (project.preferredOutputs && jsonList(project.preferredOutputs).some((item) => /lead/i.test(item)) ? 20 : 0));
  const followUp = Math.min(100, 22 + socialPosts * 3 + (project.preferredPublishingMethod ? 10 : 0));
  const latestAuthoritySnapshot = project.backlinkProfileSnapshots[0];
  const citationOutput = project.aiRuns[0]?.outputJson && typeof project.aiRuns[0].outputJson === "object" && !Array.isArray(project.aiRuns[0].outputJson)
    ? project.aiRuns[0].outputJson as Record<string, unknown>
    : {};
  const citationScores = citationOutput.scores && typeof citationOutput.scores === "object" && !Array.isArray(citationOutput.scores)
    ? citationOutput.scores as Record<string, unknown>
    : {};
  const citationReadiness = typeof citationScores.overallScore === "number" ? citationScores.overallScore : null;
  const observedCitationMentions = project.aiVisibilityQueries.filter((query) => query.snapshots[0]?.mentionDetected).length;
  const approvedCitationRecommendations = project.citationRecommendations.filter((item) => item.status === "approved").length;
  const approvedAuthorityOpportunities = project.authorityOpportunities.filter((item) => item.status === "approved").length;
  const completedAuthorityAssets = project.authorityAssets.filter((item) => item.status === "completed").length;
  const earnedReferralLeads = project.earnedMentions.reduce((sum, mention) => sum + mention.referralLeads, 0);
  const authority = Math.min(100,
    20
    + (latestAuthoritySnapshot ? 12 : 0)
    + Math.min(16, approvedAuthorityOpportunities * 4)
    + Math.min(16, completedAuthorityAssets * 5)
    + Math.min(24, project.earnedMentions.length * 6)
    + Math.min(12, earnedReferralLeads * 3)
    + Math.min(8, observedCitationMentions * 2)
    + Math.min(8, approvedCitationRecommendations * 2)
    + (citationReadiness == null ? 0 : Math.round(citationReadiness * .08))
    + Math.min(10, openTasks.filter((task) => /backlink|citation|authority/i.test(`${task.moduleName} ${task.title}`)).length * 2));
  const offer = Math.min(100, 35 + (project.businessProfile?.offerSummary ? 22 : 0) + (project.businessProfile?.targetAudience ? 14 : 0) + (project.strategyPlans[0]?.offerRecommendation ? 12 : 0));
  const retention = Math.min(100, 25 + socialPosts * 2 + (project.strategyPlans[0]?.socialStrategy ? 12 : 0));
  const scoreJson = { traffic, conversion, leadCapture, followUp, authority, offer, retention };
  const bottleneckType = Object.entries(scoreJson).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "conversion";
  const growthScore = Math.round(Object.values(scoreJson).reduce((sum, value) => sum + value, 0) / Object.values(scoreJson).length);
  return { scoreJson, bottleneckType, growthScore, latestCrawl, openTasks, keywordRuns, socialPosts, hasLeadMagnetTask, strategyApproved, latestAuthoritySnapshot, approvedAuthorityOpportunities, completedAuthorityAssets, earnedReferralLeads, citationReadiness, observedCitationMentions, approvedCitationRecommendations };
}

function buildSupportingContentRoadmap(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const buildPages = project.websiteBuilds[0]?.pages ?? [];
  const rootUrl = project.website?.rootUrl?.replace(/\/$/, "") ?? project.websiteUrl?.replace(/\/$/, "") ?? "";
  const targetLocations = jsonList(project.targetLocations);
  const inputs: Array<{
    keyword: string;
    volume: number | null;
    competitionIndex: number | null;
    competition: string | null;
    sourceType: string;
    sourceId: string;
    sourceCluster?: string;
  }> = [];
  for (const run of project.keywordResearchRuns) {
    for (const idea of run.ideas) inputs.push({
      keyword: idea.keyword,
      volume: idea.avgMonthlySearches,
      competitionIndex: idea.competitionIndex,
      competition: idea.competition,
      sourceType: "keyword_research",
      sourceId: idea.id,
      sourceCluster: run.seedKeyword,
    });
  }
  for (const group of project.keywordGroups) {
    for (const keyword of [...jsonList(group.keywords), ...jsonList(group.gapKeywords)]) inputs.push({
      keyword,
      volume: null,
      competitionIndex: null,
      competition: null,
      sourceType: "approved_keyword_group",
      sourceId: group.id,
      sourceCluster: group.title,
    });
  }
  const corePageTopics = new Set(buildPages.flatMap((page) => [normalizedTopic(page.primaryKeyword), normalizedTopic(page.title)]).filter(Boolean));
  const uniqueInputs = new Map<string, typeof inputs[number]>();
  for (const input of inputs) {
    const key = normalizedTopic(input.keyword);
    if (!key || key.length < 3 || corePageTopics.has(key)) continue;
    const current = uniqueInputs.get(key);
    if (!current || (input.volume ?? 0) > (current.volume ?? 0)) uniqueInputs.set(key, input);
  }
  if (uniqueInputs.size < 6) {
    for (const page of buildPages.filter((page) => !["legal", "contact", "privacy", "terms"].includes(page.pageType.toLowerCase()))) {
      const base = page.primaryKeyword || page.title;
      for (const angle of [`How ${base} works`, `${base} buyer checklist`, `Questions to ask about ${base}`]) {
        const key = normalizedTopic(angle);
        if (!uniqueInputs.has(key)) uniqueInputs.set(key, {
          keyword: angle,
          volume: null,
          competitionIndex: null,
          competition: null,
          sourceType: "website_authority_gap",
          sourceId: page.id,
          sourceCluster: page.title,
        });
      }
    }
  }
  if (!uniqueInputs.size) {
    const base = project.niche || project.businessProfile?.offerSummary || project.primaryGoal || project.businessName || project.name;
    for (const angle of [`How ${base} works`, `${base} buyer guide`, `${base} questions and answers`]) uniqueInputs.set(normalizedTopic(angle), {
      keyword: angle,
      volume: null,
      competitionIndex: null,
      competition: null,
      sourceType: "project_intake",
      sourceId: project.id,
      sourceCluster: String(project.niche || project.businessName || project.name),
    });
  }
  const pageCandidates = buildPages.map((page) => ({
    page,
    tokens: new Set(topicTokens(`${page.title} ${page.primaryKeyword} ${jsonList(page.secondaryKeywords).join(" ")}`)),
  }));
  const scored = [...uniqueInputs.values()].slice(0, 250).map((input) => {
    const keywordTokens = topicTokens(input.keyword);
    const matchedPages = pageCandidates.map((candidate) => ({
      page: candidate.page,
      overlap: keywordTokens.filter((token) => candidate.tokens.has(token)).length,
    })).sort((left, right) => right.overlap - left.overlap || left.page.sortOrder - right.page.sortOrder);
    const matchedPage = matchedPages[0]?.overlap ? matchedPages[0].page : buildPages.find((page) => page.pageType === "home" || !page.slug) ?? null;
    const locationName = targetLocations.find((location) => normalizedTopic(input.keyword).includes(normalizedTopic(location))) ?? null;
    const intent = contentSearchIntent(input.keyword);
    const volumeScore = input.volume == null ? 8 : Math.min(35, Math.round(Math.log10(input.volume + 1) * 12));
    const competitionScore = input.competitionIndex != null
      ? Math.max(4, Math.round((100 - input.competitionIndex) * 0.18))
      : /low/i.test(input.competition ?? "") ? 18 : /high/i.test(input.competition ?? "") ? 6 : 11;
    const clusterFit = matchedPages[0]?.overlap ? Math.min(22, 12 + matchedPages[0].overlap * 4) : 8;
    const intentScore = intent === "commercial_investigation" || intent === "transactional" ? 16 : 10;
    const evidenceScore = input.sourceType === "keyword_research" ? 10 : input.sourceType === "approved_keyword_group" ? 9 : 6;
    const priorityScore = Math.min(100, volumeScore + competitionScore + clusterFit + intentScore + evidenceScore + (locationName ? 4 : 0));
    const targetUrl = matchedPage
      ? matchedPage.targetUrl || (rootUrl ? `${rootUrl}/${matchedPage.slug}`.replace(/\/$/, matchedPage.slug ? "" : "/") : `/${matchedPage.slug}`)
      : rootUrl || null;
    const clusterName = matchedPage?.title || input.sourceCluster || project.niche || "Supporting authority";
    return {
      input,
      matchedPage,
      locationName,
      intent,
      priorityScore,
      confidence: Math.min(96, 58 + evidenceScore * 3 + (matchedPages[0]?.overlap ? 8 : 0) + (input.volume != null ? 6 : 0)),
      targetUrl,
      clusterName,
    };
  }).sort((left, right) => right.priorityScore - left.priorityScore || (right.input.volume ?? 0) - (left.input.volume ?? 0) || left.input.keyword.localeCompare(right.input.keyword)).slice(0, 90);
  const total = scored.length;
  const nowTarget = total <= 6 ? total : Math.min(12, Math.max(6, Math.ceil(total * 0.12)));
  const earlyTotalTarget = Math.min(total, Math.max(nowTarget, total >= 60 ? 24 : total >= 18 ? Math.max(12, Math.ceil(total * 0.35)) : Math.ceil(total * 0.5)));
  const conditionalTarget = total >= 10 ? Math.max(1, Math.round(total * 0.18)) : 0;
  const conditionalStart = total - conditionalTarget;
  const publishStart = Date.now() + 2 * 86_400_000;
  const opportunities: ContentOpportunityDraft[] = scored.map((item, index) => {
    const queue: ContentOpportunityDraft["queue"] = index < nowTarget ? "now" : index < earlyTotalTarget ? "next" : index >= conditionalStart ? "conditional" : "later";
    const plannedPhase: ContentOpportunityDraft["plannedPhase"] = queue === "now" ? "launch_foundation" : queue === "next" ? "early_authority" : queue === "later" && index < Math.ceil(total * 0.65) ? "expansion" : "growth_optimization";
    const plannedPublishAt = queue === "now" || queue === "next" ? new Date(publishStart + index * 4 * 86_400_000) : null;
    const volumeEvidence = item.input.volume == null ? "available project and website evidence" : `${item.input.volume.toLocaleString()} estimated monthly searches`;
    const businessPurpose = item.intent === "commercial_investigation"
      ? `Help prospective buyers compare options before moving to ${item.matchedPage?.title || "the relevant conversion page"}.`
      : item.intent === "transactional"
        ? `Answer the final questions that can move qualified visitors toward ${item.matchedPage?.title || "the primary conversion action"}.`
        : `Build topical authority and answer an audience question that supports ${item.matchedPage?.title || item.clusterName}.`;
    return {
      dedupeKey: `supporting-content:${normalizedTopic(item.input.keyword).replace(/\s+/g, "-")}`.slice(0, 191),
      title: boundedText(topicTitle(item.input.keyword), 255),
      primaryKeyword: boundedText(item.input.keyword, 512),
      searchIntent: item.intent,
      clusterName: boundedText(item.clusterName, 255),
      serviceName: item.matchedPage?.primaryKeyword ? boundedText(item.matchedPage.primaryKeyword, 255) : null,
      locationName: item.locationName ? boundedText(item.locationName, 180) : null,
      targetPageId: item.matchedPage?.id ?? null,
      targetUrl: item.targetUrl ? boundedText(item.targetUrl, 512) : null,
      internalLinkTargetPageId: item.matchedPage?.id ?? null,
      internalLinkTargetUrl: item.targetUrl ? boundedText(item.targetUrl, 512) : null,
      businessPurpose,
      recommendationReason: `Prioritized from ${volumeEvidence}, ${item.intent.replaceAll("_", " ")} intent, cluster fit, competition, and business value. It supports ${item.clusterName} without creating a duplicate city page.`,
      expectedImpact: `Strengthen ${item.clusterName} coverage and route qualified readers to ${item.matchedPage?.title || "the most relevant website destination"}.`,
      priorityScore: item.priorityScore,
      confidence: item.confidence,
      queue,
      plannedPhase,
      plannedPublishAt,
      conditionsJson: queue === "conditional" ? ["Generate only when ranking, demand, seasonality, competitor movement, or business evidence justifies it."] : [],
      evidenceJson: {
        sourceType: item.input.sourceType,
        sourceId: item.input.sourceId,
        searchVolume: item.input.volume,
        competitionIndex: item.input.competitionIndex,
        competition: item.input.competition,
        matchedPageId: item.matchedPage?.id ?? null,
        matchedPageTitle: item.matchedPage?.title ?? null,
      },
    };
  });
  return {
    opportunities,
    counts: {
      now: opportunities.filter((item) => item.queue === "now").length,
      next: opportunities.filter((item) => item.queue === "next").length,
      later: opportunities.filter((item) => item.queue === "later").length,
      conditional: opportunities.filter((item) => item.queue === "conditional").length,
    },
    recommendedCadence: total > 24 ? "1–2 approved pieces per week; reassess every 30 days" : "1 approved piece per week; reassess every 30 days",
    rationale: `SEnuke AI mapped ${total} distinct supporting-content opportunities from approved keywords, search demand, website pages, target markets, and business goals. Only the ${nowTarget} highest-priority items are recommended for the current phase.`,
  };
}

function diagnosisSummary(bottleneckType: string, ctx: ReturnType<typeof projectContext>) {
  const label = bottleneckType.replace(/([A-Z])/g, " $1").toLowerCase();
  return `${ctx.name} is currently most constrained by ${label}. Growth work should focus there before adding more disconnected tasks.`;
}

function normalizedGrowthSignals(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, score: ReturnType<typeof scoreProject>) {
  const now = new Date();
  const signals: GrowthSignalDraft[] = Object.entries(score.scoreJson).map(([signalKey, value]) => ({
    category: "growth_score",
    signalKey,
    sourceType: "project_snapshot",
    sourceId: project.id,
    value: { score: value },
    confidence: signalKey === "traffic" && !score.latestCrawl ? 58 : 82,
    collectedAt: now,
    effectiveDate: now,
    expiresAt: new Date(now.getTime() + 30 * 86_400_000),
  }));
  signals.push(
    {
      category: "strategy",
      signalKey: "approved_strategy",
      sourceType: "strategy_plan",
      sourceId: projectContext(project).approvedStrategy?.id ?? null,
      value: { approved: score.strategyApproved, primaryGoal: project.primaryGoal },
      confidence: score.strategyApproved ? 98 : 40,
      collectedAt: now,
      effectiveDate: now,
      expiresAt: new Date(now.getTime() + 90 * 86_400_000),
    },
    {
      category: "website",
      signalKey: "technical_health",
      sourceType: "crawl_job",
      sourceId: score.latestCrawl?.id ?? null,
      value: {
        siteScore: score.latestCrawl?.siteScore ?? null,
        openHighSeverityIssues: score.latestCrawl?.issues.filter((issue) => issue.severity === "high").length ?? 0,
      },
      confidence: score.latestCrawl ? 96 : 25,
      collectedAt: now,
      effectiveDate: score.latestCrawl?.createdAt ?? now,
      expiresAt: new Date((score.latestCrawl?.createdAt ?? now).getTime() + 30 * 86_400_000),
    },
    {
      category: "authority",
      signalKey: "authority_growth_outcomes",
      sourceType: score.latestAuthoritySnapshot ? "backlink_profile_snapshot" : "project_snapshot",
      sourceId: score.latestAuthoritySnapshot?.id ?? project.id,
      value: {
        authorityScore: score.scoreJson.authority,
        referringDomains: score.latestAuthoritySnapshot?.referringDomains ?? null,
        totalBacklinks: score.latestAuthoritySnapshot?.totalBacklinks ?? null,
        approvedOpportunities: score.approvedAuthorityOpportunities,
        completedAssets: score.completedAuthorityAssets,
        earnedMentions: project.earnedMentions.length,
        referralLeads: score.earnedReferralLeads,
      },
      confidence: score.latestAuthoritySnapshot || project.earnedMentions.length ? 92 : 35,
      collectedAt: now,
      effectiveDate: score.latestAuthoritySnapshot?.capturedAt ?? now,
      expiresAt: new Date((score.latestAuthoritySnapshot?.capturedAt ?? now).getTime() + 45 * 86_400_000),
    },
    {
      category: "ai_visibility",
      signalKey: "citation_readiness",
      sourceType: project.aiRuns[0] ? "ai_run" : "project_snapshot",
      sourceId: project.aiRuns[0]?.id ?? project.id,
      value: {
        overallScore: score.citationReadiness,
        monitoredPrompts: project.aiVisibilityQueries.length,
        observedMentions: score.observedCitationMentions,
        approvedRecommendations: score.approvedCitationRecommendations,
        status: score.citationReadiness == null ? "not_assessed" : "assessed",
      },
      confidence: score.citationReadiness == null ? 20 : 92,
      collectedAt: now,
      effectiveDate: project.aiRuns[0]?.createdAt ?? now,
      expiresAt: new Date((project.aiRuns[0]?.createdAt ?? now).getTime() + 30 * 86_400_000),
    },
    {
      category: "demand",
      signalKey: "keyword_research",
      sourceType: "keyword_research_run",
      sourceId: project.keywordResearchRuns[0]?.id ?? null,
      value: { recentRuns: score.keywordRuns, sampledIdeas: project.keywordResearchRuns.reduce((sum, run) => sum + run.ideas.length, 0) },
      confidence: score.keywordRuns ? 90 : 35,
      collectedAt: now,
      effectiveDate: project.keywordResearchRuns[0]?.createdAt ?? now,
      expiresAt: new Date((project.keywordResearchRuns[0]?.createdAt ?? now).getTime() + 45 * 86_400_000),
    },
  );
  return signals;
}

async function runGrowthEngine(input: {
  req: Request;
  context: WorkspaceContext;
  project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>;
  runType: "manual" | "scheduled" | "event" | "post_publish" | "post_measure";
  excludeDedupeKeys?: string[];
}) {
  const { project, context } = input;
  const ctx = projectContext(project);
  const score = scoreProject(project);
  const stages = funnelDefinitions(project, score);
  const signals = normalizedGrowthSignals(project, score);
  const findings = findingsFromScores(score.scoreJson);
  const priorActions = await prisma.nextBestAction.findMany({
    where: { projectId: project.id, sourceType: "growth_engine" },
    select: {
      id: true,
      dedupeKey: true,
      status: true,
      decision: true,
      followupTaskId: true,
      title: true,
      route: true,
      priorityScore: true,
      reasoningSummary: true,
      followupTask: { select: { status: true } },
    },
  });
  const excluded = new Set([
    ...(input.excludeDedupeKeys ?? []),
    ...priorActions
      .filter((action) => ["accepted", "rejected", "dismissed", "deferred"].includes(action.status) || Boolean(action.followupTaskId))
      .flatMap((action) => action.dedupeKey ? [action.dedupeKey] : []),
  ]);
  const candidates = generateGrowthCandidates({
    projectId: project.id,
    businessName: ctx.name,
    primaryGoal: ctx.primaryGoal,
    audience: ctx.audience,
    offer: ctx.offer,
    market: ctx.market,
    scoreJson: score.scoreJson,
    openHighIssues: score.latestCrawl?.issues.filter((issue) => issue.severity === "high").length ?? 0,
    hasLeadMagnet: score.hasLeadMagnetTask,
    hasApprovedStrategy: score.strategyApproved,
    hasRecentKeywordResearch: score.keywordRuns > 0,
  }, excluded);
  const activeAccepted = priorActions.find((action) =>
    action.status === "accepted" &&
    action.followupTask &&
    !terminalStatuses.has(action.followupTask.status),
  );
  const selected = activeAccepted ? null : selectNextBestAction(candidates);
  const generatedPhases = buildBlueprintPhases(candidates);
  const phases = activeAccepted ? {
    ...generatedPhases,
    now: [{
      dedupeKey: activeAccepted.dedupeKey ?? `growth-action:${activeAccepted.id}`,
      title: activeAccepted.title,
      route: activeAccepted.route,
      score: activeAccepted.priorityScore,
      rationale: `${activeAccepted.reasoningSummary} This accepted action remains Now until its execution task is completed or cancelled.`,
    }],
    next: [...generatedPhases.now, ...generatedPhases.next],
  } : generatedPhases;
  const diagnosisConfidence = Math.round(signals.reduce((sum, signal) => sum + signal.confidence, 0) / Math.max(1, signals.length));

  await prisma.$transaction(async (tx) => {
    for (const signal of signals) {
      const fingerprint = signalFingerprint(project.id, signal);
      await tx.growthSignal.upsert({
        where: { fingerprint },
        update: {
          valueJson: signal.value as Prisma.InputJsonValue,
          confidence: signal.confidence,
          collectedAt: signal.collectedAt,
          effectiveDate: signal.effectiveDate,
          freshnessStatus: signalFreshness(signal),
          expiresAt: signal.expiresAt,
          engineVersion: GROWTH_ENGINE_VERSION,
        },
        create: {
          projectId: project.id,
          fingerprint,
          category: signal.category,
          signalKey: signal.signalKey,
          sourceType: signal.sourceType,
          sourceId: signal.sourceId,
          valueJson: signal.value as Prisma.InputJsonValue,
          confidence: signal.confidence,
          collectedAt: signal.collectedAt,
          effectiveDate: signal.effectiveDate,
          freshnessStatus: signalFreshness(signal),
          expiresAt: signal.expiresAt,
          engineVersion: GROWTH_ENGINE_VERSION,
        },
      });
    }

    await tx.growthDiagnosis.create({
      data: {
        projectId: project.id,
        bottleneckType: score.bottleneckType,
        scoreJson: score.scoreJson,
        summary: diagnosisSummary(score.bottleneckType, ctx),
        dataSnapshot: {
          website: ctx.website,
          strategyApproved: score.strategyApproved,
          keywordRuns: score.keywordRuns,
          socialPosts: score.socialPosts,
          openTasks: score.openTasks.length,
          latestCrawlScore: score.latestCrawl?.siteScore ?? null,
        },
        findingsJson: findings as unknown as Prisma.InputJsonValue,
        evidenceJson: { signalFingerprints: signals.map((signal) => signalFingerprint(project.id, signal)) },
        confidence: diagnosisConfidence,
        engineVersion: GROWTH_ENGINE_VERSION,
        runType: input.runType,
      },
    });

    for (const stage of stages) {
      await tx.growthFunnelStage.upsert({
        where: { projectId_stageKey: { projectId: project.id, stageKey: stage.stageKey } },
        update: { title: boundedText(stage.title, 180), status: boundedText(stage.status, 60), conversionMetric: boundedText(stage.metric, 120), issueSummary: stage.issue, automationStatus: boundedText(stage.automation, 60), sortOrder: stage.sortOrder },
        create: { projectId: project.id, stageKey: boundedText(stage.stageKey, 80), title: boundedText(stage.title, 180), status: boundedText(stage.status, 60), conversionMetric: boundedText(stage.metric, 120), issueSummary: stage.issue, automationStatus: boundedText(stage.automation, 60), sortOrder: stage.sortOrder },
      });
    }

    await tx.nextBestAction.updateMany({
      where: { projectId: project.id, status: "selected" },
      data: { status: "recommended", selectedAt: null },
    });
    for (const candidate of candidates) {
      const existingCandidate = await tx.nextBestAction.findFirst({
        where: { projectId: project.id, sourceType: "growth_engine", dedupeKey: candidate.dedupeKey },
        orderBy: { createdAt: "asc" },
      });
      const candidateData = {
        title: candidate.title,
        recommendation: candidate.recommendation,
        reasoningSummary: candidate.reasoningSummary,
        expectedImpact: candidate.expectedImpact,
        confidence: candidate.factors.confidence,
        estimatedEffort: candidate.estimatedEffort,
        route: candidate.route,
        priorityScore: candidate.priorityScore,
        evidenceJson: { keys: candidate.evidenceKeys, findings: findings.filter((finding) => candidate.targetEntities.includes(finding.category)) } as Prisma.InputJsonValue,
        actionType: candidate.actionType,
        businessGoal: candidate.businessGoal,
        targetEntitiesJson: candidate.targetEntities,
        estimatedImpactJson: { description: candidate.expectedImpact },
        scoreJson: candidate.factors,
        dependencyIdsJson: candidate.dependencies,
        approvalType: candidate.approvalType,
        riskLevel: candidate.riskLevel,
        urgency: candidate.urgency,
        engineVersion: GROWTH_ENGINE_VERSION,
        status: candidate.dedupeKey === selected?.dedupeKey ? "selected" : "recommended",
        selectedAt: candidate.dedupeKey === selected?.dedupeKey ? new Date() : null,
      };
      if (existingCandidate) {
        await tx.nextBestAction.update({ where: { id: existingCandidate.id }, data: candidateData });
      } else {
        await tx.nextBestAction.create({
          data: {
            projectId: project.id,
            sourceType: "growth_engine",
            sourceId: null,
            dedupeKey: candidate.dedupeKey,
            ...candidateData,
          },
        });
      }
    }

    const existingBlueprint = await tx.growthBlueprint.findUnique({
      where: { projectId: project.id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const phasePayload = {
      goals: [ctx.goal],
      now: phases.now,
      next: phases.next,
      later: phases.later,
      conditional: phases.conditional,
    };
    const previousVersion = existingBlueprint?.versions[0];
    const previousPayload = previousVersion ? {
      goals: previousVersion.goalsJson,
      now: previousVersion.nowJson,
      next: previousVersion.nextJson,
      later: previousVersion.laterJson,
      conditional: previousVersion.conditionalJson,
    } : null;
    const blueprintChanged = JSON.stringify(previousPayload) !== JSON.stringify(phasePayload);
    if (!existingBlueprint) {
      await tx.growthBlueprint.create({
        data: {
          projectId: project.id,
          title: `${ctx.name} Growth Blueprint`,
          status: "active",
          currentVersion: 1,
          primaryGoal: boundedText(ctx.primaryGoal, 255),
          approvedStrategyId: ctx.approvedStrategy?.id,
          nextReviewAt: new Date(Date.now() + 7 * 86_400_000),
          versions: {
            create: {
              version: 1,
              status: "active",
              goalsJson: phasePayload.goals,
              nowJson: phasePayload.now,
              nextJson: phasePayload.next,
              laterJson: phasePayload.later,
              conditionalJson: phasePayload.conditional,
              evidenceJson: { diagnosis: score.bottleneckType, signalCount: signals.length },
              reason: "Initial Blueprint generated from the approved strategy and normalized project signals.",
              engineVersion: GROWTH_ENGINE_VERSION,
              createdByUserId: context.membership.userId,
            },
          },
        },
      });
    } else if (blueprintChanged) {
      const version = existingBlueprint.currentVersion + 1;
      await tx.growthBlueprintVersion.create({
        data: {
          blueprintId: existingBlueprint.id,
          version,
          status: "active",
          goalsJson: phasePayload.goals,
          nowJson: phasePayload.now,
          nextJson: phasePayload.next,
          laterJson: phasePayload.later,
          conditionalJson: phasePayload.conditional,
          evidenceJson: { diagnosis: score.bottleneckType, signalCount: signals.length },
          reason: `Blueprint refreshed after a ${input.runType.replace(/_/g, " ")} Growth Engine run.`,
          engineVersion: GROWTH_ENGINE_VERSION,
          createdByUserId: context.membership.userId,
        },
      });
      await tx.growthBlueprint.update({
        where: { id: existingBlueprint.id },
        data: { currentVersion: version, primaryGoal: boundedText(ctx.primaryGoal, 255), approvedStrategyId: ctx.approvedStrategy?.id, nextReviewAt: new Date(Date.now() + 7 * 86_400_000) },
      });
    } else {
      await tx.growthBlueprint.update({
        where: { id: existingBlueprint.id },
        data: { nextReviewAt: new Date(Date.now() + 7 * 86_400_000) },
      });
    }

    const aiRun = await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "growth_engine",
        promptVersion: GROWTH_ENGINE_VERSION,
        inputSnapshotJson: { runType: input.runType, signals: signals.map((signal) => ({ key: signal.signalKey, confidence: signal.confidence, freshness: signalFreshness(signal) })) },
        outputJson: { findings, candidateCount: candidates.length, selectedDedupeKey: selected?.dedupeKey ?? null, phases } as unknown as Prisma.InputJsonValue,
      },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "growth_engine.run_completed",
      entityType: "ai_run",
      entityId: aiRun.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: { runType: input.runType, candidateCount: candidates.length, selectedDedupeKey: selected?.dedupeKey ?? null, engineVersion: GROWTH_ENGINE_VERSION },
    });
  }, { timeout: 15_000 });

  await refreshSupportingContentPlan(context, project);
  return { score, signals, findings, candidates, selected, phases };
}

function funnelDefinitions(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, score: ReturnType<typeof scoreProject>) {
  const ctx = projectContext(project);
  return [
    { stageKey: "traffic_sources", title: "Traffic sources", metric: `${score.keywordRuns} keyword runs`, health: score.scoreJson.traffic, issue: score.keywordRuns ? "Traffic inputs exist. Keep mapping demand to pages." : "Keyword and traffic source data is missing.", automation: "execute_through_integration" },
    { stageKey: "landing_page", title: "Landing page", metric: score.latestCrawl ? `${score.latestCrawl.siteScore ?? 0}/100 site score` : "No crawl", health: score.latestCrawl?.siteScore ?? 35, issue: score.latestCrawl ? "Use crawl findings to improve clarity and page health." : "Run site analysis before conversion work.", automation: "execute_through_integration" },
    { stageKey: "lead_capture", title: "Lead capture", metric: score.hasLeadMagnetTask ? "Lead magnet task exists" : "No lead capture asset", health: score.scoreJson.leadCapture, issue: score.hasLeadMagnetTask ? "Lead capture is planned. Review landing page and form flow." : "Create a lead magnet or capture offer.", automation: "generate" },
    { stageKey: "follow_up", title: "Follow-up", metric: `${score.socialPosts} planned social posts`, health: score.scoreJson.followUp, issue: "Email and nurture follow-up should be reviewed before sending.", automation: "prepare" },
    { stageKey: "conversion", title: "Conversion", metric: ctx.primaryGoal, health: score.scoreJson.conversion, issue: "CTA clarity, proof, objections, and form friction need measurable checks.", automation: "generate" },
    { stageKey: "retention_referral", title: "Retention / referral", metric: "Manual tracking", health: score.scoreJson.retention, issue: "Add retention, referral, or review prompts after lead capture is stable.", automation: "manual_guided" },
  ].map((stage, index) => ({
    ...stage,
    status: stage.health >= 75 ? "healthy" : stage.health >= 55 ? "watch" : "needs_attention",
    sortOrder: index + 1,
  }));
}

function experimentIdeas(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, bottleneckType: string) {
  const ctx = projectContext(project);
  const base = [
    {
      title: "Improve primary CTA clarity",
      hypothesis: `If ${ctx.name} uses a clearer primary CTA tied to ${ctx.offer}, more visitors will take the next step.`,
      metric: "CTA click-through rate",
      successThreshold: "Increase CTA clicks by 15% within 14 days",
      assets: ["CTA copy", "Hero section variant", "Tracking task"],
      impact: bottleneckType === "conversion" ? 9 : 7,
      confidence: 8,
      ease: 8,
      potential: 8,
      importance: 9,
    },
    {
      title: "Launch a focused lead magnet test",
      hypothesis: `If ${ctx.audience} receives a useful lead magnet before booking, lead capture will improve.`,
      metric: "Lead conversion rate",
      successThreshold: "Capture 10 qualified leads or improve opt-in rate by 20%",
      assets: ["Lead magnet outline", "Landing page copy", "Delivery email"],
      impact: bottleneckType === "leadCapture" ? 9 : 8,
      confidence: 7,
      ease: 6,
      potential: 9,
      importance: 8,
    },
    {
      title: "Create one authority-backed SEO page",
      hypothesis: `If ${ctx.name} publishes one page mapped to proven demand and clear proof, qualified traffic will increase.`,
      metric: "Organic visits and ranking movement",
      successThreshold: "Page indexed and reaches top 30 for one target query",
      assets: ["Keyword cluster", "Page brief", "Internal link plan"],
      impact: bottleneckType === "traffic" || bottleneckType === "authority" ? 9 : 7,
      confidence: 7,
      ease: 6,
      potential: 8,
      importance: 8,
    },
  ];
  return base.map((idea) => ({
    ...idea,
    ice: idea.impact * idea.confidence * idea.ease,
    pie: idea.potential * idea.importance * idea.ease,
  })).sort((a, b) => b.ice - a.ice);
}

async function activePlanId(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { name: true } });
  return (await tx.executionPlan.create({ data: { projectId, title: `${project?.name ?? "Project"} execution plan` } })).id;
}

async function upsertGrowthTask(tx: Prisma.TransactionClient, input: {
  project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>;
  sourceType?: string;
  sourceId?: string | null;
  key: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  automationLevel: AutomationLevel;
  safetyCategory?: string;
  relatedUrl?: string;
  actionButtonLabel?: string;
  manualInstructions?: string;
  moduleName?: string;
  relatedModule?: string;
  approvalSnapshotJson?: Prisma.InputJsonValue;
}) {
  const policy = policyForModule("growth_marketing");
  const executionPlanId = await activePlanId(tx, input.project.id);
  const existing = await tx.executionTask.findUnique({ where: { dedupeKey: input.key } });
  const data = {
    clientId: input.project.clientId,
    websiteId: input.project.websiteId,
    projectId: input.project.id,
    executionPlanId,
    moduleName: input.moduleName ?? "growth_marketing",
    sourceType: input.sourceType ?? "growth_engine",
    sourceId: input.sourceId ?? input.project.id,
    title: input.title,
    description: input.description,
    priority: input.priority,
    automationLevel: input.automationLevel,
    status: "ready",
    requiresApproval: approvalRequiredForLevel(input.automationLevel),
    requiresIntegration: input.automationLevel === "execute_through_integration",
    manualRequired: input.automationLevel === "manual_guided",
    safetyCategory: input.safetyCategory ?? policy.safetyCategory,
    relatedModule: input.relatedModule ?? input.moduleName ?? "growth_marketing",
    actionButtonLabel: input.actionButtonLabel ?? "Review Growth Task",
    relatedUrl: input.relatedUrl ?? "/growth",
    manualInstructions: input.manualInstructions ?? "Review the generated recommendation, approve any live changes, and record the result after the experiment runs.",
    impact: "Connects strategy and execution work to a measurable growth experiment.",
    ...(input.approvalSnapshotJson ? { approvalSnapshotJson: input.approvalSnapshotJson } : {}),
  };
  if (!existing) return tx.executionTask.create({ data: { ...data, dedupeKey: input.key } });
  if (terminalStatuses.has(existing.status)) return existing;
  return tx.executionTask.update({ where: { id: existing.id }, data });
}

async function loadGrowthOverview(projectId: string) {
  const [diagnosis, funnelStages, experiments, channelTests, reports, blueprint, contentRoadmap, evidenceSignals, candidateActions, learnings, recentRuns] = await Promise.all([
    prisma.growthDiagnosis.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.growthFunnelStage.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.growthExperiment.findMany({ where: { projectId }, orderBy: [{ status: "asc" }, { iceScore: "desc" }], include: { assets: true, results: { orderBy: { recordedAt: "desc" }, take: 3 } } }),
    prisma.growthChannelTest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.growthReport.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.growthBlueprint.findUnique({ where: { projectId }, include: { versions: { orderBy: { version: "desc" }, take: 10 } } }),
    prisma.growthContentRoadmap.findUnique({
      where: { projectId },
      include: {
        opportunities: { orderBy: [{ queue: "asc" }, { priorityScore: "desc" }, { createdAt: "asc" }] },
        batches: { orderBy: { createdAt: "desc" }, take: 20, include: { opportunities: { select: { id: true, title: true, lifecycleStatus: true, executionTaskId: true, generationId: true } } } },
      },
    }),
    prisma.growthSignal.findMany({ where: { projectId }, orderBy: [{ category: "asc" }, { effectiveDate: "desc" }] }),
    prisma.nextBestAction.findMany({
      where: { projectId, sourceType: { in: ["growth_engine", "citation_recommendation"] } },
      orderBy: [{ status: "asc" }, { priorityScore: "desc" }, { createdAt: "desc" }],
      include: { followupTask: { select: { id: true, title: true, status: true, relatedUrl: true } } },
    }),
    prisma.projectGrowthLearning.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.aiRun.findMany({ where: { projectId, moduleName: "growth_engine" }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return {
    diagnosis,
    funnelStages,
    experiments,
    channelTests,
    reports,
    blueprint,
    contentRoadmap,
    evidenceSignals,
    candidateActions,
    selectedAction: candidateActions.find((action) => action.status === "selected")
      ?? candidateActions.find((action) => action.status === "accepted" && action.followupTask && !terminalStatuses.has(action.followupTask.status))
      ?? null,
    learnings,
    recentRuns,
  };
}

async function refreshSupportingContentPlan(
  context: WorkspaceContext,
  project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>,
) {
  const generated = buildSupportingContentRoadmap(project);
  const existing = await prisma.growthContentRoadmap.findUnique({
    where: { projectId: project.id },
    include: { opportunities: true },
  });
  const existingByKey = new Map(existing?.opportunities.map((item) => [item.dedupeKey, item]) ?? []);
  const generatedKeys = generated.opportunities.map((item) => item.dedupeKey);
  const protectedStatuses = new Set(["approved", "generating", "needs_review", "scheduled", "published", "measuring", "completed", "rejected"]);
  const roadmap = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.growthContentRoadmap.update({
          where: { id: existing.id },
          data: {
            status: "active",
            currentVersion: { increment: 1 },
            recommendedCadence: generated.recommendedCadence,
            recommendationRationale: generated.rationale,
            lastResearchedAt: new Date(),
            nextReviewAt: new Date(Date.now() + 30 * 86_400_000),
          },
        })
      : await tx.growthContentRoadmap.create({
          data: {
            projectId: project.id,
            status: "active",
            currentVersion: 1,
            recommendedCadence: generated.recommendedCadence,
            recommendationRationale: generated.rationale,
            lastResearchedAt: new Date(),
            nextReviewAt: new Date(Date.now() + 30 * 86_400_000),
          },
        });
    for (const item of generated.opportunities) {
      const prior = existingByKey.get(item.dedupeKey);
      const preserveDecision = Boolean(prior && protectedStatuses.has(prior.lifecycleStatus));
      const data = {
        title: item.title,
        contentType: "article",
        primaryKeyword: item.primaryKeyword,
        searchIntent: item.searchIntent,
        clusterName: item.clusterName,
        serviceName: item.serviceName,
        locationName: item.locationName,
        targetPageId: item.targetPageId,
        targetUrl: item.targetUrl,
        internalLinkTargetPageId: item.internalLinkTargetPageId,
        internalLinkTargetUrl: item.internalLinkTargetUrl,
        businessPurpose: item.businessPurpose,
        recommendationReason: item.recommendationReason,
        expectedImpact: item.expectedImpact,
        priorityScore: item.priorityScore,
        confidence: item.confidence,
        queue: preserveDecision ? prior!.queue : item.queue,
        lifecycleStatus: preserveDecision ? prior!.lifecycleStatus : "proposed",
        plannedPhase: preserveDecision ? prior!.plannedPhase : item.plannedPhase,
        plannedPublishAt: preserveDecision ? prior!.plannedPublishAt : item.plannedPublishAt,
        conditionsJson: item.conditionsJson as Prisma.InputJsonValue,
        evidenceJson: item.evidenceJson as Prisma.InputJsonValue,
      };
      await tx.growthContentOpportunity.upsert({
        where: { projectId_dedupeKey: { projectId: project.id, dedupeKey: item.dedupeKey } },
        update: data,
        create: {
          roadmapId: row.id,
          projectId: project.id,
          dedupeKey: item.dedupeKey,
          ...data,
        },
      });
    }
    if (generatedKeys.length) {
      await tx.growthContentOpportunity.updateMany({
        where: {
          roadmapId: row.id,
          dedupeKey: { notIn: generatedKeys },
          lifecycleStatus: { in: ["proposed", "queued", "deferred"] },
        },
        data: { lifecycleStatus: "superseded" },
      });
    }
    const active = await tx.growthContentOpportunity.findMany({
      where: { roadmapId: row.id, lifecycleStatus: { notIn: ["rejected", "superseded"] } },
      select: { queue: true },
    });
    const counts = {
      now: active.filter((item) => item.queue === "now").length,
      next: active.filter((item) => item.queue === "next").length,
      later: active.filter((item) => item.queue === "later").length,
      conditional: active.filter((item) => item.queue === "conditional").length,
    };
    await tx.growthContentRoadmap.update({
      where: { id: row.id },
      data: {
        opportunityCount: active.length,
        nowCount: counts.now,
        nextCount: counts.next,
        laterCount: counts.later,
        conditionalCount: counts.conditional,
      },
    });
    const aiRun = await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "growth_content_roadmap",
        promptVersion: GROWTH_ENGINE_VERSION,
        inputSnapshotJson: {
          keywordRuns: project.keywordResearchRuns.length,
          keywordIdeas: project.keywordResearchRuns.reduce((sum, run) => sum + run.ideas.length, 0),
          keywordGroups: project.keywordGroups.length,
          websitePages: project.websiteBuilds[0]?.pages.length ?? 0,
          targetMarkets: jsonList(project.targetLocations),
        },
        outputJson: { roadmapId: row.id, version: existing ? existing.currentVersion + 1 : 1, opportunityCount: active.length, counts, cadence: generated.recommendedCadence },
      },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "growth_content_roadmap.refreshed",
      entityType: "growth_content_roadmap",
      entityId: row.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: { aiRunId: aiRun.id, opportunityCount: active.length, counts, cadence: generated.recommendedCadence },
    });
    return row;
  }, { timeout: 30_000 });
  return roadmap;
}

growthRouter.get("/projects-v2/:projectId/growth/overview", async (req, res) => {
  await authorizeProject(req, req.params.projectId);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const score = scoreProject(project);
  const readiness = growthReadiness(project);
  const growth = await loadGrowthOverview(project.id);
  res.json({ project, signals: score, readiness, growth, automationPolicy: policyForModule("growth_marketing") });
});

growthRouter.post("/projects-v2/:projectId/growth/analyze", async (req, res) => {
  const context = await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  await runGrowthEngine({ req, context, project, runType: "manual" });

  const score = scoreProject(project);
  const growth = await loadGrowthOverview(project.id);
  res.json({ project, signals: score, readiness, growth, automationPolicy: policyForModule("growth_marketing") });
});

growthRouter.post("/projects-v2/:projectId/growth/content-roadmap/refresh", async (req, res) => {
  const context = await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  let project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const blueprintExists = Boolean(await prisma.growthBlueprint.findUnique({ where: { projectId: project.id }, select: { id: true } }));
  if (!blueprintExists) {
    await runGrowthEngine({ req, context, project, runType: "manual" });
  } else {
    await refreshSupportingContentPlan(context, project);
  }
  res.json({ growth: await loadGrowthOverview(project.id) });
});

const contentOpportunityUpdateSchema = z.object({
  queue: z.enum(["now", "next", "later", "conditional"]).optional(),
  lifecycleStatus: z.enum(["proposed", "deferred", "rejected"]).optional(),
}).refine((input) => Boolean(input.queue || input.lifecycleStatus), { message: "Choose a queue or status update." });

growthRouter.patch("/projects-v2/:projectId/growth/content-roadmap/opportunities/:opportunityId", async (req, res) => {
  const parsed = contentOpportunityUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await authorizeProject(req, req.params.projectId, "execute_tasks");
  const opportunity = await prisma.growthContentOpportunity.findFirst({
    where: { id: req.params.opportunityId, projectId: req.params.projectId },
  });
  if (!opportunity) return res.status(404).json({ error: "Content opportunity not found." });
  if (["generating", "needs_review", "scheduled", "published", "measuring", "completed"].includes(opportunity.lifecycleStatus)) {
    return res.status(409).json({ error: "Generated or published content cannot be moved back into planning. Open its linked task to continue the workflow." });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.growthContentOpportunity.update({
      where: { id: opportunity.id },
      data: parsed.data,
    });
    const active = await tx.growthContentOpportunity.findMany({
      where: { roadmapId: opportunity.roadmapId, lifecycleStatus: { notIn: ["rejected", "superseded"] } },
      select: { queue: true },
    });
    await tx.growthContentRoadmap.update({
      where: { id: opportunity.roadmapId },
      data: {
        opportunityCount: active.length,
        nowCount: active.filter((item) => item.queue === "now").length,
        nextCount: active.filter((item) => item.queue === "next").length,
        laterCount: active.filter((item) => item.queue === "later").length,
        conditionalCount: active.filter((item) => item.queue === "conditional").length,
      },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "growth_content_opportunity.updated",
      entityType: "growth_content_opportunity",
      entityId: row.id,
      projectId: opportunity.projectId,
      previousJson: { queue: opportunity.queue, lifecycleStatus: opportunity.lifecycleStatus },
      nextJson: { queue: row.queue, lifecycleStatus: row.lifecycleStatus },
    });
    return row;
  });
  res.json({ opportunity: updated, growth: await loadGrowthOverview(opportunity.projectId) });
});

const contentBatchApprovalSchema = z.object({
  opportunityIds: z.array(z.string().min(1)).min(1).max(20),
  title: z.string().trim().min(2).max(220).optional(),
});

growthRouter.post("/projects-v2/:projectId/growth/content-roadmap/batches/approve", async (req, res) => {
  const parsed = contentBatchApprovalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await authorizeProject(req, req.params.projectId, "approve");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const opportunities = await prisma.growthContentOpportunity.findMany({
    where: { id: { in: parsed.data.opportunityIds }, projectId: project.id },
    orderBy: { priorityScore: "desc" },
  });
  if (opportunities.length !== new Set(parsed.data.opportunityIds).size) return res.status(404).json({ error: "One or more selected content opportunities were not found." });
  const unavailable = opportunities.filter((item) => !["proposed", "deferred"].includes(item.lifecycleStatus) || item.executionTaskId);
  if (unavailable.length) return res.status(409).json({ error: `${unavailable.length} selected item${unavailable.length === 1 ? " is" : "s are"} already approved, generated, rejected, or unavailable.` });
  const queues = [...new Set(opportunities.map((item) => item.queue))];
  const phase = queues.length === 1 ? opportunities[0].plannedPhase : "mixed_approved_batch";
  const batch = await prisma.$transaction(async (tx) => {
    const roadmap = await tx.growthContentRoadmap.findUnique({ where: { projectId: project.id } });
    if (!roadmap) throw Object.assign(new Error("Generate the Supporting Content Plan before approving a batch."), { statusCode: 409 });
    const row = await tx.growthContentBatch.create({
      data: {
        roadmapId: roadmap.id,
        projectId: project.id,
        title: parsed.data.title || `${queues.map((queue) => queue.charAt(0).toUpperCase() + queue.slice(1)).join(" + ")} supporting-content batch`,
        phase,
        status: "approved",
        rationale: `Approved ${opportunities.length} prioritized supporting-content opportunities for phased AI generation. Each item retains its keyword, intent, cluster, target page, internal-link role, and business purpose.`,
        opportunityCount: opportunities.length,
        approvedByUserId: context.membership.userId,
        approvedAt: new Date(),
        createdByUserId: context.membership.userId,
      },
    });
    for (const opportunity of opportunities) {
      const manualInstructions = [
        "Approved Supporting Content Plan brief:",
        `Title: ${opportunity.title}`,
        `Primary keyword: ${opportunity.primaryKeyword}`,
        `Search intent: ${opportunity.searchIntent}`,
        `Authority cluster: ${opportunity.clusterName}`,
        opportunity.locationName ? `Location: ${opportunity.locationName}` : "",
        `Business purpose: ${opportunity.businessPurpose}`,
        `Recommendation reason: ${opportunity.recommendationReason}`,
        opportunity.expectedImpact ? `Expected impact: ${opportunity.expectedImpact}` : "",
        opportunity.targetUrl ? `Target supporting destination: ${opportunity.targetUrl}` : "",
        opportunity.internalLinkTargetUrl ? `Required internal-link destination: ${opportunity.internalLinkTargetUrl}` : "",
        "Create one original, useful supporting article. Do not create near-duplicate city variants or invent claims, people, credentials, statistics, or sources.",
      ].filter(Boolean).join("\n");
      const task = await upsertGrowthTask(tx, {
        project,
        sourceType: "growth_content_opportunity",
        sourceId: opportunity.id,
        key: `growth-content-opportunity:${opportunity.id}`,
        title: `Create supporting content: ${opportunity.title}`,
        description: opportunity.businessPurpose,
        priority: opportunity.priorityScore >= 80 ? "high" : opportunity.priorityScore >= 55 ? "medium" : "low",
        automationLevel: "prepare",
        safetyCategory: "review_required",
        moduleName: "content",
        relatedModule: "growth_marketing",
        actionButtonLabel: "Generate with AI",
        relatedUrl: `/ai-content?projectId=${project.id}`,
        manualInstructions,
        approvalSnapshotJson: {
          growthContentOpportunityId: opportunity.id,
          growthContentBatchId: row.id,
          targetUrl: opportunity.targetUrl,
          contentPlanning: {
            keyword: opportunity.primaryKeyword,
            searchIntent: opportunity.searchIntent,
            targetUrl: opportunity.targetUrl,
            gapAnalysis: opportunity.recommendationReason,
            brief: manualInstructions,
            clusterName: opportunity.clusterName,
            internalLinkTargetUrl: opportunity.internalLinkTargetUrl,
            plannedPhase: opportunity.plannedPhase,
          },
        } as Prisma.InputJsonValue,
      });
      const relatedUrl = `/ai-content?projectId=${project.id}&taskId=${task.id}&open=1`;
      await tx.executionTask.update({ where: { id: task.id }, data: { relatedUrl } });
      await tx.growthContentOpportunity.update({
        where: { id: opportunity.id },
        data: {
          batchId: row.id,
          lifecycleStatus: "approved",
          executionTaskId: task.id,
          approvedByUserId: context.membership.userId,
          approvedAt: new Date(),
        },
      });
    }
    await recordWorkspaceActivity(tx, {
      context,
      action: "growth_content_batch.approved",
      entityType: "growth_content_batch",
      entityId: row.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: { opportunityIds: opportunities.map((item) => item.id), opportunityCount: opportunities.length, phase },
    });
    return row;
  }, { timeout: 30_000 });
  res.json({ batch, growth: await loadGrowthOverview(project.id) });
});

growthRouter.post("/projects-v2/:projectId/growth/funnel-map", async (req, res) => {
  await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const score = scoreProject(project);
  const stages = funnelDefinitions(project, score);
  await prisma.$transaction(async (tx) => {
    for (const stage of stages) {
      await tx.growthFunnelStage.upsert({
        where: { projectId_stageKey: { projectId: project.id, stageKey: stage.stageKey } },
        update: { title: boundedText(stage.title, 180), status: boundedText(stage.status, 60), conversionMetric: boundedText(stage.metric, 120), issueSummary: stage.issue, automationStatus: boundedText(stage.automation, 60), sortOrder: stage.sortOrder },
        create: { projectId: project.id, stageKey: boundedText(stage.stageKey, 80), title: boundedText(stage.title, 180), status: boundedText(stage.status, 60), conversionMetric: boundedText(stage.metric, 120), issueSummary: stage.issue, automationStatus: boundedText(stage.automation, 60), sortOrder: stage.sortOrder },
      });
    }
  });
  res.json(await loadGrowthOverview(project.id));
});

growthRouter.post("/projects-v2/:projectId/growth/experiments/generate", async (req, res) => {
  const context = await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const latestDiagnosis = await prisma.growthDiagnosis.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
  const score = scoreProject(project);
  const bottleneckType = latestDiagnosis?.bottleneckType ?? score.bottleneckType;
  const ideas = experimentIdeas(project, bottleneckType);
  const selectedAction = await prisma.nextBestAction.findFirst({
    where: { projectId: project.id, sourceType: "growth_engine", status: { in: ["selected", "accepted"] } },
    orderBy: [{ status: "asc" }, { priorityScore: "desc" }],
  });

  await prisma.$transaction(async (tx) => {
    for (const idea of ideas) {
      const existing = await tx.growthExperiment.findFirst({
        where: { projectId: project.id, title: idea.title, status: { notIn: ["failed", "completed", "scaled"] } },
      });
      if (existing) continue;
      const experiment = await tx.growthExperiment.create({
        data: {
          projectId: project.id,
          title: idea.title,
          hypothesis: idea.hypothesis,
          metric: idea.metric,
          successThreshold: idea.successThreshold,
          iceScore: idea.ice,
          pieScore: idea.pie,
          impactScore: idea.impact,
          confidenceScore: idea.confidence,
          easeScore: idea.ease,
          potentialScore: idea.potential,
          importanceScore: idea.importance,
          requiredAssets: idea.assets,
          automationLevel: "prepare",
          requiresApproval: true,
          safetyCategory: "review_required",
          guardrailMetrics: ["No unapproved live publishing", "Do not weaken privacy, consent, accessibility, or business identity"],
          baselineJson: { bottleneckType, score: score.scoreJson[bottleneckType as keyof typeof score.scoreJson] ?? null },
          sourceActionId: selectedAction?.id,
          reviewAt: new Date(Date.now() + 14 * 86_400_000),
        },
      });
      for (const asset of idea.assets) {
        await tx.growthExperimentAsset.create({
          data: {
            experimentId: experiment.id,
            assetType: asset.toLowerCase().replace(/\s+/g, "_"),
            title: asset,
            approvalStatus: "needs_review",
            contentJson: { generatedBy: "growth_engine", status: "draft" },
          },
        });
      }
      await recordWorkspaceActivity(tx, {
        context,
        action: "growth_experiment.prepared",
        entityType: "growth_experiment",
        entityId: experiment.id,
        agencyClientId: project.agencyClientId,
        projectId: project.id,
        nextJson: { title: idea.title, sourceActionId: selectedAction?.id ?? null, requiresApproval: true },
      });
    }
  }, { timeout: 15_000 });

  res.json(await loadGrowthOverview(project.id));
});

growthRouter.post("/growth/experiments/:experimentId/start", async (req, res) => {
  const experiment = await prisma.growthExperiment.findFirst({
    where: { id: req.params.experimentId },
    include: { project: true },
  });
  if (!experiment) return res.status(404).json({ error: "experiment not found" });
  const context = await authorizeProject(req, experiment.projectId, "execute_tasks");
  const project = await scopedProject(req, experiment.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const updated = await prisma.$transaction(async (tx) => {
    const task = await upsertGrowthTask(tx, {
      project,
      sourceType: "growth_experiment",
      sourceId: experiment.id,
      key: `project:${project.id}:growth:experiment:${experiment.id}`,
      title: `Run experiment: ${experiment.title}`,
      description: experiment.hypothesis,
      priority: experiment.iceScore >= 500 ? "high" : "medium",
      automationLevel: "prepare",
      actionButtonLabel: "Track Experiment",
      relatedUrl: `/growth?projectId=${project.id}&tab=tracker`,
    });
    if (!terminalStatuses.has(task.status)) {
      await tx.executionTask.update({ where: { id: task.id }, data: { status: "in_progress" } });
    }
    const row = await tx.growthExperiment.update({
      where: { id: experiment.id },
      data: { status: "running", startedAt: new Date() },
    });
    if (experiment.sourceActionId) {
      await tx.nextBestAction.updateMany({
        where: { id: experiment.sourceActionId, followupTaskId: null },
        data: { status: "accepted", decision: "accepted", decidedByUserId: context.membership.userId, decidedAt: new Date(), followupTaskId: task.id },
      });
    }
    await recordWorkspaceActivity(tx, {
      context,
      action: "growth_experiment.started",
      entityType: "growth_experiment",
      entityId: experiment.id,
      agencyClientId: experiment.project.agencyClientId,
      projectId: experiment.projectId,
      nextJson: { taskId: task.id, status: "running" },
    });
    return row;
  });
  res.json({ experiment: updated });
});

const resultSchema = z.object({
  baselineValue: z.number().optional(),
  currentValue: z.number().optional(),
  resultStatus: z.enum(["tracking", "winner", "failed", "inconclusive", "scaled"]).default("tracking"),
  notes: z.string().max(5000).optional(),
});

growthRouter.post("/growth/experiments/:experimentId/results", async (req, res) => {
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const experiment = await prisma.growthExperiment.findFirst({
    where: { id: req.params.experimentId },
    include: { project: true },
  });
  if (!experiment) return res.status(404).json({ error: "experiment not found" });
  const context = await authorizeProject(req, experiment.projectId, "execute_tasks");
  const terminal = ["winner", "failed", "inconclusive", "scaled"].includes(parsed.data.resultStatus);
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.growthExperimentResult.create({
      data: {
        experimentId: experiment.id,
        ...parsed.data,
        learningJson: {
          metric: experiment.metric,
          baselineValue: parsed.data.baselineValue ?? null,
          currentValue: parsed.data.currentValue ?? null,
          outcome: parsed.data.resultStatus,
        },
        evaluatedAt: terminal ? new Date() : null,
      },
    });
    if (terminal) {
      await tx.growthExperiment.update({
        where: { id: experiment.id },
        data: { status: parsed.data.resultStatus === "winner" ? "completed" : parsed.data.resultStatus, completedAt: new Date() },
      });
      await tx.projectGrowthLearning.create({
        data: {
          projectId: experiment.projectId,
          sourceType: "growth_experiment",
          sourceId: experiment.id,
          outcome: parsed.data.resultStatus === "winner" || parsed.data.resultStatus === "scaled" ? "won" : parsed.data.resultStatus === "failed" ? "lost" : "inconclusive",
          summary: parsed.data.notes || `${experiment.title} finished as ${parsed.data.resultStatus}.`,
          learningJson: { metric: experiment.metric, baselineValue: parsed.data.baselineValue ?? null, currentValue: parsed.data.currentValue ?? null },
        },
      });
    }
    await recordWorkspaceActivity(tx, {
      context,
      action: terminal ? "growth_experiment.evaluated" : "growth_experiment.measurement_recorded",
      entityType: "growth_experiment_result",
      entityId: row.id,
      agencyClientId: experiment.project.agencyClientId,
      projectId: experiment.projectId,
      nextJson: { resultStatus: parsed.data.resultStatus, terminal },
    });
    return row;
  });
  if (terminal) {
    const refreshedProject = await scopedProject(req, experiment.projectId);
    if (refreshedProject && growthReadiness(refreshedProject).canRun) {
      await runGrowthEngine({ req, context, project: refreshedProject, runType: "post_measure" });
    }
  }
  res.json({ result });
});

const growthDecisionSchema = z.object({
  decision: z.enum(["accepted", "edited", "deferred", "rejected", "alternatives"]),
  comment: z.string().trim().max(5000).optional(),
  title: z.string().trim().min(2).max(255).optional(),
  recommendation: z.string().trim().min(2).max(10000).optional(),
  route: z.enum(["content", "technical", "local_seo", "gbp", "citations_reviews", "authority"]).optional(),
  deferDays: z.number().int().min(1).max(180).optional(),
});

growthRouter.post("/projects-v2/:projectId/growth/actions/:actionId/decision", async (req, res) => {
  const parsed = growthDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await authorizeProject(req, req.params.projectId, "execute_tasks");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const action = await prisma.nextBestAction.findFirst({
    where: { id: req.params.actionId, projectId: project.id, sourceType: "growth_engine" },
  });
  if (!action) return res.status(404).json({ error: "Growth recommendation not found." });
  const input = parsed.data;
  const accepted = input.decision === "accepted" || input.decision === "edited";
  const reviewAfter = input.decision === "deferred"
    ? new Date(Date.now() + (input.deferDays ?? 7) * 86_400_000)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    let followupTaskId = action.followupTaskId;
    const title = input.title ?? action.title;
    const recommendation = input.recommendation ?? action.recommendation;
    const route = input.route ?? action.route;
    if (accepted && !followupTaskId) {
      const task = await upsertGrowthTask(tx, {
        project,
        sourceType: "next_best_action",
        sourceId: action.id,
        key: `next-best-action:${action.id}`,
        title,
        description: recommendation,
        priority: action.priorityScore >= 80 ? "high" : action.priorityScore >= 55 ? "medium" : "low",
        automationLevel: "prepare",
        safetyCategory: action.riskLevel === "high" ? "protected_change" : "review_required",
        actionButtonLabel: route === "content" ? "Create Growth Asset" : "Review Growth Task",
        relatedUrl: route === "content" ? `/ai-content?projectId=${project.id}` : `/guided-projects/${project.id}?tab=execution`,
        manualInstructions: "Review the accepted recommendation, prepare the scoped change, obtain any required publishing approval, and record baseline and result metrics.",
      });
      followupTaskId = task.id;
    }
    const status = accepted ? "accepted"
      : input.decision === "deferred" ? "deferred"
      : input.decision === "alternatives" ? "dismissed"
      : "rejected";
    const row = await tx.nextBestAction.update({
      where: { id: action.id },
      data: {
        status,
        decision: input.decision,
        decisionComment: input.comment,
        decidedByUserId: context.membership.userId,
        decidedAt: new Date(),
        title,
        recommendation,
        route,
        reviewAfter,
        followupTaskId,
      },
    });
    if (!accepted) {
      const alternatives = await tx.nextBestAction.findMany({
        where: { projectId: project.id, sourceType: "growth_engine", status: "recommended", id: { not: action.id } },
        orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
        take: 20,
      });
      const next = alternatives.find((candidate) => Array.isArray(candidate.dependencyIdsJson) && candidate.dependencyIdsJson.length === 0);
      if (next) {
        await tx.nextBestAction.update({ where: { id: next.id }, data: { status: "selected", selectedAt: new Date() } });
      }
    }
    if (input.decision === "rejected") {
      await tx.projectGrowthLearning.create({
        data: {
          projectId: project.id,
          sourceType: "next_best_action",
          sourceId: action.id,
          outcome: "feedback",
          summary: input.comment || `${title} was rejected by the user.`,
          learningJson: { decision: "rejected", actionType: action.actionType, route },
        },
      });
    }
    await recordWorkspaceActivity(tx, {
      context,
      action: "growth_recommendation.decided",
      entityType: "next_best_action",
      entityId: action.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      previousJson: { status: action.status, title: action.title, route: action.route },
      nextJson: { status, decision: input.decision, title, route, followupTaskId, reviewAfter: reviewAfter?.toISOString() ?? null },
    });
    return row;
  }, { timeout: 15_000 });

  if (input.decision === "alternatives") {
    await runGrowthEngine({ req, context, project, runType: "event", excludeDedupeKeys: action.dedupeKey ? [action.dedupeKey] : [] });
  }
  res.json({ nextBestAction: updated, growth: await loadGrowthOverview(project.id) });
});

growthRouter.post("/projects-v2/:projectId/growth/channel-tests", async (req, res) => {
  await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const channels = [
    { channel: "SEO", cadence: "2 optimized pages per month", metric: "Indexed pages and ranking movement", assetsNeeded: ["Keyword map", "Page briefs"] },
    { channel: "Social", cadence: "3 posts per week", metric: "Profile clicks and assisted leads", assetsNeeded: ["Post drafts", "Creative prompts"] },
    { channel: "Email", cadence: "4-message follow-up", metric: "Reply or booked-call rate", assetsNeeded: ["Sequence copy", "Lead magnet"] },
  ];
  await prisma.$transaction(channels.map((test) => prisma.growthChannelTest.create({ data: { projectId: project.id, durationDays: 30, status: "planned", ...test } })));
  res.json(await loadGrowthOverview(project.id));
});

growthRouter.post("/projects-v2/:projectId/growth/reports", async (req, res) => {
  await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const growth = await loadGrowthOverview(project.id);
  const latestBlueprint = growth.blueprint?.versions[0];
  const nowItems = latestBlueprint && Array.isArray(latestBlueprint.nowJson) ? latestBlueprint.nowJson : [];
  const learningItems = growth.learnings.slice(0, 5);
  const report = await prisma.growthReport.create({
    data: {
      projectId: project.id,
      clientId: project.clientId,
      reportType: "agency_growth_report",
      status: "draft",
      htmlContent: [
        `<h1>${escapeHtml(project.businessName ?? project.name)} Growth Report</h1>`,
        `<h2>Current diagnosis</h2><p>${escapeHtml(growth.diagnosis?.summary ?? "Run the Growth Engine to populate the diagnosis.")}</p>`,
        `<h2>Next Best Action</h2><p>${escapeHtml(growth.selectedAction?.title ?? "No undecided action is currently selected.")}</p><p>${escapeHtml(growth.selectedAction?.reasoningSummary ?? "")}</p>`,
        `<h2>Blueprint Now</h2><ul>${nowItems.map((item) => `<li>${escapeHtml(item && typeof item === "object" && "title" in item ? item.title : "Growth action")}</li>`).join("")}</ul>`,
        `<h2>Recent learning</h2><ul>${learningItems.map((item) => `<li>${escapeHtml(item.summary)}</li>`).join("")}</ul>`,
        "<p><em>Draft report. Human review is required before client delivery.</em></p>",
      ].join(""),
    },
  });
  res.json({ report });
});
