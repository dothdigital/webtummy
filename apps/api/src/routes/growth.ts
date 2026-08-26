import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@webtummy/db";
import { splitKeywordEntries } from "@webtummy/core";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { approvalRequiredForLevel, policyForModule, type AutomationLevel } from "../automation-policy.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext, type WorkspaceContext } from "../workspace-access.js";
import {
  GROWTH_ENGINE_VERSION,
  applyGrowthCapacityGate,
  buildBlueprintPhases,
  findingsFromScores,
  generateGrowthCandidates,
  growthEvidenceContradictions,
  normalizeGrowthCandidateForStorage,
  selectNextBestAction,
  signalFingerprint,
  signalFreshness,
  type GrowthSignalDraft,
} from "../growth-engine.js";
import { approvedStrategyContext } from "../strategy-ai.js";
import { getProjectWorkflowController, publishProjectWorkflowEvent } from "../project-workflow-controller.js";
import {
  GROWTH_INTELLIGENCE_CONTRACT_VERSION,
  createBlueprintPatch,
  evaluateMeasurement,
  safeObservedImpact,
  type EvidenceAvailability,
} from "../growth-intelligence-engine.js";
import { websiteTrackingDeviceMetrics, websiteTrackingMetrics } from "../website-tracking.js";
import { calculateWorkflowUnits, workspaceCapacitySummary } from "../commercial-capacity.js";

export const growthRouter = Router();
growthRouter.use(requireAuth);

const terminalStatuses = new Set(["completed", "skipped", "cancelled", "canceled"]);
type GrowthReadinessAction = { label: string; url: string };
type GrowthReadinessItem = {
  key: string;
  title: string;
  description: string;
  status: "complete" | "in_progress" | "missing";
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
          measurementPlans: { where: { active: true }, orderBy: { version: "desc" }, take: 1 },
          trackingSite: true,
          trackingEvents: { orderBy: { occurredAt: "desc" }, take: 5000 },
        },
      },
      keywordResearchRuns: { orderBy: { createdAt: "desc" }, take: 5, include: { ideas: { take: 200 } } },
      keywordGroups: { where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 100 },
      websiteBuilds: { orderBy: { updatedAt: "desc" }, take: 1, include: { pages: { where: { status: { not: "deferred" } }, orderBy: { sortOrder: "asc" }, take: 500 } } },
      socialPerformanceMetrics: { orderBy: { recordedAt: "desc" }, take: 200 },
      businessProfile: true,
      intakeAnswers: true,
      opportunities: { orderBy: { createdAt: "desc" }, take: 5 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
      executionTasks: { orderBy: { createdAt: "desc" }, take: 80 },
      measurementCheckpoints: { orderBy: { updatedAt: "desc" }, take: 100, include: { task: { select: { id: true, title: true, moduleName: true, status: true } } } },
      leadMagnetFunnels: { orderBy: { updatedAt: "desc" }, take: 20, include: { metrics: { orderBy: { createdAt: "desc" }, take: 10 }, espConnection: { select: { status: true, lastVerifiedAt: true, errorMessage: true } } } },
      backlinkProfileSnapshots: { where: { profileType: "owned" }, orderBy: { capturedAt: "desc" }, take: 2 },
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

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function savedCanonicalPages(tasks: Array<{ status: string; approvalSnapshotJson: unknown }>, rootUrl: string) {
  for (const task of tasks) {
    const snapshot = jsonRecord(task.approvalSnapshotJson);
    const planStatus = String(snapshot.contentPlanStatus ?? "");
    if (!["saved", "confirmed", "approved"].includes(planStatus) && !["completed", "approved"].includes(task.status)) continue;
    const contentPlan = jsonRecord(snapshot.contentPlan);
    const assignments = Array.isArray(contentPlan.pageAssignments) ? contentPlan.pageAssignments : [];
    const pages = assignments.flatMap((value, index) => {
      const item = jsonRecord(value);
      if (typeof item.canonicalKeyword !== "string" || typeof item.targetUrl !== "string") return [];
      const targetUrl = (() => { try { return new URL(item.targetUrl, rootUrl || undefined).toString(); } catch { return item.targetUrl; } })();
      return [{
        id: `canonical-page:${index}:${normalizedTopic(item.canonicalKeyword).replace(/\s+/g, "-")}`.slice(0, 191),
        title: typeof item.pageName === "string" ? item.pageName : item.canonicalKeyword,
        primaryKeyword: item.canonicalKeyword,
        secondaryKeywords: Array.isArray(item.secondaryKeywords) ? item.secondaryKeywords.map(String).filter(Boolean) : [],
        sortOrder: index,
        targetUrl,
        slug: (() => { try { return new URL(targetUrl, rootUrl || undefined).pathname.replace(/^\//, ""); } catch { return targetUrl.replace(/^\//, ""); } })(),
        pageType: typeof item.clusterRole === "string" ? item.clusterRole : typeof item.searchIntent === "string" ? item.searchIntent : "planned",
      }];
    });
    if (pages.length) return pages;
  }
  return [];
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
  plannedPhase: string;
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
  const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved") ?? null;
  const strategyContract = approvedStrategyContext(approvedStrategy);
  return {
    name: project.businessName ?? project.name,
    website: project.website?.rootUrl ?? project.websiteUrl ?? null,
    niche: project.niche ?? project.businessProfile?.businessSummary ?? "this market",
    audience: strategyContract?.audience ?? project.businessProfile?.targetAudience ?? "the target audience",
    offer: strategyContract?.offer ?? project.businessProfile?.offerSummary ?? project.primaryGoal ?? "the main offer",
    primaryGoal,
    goal: [primaryGoal, ...secondaryGoals].filter(Boolean).join("; "),
    secondaryGoals,
    businessLocation: project.businessLocation,
    targetMarkets,
    market: targetMarkets.join(", ") || project.targetLocation || "the target market",
    outputs: jsonList(project.preferredOutputs),
    strategy: project.strategyPlans[0] ?? null,
    approvedStrategy,
    strategyContract,
  };
}

function growthReadiness(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const intakeComplete = Boolean(project.businessProfile || project.intakeAnswers.length > 0);
  const opportunityExists = project.opportunities.length > 0;
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const hasWebsite = Boolean(project.website);
  const latestCrawl = project.website?.crawlJobs[0] ?? null;
  const siteAnalysisComplete = Boolean(latestCrawl && latestCrawl.status === "completed");
  const siteAnalysisInProgress = Boolean(latestCrawl && ["queued", "running"].includes(latestCrawl.status));

  const items: GrowthReadinessItem[] = [
    {
      key: "intake",
      title: "Project intake required",
      description: "SEnuke AI - AI Growth Operating System needs the business profile, audience, offer, goal, and project context before advanced growth analysis can run.",
      status: intakeComplete ? "complete" : "missing",
      required: true,
      actions: [{ label: "Complete Intake", url: `/guided-projects/${project.id}/intake` }],
    },
    {
      key: "opportunity",
      title: "Opportunity required",
      description: "SEnuke AI - AI Growth Operating System needs to know what direction this project is targeting before it can create growth recommendations.",
      status: opportunityExists ? "complete" : "missing",
      required: true,
      actions: [{ label: "Find Opportunity", url: `/opportunities?projectId=${project.id}` }],
    },
    {
      key: "strategy",
      title: "Strategy required",
      description: "SEnuke AI - AI Growth Operating System needs an approved strategy before it can diagnose growth bottlenecks or create experiments.",
      status: strategyApproved ? "complete" : "missing",
      required: true,
      actions: [{ label: "Generate Strategy", url: `/strategy?projectId=${project.id}` }],
    },
  ];

  if (!hasWebsite) {
    items.push({
      key: "website",
      title: "No website found",
      description: "Create or connect a website first so SEnuke AI - AI Growth Operating System can analyze and optimize it.",
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
      title: siteAnalysisInProgress ? "Site analysis in progress" : "Site analysis required",
      description: siteAnalysisInProgress
        ? "SEnuke AI - AI Growth Operating System is currently analyzing this website. Growth recommendations will unlock automatically when the crawl finishes."
        : "SEnuke AI - AI Growth Operating System needs to analyze your website before it can evaluate funnel gaps, conversion issues, SEO issues, internal links, AI citations, or page improvements.",
      status: siteAnalysisComplete ? "complete" : siteAnalysisInProgress ? "in_progress" : "missing",
      required: true,
      actions: [{ label: siteAnalysisInProgress ? "View progress" : "Analyze Site", url: `/site-analysis?projectId=${project.id}` }],
    });
  }

  const missing = items.filter((item) => item.required && item.status !== "complete");
  return {
    canRun: missing.length === 0,
    status: missing.length === 0 ? "ready" : "blocked",
    message: missing.length === 0
      ? "Growth Engine has the required foundation data for this project."
      : "Before SEnuke AI - AI Growth Operating System can run this, we need to complete these missing steps.",
    items,
    missing,
  };
}

async function growthWorkflowBlocker(projectId: string) {
  const workflow = await getProjectWorkflowController(projectId);
  if (!workflow) return { error: "workflow_controller_unavailable", message: "Project workflow readiness could not be loaded." };
  if (!workflow.intelligenceReady) return {
    error: "growth_intelligence_stale_or_incomplete",
    message: "Complete or refresh the required Keyword, Site, Gap, Local SEO, AI Citation, and Authority intelligence before running Growth.",
    workflow,
  };
  // Newer evidence is advisory. Growth may continue from the approved
  // Strategy so customers are not forced into another credit-consuming run.
  return null;
}

function scoreProject(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const latestCrawl = project.website?.crawlJobs[0] ?? null;
  const openTasks = project.executionTasks.filter((task) => !terminalStatuses.has(task.status));
  const highIssues = latestCrawl?.issues.filter((issue) => issue.severity === "high").length ?? 0;
  const keywordRuns = project.keywordResearchRuns.length;
  const socialPosts = project.website?.socialStrategies[0]?.posts.length ?? 0;
  const socialPerformance = project.socialPerformanceMetrics.reduce((sum, metric) => ({
    impressions: sum.impressions + metric.impressions,
    engagements: sum.engagements + metric.engagements,
    clicks: sum.clicks + metric.clicks,
    leads: sum.leads + metric.leads,
    conversions: sum.conversions + metric.conversions,
  }), { impressions: 0, engagements: 0, clicks: 0, leads: 0, conversions: 0 });
  const socialEngagementRate = socialPerformance.impressions ? socialPerformance.engagements / socialPerformance.impressions * 100 : 0;
  const trackingEvents = project.website?.trackingEvents ?? [];
  const trackingMetrics = websiteTrackingMetrics(trackingEvents);
  const deviceTrackingMetrics = websiteTrackingDeviceMetrics(trackingEvents);
  const mobileCompletionRate = deviceTrackingMetrics.mobile.formStarts ? deviceTrackingMetrics.mobile.formSuccesses / deviceTrackingMetrics.mobile.formStarts : null;
  const desktopCompletionRate = deviceTrackingMetrics.desktop.formStarts ? deviceTrackingMetrics.desktop.formSuccesses / deviceTrackingMetrics.desktop.formStarts : null;
  const mobileConversionIssue = deviceTrackingMetrics.mobile.formStarts >= 10 && (
    deviceTrackingMetrics.mobile.formErrors / deviceTrackingMetrics.mobile.formStarts >= 0.2
    || (deviceTrackingMetrics.desktop.formStarts >= 10 && mobileCompletionRate != null && desktopCompletionRate != null && mobileCompletionRate + 0.1 < desktopCompletionRate)
  ) ? {
      mobileStarts: deviceTrackingMetrics.mobile.formStarts,
      mobileSuccesses: deviceTrackingMetrics.mobile.formSuccesses,
      mobileErrors: deviceTrackingMetrics.mobile.formErrors,
      desktopStarts: deviceTrackingMetrics.desktop.formStarts,
      desktopSuccesses: deviceTrackingMetrics.desktop.formSuccesses,
    } : null;
  const measurementPlan = project.website?.measurementPlans[0] ?? null;
  const trackingVerified = Boolean(project.website?.trackingSite?.lastVerifiedAt && trackingEvents.length);
  const primaryConversionEvents = measurementPlan
    ? trackingEvents.filter((event) => event.eventName === measurementPlan.primaryConversion).length
    : 0;
  const funnelMetrics = project.leadMagnetFunnels.flatMap((funnel) => funnel.metrics);
  const funnelViews = funnelMetrics.reduce((sum, metric) => sum + metric.views, 0);
  const funnelOptIns = funnelMetrics.reduce((sum, metric) => sum + metric.optIns, 0);
  const emailsDelivered = funnelMetrics.reduce((sum, metric) => sum + metric.emailsDelivered, 0);
  const emailClicks = funnelMetrics.reduce((sum, metric) => sum + metric.emailClicks, 0);
  const evaluatedDimensions = new Map<string, "observed" | "limited">();
  const dimensionEvaluations = new Map<string, Array<{ checkpointId: string; classification: string; availability: string }>>();
  for (const checkpoint of project.measurementCheckpoints) {
    const metrics = jsonRecord(checkpoint.metricsJson);
    const evaluation = jsonRecord(metrics.evaluation);
    if (!evaluation.classification) continue;
    const taskText = `${checkpoint.task.moduleName} ${checkpoint.task.title}`.toLowerCase();
    const dimension = /retention|renewal|referral/.test(taskText) ? "retention"
      : /follow.?up|nurture|email/.test(taskText) ? "followUp"
        : /lead|form|capture/.test(taskText) ? "leadCapture"
          : /authority|backlink|citation|mention/.test(taskText) ? "authority"
            : /offer|position/.test(taskText) ? "offer"
              : /conversion|cta|checkout/.test(taskText) ? "conversion"
                : /traffic|seo|content|ranking/.test(taskText) ? "traffic"
                  : null;
    if (!dimension) continue;
    const observations = dimensionEvaluations.get(dimension) ?? [];
    observations.push({ checkpointId: checkpoint.id, classification: String(evaluation.classification), availability: String(evaluation.availability ?? "UNAVAILABLE") });
    dimensionEvaluations.set(dimension, observations);
  }
  const contradictions = growthEvidenceContradictions(dimensionEvaluations);
  for (const [dimension, observations] of dimensionEvaluations) {
    const conflicting = contradictions.some((item) => item.dimension === dimension);
    evaluatedDimensions.set(dimension, !conflicting && observations.every((item) => item.availability === "AVAILABLE") ? "observed" : "limited");
  }
  const hasLeadMagnetTask = project.executionTasks.some((task) => task.moduleName.includes("lead") || task.title.toLowerCase().includes("lead magnet"));
  const strategyApproved = Boolean(project.strategyPlans.find((strategy) => strategy.status === "approved"));

  // These are evidence-readiness scores until a completed measurement checkpoint
  // supplies mapped outcome evidence. They must never be presented as observed
  // business performance merely because a task, strategy, or asset exists.
  const traffic = Math.min(100, 20 + keywordRuns * 12 + (latestCrawl ? 12 : 0) + (trackingVerified ? 28 : 0) + (trackingMetrics.sessions >= 30 ? 15 : 0));
  const conversion = Math.min(100, 15 + (measurementPlan ? 20 : 0) + (trackingVerified ? 25 : 0) + (trackingMetrics.sessions >= 30 ? 20 : 0) + (primaryConversionEvents > 0 ? 15 : 0));
  const leadCapture = Math.min(100, 15 + (hasLeadMagnetTask ? 15 : 0) + (project.leadMagnetFunnels.length ? 20 : 0) + (funnelViews >= 30 ? 25 : 0) + (funnelOptIns > 0 ? 20 : 0));
  const followUp = Math.min(100, 15 + (project.leadMagnetFunnels.some((funnel) => funnel.espConnection?.status === "connected") ? 25 : 0) + (emailsDelivered >= 30 ? 30 : 0) + (emailClicks > 0 ? 20 : 0));
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
  const retention = Math.min(100, 10 + (evaluatedDimensions.has("retention") ? 75 : 0));
  const scoreJson = { traffic, conversion, leadCapture, followUp, authority, offer, retention };
  const evidenceStates: Record<string, "observed" | "limited" | "unavailable" | "hypothesis"> = {
    traffic: evaluatedDimensions.get("traffic") ?? (trackingVerified ? "limited" : "unavailable"),
    conversion: evaluatedDimensions.get("conversion") ?? (measurementPlan && trackingVerified ? "limited" : "unavailable"),
    leadCapture: evaluatedDimensions.get("leadCapture") ?? (funnelViews > 0 ? "limited" : "unavailable"),
    followUp: evaluatedDimensions.get("followUp") ?? (emailsDelivered > 0 ? "limited" : "unavailable"),
    authority: evaluatedDimensions.get("authority") ?? (latestAuthoritySnapshot || project.earnedMentions.length || project.authorityPerformanceMetrics.length ? "limited" : "unavailable"),
    offer: evaluatedDimensions.get("offer") ?? (project.businessProfile?.offerSummary ? "hypothesis" : "unavailable"),
    retention: evaluatedDimensions.get("retention") ?? "unavailable",
  };
  const observedScores = Object.entries(scoreJson).filter(([dimension]) => evidenceStates[dimension] === "observed");
  const bottleneckType = (observedScores.length ? observedScores : Object.entries(scoreJson))
    .sort((a, b) => a[1] - b[1])[0]?.[0] ?? "conversion";
  const growthScore = Math.round(Object.values(scoreJson).reduce((sum, value) => sum + value, 0) / Object.values(scoreJson).length);
  return { scoreJson, evidenceStates, contradictions, bottleneckType, growthScore, trackingMetrics, deviceTrackingMetrics, mobileConversionIssue, trackingVerified, measurementPlan, primaryConversionEvents, funnelViews, funnelOptIns, emailsDelivered, emailClicks, latestCrawl, openTasks, keywordRuns, socialPosts, socialPerformance, socialEngagementRate, hasLeadMagnetTask, strategyApproved, latestAuthoritySnapshot, approvedAuthorityOpportunities, completedAuthorityAssets, earnedReferralLeads, citationReadiness, observedCitationMentions, approvedCitationRecommendations };
}

function buildSupportingContentRoadmap(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, scheduleStartAt: Date | null = null) {
  const rootUrl = project.website?.rootUrl?.replace(/\/$/, "") ?? project.websiteUrl?.replace(/\/$/, "") ?? "";
  const canonicalPages = savedCanonicalPages(project.executionTasks, rootUrl);
  const buildPages = canonicalPages.length ? canonicalPages : project.websiteBuilds[0]?.pages ?? [];
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
  const approvedKeywordGroups = project.keywordGroups.filter((item) => item.status === "approved");
  const approvedKeywords = splitKeywordEntries(approvedKeywordGroups.flatMap((group) => splitKeywordEntries(group.keywords)));
  const approvedKeywordSet = new Set(approvedKeywords.map(normalizedTopic));
  for (const run of project.keywordResearchRuns) {
    if (!approvedKeywordSet.has(normalizedTopic(run.seedKeyword))) continue;
    inputs.push({
      keyword: run.seedKeyword,
      volume: run.averageVolume,
      competitionIndex: null,
      competition: null,
      sourceType: "keyword_research",
      sourceId: run.id,
      sourceCluster: run.seedKeyword,
    });
  }
  for (const group of approvedKeywordGroups) {
    for (const keyword of splitKeywordEntries(group.keywords)) inputs.push({
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
    const clusterName = matchedPage?.title || input.sourceCluster || "Supporting authority";
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
  const publishStart = scheduleStartAt?.getTime() ?? null;
  const publishIntervalDays = total <= 1 ? 0 : Math.min(7, 178 / (total - 1));
  const opportunities: ContentOpportunityDraft[] = scored.map((item, index) => {
    const queue: ContentOpportunityDraft["queue"] = index < nowTarget ? "now" : index < earlyTotalTarget ? "next" : index >= conditionalStart ? "conditional" : "later";
    const plannedDay = Math.min(180, 2 + Math.round(index * publishIntervalDays));
    const plannedPhase: ContentOpportunityDraft["plannedPhase"] = `day_${plannedDay}`;
    const plannedPublishAt = publishStart == null ? null : new Date(publishStart + Math.max(0, plannedDay - 1) * 86_400_000);
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
    recommendedCadence: total > 60 ? "2–4 planned pieces per week; reassess every 30 days" : total > 24 ? "1–2 planned pieces per week; reassess every 30 days" : "Up to 1 planned piece per week; reassess every 30 days",
    rationale: `SEnuke AI - AI Growth Operating System mapped ${total} distinct supporting-content opportunities from approved keywords, search demand, website pages, target markets, and business goals. Every opportunity is assigned a day within a governed 180-day plan; higher-priority work is scheduled first.`,
  };
}

function diagnosisSummary(bottleneckType: string, ctx: ReturnType<typeof projectContext>, evidenceState: "observed" | "limited" | "unavailable" | "hypothesis", hasContradiction = false) {
  const label = bottleneckType.replace(/([A-Z])/g, " $1").toLowerCase();
  if (hasContradiction) return `${ctx.name} has conflicting ${label} outcome evidence. The engine has lowered confidence and will not declare a constraint until the source, period, segment, or metric mapping is resolved.`;
  return evidenceState === "observed"
    ? `${ctx.name} is currently most constrained by ${label} according to mapped outcome evidence. Growth work should focus there before adding disconnected tasks.`
    : `${ctx.name} does not yet have sufficient verified ${label} outcome evidence. The next action is to connect and baseline this measurement, not assume the business is underperforming.`;
}

function normalizedGrowthSignals(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, score: ReturnType<typeof scoreProject>) {
  const now = new Date();
  const signals: GrowthSignalDraft[] = Object.entries(score.scoreJson).map(([signalKey, value]) => ({
    category: "growth_score",
    signalKey,
    sourceType: "project_snapshot",
    sourceId: project.id,
    value: {
      score: value,
      scoreKind: "evidence_readiness",
      evidenceState: score.evidenceStates[signalKey] ?? "unavailable",
      performanceClaimAllowed: score.evidenceStates[signalKey] === "observed",
    },
    confidence: score.evidenceStates[signalKey] === "observed" ? 88 : 96,
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
      value: {
        approved: score.strategyApproved,
        primaryGoal: project.primaryGoal,
        contractVersion: projectContext(project).strategyContract?.contractVersion ?? null,
        strategyVersion: projectContext(project).strategyContract?.version ?? null,
        focusAreas: projectContext(project).strategyContract?.focusAreas.map((focus) => ({ key: focus.key, priority: focus.priority, channels: focus.channels })) ?? [],
        currentPhase: projectContext(project).strategyContract?.phases[0]?.name ?? null,
      },
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
    {
      category: "social",
      signalKey: "social_distribution_performance",
      sourceType: project.socialPerformanceMetrics.length ? "social_performance" : "project_snapshot",
      sourceId: project.socialPerformanceMetrics[0]?.id ?? project.id,
      value: {
        plannedPosts: score.socialPosts,
        observations: project.socialPerformanceMetrics.length,
        ...score.socialPerformance,
        engagementRate: Number(score.socialEngagementRate.toFixed(2)),
      },
      confidence: project.socialPerformanceMetrics.length ? Math.min(95, 55 + project.socialPerformanceMetrics.length * 5) : 30,
      collectedAt: now,
      effectiveDate: project.socialPerformanceMetrics[0]?.recordedAt ?? now,
      expiresAt: new Date((project.socialPerformanceMetrics[0]?.recordedAt ?? now).getTime() + 30 * 86_400_000),
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
  const findings = findingsFromScores(score.scoreJson, score.evidenceStates);
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
  const generatedCandidates = generateGrowthCandidates({
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
    strategyId: ctx.strategyContract?.strategyId,
    strategyVersion: ctx.strategyContract?.version,
    strategyFocusAreas: ctx.strategyContract?.focusAreas,
    evidenceStates: score.evidenceStates,
    mobileConversionIssue: score.mobileConversionIssue,
  }, excluded);
  const capacity = await workspaceCapacitySummary(context.workspace.id);
  const featureKeys = ["ai_content_generate", "safe_authority_builder"];
  const featureCosts = await prisma.featureCostCatalog.findMany({ where: { featureKey: { in: featureKeys } } });
  const featureCost = new Map(featureCosts.map((feature) => [feature.featureKey, feature]));
  const unitsForCandidate = (candidate: typeof generatedCandidates[number]) => {
    if (candidate.actionType === "measurement_setup") return 0;
    const featureKey = candidate.route === "authority" ? "safe_authority_builder" : "ai_content_generate";
    const feature = featureCost.get(featureKey);
    return calculateWorkflowUnits(featureKey, feature?.defaultCreditCost ?? (featureKey === "safe_authority_builder" ? 100 : 80), {
      pricingModel: feature?.pricingModel,
      pricingConfig: feature?.pricingConfigJson,
      minimumUnitCost: feature?.minimumUnitCost,
      maximumUnitCost: feature?.maximumUnitCost,
    });
  };
  const candidates = applyGrowthCapacityGate(generatedCandidates, capacity.totalAvailable, unitsForCandidate);
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
        summary: diagnosisSummary(score.bottleneckType, ctx, score.evidenceStates[score.bottleneckType] ?? "unavailable", score.contradictions.some((item) => item.dimension === score.bottleneckType)),
        dataSnapshot: {
          website: ctx.website,
          strategyApproved: score.strategyApproved,
          keywordRuns: score.keywordRuns,
          socialPosts: score.socialPosts,
          openTasks: score.openTasks.length,
          latestCrawlScore: score.latestCrawl?.siteScore ?? null,
          evidenceStates: score.evidenceStates,
          trackingVerified: score.trackingVerified,
          measurementPlanId: score.measurementPlan?.id ?? null,
          trackedSessions: score.trackingMetrics.sessions,
          primaryConversionEvents: score.primaryConversionEvents,
          contradictions: score.contradictions,
          approvedStrategy: ctx.strategyContract,
        },
        findingsJson: findings as unknown as Prisma.InputJsonValue,
        evidenceJson: { signalFingerprints: signals.map((signal) => signalFingerprint(project.id, signal)), contradictions: score.contradictions },
        confidence: Math.max(0, diagnosisConfidence - (score.contradictions.length ? 20 : 0)),
        engineVersion: GROWTH_ENGINE_VERSION,
        runType: input.runType,
      },
    });

    await tx.growthFunnelStage.deleteMany({
      where: { projectId: project.id, stageKey: { notIn: stages.map((stage) => stage.stageKey) } },
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
      const storedCandidate = normalizeGrowthCandidateForStorage(candidate);
      const existingCandidate = await tx.nextBestAction.findFirst({
        where: { projectId: project.id, sourceType: "growth_engine", dedupeKey: storedCandidate.dedupeKey },
        orderBy: { createdAt: "asc" },
      });
      const candidateData = {
        title: storedCandidate.title,
        recommendation: storedCandidate.recommendation,
        reasoningSummary: storedCandidate.reasoningSummary,
        expectedImpact: storedCandidate.expectedImpact,
        confidence: storedCandidate.factors.confidence,
        estimatedEffort: storedCandidate.estimatedEffort,
        route: storedCandidate.route,
        priorityScore: storedCandidate.priorityScore,
        evidenceJson: { keys: storedCandidate.evidenceKeys, findings: findings.filter((finding) => storedCandidate.targetEntities.includes(finding.category)) } as Prisma.InputJsonValue,
        actionType: storedCandidate.actionType,
        businessGoal: storedCandidate.businessGoal,
        targetEntitiesJson: storedCandidate.targetEntities,
        estimatedImpactJson: { description: storedCandidate.expectedImpact },
        scoreJson: storedCandidate.factors,
        dependencyIdsJson: storedCandidate.dependencies,
        approvalType: storedCandidate.approvalType,
        riskLevel: storedCandidate.riskLevel,
        urgency: storedCandidate.urgency,
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
            dedupeKey: storedCandidate.dedupeKey,
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
      goals: ctx.strategyContract?.unifiedPlan?.objectives?.length ? ctx.strategyContract.unifiedPlan.objectives : [ctx.goal],
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
    const strategyDecisionSet = ctx.strategyContract?.decisionSet && typeof ctx.strategyContract.decisionSet === "object" && !Array.isArray(ctx.strategyContract.decisionSet) ? ctx.strategyContract.decisionSet as Record<string, unknown> : {};
    const strategyBusinessBrainVersion = typeof strategyDecisionSet.businessBrainVersion === "number" ? strategyDecisionSet.businessBrainVersion : null;
    const strategyEvidenceVersion = typeof strategyDecisionSet.evidenceVersion === "number" ? strategyDecisionSet.evidenceVersion : null;
    const measurementStarted = project.measurementCheckpoints.length > 0 || project.executionTasks.some((task) => Boolean(task.completedAt || task.publishedAt) || ["completed", "published", "verified"].includes(task.status));
    const blueprintLifecycleStatus = measurementStarted ? "active" : "baseline";
    const blueprintReason = measurementStarted
      ? "Blueprint uses the approved Strategy plus execution or measurement evidence for continuous optimization."
      : "Initial Blueprint baseline generated from the approved Strategy. It becomes active after execution and measurement begin.";
    if (!existingBlueprint) {
      await tx.growthBlueprint.create({
        data: {
          projectId: project.id,
          title: `${ctx.name} Growth Blueprint`,
          status: blueprintLifecycleStatus,
          currentVersion: 1,
          primaryGoal: boundedText(ctx.primaryGoal, 255),
          approvedStrategyId: ctx.approvedStrategy?.id,
          businessBrainVersion: strategyBusinessBrainVersion,
          evidenceVersion: strategyEvidenceVersion,
          nextReviewAt: new Date(Date.now() + 7 * 86_400_000),
          versions: {
            create: {
              version: 1,
              status: blueprintLifecycleStatus,
              goalsJson: phasePayload.goals,
              nowJson: phasePayload.now,
              nextJson: phasePayload.next,
              laterJson: phasePayload.later,
              conditionalJson: phasePayload.conditional,
              evidenceJson: { diagnosis: score.bottleneckType, signalCount: signals.length, approvedStrategy: ctx.strategyContract },
              reason: blueprintReason,
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
          status: blueprintLifecycleStatus,
          goalsJson: phasePayload.goals,
          nowJson: phasePayload.now,
          nextJson: phasePayload.next,
          laterJson: phasePayload.later,
          conditionalJson: phasePayload.conditional,
          evidenceJson: { diagnosis: score.bottleneckType, signalCount: signals.length, approvedStrategy: ctx.strategyContract },
          reason: `${blueprintReason} Refreshed after a ${input.runType.replace(/_/g, " ")} Growth Engine run.`,
          engineVersion: GROWTH_ENGINE_VERSION,
          createdByUserId: context.membership.userId,
        },
      });
      await tx.growthBlueprint.update({
        where: { id: existingBlueprint.id },
        data: { status: blueprintLifecycleStatus, currentVersion: version, primaryGoal: boundedText(ctx.primaryGoal, 255), approvedStrategyId: ctx.approvedStrategy?.id, businessBrainVersion: strategyBusinessBrainVersion, evidenceVersion: strategyEvidenceVersion, nextReviewAt: new Date(Date.now() + 7 * 86_400_000) },
      });
    } else {
      await tx.growthBlueprint.update({
        where: { id: existingBlueprint.id },
        data: { status: blueprintLifecycleStatus, primaryGoal: boundedText(ctx.primaryGoal, 255), approvedStrategyId: ctx.approvedStrategy?.id, businessBrainVersion: strategyBusinessBrainVersion, evidenceVersion: strategyEvidenceVersion, nextReviewAt: new Date(Date.now() + 7 * 86_400_000) },
      });
    }

    const aiRun = await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "growth_engine",
        promptVersion: GROWTH_ENGINE_VERSION,
        inputSnapshotJson: { runType: input.runType, approvedStrategy: ctx.strategyContract, signals: signals.map((signal) => ({ key: signal.signalKey, confidence: signal.confidence, freshness: signalFreshness(signal) })) },
        outputJson: { findings, candidateCount: candidates.length, selectedDedupeKey: selected?.dedupeKey ?? null, phases, strategyId: ctx.strategyContract?.strategyId ?? null } as unknown as Prisma.InputJsonValue,
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
  const tracking = score.trackingMetrics;
  const enoughTraffic = score.trackingVerified && tracking.sessions >= 30;
  const measurementConfigured = Boolean(score.measurementPlan && score.trackingVerified);
  const primaryGoal = projectContext(project).primaryGoal;
  const stages = [
    {
      stageKey: "awareness",
      title: "Awareness",
      metric: score.keywordRuns ? `${score.keywordRuns} research run${score.keywordRuns === 1 ? "" : "s"}` : "No demand source connected",
      status: score.keywordRuns ? "limited_evidence" : "connection_required",
      issue: score.keywordRuns
        ? "Entry: target market demand. Exit: a qualified person discovers the business. Keyword research is available, but connect Search Console or another reach source to measure actual visibility."
        : "Entry: target market demand. Exit: a qualified person discovers the business. Run keyword research and connect a reach source before judging awareness performance.",
      automation: "execute_through_integration",
    },
    {
      stageKey: "acquisition",
      title: "Acquisition",
      metric: score.trackingVerified ? `${tracking.sessions} tracked sessions` : "Website tracking not verified",
      status: enoughTraffic ? "evidence_available" : score.trackingVerified ? "insufficient_sample" : "connection_required",
      issue: enoughTraffic
        ? "Entry: discovered audience. Exit: qualified website visit. Use source and landing-page results to identify the channel bringing the most qualified sessions."
        : "Entry: discovered audience. Exit: qualified website visit. Verify website tracking and collect at least 30 sessions before comparing channels.",
      automation: "execute_through_integration",
    },
    {
      stageKey: "activation",
      title: "Activation",
      metric: score.trackingVerified ? `${tracking.ctaClicks} CTA clicks · ${tracking.formStarts} form starts` : "CTA and form events unavailable",
      status: enoughTraffic ? "evidence_available" : score.trackingVerified ? "insufficient_sample" : "connection_required",
      issue: enoughTraffic
        ? "Entry: website visit. Exit: visitor starts the intended action. Compare CTA clicks and form starts with page views, then improve the largest measured drop-off."
        : "Entry: website visit. Exit: visitor starts the intended action. Track CTA clicks and form starts, then collect enough sessions to establish a baseline.",
      automation: "execute_through_integration",
    },
    {
      stageKey: "conversion",
      title: "Conversion",
      metric: measurementConfigured ? `${score.primaryConversionEvents} ${score.measurementPlan?.primaryConversion ?? "primary conversions"}` : "Primary conversion not verified",
      status: enoughTraffic && measurementConfigured ? "evidence_available" : measurementConfigured ? "insufficient_sample" : "connection_required",
      issue: measurementConfigured
        ? `Entry: activated visitor. Exit: ${primaryGoal}. Compare the verified primary conversion with the baseline; do not declare a conversion problem until the evaluation window and sample are complete.`
        : `Entry: activated visitor. Exit: ${primaryGoal}. Confirm one primary conversion event and verify that it reaches the measurement plan.`,
      automation: "execute_through_integration",
    },
    {
      stageKey: "retention",
      title: "Retention",
      metric: score.evidenceStates.retention === "observed" ? "Verified checkpoint available" : "Retention outcome unavailable",
      status: score.evidenceStates.retention === "observed" ? "evidence_available" : "connection_required",
      issue: score.evidenceStates.retention === "observed"
        ? "Entry: converted customer. Exit: retained or returning customer. Review the latest verified retention checkpoint before choosing an intervention."
        : "Entry: converted customer. Exit: retained or returning customer. Connect CRM, renewal, repeat-purchase, or manual cohort data and record the first retention baseline.",
      automation: "manual_guided",
    },
    {
      stageKey: "revenue",
      title: "Revenue",
      metric: tracking.purchases ? `${tracking.purchases} tracked purchases` : "Revenue source unavailable or not applicable",
      status: tracking.purchases ? "limited_evidence" : "not_configured",
      issue: tracking.purchases
        ? "Entry: converted customer. Exit: recorded revenue. Connect transaction values or CRM revenue so the engine can compare revenue, not only purchase counts."
        : "Entry: converted customer. Exit: recorded revenue. If revenue applies to this business, connect ecommerce or CRM values; otherwise leave this stage not applicable.",
      automation: "execute_through_integration",
    },
    {
      stageKey: "referral",
      title: "Referral",
      metric: score.earnedReferralLeads ? `${score.earnedReferralLeads} recorded referral leads` : "Referral outcome unavailable",
      status: score.earnedReferralLeads ? "limited_evidence" : "connection_required",
      issue: score.earnedReferralLeads
        ? "Entry: satisfied customer or earned mention. Exit: attributed referral lead. Add conversion outcomes to determine referral quality."
        : "Entry: satisfied customer or earned mention. Exit: attributed referral lead. Add a referral source field or CRM attribution and record the first referral baseline.",
      automation: "manual_guided",
    },
  ];
  return stages.map((stage, index) => ({ ...stage, sortOrder: index + 1 }));
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

function growthTaskWorkspace(action: { actionType: string; route: string; title: string }, projectId: string) {
  const text = `${action.actionType} ${action.route} ${action.title}`.toLowerCase();
  if (/lead_capture|lead_nurture|retention_referral|lead magnet|follow.?up|retention|referral|enquiry|handoff/.test(text)) return {
    moduleName: "lead_magnets",
    relatedUrl: `/lead-magnets?projectId=${projectId}&start=1`,
    actionButtonLabel: "Prepare with AI Funnel Builder",
  };
  if (action.route === "authority" || /authority|backlink|outreach/.test(text)) return {
    moduleName: "authority_growth",
    relatedUrl: `/backlinks?projectId=${projectId}&start=discover`,
    actionButtonLabel: "Prepare with AI Authority Builder",
  };
  if (action.route === "local_seo") return {
    moduleName: "local_seo",
    relatedUrl: `/local-seo?projectId=${projectId}`,
    actionButtonLabel: "Prepare in Local SEO",
  };
  if (/sitemap|intent architecture|canonical owner|page map/.test(text) && action.actionType !== "search_setup") return {
    moduleName: "seo_page_map",
    relatedUrl: `/seo-page-map?projectId=${projectId}`,
    actionButtonLabel: "Prepare with AI Page Map",
  };
  if (/analytics|measurement|tracking|evidence loop/.test(text)) return {
    moduleName: "website_intelligence",
    relatedUrl: `/projects/${projectId}/website/performance#search-performance`,
    actionButtonLabel: "Open Measurement Setup",
  };
  if (action.route === "technical") return {
    moduleName: "website_intelligence",
    relatedUrl: action.actionType === "search_setup" ? `/projects/${projectId}/website/performance#search-performance` : `/gap-analysis?projectId=${projectId}`,
    actionButtonLabel: action.actionType === "search_setup" ? "Open Search Setup" : "Prepare Technical Fix",
  };
  return {
    moduleName: "content",
    relatedUrl: `/ai-content?projectId=${projectId}`,
    actionButtonLabel: "Prepare with AI Content",
  };
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
  const [diagnosis, funnelStages, experiments, channelTests, reports, blueprint, contentRoadmap, socialDistribution, evidenceSignals, candidateActions, learnings, recentRuns] = await Promise.all([
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
    prisma.socialStrategy.findFirst({
      where: { projectId, status: "active" },
      orderBy: { createdAt: "desc" },
      include: {
        posts: { orderBy: { publishDate: "asc" }, take: 50 },
        metrics: { orderBy: { recordedAt: "desc" }, take: 200 },
        repurposingBatches: { orderBy: { createdAt: "desc" }, take: 10, include: { assets: { select: { id: true, status: true, channel: true } } } },
      },
    }),
    prisma.growthSignal.findMany({ where: { projectId }, orderBy: [{ category: "asc" }, { effectiveDate: "desc" }] }),
    prisma.nextBestAction.findMany({
      where: { projectId, sourceType: { in: ["growth_engine", "citation_recommendation", "social_performance"] } },
      orderBy: [{ status: "asc" }, { priorityScore: "desc" }, { createdAt: "desc" }],
      include: { followupTask: { select: { id: true, title: true, status: true, relatedUrl: true } } },
    }),
    prisma.projectGrowthLearning.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.aiRun.findMany({ where: { projectId, moduleName: "growth_engine" }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const selectedAction = candidateActions.find((action) => action.status === "selected")
    ?? candidateActions.find((action) => action.status === "accepted" && action.followupTask && !terminalStatuses.has(action.followupTask.status))
    ?? null;
  const activeExperiment = experiments.find((experiment) => ["approved", "running", "paused"].includes(experiment.status));
  const blockedCandidate = candidateActions.find((action) => action.status === "recommended" && Array.isArray(action.dependencyIdsJson) && action.dependencyIdsJson.length > 0);
  const decisionState = selectedAction
    ? { key: "ACTION_READY", title: "Next Best Action ready", message: "Review the selected action and create its trackable Execution task." }
    : activeExperiment?.status === "running"
      ? { key: "WAITING_FOR_OUTCOME", title: "Waiting for experiment outcome", message: `Continue collecting ${activeExperiment.metric} until the saved review date. Do not start a competing change.` }
      : activeExperiment?.status === "approved"
        ? { key: "APPROVED_NOT_STARTED", title: "Approved experiment ready to start", message: `Start ${activeExperiment.title} when its approved change is ready.` }
        : activeExperiment?.status === "paused"
          ? { key: "PAUSED", title: "Experiment paused", message: `Resume ${activeExperiment.title} when measurement can continue.` }
          : blockedCandidate
            ? { key: "BLOCKED_BY_DEPENDENCY", title: "Action blocked by a requirement", message: (Array.isArray(blockedCandidate.dependencyIdsJson) ? blockedCandidate.dependencyIdsJson.map(String).join(" · ") : "Resolve the required dependency, then refresh Growth.") }
            : candidateActions.length
              ? { key: "DECISIONS_RECORDED", title: "Current recommendations already decided", message: "Refresh the engine after new evidence or a completed outcome to select valid new work." }
              : { key: "NO_MATERIAL_ACTION", title: "No material action identified", message: "The engine checked current saved evidence and found no eligible new work. Refresh after new evidence or a material project change." };
  return {
    diagnosis,
    funnelStages,
    experiments,
    channelTests,
    reports,
    blueprint,
    contentRoadmap,
    socialDistribution,
    evidenceSignals,
    candidateActions,
    selectedAction,
    decisionState,
    learnings,
    recentRuns,
  };
}

async function loadGrowthIntelligence(projectId: string) {
  const now = new Date();
  const [checkpoints, signals, experiments, blueprint, activeTasks, continuousCycles] = await Promise.all([
    prisma.measurementCheckpoint.findMany({
      where: { projectId },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      include: { task: { select: { id: true, title: true, moduleName: true, status: true, approvalSnapshotJson: true } } },
    }),
    prisma.growthSignal.findMany({ where: { projectId }, orderBy: { effectiveDate: "desc" } }),
    prisma.growthExperiment.findMany({ where: { projectId }, include: { results: { orderBy: { recordedAt: "desc" } } } }),
    prisma.growthBlueprint.findUnique({ where: { projectId }, include: { versions: { orderBy: { version: "desc" }, take: 20 } } }),
    prisma.executionTask.findMany({ where: { projectId, status: { notIn: [...terminalStatuses] } }, select: { id: true, status: true, title: true, moduleName: true } }),
    prisma.growthIntelligenceCycle.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        sourceRuns: { orderBy: { sourceType: "asc" } },
        findings: { orderBy: [{ severity: "asc" }, { detectedAt: "desc" }], take: 50 },
        decisions: { take: 1 },
      },
    }),
  ]);
  const completed = checkpoints.filter((item) => item.status === "completed");
  const due = checkpoints.filter((item) => item.status !== "completed" && item.dueAt <= now);
  const scheduled = checkpoints.filter((item) => item.status !== "completed" && item.dueAt > now);
  const staleSignals = signals.filter((signal) => ["stale", "expired"].includes(signal.freshnessStatus));
  const limitedSignals = signals.filter((signal) => signal.confidence < 50 || ["stale", "expired"].includes(signal.freshnessStatus));
  const evaluations = experiments.flatMap((experiment) => experiment.results.map((result) => ({
    id: result.id,
    experimentId: experiment.id,
    title: experiment.title,
    metric: experiment.metric,
    status: result.resultStatus,
    evaluation: jsonRecord(result.learningJson).evaluation ?? null,
    recordedAt: result.recordedAt,
  })));
  const latestVersion = blueprint?.versions[0] ?? null;
  const latestEvidence = jsonRecord(latestVersion?.evidenceJson);
  const patches = Array.isArray(latestEvidence.patches) ? latestEvidence.patches : [];
  const verifiedExposures = checkpoints.filter((checkpoint) => Boolean(jsonRecord(checkpoint.baselineJson).publishedAt));
  const measurementState = !checkpoints.length
    ? "NOT_PLANNED"
    : !verifiedExposures.length
      ? "AWAITING_VERIFIED_EXPOSURE"
      : due.length
        ? "EVALUATION_DUE"
        : scheduled.length
          ? "COLLECTING"
          : "CURRENT";
  const latestContinuous = continuousCycles[0] ?? null;
  return {
    contractVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION,
    lifecycle: {
      state: measurementState,
      verifiedExposures: verifiedExposures.length,
      completedEvaluations: completed.length,
      dueEvaluations: due.length,
      scheduledEvaluations: scheduled.length,
      nextEvaluationAt: scheduled[0]?.dueAt ?? null,
    },
    dataQuality: {
      status: staleSignals.length ? "LIMITED" : signals.length ? "AVAILABLE" : "UNAVAILABLE",
      sourceCount: signals.length,
      limitedSourceCount: limitedSignals.length,
      staleSourceCount: staleSignals.length,
      limitations: [
        ...(!signals.length ? ["No normalized growth evidence has been collected yet."] : []),
        ...(staleSignals.length ? [`${staleSignals.length} evidence source${staleSignals.length === 1 ? " is" : "s are"} stale or expired.`] : []),
        ...(!verifiedExposures.length ? ["Official outcome measurement starts only after a verified external exposure."] : []),
      ],
    },
    activeWork: {
      count: activeTasks.length,
      tasks: activeTasks.slice(0, 10),
    },
    evaluations: evaluations.slice(0, 20),
    blueprint: {
      version: blueprint?.currentVersion ?? null,
      patchCount: patches.length,
      patches,
      strategyReviewRequired: patches.some((patch) => jsonRecord(patch).materialStrategyChange === true),
    },
    continuousMonitoring: {
      enabled: true,
      customerCapacityUnits: 0,
      status: latestContinuous?.status ?? "waiting_for_first_cycle",
      lastCheckedAt: latestContinuous?.completedAt ?? latestContinuous?.startedAt ?? null,
      nextScheduledAt: latestContinuous?.nextScheduledAt ?? latestContinuous?.scheduledAt ?? null,
      triggerType: latestContinuous?.triggerType ?? null,
      meaningfulChangeDetected: latestContinuous?.meaningfulChangeDetected ?? false,
      growthEvaluationTriggered: latestContinuous?.growthEvaluationTriggered ?? false,
      nextBestActionTriggered: latestContinuous?.nextBestActionTriggered ?? false,
      skipReason: latestContinuous?.skipReason ?? null,
      errorMessage: latestContinuous?.errorMessage ?? null,
      sources: (latestContinuous?.sourceRuns ?? []).map((source) => ({
        key: source.sourceType,
        status: source.status,
        recordCount: source.recordCount,
        observedAt: jsonRecord(source.snapshotJson).observedAt ?? null,
        nextScheduledAt: source.nextScheduledAt,
        restrictionReason: source.restrictionReason,
        skipReason: source.skipReason,
      })),
      findings: (latestContinuous?.findings ?? []).map((finding) => ({
        id: finding.id,
        sourceType: finding.sourceType,
        findingType: finding.findingType,
        severity: finding.severity,
        status: finding.status,
        observedFact: finding.observedFact,
        interpretation: finding.interpretation,
        importance: finding.importance,
        confidence: finding.confidence,
        limitations: finding.limitationsJson,
        recommendedResponse: finding.recommendedResponse,
        detectedAt: finding.detectedAt,
      })),
      decision: latestContinuous?.decisions[0] ? {
        outcome: latestContinuous.decisions[0].outcome,
        reason: latestContinuous.decisions[0].reason,
        currentNextBestActionId: latestContinuous.decisions[0].currentNextBestActionId,
        createdAt: latestContinuous.decisions[0].createdAt,
      } : null,
      history: continuousCycles.map((cycle) => ({ id: cycle.id, status: cycle.status, triggerType: cycle.triggerType, scheduledAt: cycle.scheduledAt, completedAt: cycle.completedAt, meaningfulChangeDetected: cycle.meaningfulChangeDetected, recordCount: cycle.recordCount, decision: cycle.decisions[0]?.outcome ?? null })),
    },
  };
}

async function refreshSupportingContentPlan(
  context: WorkspaceContext,
  project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>,
  scheduleStartAt: Date | null = null,
) {
  const generated = buildSupportingContentRoadmap(project, scheduleStartAt);
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
  const growthIntelligence = await loadGrowthIntelligence(project.id);
  const workflowController = await getProjectWorkflowController(project.id);
  res.json({ project, signals: score, readiness, growth, growthIntelligence, workflowController, strategyContext: projectContext(project).strategyContract, automationPolicy: policyForModule("growth_marketing") });
});

growthRouter.get("/projects-v2/:projectId/growth/continuous-status", async (req, res) => {
  await authorizeProject(req, req.params.projectId);
  const project = await prisma.project.findUnique({ where: { id: req.params.projectId }, select: { id: true, name: true, status: true } });
  if (!project) return res.status(404).json({ error: "project not found" });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [cycles, sourceRuns, decisions, weeklyReports, strategyReviews] = await Promise.all([
    prisma.growthIntelligenceCycle.findMany({ where: { projectId: project.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
    prisma.growthIntelligenceSourceRun.findMany({ where: { projectId: project.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
    prisma.growthIntelligenceDecision.findMany({ where: { projectId: project.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
    prisma.growthReport.findMany({ where: { projectId: project.id, reportType: "continuous_growth_weekly", createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
    prisma.projectWorkflowEvent.findMany({ where: { projectId: project.id, eventType: "growth_intelligence.strategy_review_evaluated", createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
  ]);
  const catalogue = [
    ["analytics", "daily"], ["search_console", "daily"], ["google_business_profile", "daily"], ["reviews", "6–12 hours"], ["website_crawl", "weekly and post-publish"], ["publish_verification", "15–30 minutes"], ["technical_health", "after crawl"], ["rankings", "weekly"], ["local_visibility", "weekly"], ["competitors", "weekly"], ["backlinks", "biweekly"], ["content_decay", "weekly"], ["ai_visibility", "weekly"], ["conversions", "daily"], ["measurement_checkpoints", "scheduled"],
  ] as const;
  const processes = catalogue.map(([key, cadence]) => {
    const rows = sourceRuns.filter((row) => row.sourceType === key);
    const latest = rows[0];
    return { key, cadence, status: latest?.status ?? "not_run", runCount: rows.length, latestRunAt: latest?.completedAt ?? latest?.startedAt ?? null, nextRunAt: latest?.nextScheduledAt ?? null, recordCount: latest?.recordCount ?? 0, meaningfulChangeDetected: latest?.meaningfulChangeDetected ?? false, restrictionReason: latest?.restrictionReason ?? null, skipReason: latest?.skipReason ?? null, retries: latest?.retryCount ?? 0 };
  });
  const completedCycles = cycles.filter((cycle) => ["completed", "skipped"].includes(cycle.status));
  const failedCycles = cycles.filter((cycle) => cycle.status === "failed");
  res.json({
    contractVersion: "DEV-063-v1",
    project,
    window: { start: since, end: new Date(), days: 7 },
    customerCapacityUnits: 0,
    orchestration: { cycleCount: cycles.length, completedOrSafelySkipped: completedCycles.length, failed: failedCycles.length, retryCount: cycles.reduce((sum, cycle) => sum + cycle.retryCount, 0), nextScheduledAt: cycles.find((cycle) => cycle.nextScheduledAt)?.nextScheduledAt ?? null, singleProjectEvaluationLease: true, debounceMinutes: 30, idempotentArtifacts: true },
    processes: [
      ...processes,
      { key: "growth_evaluation", cadence: "daily after qualifying change", status: cycles.some((cycle) => cycle.growthEvaluationTriggered) ? "completed" : "no_qualifying_change", runCount: cycles.filter((cycle) => cycle.growthEvaluationTriggered).length },
      { key: "next_best_action", cadence: "after qualifying Growth evaluation", status: decisions[0]?.outcome ?? "not_run", runCount: decisions.length, latestDecision: decisions[0] ?? null },
      { key: "weekly_summary", cadence: "weekly", status: weeklyReports.length ? "completed" : "not_due_or_not_run", runCount: weeklyReports.length, latestRunAt: weeklyReports[0]?.createdAt ?? null },
      { key: "strategy_review", cadence: "monthly or material event", status: strategyReviews.length ? "evaluated" : "not_due_or_not_run", runCount: strategyReviews.length, latestRunAt: strategyReviews[0]?.occurredAt ?? null },
    ],
    acceptance: {
      sevenConsecutiveDaysObserved: completedCycles.some((cycle) => cycle.completedAt && cycle.completedAt <= new Date(Date.now() - 6 * 86_400_000)),
      noDuplicateCycleKeys: new Set(cycles.map((cycle) => cycle.idempotencyKey)).size === cycles.length,
      retriesDoNotCreateDuplicateDecisions: new Set(decisions.map((decision) => decision.cycleId)).size === decisions.length,
      unchangedDataSkipped: cycles.some((cycle) => cycle.status === "skipped" && /unchanged/i.test(cycle.skipReason ?? "")),
      weeklySummaryCreated: weeklyReports.length > 0,
      failures: failedCycles.map((cycle) => ({ id: cycle.id, error: cycle.errorMessage, retries: cycle.retryCount })),
    },
  });
});

growthRouter.post("/projects-v2/:projectId/growth/analyze", async (req, res) => {
  const context = await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const workflowBlocker = await growthWorkflowBlocker(project.id);
  if (workflowBlocker) return res.status(409).json(workflowBlocker);
  await runGrowthEngine({ req, context, project, runType: "manual" });

  const score = scoreProject(project);
  const growth = await loadGrowthOverview(project.id);
  const growthIntelligence = await loadGrowthIntelligence(project.id);
  const workflowController = await getProjectWorkflowController(project.id);
  res.json({ project, signals: score, readiness, growth, growthIntelligence, workflowController, strategyContext: projectContext(project).strategyContract, automationPolicy: policyForModule("growth_marketing") });
});

growthRouter.post("/projects-v2/:projectId/growth/content-roadmap/refresh", async (req, res) => {
  const context = await authorizeProject(req, req.params.projectId, "run_ai_analysis");
  let project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const workflowBlocker = await growthWorkflowBlocker(project.id);
  if (workflowBlocker) return res.status(409).json(workflowBlocker);
  const blueprintExists = Boolean(await prisma.growthBlueprint.findUnique({ where: { projectId: project.id }, select: { id: true } }));
  const startDateValue = typeof req.body?.startDate === "string" ? new Date(`${req.body.startDate}T00:00:00.000Z`) : null;
  if (startDateValue && Number.isNaN(startDateValue.getTime())) return res.status(400).json({ error: "Choose a valid plan start date." });
  if (!blueprintExists) {
    await runGrowthEngine({ req, context, project, runType: "manual" });
  } else {
    await refreshSupportingContentPlan(context, project, startDateValue);
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
  const workflowBlocker = await growthWorkflowBlocker(project.id);
  if (workflowBlocker) return res.status(409).json(workflowBlocker);
  const score = scoreProject(project);
  const stages = funnelDefinitions(project, score);
  await prisma.$transaction(async (tx) => {
    await tx.growthFunnelStage.deleteMany({
      where: { projectId: project.id, stageKey: { notIn: stages.map((stage) => stage.stageKey) } },
    });
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
  const workflowBlocker = await growthWorkflowBlocker(project.id);
  if (workflowBlocker) return res.status(409).json(workflowBlocker);
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

const experimentApprovalSchema = z.object({
  baselineValue: z.number(),
  baselineSampleSize: z.number().int().nonnegative().default(0),
  evaluationWindowDays: z.number().int().min(1).max(180).default(14),
  sourceStatus: z.enum(["AVAILABLE", "LIMITED", "STALE", "UNAVAILABLE", "INSUFFICIENT"]).default("AVAILABLE"),
  baselineNote: z.string().trim().min(2).max(1000),
});

growthRouter.post("/growth/experiments/:experimentId/approve", async (req, res) => {
  const parsed = experimentApprovalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const experiment = await prisma.growthExperiment.findFirst({
    where: { id: req.params.experimentId },
    include: { project: true },
  });
  if (!experiment) return res.status(404).json({ error: "experiment not found" });
  const context = await authorizeProject(req, experiment.projectId, "approve");
  if (!["planned", "draft"].includes(experiment.status)) return res.status(409).json({ error: "Only a planned or draft experiment can be approved." });
  if (parsed.data.sourceStatus !== "AVAILABLE") return res.status(409).json({ error: "A verified available baseline is required before this experiment can start. Record or reconnect the source first." });
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.growthExperiment.update({
      where: { id: experiment.id },
      data: {
        status: "approved",
        baselineJson: {
          ...jsonRecord(experiment.baselineJson),
          metric: experiment.metric,
          value: parsed.data.baselineValue,
          sampleSize: parsed.data.baselineSampleSize,
          sourceStatus: parsed.data.sourceStatus,
          note: parsed.data.baselineNote,
          evaluationWindowDays: parsed.data.evaluationWindowDays,
          approvedByUserId: context.membership.userId,
          approvedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    await tx.growthExperimentAsset.updateMany({ where: { experimentId: experiment.id, approvalStatus: "needs_review" }, data: { approvalStatus: "approved" } });
    await recordWorkspaceActivity(tx, {
      context,
      action: "growth_experiment.approved",
      entityType: "growth_experiment",
      entityId: experiment.id,
      agencyClientId: experiment.project.agencyClientId,
      projectId: experiment.projectId,
      previousJson: { status: experiment.status },
      nextJson: { status: "approved", baselineValue: parsed.data.baselineValue, baselineSampleSize: parsed.data.baselineSampleSize, evaluationWindowDays: parsed.data.evaluationWindowDays },
    });
    return row;
  });
  res.json({ experiment: updated });
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
  if (!["approved", "paused"].includes(experiment.status)) return res.status(409).json({ error: "Approve the experiment and its baseline before starting it." });
  const baseline = jsonRecord(experiment.baselineJson);
  if (baseline.sourceStatus !== "AVAILABLE" || typeof baseline.value !== "number") return res.status(409).json({ error: "A verified available baseline is required before this experiment can start." });
  const evaluationWindowDays = typeof baseline.evaluationWindowDays === "number" ? Math.max(1, Math.min(180, Math.round(baseline.evaluationWindowDays))) : 14;
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
      data: {
        status: "running",
        startedAt: experiment.startedAt ?? new Date(),
        reviewAt: new Date(Date.now() + evaluationWindowDays * 86_400_000),
      },
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
      previousJson: { status: experiment.status },
      nextJson: { taskId: task.id, status: "running", baselineValue: baseline.value, baselineSampleSize: baseline.sampleSize ?? 0, evaluationWindowDays },
    });
    return row;
  });
  res.json({ experiment: updated });
});

growthRouter.post("/growth/experiments/:experimentId/pause", async (req, res) => {
  const experiment = await prisma.growthExperiment.findFirst({ where: { id: req.params.experimentId }, include: { project: true } });
  if (!experiment) return res.status(404).json({ error: "experiment not found" });
  const context = await authorizeProject(req, experiment.projectId, "execute_tasks");
  if (experiment.status !== "running") return res.status(409).json({ error: "Only a running experiment can be paused." });
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.growthExperiment.update({ where: { id: experiment.id }, data: { status: "paused" } });
    await recordWorkspaceActivity(tx, { context, action: "growth_experiment.paused", entityType: "growth_experiment", entityId: experiment.id, agencyClientId: experiment.project.agencyClientId, projectId: experiment.projectId, previousJson: { status: "running" }, nextJson: { status: "paused" } });
    return row;
  });
  res.json({ experiment: updated });
});

const resultSchema = z.object({
  baselineValue: z.number().optional(),
  currentValue: z.number().optional(),
  baselineSampleSize: z.number().int().nonnegative().optional(),
  currentSampleSize: z.number().int().nonnegative().optional(),
  minimumSampleSize: z.number().int().positive().max(1_000_000).optional(),
  minimumMaterialChangePercent: z.number().nonnegative().max(100).optional(),
  direction: z.enum(["increase", "decrease"]).optional(),
  sourceStatus: z.enum(["AVAILABLE", "LIMITED", "STALE", "UNAVAILABLE", "INSUFFICIENT"]).optional(),
  sourceFreshnessDays: z.number().nonnegative().optional(),
  evaluationWindowComplete: z.boolean().optional(),
  limitations: z.array(z.string().trim().min(2).max(500)).max(20).optional(),
  resultStatus: z.enum(["tracking", "winner", "failed", "inconclusive", "scaled"]).optional(),
  decision: z.enum(["adopt", "revise", "stop"]).optional(),
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
  let context = await authorizeProject(req, experiment.projectId, "execute_tasks");
  if (experiment.status !== "running") return res.status(409).json({ error: "Only a running experiment can record a measurement or final result." });
  const approvedBaseline = jsonRecord(experiment.baselineJson);
  const baselineValue = parsed.data.baselineValue ?? (typeof approvedBaseline.value === "number" ? approvedBaseline.value : undefined);
  const baselineSampleSize = parsed.data.baselineSampleSize ?? (typeof approvedBaseline.sampleSize === "number" ? approvedBaseline.sampleSize : undefined);
  const serverWindowComplete = Boolean(experiment.reviewAt && experiment.reviewAt.getTime() <= Date.now());
  const evaluation = evaluateMeasurement({
    metricKey: experiment.metric,
    direction: parsed.data.direction,
    baselineValue,
    currentValue: parsed.data.currentValue,
    baselineSampleSize,
    currentSampleSize: parsed.data.currentSampleSize,
    minimumSampleSize: parsed.data.minimumSampleSize,
    minimumMaterialChangePercent: parsed.data.minimumMaterialChangePercent,
    sourceStatus: parsed.data.sourceStatus as EvidenceAvailability | undefined,
    sourceFreshnessDays: parsed.data.sourceFreshnessDays,
    evaluationWindowComplete: serverWindowComplete && parsed.data.evaluationWindowComplete !== false,
    limitations: parsed.data.limitations,
  });
  const evaluatedStatus = evaluation.classification === "IMPROVED"
    ? parsed.data.resultStatus === "scaled" ? "scaled" : "winner"
    : evaluation.classification === "DECLINED"
      ? "failed"
      : evaluation.classification === "COLLECTING"
        ? "tracking"
        : "inconclusive";
  const terminal = evaluatedStatus !== "tracking";
  if (terminal && !parsed.data.decision) return res.status(400).json({ error: "Choose Adopt, Revise, or Stop before completing the experiment evaluation." });
  if (evaluatedStatus === "inconclusive" && parsed.data.decision === "adopt") return res.status(409).json({ error: "An inconclusive result cannot be adopted. Choose Revise to run a better test, or Stop." });
  if (terminal) context = await authorizeProject(req, experiment.projectId, "approve");
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.growthExperimentResult.create({
      data: {
        experimentId: experiment.id,
        baselineValue,
        currentValue: parsed.data.currentValue,
        resultStatus: evaluatedStatus,
        notes: parsed.data.notes,
        learningJson: {
          contractVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION,
          metric: experiment.metric,
          baselineValue: baselineValue ?? null,
          currentValue: parsed.data.currentValue ?? null,
          outcome: evaluatedStatus,
          evaluation,
          observedImpact: safeObservedImpact(evaluation),
          decision: parsed.data.decision ?? null,
        },
        followUpAction: parsed.data.decision ?? null,
        evaluatedAt: terminal ? new Date() : null,
      },
    });
    if (terminal) {
      await tx.growthExperiment.update({
        where: { id: experiment.id },
        data: { status: parsed.data.decision === "adopt" ? "completed" : parsed.data.decision === "revise" ? "inconclusive" : "stopped", completedAt: new Date() },
      });
      const learning = await tx.projectGrowthLearning.create({
        data: {
          projectId: experiment.projectId,
          sourceType: "growth_experiment",
          sourceId: experiment.id,
          outcome: evaluatedStatus === "winner" || evaluatedStatus === "scaled" ? "won" : evaluatedStatus === "failed" ? "lost" : "inconclusive",
          summary: parsed.data.notes || evaluation.summary,
          learningJson: { contractVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION, metric: experiment.metric, evaluation, observedImpact: safeObservedImpact(evaluation), decision: parsed.data.decision },
        },
      });
      const blueprint = await tx.growthBlueprint.findUnique({
        where: { projectId: experiment.projectId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      const previous = blueprint?.versions[0];
      if (blueprint && previous) {
        const patch = createBlueprintPatch({
          patchType: "LEARNING",
          path: `/learnings/${learning.id}`,
          operation: "add",
          previousValue: null,
          nextValue: { outcome: learning.outcome, metric: experiment.metric, evaluation, decision: parsed.data.decision, sourceExperimentId: experiment.id },
          reason: evaluation.summary,
          evidenceRefs: [`growth_experiment:${experiment.id}`, `growth_experiment_result:${row.id}`],
        });
        const previousEvidence = jsonRecord(previous.evidenceJson);
        const previousPatches = Array.isArray(previousEvidence.patches) ? previousEvidence.patches : [];
        const version = blueprint.currentVersion + 1;
        await tx.growthBlueprintVersion.create({
          data: {
            blueprintId: blueprint.id,
            version,
            status: "active",
            goalsJson: previous.goalsJson as Prisma.InputJsonValue,
            nowJson: previous.nowJson as Prisma.InputJsonValue,
            nextJson: previous.nextJson as Prisma.InputJsonValue,
            laterJson: previous.laterJson as Prisma.InputJsonValue,
            conditionalJson: previous.conditionalJson as Prisma.InputJsonValue,
            evidenceJson: { ...previousEvidence, patches: [...previousPatches, patch], latestEvaluation: evaluation } as Prisma.InputJsonValue,
            reason: `Growth Blueprint updated from measured learning: ${evaluation.summary}`,
            engineVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION,
            createdByUserId: context.membership.userId,
          },
        });
        await tx.growthBlueprint.update({ where: { id: blueprint.id }, data: { currentVersion: version, status: "active", nextReviewAt: new Date(Date.now() + 7 * 86_400_000) } });
      }
    }
    await recordWorkspaceActivity(tx, {
      context,
      action: terminal ? "growth_experiment.evaluated" : "growth_experiment.measurement_recorded",
      entityType: "growth_experiment_result",
      entityId: row.id,
      agencyClientId: experiment.project.agencyClientId,
      projectId: experiment.projectId,
      nextJson: { resultStatus: evaluatedStatus, terminal, decision: parsed.data.decision ?? null, evaluationClassification: evaluation.classification, availability: evaluation.availability },
    });
    return row;
  });
  await publishProjectWorkflowEvent({
    projectId: experiment.projectId,
    eventType: terminal ? "experiment.completed" : "measurement.recorded",
    sourceModule: "growth_engine",
    sourceId: experiment.id,
    idempotencyKey: `${terminal ? "experiment.completed" : "measurement.recorded"}:${experiment.id}:${result.id}`,
    payload: { resultId: result.id, resultStatus: evaluatedStatus, metric: experiment.metric, baselineValue: baselineValue ?? null, currentValue: parsed.data.currentValue ?? null, evaluation },
  });
  if (terminal) {
    const refreshedProject = await scopedProject(req, experiment.projectId);
    if (refreshedProject && growthReadiness(refreshedProject).canRun) {
      await runGrowthEngine({ req, context, project: refreshedProject, runType: "post_measure" });
    }
  }
  res.json({ result });
});

const checkpointEvaluationSchema = z.object({
  metricKey: z.string().trim().min(2).max(160),
  direction: z.enum(["increase", "decrease"]).optional(),
  baselineValue: z.number().optional(),
  currentValue: z.number().optional(),
  baselineSampleSize: z.number().int().nonnegative().optional(),
  currentSampleSize: z.number().int().nonnegative().optional(),
  minimumSampleSize: z.number().int().positive().max(1_000_000).optional(),
  minimumMaterialChangePercent: z.number().nonnegative().max(100).optional(),
  sourceStatus: z.enum(["AVAILABLE", "LIMITED", "STALE", "UNAVAILABLE", "INSUFFICIENT"]).optional(),
  sourceFreshnessDays: z.number().nonnegative().optional(),
  evaluationWindowComplete: z.boolean().default(true),
  limitations: z.array(z.string().trim().min(2).max(500)).max(20).optional(),
});

growthRouter.post("/projects-v2/:projectId/growth/measurements/:checkpointId/evaluate", async (req, res) => {
  const parsed = checkpointEvaluationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await authorizeProject(req, req.params.projectId, "execute_tasks");
  const checkpoint = await prisma.measurementCheckpoint.findFirst({
    where: { id: req.params.checkpointId, projectId: req.params.projectId },
    include: { task: { select: { id: true, title: true, moduleName: true } } },
  });
  if (!checkpoint) return res.status(404).json({ error: "Measurement checkpoint not found." });
  const evaluation = evaluateMeasurement(parsed.data);
  const terminal = evaluation.classification !== "COLLECTING";
  const observedImpact = safeObservedImpact(evaluation);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.measurementCheckpoint.update({
      where: { id: checkpoint.id },
      data: {
        status: terminal ? "completed" : "collecting",
        metricsJson: { contractVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION, evaluation, observedImpact } as Prisma.InputJsonValue,
        diagnosis: evaluation.summary,
        completedAt: terminal ? new Date() : null,
      },
    });
    if (terminal) {
      const learning = await tx.projectGrowthLearning.create({
        data: {
          projectId: checkpoint.projectId,
          sourceType: "measurement_checkpoint",
          sourceId: checkpoint.id,
          outcome: evaluation.classification === "IMPROVED" ? "won" : evaluation.classification === "DECLINED" ? "lost" : "inconclusive",
          summary: evaluation.summary,
          learningJson: { contractVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION, taskId: checkpoint.taskId, checkpointType: checkpoint.checkpointType, evaluation, observedImpact } as Prisma.InputJsonValue,
        },
      });
      const blueprint = await tx.growthBlueprint.findUnique({ where: { projectId: checkpoint.projectId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      const previous = blueprint?.versions[0];
      if (blueprint && previous) {
        const patch = createBlueprintPatch({
          patchType: "MEASUREMENT",
          path: `/measurements/${checkpoint.id}`,
          operation: "add",
          previousValue: null,
          nextValue: { checkpointType: checkpoint.checkpointType, taskId: checkpoint.taskId, evaluation },
          reason: evaluation.summary,
          evidenceRefs: [`measurement_checkpoint:${checkpoint.id}`, `execution_task:${checkpoint.taskId}`, `learning:${learning.id}`],
        });
        const evidence = jsonRecord(previous.evidenceJson);
        const patches = Array.isArray(evidence.patches) ? evidence.patches : [];
        const version = blueprint.currentVersion + 1;
        await tx.growthBlueprintVersion.create({
          data: {
            blueprintId: blueprint.id,
            version,
            status: "active",
            goalsJson: previous.goalsJson as Prisma.InputJsonValue,
            nowJson: previous.nowJson as Prisma.InputJsonValue,
            nextJson: previous.nextJson as Prisma.InputJsonValue,
            laterJson: previous.laterJson as Prisma.InputJsonValue,
            conditionalJson: previous.conditionalJson as Prisma.InputJsonValue,
            evidenceJson: { ...evidence, patches: [...patches, patch], latestEvaluation: evaluation } as Prisma.InputJsonValue,
            reason: `Growth Blueprint updated from ${checkpoint.checkpointType.replaceAll("_", " ")} evidence.`,
            engineVersion: GROWTH_INTELLIGENCE_CONTRACT_VERSION,
            createdByUserId: context.membership.userId,
          },
        });
        await tx.growthBlueprint.update({ where: { id: blueprint.id }, data: { currentVersion: version, status: "active", nextReviewAt: new Date(Date.now() + 7 * 86_400_000) } });
      }
    }
    await recordWorkspaceActivity(tx, {
      context,
      action: terminal ? "growth_measurement.evaluated" : "growth_measurement.collecting",
      entityType: "measurement_checkpoint",
      entityId: checkpoint.id,
      projectId: checkpoint.projectId,
      nextJson: { taskId: checkpoint.taskId, checkpointType: checkpoint.checkpointType, classification: evaluation.classification, availability: evaluation.availability, confidence: evaluation.confidence },
    });
    return row;
  });
  await publishProjectWorkflowEvent({
    projectId: checkpoint.projectId,
    eventType: terminal ? "measurement.evaluated" : "measurement.recorded",
    sourceModule: "growth_intelligence",
    sourceId: checkpoint.id,
    idempotencyKey: `measurement:${checkpoint.id}:${updated.updatedAt.toISOString()}`,
    payload: { checkpointId: checkpoint.id, taskId: checkpoint.taskId, evaluation },
  });
  res.json({ checkpoint: updated, evaluation, observedImpact, growthIntelligence: await loadGrowthIntelligence(checkpoint.projectId) });
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
  let context = await authorizeProject(req, req.params.projectId, "execute_tasks");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const action = await prisma.nextBestAction.findFirst({
    where: { id: req.params.actionId, projectId: project.id, sourceType: "growth_engine" },
  });
  if (!action) return res.status(404).json({ error: "Growth recommendation not found." });
  const input = parsed.data;
  const accepted = input.decision === "accepted" || input.decision === "edited";
  if (accepted) context = await authorizeProject(req, req.params.projectId, "approve");
  const reviewAfter = input.decision === "deferred"
    ? new Date(Date.now() + (input.deferDays ?? 7) * 86_400_000)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    let followupTaskId = action.followupTaskId;
    const title = input.title ?? action.title;
    const recommendation = input.recommendation ?? action.recommendation;
    const route = input.route ?? action.route;
    if (accepted && !followupTaskId) {
      const workspace = growthTaskWorkspace({ actionType: action.actionType, route, title }, project.id);
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
        moduleName: workspace.moduleName,
        relatedModule: "growth_marketing",
        actionButtonLabel: workspace.actionButtonLabel,
        relatedUrl: workspace.relatedUrl,
        manualInstructions: `${recommendation} Use the linked AI workspace to prepare the scoped asset or fix. Review the exact output, obtain any required publishing or external-system approval, perform the approved action, and record baseline and result metrics.`,
        approvalSnapshotJson: {
          nextBestActionId: action.id,
          actionType: action.actionType,
          route,
          recommendation,
          reasoningSummary: action.reasoningSummary,
          expectedImpact: action.expectedImpact,
          confidence: action.confidence,
          priorityScore: action.priorityScore,
        } as Prisma.InputJsonValue,
      });
      followupTaskId = task.id;
      if (workspace.moduleName === "content") {
        await tx.executionTask.update({
          where: { id: task.id },
          data: { relatedUrl: `/ai-content?projectId=${project.id}&taskId=${task.id}&open=1` },
        });
      }
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
    { channel: "Organic search", cadence: "One approved intent-led page test", metric: "Qualified organic sessions and primary conversions", assetsNeeded: { assets: ["Approved keyword map", "Page brief"], role: "Capture existing search demand", readiness: project.keywordResearchRuns.length ? "ready" : "blocked", cost: "low", effort: "medium", risk: "low", evidence: project.keywordResearchRuns.length ? `${project.keywordResearchRuns.length} saved keyword research runs` : "Keyword research required" } },
    { channel: "Email", cadence: "One permission-based follow-up sequence", metric: "Qualified replies or primary conversions", assetsNeeded: { assets: ["Consented audience", "Sequence copy", "Tracked CTA"], role: "Convert and reactivate known contacts", readiness: project.leadMagnetFunnels.some((funnel) => funnel.espConnection?.status === "connected") ? "ready" : "connection_required", cost: "low", effort: "medium", risk: "medium", evidence: project.leadMagnetFunnels.some((funnel) => funnel.espConnection?.status === "connected") ? "ESP connection available" : "ESP and consented audience required" } },
    { channel: "Social/community", cadence: "One two-week message and distribution test", metric: "Qualified profile visits and attributed conversions", assetsNeeded: { assets: ["Approved source content", "Channel-specific posts", "Tracked link"], role: "Reach and validate messages", readiness: project.website?.socialStrategies.length ? "ready" : "partial", cost: "low", effort: "medium", risk: "low", evidence: project.socialPerformanceMetrics.length ? `${project.socialPerformanceMetrics.length} performance observations` : "No connected performance observations" } },
    { channel: "Referral/partner", cadence: "One permission-based partner or customer referral test", metric: "Attributed qualified referral leads", assetsNeeded: { assets: ["Eligibility rule", "Request copy", "Referral source field"], role: "Generate trusted introductions", readiness: project.earnedMentions.length ? "partial" : "measurement_required", cost: "low", effort: "medium", risk: "medium", evidence: project.earnedMentions.length ? `${project.earnedMentions.length} earned mention records` : "No referral baseline" } },
    { channel: "Paid acquisition test", cadence: "One capped-budget landing-page test", metric: "Cost per qualified conversion", assetsNeeded: { assets: ["Approved budget cap", "Audience", "Landing page", "Conversion tracking"], role: "Test scalable demand", readiness: scoreProject(project).trackingVerified ? "approval_required" : "blocked", cost: "high", effort: "medium", risk: "high", evidence: scoreProject(project).trackingVerified ? "Conversion tracking available; budget approval required" : "Verified conversion tracking and budget approval required" } },
  ];
  await prisma.$transaction(async (tx) => {
    for (const test of channels) {
      const existing = await tx.growthChannelTest.findFirst({
        where: { projectId: project.id, channel: test.channel, status: { in: ["planned", "approved", "running"] } },
      });
      if (existing) {
        await tx.growthChannelTest.update({ where: { id: existing.id }, data: { cadence: test.cadence, metric: test.metric, assetsNeeded: test.assetsNeeded as Prisma.InputJsonValue } });
      } else {
        await tx.growthChannelTest.create({ data: { projectId: project.id, durationDays: 30, status: "planned", ...test, assetsNeeded: test.assetsNeeded as Prisma.InputJsonValue } });
      }
    }
  });
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
