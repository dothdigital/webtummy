import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { ActionIconButton, ActionIconLink, AiPlanningScreen, Button, Card, EmptyState, StatusPill } from "../components/ui.js";
import ProjectWorkflowController from "../components/ProjectWorkflowController.js";
import ProjectModuleHeader, { type ProjectHeaderAction } from "../components/ProjectModuleHeader.js";
import { ExecutionTaskDrawer } from "./CrawlDetail.js";
import { isExistingWebsiteFlow, nextProjectFlowStep } from "../project-flow.js";
import { BACKGROUND_JOBS_EVENT, isBackgroundJobFinished, registerBackgroundJob, type BackgroundJob } from "../background-jobs.js";
import { approvedKeywordEntries, expectedApprovedKeywordResearchChecks, incompleteApprovedKeywordResearchChecks, keywordResearchRequestIdentity, keywordResearchScopeKeywords, missingApprovedKeywordResearch, normalizeKeywordPhrase, splitKeywordEntries } from "@webtummy/core";
import { projectAnalysisLocations } from "../locationOptions.js";
import { keywordMarketKey, keywordMarketOptions, keywordOpportunityScore, latestSuccessfulKeywordRuns, uniqueSerpDomains } from "../keyword-runs.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";
import LeadFunnelWorkspace from "../components/LeadFunnelWorkspace.js";
import SiteBuilderWorkflow from "../components/SiteBuilderWorkflow.js";
import SiteCapabilityExtension from "../components/SiteCapabilityExtension.js";
import type { AiContentGeneration, DomainBacklinkLinks, DomainBacklinkSummary, ExecutionTask, GuidedExecutionTask, GuidedProject, HealthReport, IssueRow, KeywordResearchRun, Opportunity, ProjectNotification, ProjectWorkflowController as ProjectWorkflowControllerState, StrategyPagePriority, Website, WorkspaceIntelligence, WorkspaceIntelligenceResponse } from "../types.js";
import { AuthorityGrowthWorkspace } from "../components/AuthorityGrowthWorkspace.js";
import AiCitationVisibilityWorkspace from "../components/AiCitationVisibilityWorkspace.js";

type ModuleKind = "opportunities" | "strategy" | "keywords" | "site-analysis" | "backlinks" | "ai-citations" | "site-architect" | "lead-magnets";
type CrawlSummary = NonNullable<Website["crawlJobs"]>[number];
type CrawlIssue = {
  id: string;
  issueType: string;
  category: string;
  severity: "high" | "medium" | "low" | string;
  message: string;
  recommendation?: string | null;
  weightImpact?: number;
  status: string;
  page?: { url: string } | null;
};
type CrawlPageRow = {
  id: string;
  url: string;
  finalUrl?: string | null;
  statusCode?: number | null;
  depth: number;
  wordCount?: number | null;
  inlinkCount?: number;
  outlinkCount?: number;
  internalLinkScore?: number | null;
  internalLinkGrade?: string | null;
  brokenInternalLinkCount?: number;
  weakAnchorCount?: number;
  isOrphan?: boolean;
  crawlerPerformance?: { score?: number | null } | number | null;
  aliasUrls?: string[];
  aliasCount?: number;
};
type ScanDetailKey = "highIssues" | "brokenLinks" | "orphanPages" | "weakAnchors" | null;
type StrategyTab = "overview" | "score" | "core" | "audience" | "growth" | "funnel" | "advanced" | "roadmap";
type StrategyGenerationJob = {
  id: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  stage: string;
  progress: number;
  strategyId?: string | null;
  strategyVersion?: number | null;
  error?: string | null;
  errorCode?: string | null;
  delayed?: boolean;
};

type UnifiedChannelPlan = { objective: string; actions: string[]; dependencies: string[]; destination: string; successSignal: string };
type UnifiedGrowthFunnelStep = {
  key: string;
  title: string;
  objective: string;
  whyNow: string;
  recommendedAction: string;
  expectedImpact: string;
  confidence: number;
  confidenceReason: string;
  effort: "low" | "medium" | "high";
  planningTimeEstimate: string | null;
  destination: "seo" | "gap_analysis" | "content" | "website" | "lead_magnets" | "ai_citations" | "local_seo" | "authority" | "publishing" | "execution_plan" | "measurement";
  sourceSignals: string[];
  affectedPages: string[];
  dependencies: string[];
  details: string[];
  funnelStage?: "discover" | "evaluate" | "trust" | "convert" | "delight" | "grow_refer";
  audienceIntent?: string;
  trafficSources?: string[];
  entryAssets?: string[];
  conversionAction?: string;
  handoffToNext?: string;
  successMetric?: string;
  leakOrGap?: string;
  impactScore?: number;
  evidenceType?: "measured" | "verified_project_data" | "inferred";
  executionHorizon?: "now" | "next" | "later";
  recommendedExperiment?: string;
  validationRequirement?: string;
};
type UnifiedGrowthFunnel = {
  evaluationMethod: "ai" | "strategy_derived";
  summary: string;
  currentStage: string;
  nextBestActionKey: string;
  steps: UnifiedGrowthFunnelStep[];
  evidenceSummary: string[];
  safeguards: string[];
};
type UnifiedStrategyDecision = {
  key: string;
  analysisKey: string;
  title: string;
  why: string;
  whyNow: string;
  expectedImpact: string;
  confidence: number;
  confidenceLabel: "High" | "Medium" | "Low";
  confidenceReason: string;
  effort: "low" | "medium" | "high";
  priority: "critical" | "high" | "medium" | "low";
  priorityScore: number;
  impact: number;
  goalAlignment: number;
  urgency: number;
  evidence: string[];
  actions: string[];
  destination: string;
  destinationUrl: string;
  successMeasure: string;
  validationRequirement: string;
  whatHappensAfterApproval: string;
  sourceModule: string;
  selected: boolean;
  disposition: "selected" | "queued" | "deferred";
  reasonNotSelected: string | null;
  businessObjective: string;
  problemOrOpportunity: string;
  affectedPages: string[];
  dependencies: string[];
  requiredPermissions: string[];
  capacityRequirement: string;
  executionMethod: string;
  timeHorizon: "now" | "next" | "later";
};
type UnifiedStrategyDecisionSet = {
  engineVersion: string;
  businessBrainVersion: number;
  evidenceVersion: number;
  generatedAt: string;
  formula: string;
  nextBestActionKey: string;
  nextBestAction: UnifiedStrategyDecision;
  audit: {
    candidateCount: number;
    evidenceWarnings: string[];
    invalidCandidates?: Array<{ key: string; reason: string }>;
    modelPipelineReference?: string;
    approval?: { status: string; decidedAt: string | null };
  };
};
type UnifiedStrategyPlanView = {
  executiveSummary: string;
  objectives: string[];
  diagnosis: { currentState: string; keyChallenge: string; strategicOpportunity: string };
  positioning: { statement: string; audience: string; offer: string; differentiation: string };
  audience: { primarySegments: Array<{ name: string; need: string; intent: string; message: string }>; journey: Array<{ stage: string; question: string; requiredAsset: string; nextAction: string }> };
  focusAreas: Array<{ key: string; title: string; priority: string; objective: string; whyNow: string; evidence: string[]; actions: string[]; channels: string[]; successMeasures: string[]; dependencies: string[] }>;
  channels: Record<string, UnifiedChannelPlan | null>;
  websiteStrategy?: {
    mode: "new_website" | "existing_website_improvement" | "no_website";
    scope: { recommendedPageRange: string; rationale: string; releaseApproach: string };
    sitemapPriorities: Array<{ pageType: string; purpose: string; searchIntent: string; priority: "launch" | "next" | "later" }>;
    navigationApproach: string;
    contentArchitecture: string;
    conversionArchitecture: string;
    localAuthorityApproach: string;
    technicalFoundation: string[];
    launchRequirements: string[];
    deferredOpportunities: string[];
  };
  phases: Array<{ name: string; timeframe: string; objective: string; actions: string[]; deliverables: string[]; exitCriteria: string[] }>;
  topActions: string[];
  kpis: Array<{ name: string; why: string; measurement: string; targetDirection: string }>;
  risks: Array<{ risk: string; mitigation: string }>;
  assumptionsToValidate: string[];
  competitiveApproach: string;
  growthFunnel?: UnifiedGrowthFunnel;
};

function unifiedStrategyPlanFrom(value: unknown): UnifiedStrategyPlanView | null {
  if (!Array.isArray(value)) return null;
  const entry = value.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { analysisKey?: unknown }).analysisKey === "unified_strategy_plan") as { plan?: unknown } | undefined;
  const plan = entry?.plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const candidate = plan as Partial<UnifiedStrategyPlanView>;
  return candidate.executiveSummary && candidate.diagnosis && candidate.positioning && Array.isArray(candidate.focusAreas) && candidate.channels && Array.isArray(candidate.phases) ? candidate as UnifiedStrategyPlanView : null;
}

function unifiedStrategyDecisionSetFrom(value: unknown): UnifiedStrategyDecisionSet | null {
  if (!Array.isArray(value)) return null;
  const entry = value.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { analysisKey?: unknown }).analysisKey === "unified_strategy_plan") as { decisionSet?: unknown } | undefined;
  const decisionSet = entry?.decisionSet;
  if (!decisionSet || typeof decisionSet !== "object" || Array.isArray(decisionSet)) return null;
  const candidate = decisionSet as Partial<UnifiedStrategyDecisionSet>;
  return candidate.engineVersion && candidate.nextBestAction && candidate.nextBestActionKey ? candidate as UnifiedStrategyDecisionSet : null;
}

const moduleCopy: Record<ModuleKind, { title: string; subtitle: string; primary: string; secondary?: string }> = {
  opportunities: {
    title: "Opportunity Finder",
    subtitle: "Discover and evaluate high-value opportunities for this project.",
    primary: "Reassess opportunities",
    secondary: "How it works",
  },
  strategy: {
    title: "SEnuke AI Intelligence Strategy Engine",
    subtitle: "Turn opportunity insights into a structured execution strategy.",
    primary: "Create new Strategy version",
    secondary: "How it works",
  },
  keywords: {
    title: "Keyword Research",
    subtitle: "Review saved keyword research, search demand, difficulty, intent, CPC, opportunities, and page targets.",
    primary: "Start Keyword Analysis",
    secondary: "How it works",
  },
  "site-analysis": {
    title: "Site Analysis",
    subtitle: "Analyze and improve your website's performance, health, and search visibility.",
    primary: "Analyze Site",
    secondary: "How it works",
  },
  backlinks: {
    title: "Backlinks & Authority",
    subtitle: "Track backlinks, monitor authority, and discover safe link, citation, and outreach opportunities.",
    primary: "Refresh Backlinks",
    secondary: "How it works",
  },
  "ai-citations": {
    title: "AI Citation Optimization",
    subtitle: "Improve your brand's discoverability in AI search, answer engines, and large language models.",
    primary: "Refresh Citations",
    secondary: "How it works",
  },
  "site-architect": {
    title: "AI Site Architect",
    subtitle: "Create an approved website structure and page plan designed for usability, search visibility and conversion goals.",
    primary: "Generate Pages",
    secondary: "How it works",
  },
  "lead-magnets": {
    title: "Lead Magnet Builder",
    subtitle: "Prepare a Strategy-approved lead capture asset, delivery path and follow-up workflow for review.",
    primary: "Create Lead Magnet",
    secondary: "How it works",
  },
};

interface ModuleData {
  projects: GuidedProject[];
  websites: Website[];
  keywordRuns: KeywordResearchRun[];
  strategyPagePriorities: StrategyPagePriority[];
  tasks: GuidedExecutionTask[];
  notifications: ProjectNotification[];
  backlinkSummary: DomainBacklinkSummary | null;
  backlinkLinks: DomainBacklinkLinks | null;
  intelligence: WorkspaceIntelligence | null;
  leadMagnetGenerations: AiContentGeneration[];
}

const BACKLINK_REFRESH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_ANALYSIS_SCAN_COOLDOWN_MS = 72 * 60 * 60 * 1000;
type ReadinessItem = {
  key: string;
  title: string;
  description: string;
  status: "complete" | "in_progress" | "missing";
  actions: { label: string; url: string }[];
};

function hasCompletedSiteAnalysis(data: ModuleData, project?: GuidedProject, website?: Website) {
  const projectWebsite = project?.website as ({ crawlJobs?: Website["crawlJobs"] } | undefined);
  const crawlJobs = [...(projectWebsite?.crawlJobs ?? []), ...(website?.crawlJobs ?? [])];
  return crawlJobs.some((crawl) => crawl.status === "completed");
}

function hasActiveSiteAnalysis(project?: GuidedProject, website?: Website) {
  const projectWebsite = project?.website as ({ crawlJobs?: Website["crawlJobs"] } | undefined);
  const crawlJobs = [...(projectWebsite?.crawlJobs ?? []), ...(website?.crawlJobs ?? [])];
  return crawlJobs.some((crawl) => crawl.status === "queued" || crawl.status === "running");
}

function normalizeDomainForMatch(value: string | null | undefined) {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/:\d+$/, "");
}

function keywordRunBelongsToProject(run: KeywordResearchRun, project: GuidedProject, website?: Website) {
  if (run.projectId === project.id) return true;
  // An explicit project association is authoritative. Never recover a run from
  // another project merely because both projects reference the same website.
  if (run.projectId) return false;
  if (project.websiteId && run.websiteId === project.websiteId) return true;
  if (website?.id && run.websiteId === website.id) return true;

  const projectDomains = [
    project.websiteUrl,
    project.website?.rootUrl,
    project.website?.domain,
    website?.rootUrl,
    website?.domain,
  ].map(normalizeDomainForMatch).filter(Boolean);
  const runDomains = [
    run.targetDomain,
    run.website?.rootUrl,
    run.website?.domain,
    run.targetUrl,
    run.rankingUrl,
    run.manualUrl,
  ].map(normalizeDomainForMatch).filter(Boolean);

  if (!projectDomains.length || !runDomains.length) return false;
  return projectDomains.some((projectDomain) => runDomains.some((runDomain) => projectDomain === runDomain || projectDomain.endsWith(`.${runDomain}`) || runDomain.endsWith(`.${projectDomain}`)));
}

function moduleReadiness(kind: ModuleKind, data: ModuleData, project?: GuidedProject, website?: Website) {
  if (!project) return { canRun: false, items: [] as ReadinessItem[] };
  const intakeComplete = Boolean(project.businessProfile || (project.intakeAnswers?.length ?? 0) > 0);
  const opportunityExists = (project.opportunities?.length ?? 0) > 0;
  const opportunitySelected = project.opportunities?.some((opportunity) => ["selected", "confirmed"].includes(opportunity.status)) ?? false;
  const strategyExists = (project.strategyPlans?.length ?? 0) > 0;
  const strategyApproved = project.strategyPlans?.some((strategy) => typeof strategy === "object" && strategy !== null && "status" in strategy && strategy.status === "approved") ?? false;
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || website);
  const isExistingWebsite = isExistingWebsiteFlow(project, website);
  const siteAnalysisComplete = hasCompletedSiteAnalysis(data, project, website);
  const siteAnalysisInProgress = hasActiveSiteAnalysis(project, website);
  const keywordAnalysisComplete = (project.keywordGroups?.some((group) => group.status === "approved") ?? false) || data.keywordRuns.some((run) => {
    const runBelongsToWebsite = website?.id ? run.websiteId === website.id : true;
    const runBelongsToDomain = project.websiteUrl && run.targetDomain ? project.websiteUrl.includes(run.targetDomain) || run.targetDomain.includes(project.websiteUrl.replace(/^https?:\/\//i, "")) : true;
    return (runBelongsToWebsite || runBelongsToDomain) && (run.status === "completed" || run.keywordCount > 0 || (run.ideas?.length ?? 0) > 0);
  }) || data.tasks.some((task) => task.projectId === project.id && task.moduleName === "keyword_research" && ["completed", "skipped"].includes(task.status));
  const item = (key: string, title: string, description: string, complete: boolean, actions: { label: string; url: string }[]): ReadinessItem => ({
    key,
    title,
    description,
    status: complete ? "complete" : "missing",
    actions,
  });
  const intake = item(
    "intake",
    "Project intake required",
    "SEnuke AI - AI Growth Operating System needs the business profile, audience, offer, goal, and project context before this module can create useful output.",
    intakeComplete,
    [{ label: "Complete Intake", url: `/guided-projects/${project.id}/intake` }],
  );
  const opportunity = item(
    "opportunity",
    "Opportunity required",
    "SEnuke AI - AI Growth Operating System needs to know what direction this project is targeting before it can create downstream recommendations.",
    opportunityExists,
    [{ label: "Find Opportunity", url: `/opportunities?projectId=${project.id}` }],
  );
  const selectedOpportunity = item(
    "opportunity_selected",
    "Opportunity selection required",
    "Select one opportunity so the strategy and execution modules use the right project direction.",
    opportunitySelected,
    [{ label: "Select Opportunity", url: `/opportunities?projectId=${project.id}` }],
  );
  const strategy = item(
    "strategy",
    "Strategy required",
    "SEnuke AI - AI Growth Operating System needs an approved strategy before this module can generate reliable execution tasks.",
    strategyApproved,
    [{ label: strategyExists ? "Approve Strategy" : "Generate Strategy", url: `/strategy?projectId=${project.id}` }],
  );
  const keywordAnalysis = item(
    "keyword_analysis",
    keywordAnalysisComplete ? "Keyword analysis complete" : "Keyword analysis required",
    "SEnuke AI - AI Growth Operating System needs target keywords, buyer intent, topical clusters, competitor gaps, difficulty, opportunity score, and revenue potential before strategy and full execution planning.",
    keywordAnalysisComplete,
    [{ label: "Run Keyword Analysis", url: `/keywords?projectId=${project.id}` }],
  );
  const websitePlanTask = project.executionTasks?.find((task) => task.sourceType === "website_plan" || task.moduleName === "site_architect" || /website plan|page map/i.test(task.title ?? ""));
  const websitePlanApproved = Boolean(websitePlanTask?.approvedAt || ["approved", "ready_to_publish", "completed"].includes(websitePlanTask?.status ?? ""));
  const existingWebsitePath = project.projectType === "existing_website" || project.websiteStatus === "existing_website";
  const websiteRecoveryActions = websitePlanApproved
    ? [{ label: existingWebsitePath ? "Add Website URL" : "Create Website", url: existingWebsitePath ? `/guided-projects/${project.id}/intake` : `/site-architect?projectId=${project.id}` }]
    : [{ label: "Review Website Plan", url: `/seo-page-map?projectId=${project.id}${websitePlanTask?.id ? `&taskId=${websitePlanTask.id}` : ""}` }];
  const websiteItem = item(
    "website",
    "Site Analysis needs a website",
    websitePlanApproved ? "Create or connect the website approved in the Website Plan before Site Analysis begins." : "Review and approve the governed Website Plan before creating or connecting its website.",
    hasWebsite,
    websiteRecoveryActions,
  );
  const siteAnalysis: ReadinessItem = {
    key: "site_analysis",
    title: siteAnalysisInProgress && !siteAnalysisComplete ? "Site analysis in progress" : "Site analysis required",
    description: siteAnalysisInProgress && !siteAnalysisComplete
      ? "SEnuke AI - AI Growth Operating System is currently analyzing this website. Dependent modules will unlock automatically when the crawl finishes."
      : "SEnuke AI - AI Growth Operating System needs to analyze your website before it can evaluate funnel gaps, SEO issues, internal links, AI citations, backlinks, or page improvements.",
    status: siteAnalysisComplete ? "complete" : siteAnalysisInProgress ? "in_progress" : "missing",
    actions: [{ label: siteAnalysisInProgress && !siteAnalysisComplete ? "View progress" : "Analyze Site", url: `/site-analysis?projectId=${project.id}` }],
  };

  const requiredByModule: Partial<Record<ModuleKind, ReadinessItem[]>> = {
    opportunities: [intake],
    strategy: [intake, opportunity, selectedOpportunity, keywordAnalysis, ...(isExistingWebsite && hasWebsite ? [siteAnalysis] : [])],
    keywords: [intake, opportunity, selectedOpportunity],
    "site-analysis": [websiteItem, keywordAnalysis],
    backlinks: [websiteItem, siteAnalysis],
    "ai-citations": [websiteItem, siteAnalysis],
    "site-architect": [intake, strategy],
    "lead-magnets": [intake, strategy],
  };
  const items = requiredByModule[kind] ?? [];
  return { canRun: items.every((readyItem) => readyItem.status === "complete"), items };
}

export default function ExecutionModule({ kind }: { kind: ModuleKind }) {
  const copy = moduleCopy[kind];
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ModuleData>({
    projects: [],
    websites: [],
    keywordRuns: [],
    strategyPagePriorities: [],
    tasks: [],
    notifications: [],
    backlinkSummary: null,
    backlinkLinks: null,
    intelligence: null,
    leadMagnetGenerations: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshingBacklinks, setRefreshingBacklinks] = useState(false);
  const [backlinkMessage, setBacklinkMessage] = useState("");
  const [siteAnalysisBusy, setSiteAnalysisBusy] = useState(false);
  const [siteStatusRefreshing, setSiteStatusRefreshing] = useState(false);
  const [siteAnalysisMessage, setSiteAnalysisMessage] = useState("");
  const [strategyBusy, setStrategyBusy] = useState<"generate" | "analyze" | "approve" | "execution" | null>(null);
  const [strategyForegroundVisible, setStrategyForegroundVisible] = useState(false);
  const [strategyMessage, setStrategyMessage] = useState("");
  const [strategyJob, setStrategyJob] = useState<StrategyGenerationJob | null>(null);
  const [leadMagnetStartRequest, setLeadMagnetStartRequest] = useState(kind === "lead-magnets" && searchParams.get("start") === "1" ? 1 : 0);
  const [opportunityBusy, setOpportunityBusy] = useState<"generate" | string | null>(null);
  const [opportunityMessage, setOpportunityMessage] = useState("");
  const [opportunityCapacityEstimate, setOpportunityCapacityEstimate] = useState<number | null>(null);
  const [strategyCapacityEstimate, setStrategyCapacityEstimate] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get("projectId") ?? getActiveProjectId());
  const keywordJobFingerprint = useRef("");
  const strategyRequestKey = useRef("");
  const strategyConfirmResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [strategyGenerateConfirm, setStrategyGenerateConfirm] = useState<{ estimate: string } | null>(null);
  const [workspaceLoadError, setWorkspaceLoadError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [workflowController, setWorkflowController] = useState<ProjectWorkflowControllerState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setWorkspaceLoadError("");
      const requestedProjectId = searchParams.get("projectId");
      const workspaceParams = new URLSearchParams();
      if (requestedProjectId) workspaceParams.set("projectId", requestedProjectId);
      if (kind === "strategy") workspaceParams.set("includeStrategyPagePriorities", "true");
      const workspaceUrl = `/api/workspace/intelligence${workspaceParams.size ? `?${workspaceParams.toString()}` : ""}`;
      const workspace = await api.get<WorkspaceIntelligenceResponse>(workspaceUrl).catch((error) => {
        if (!cancelled) setWorkspaceLoadError(error instanceof Error ? error.message : "Project data could not be loaded.");
        return null;
      });
      if (!workspace) {
        if (!cancelled) setLoading(false);
        return;
      }
      const activeWebsiteId = workspace.intelligence.activeWebsiteId ?? workspace.projects[0]?.websiteId ?? workspace.websites[0]?.id;
      const [backlinkSummaryResult, backlinkLinksResult] = activeWebsiteId
        ? await Promise.all([
            api.get<{ summary: DomainBacklinkSummary }>(`/api/keyword-research/domain-backlinks?websiteId=${encodeURIComponent(activeWebsiteId)}&cacheOnly=true`).catch(() => ({ summary: null })),
            api.get<{ backlinks: DomainBacklinkLinks }>(`/api/keyword-research/domain-backlink-links?websiteId=${encodeURIComponent(activeWebsiteId)}&limit=${kind === "backlinks" ? 100 : 10}&cacheOnly=true`).catch(() => ({ backlinks: null })),
          ])
        : [{ summary: null }, { backlinks: null }];
      if (!cancelled) {
        const defaultProjectId = resolveActiveProjectId(workspace.projects, requestedProjectId, workspace.intelligence.activeProjectId);
        if (defaultProjectId) setActiveProjectId(defaultProjectId);
        setData({
          projects: workspace.projects,
          websites: workspace.websites,
          keywordRuns: workspace.keywordRuns,
          strategyPagePriorities: workspace.strategyPagePriorities ?? [],
          tasks: workspace.tasks,
          notifications: workspace.notifications ?? [],
          backlinkSummary: backlinkSummaryResult.summary,
          backlinkLinks: backlinkLinksResult.backlinks,
          intelligence: workspace.intelligence,
          leadMagnetGenerations: workspace.leadMagnetGenerations ?? [],
        });
        setSelectedProjectId(defaultProjectId);
        if (!requestedProjectId && defaultProjectId) {
          const next = new URLSearchParams(searchParams);
          next.set("projectId", defaultProjectId);
          setSearchParams(next, { replace: true });
        }
        setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (kind !== "opportunities" && kind !== "strategy") return;
    void api.get<{ features: Array<{ featureKey: string; defaultCreditCost: number }> }>("/api/usage/feature-costs")
      .then((result) => {
        setOpportunityCapacityEstimate(result.features.find((feature) => feature.featureKey === "opportunity_refresh")?.defaultCreditCost ?? null);
        setStrategyCapacityEstimate(result.features.find((feature) => feature.featureKey === "strategy_generate")?.defaultCreditCost ?? null);
      })
      .catch(() => { setOpportunityCapacityEstimate(null); setStrategyCapacityEstimate(null); });
  }, [kind]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    let cancelled = false;
    const projectId = selectedProjectId || searchParams.get("projectId");
    if (!projectId) return;
    const projectForJob = (job: BackgroundJob) => {
      if (job.projectId) return job.projectId;
      try { return new URL(job.resultUrl, window.location.origin).searchParams.get("projectId"); } catch { return null; }
    };
    const refreshKeywordRuns = async () => {
      try {
        const result = await api.get<{ runs: KeywordResearchRun[] }>(`/api/keyword-research?projectId=${encodeURIComponent(projectId)}`);
        if (!cancelled) setData((current) => ({ ...current, keywordRuns: result.runs }));
      } catch {
        // The normal workspace error handling remains authoritative. A later
        // job event or page load will retry this lightweight synchronization.
      }
    };
    const onBackgroundJobsChanged = (event: Event) => {
      const jobs = ((event as CustomEvent<BackgroundJob[]>).detail ?? [])
        .filter((job) => job.type === "keyword-research" && projectForJob(job) === projectId);
      if (!jobs.length) return;
      const fingerprint = jobs.map((job) => `${job.id}:${job.status}`).sort().join("|");
      if (fingerprint === keywordJobFingerprint.current) return;
      keywordJobFingerprint.current = fingerprint;
      if (!jobs.every((job) => isBackgroundJobFinished(job.status))) return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void refreshKeywordRuns(); }, 250);
    };
    window.addEventListener(BACKGROUND_JOBS_EVENT, onBackgroundJobsChanged);
    void refreshKeywordRuns();
    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.removeEventListener(BACKGROUND_JOBS_EVENT, onBackgroundJobsChanged);
    };
  }, [selectedProjectId]);

  const selectedProject = data.projects.find((project) => project.id === selectedProjectId) ?? data.projects[0];
  const selectedProjectWebsite = selectedProject?.websiteId
    ? data.websites.find((website) => website.id === selectedProject.websiteId)
    : undefined;
  const scopedWebsites = selectedProject
    ? selectedProjectWebsite ? [selectedProjectWebsite] : []
    : data.websites;
  const scopedKeywordRuns = selectedProject
    ? data.keywordRuns.filter((run) => keywordRunBelongsToProject(run, selectedProject, selectedProjectWebsite))
    : data.keywordRuns;
  const scopedData = selectedProject ? {
    ...data,
    projects: [selectedProject, ...data.projects.filter((project) => project.id !== selectedProject.id)],
    websites: scopedWebsites,
    keywordRuns: scopedKeywordRuns,
    tasks: data.tasks.filter((task) => !task.projectId || task.projectId === selectedProject.id),
  } : data;
  const activeProject = scopedData.projects[0];
  const activeWebsite = activeProject?.websiteId
    ? scopedData.websites.find((website) => website.id === activeProject.websiteId)
    : scopedData.websites[0];
  const activeSiteCrawl = activeWebsite?.crawlJobs?.find((crawl) => crawl.status === "queued" || crawl.status === "running");
  const latestSiteCrawl = activeWebsite?.crawlJobs?.find((crawl) => crawl.status === "completed" && (crawl.pagesCrawled > 0 || crawl.siteScore != null));

  const refreshSiteAnalysisStatus = async () => {
    if (!activeWebsite?.id || siteStatusRefreshing) return;
    setSiteStatusRefreshing(true);
    try {
      const result = await api.get<{ website: Website }>(`/api/websites/${encodeURIComponent(activeWebsite.id)}`);
      const trackedId = activeSiteCrawl?.id;
      const crawl = trackedId ? result.website.crawlJobs?.find((item) => item.id === trackedId) : result.website.crawlJobs?.[0];
      setData((current) => ({ ...current, websites: current.websites.map((website) => website.id === result.website.id ? result.website : website) }));
      if (crawl?.status === "completed") setSiteAnalysisMessage(`Site analysis completed.${crawl.pagesCrawled ? ` ${formatNumber(crawl.pagesCrawled)} pages were analyzed.` : ""} The report is ready to review.`);
      else if (crawl?.status === "failed") setSiteAnalysisMessage(`Site analysis failed${crawl.error ? `: ${crawl.error}` : "."} Review the error and try again.`);
      else setSiteAnalysisMessage(`Site analysis is ${crawl?.status ?? "starting"}. Results will appear here automatically when processing finishes.`);
    } catch (error) {
      setSiteAnalysisMessage(error instanceof Error ? error.message : "Site analysis status could not be refreshed.");
    } finally {
      setSiteStatusRefreshing(false);
    }
  };

  useEffect(() => {
    if ((kind !== "site-analysis" && kind !== "keywords") || !activeWebsite?.id || !activeSiteCrawl?.id) return;
    let cancelled = false;
    const pollCrawl = async () => {
      try {
        const result = await api.get<{ website: Website }>(`/api/websites/${encodeURIComponent(activeWebsite.id)}`);
        if (cancelled) return;
        const crawl = result.website.crawlJobs?.find((item) => item.id === activeSiteCrawl.id);
        setData((current) => ({
          ...current,
          websites: current.websites.map((website) => website.id === result.website.id ? result.website : website),
        }));
        if (!crawl || crawl.status === "queued" || crawl.status === "running") return;
        if (crawl.status === "completed") {
          const pages = crawl.pagesCrawled ? ` ${formatNumber(crawl.pagesCrawled)} pages were analyzed.` : "";
          setSiteAnalysisMessage(`Site analysis completed.${pages} The report and recommendations are now updated.`);
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            new Notification("Site analysis completed", { body: `${activeWebsite.domain} is ready to review.` });
          }
        } else {
          setSiteAnalysisMessage(`Site analysis ${crawl.status}. Review the crawl details and try again if needed.`);
        }
      } catch {
        // Keep the current status visible and retry on the next interval.
      }
    };
    void pollCrawl();
    const timer = window.setInterval(() => { void pollCrawl(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSiteCrawl?.id, activeWebsite?.domain, activeWebsite?.id, kind]);

  const titleSuffix = activeProject?.businessName || activeProject?.name || activeWebsite?.domain;
  const moduleTitle = titleSuffix || copy.title;
  const hasActiveProject = Boolean(activeProject);
  const activeOpportunityCount = activeProject?.opportunities?.length ?? activeProject?._count?.opportunities ?? 0;
  const hasOpportunities = activeOpportunityCount > 0;
  const hasWorkspaceRecords = data.projects.length > 0
    || data.websites.length > 0
    || data.keywordRuns.length > 0
    || data.tasks.length > 0
    || Boolean(data.backlinkSummary)
    || Boolean(data.backlinkLinks?.links?.length);
  const backlinkCooldown = useMemo(() => backlinkRefreshState(data.backlinkSummary?.fetchedAt), [data.backlinkSummary?.fetchedAt]);
  const siteScanCooldown = useMemo(() => siteScanCooldownState(latestSiteCrawl, nowMs), [latestSiteCrawl, nowMs]);
  const readiness = moduleReadiness(kind, scopedData, activeProject, activeWebsite);
  const canRunModule = readiness.canRun;

  const refreshBacklinks = async () => {
    if (!activeWebsite || refreshingBacklinks || backlinkCooldown.blocked) return;
    setRefreshingBacklinks(true);
    setBacklinkMessage("");
    try {
      // Complete the profile summary reservation first. Link detail then joins
      // the same idempotent refresh event without a parallel refund/commit race.
      const summaryResult = await api.get<{ summary: DomainBacklinkSummary }>(`/api/keyword-research/domain-backlinks?websiteId=${encodeURIComponent(activeWebsite.id)}&refresh=true`);
      const linksResult = await api.get<{ backlinks: DomainBacklinkLinks }>(`/api/keyword-research/domain-backlink-links?websiteId=${encodeURIComponent(activeWebsite.id)}&limit=100&refresh=true`);
      if (activeProject && summaryResult.summary) {
        await api.post(`/api/projects/${encodeURIComponent(activeProject.id)}/authority-growth/snapshots`, {
          summary: summaryResult.summary,
          links: linksResult.backlinks?.links ?? [],
        });
      }
      setData((current) => ({
        ...current,
        backlinkSummary: summaryResult.summary,
        backlinkLinks: linksResult.backlinks,
      }));
      setBacklinkMessage(summaryResult.summary?.cached ? "Backlinks were already refreshed recently. The current evidence was saved to the authority profile." : "Backlink data refreshed and saved to the authority profile.");
    } catch (error) {
      setBacklinkMessage(error instanceof Error ? error.message : "Backlink refresh failed.");
    } finally {
      setRefreshingBacklinks(false);
    }
  };

  const analyzeSite = async () => {
    if (!activeWebsite || activeSiteCrawl || siteAnalysisBusy || siteScanCooldown.blocked) return;
    setSiteAnalysisBusy(true);
    setSiteAnalysisMessage("");
    try {
      const result = await api.post<{ crawlJob: NonNullable<Website["crawlJobs"]>[number] }>(`/api/websites/${activeWebsite.id}/crawls`, {
        pageLimit: 150,
        maxDepth: 3,
        includePatterns: [],
        excludePatterns: [],
        respectRobots: true,
      });
      setData((current) => ({
        ...current,
        websites: current.websites.map((website) => website.id === activeWebsite.id
          ? { ...website, crawlJobs: [result.crawlJob, ...(website.crawlJobs ?? []).filter((crawl) => crawl.id !== result.crawlJob.id)] }
          : website),
      }));
      if (result.crawlJob.status !== "completed" && activeProject) {
        registerBackgroundJob({
          id: result.crawlJob.id,
          projectId: activeProject.id,
          type: "site-analysis",
          title: "Site analysis",
          subject: activeProject.businessName || activeProject.name,
          status: result.crawlJob.status,
          statusUrl: `/api/crawls/${result.crawlJob.id}/status`,
          resultUrl: `/site-analysis?projectId=${encodeURIComponent(activeProject.id)}`,
          startedAt: new Date().toISOString(),
          progressMessage: `You can continue working. We’re analyzing ${activeProject.businessName || activeProject.name} in the background.`,
          completedMessage: `${activeProject.businessName || activeProject.name} is ready to review`,
          failedMessage: `${activeProject.businessName || activeProject.name} could not be analyzed. Review the error and try again.`,
          resultMetricKey: "pagesCrawled",
          resultMetricLabel: "pages analyzed",
          resultMetric: result.crawlJob.pagesCrawled,
        });
      }
      setSiteAnalysisMessage(result.crawlJob.status === "completed"
        ? "Latest site analysis is already available."
        : "Site analysis started. Crawl results will appear here when the worker finishes.");
    } catch (error) {
      setSiteAnalysisMessage(error instanceof Error ? error.message : "Could not start site analysis.");
    } finally {
      setSiteAnalysisBusy(false);
    }
  };

  const updateActiveProject = (project: GuidedProject) => {
    setData((current) => ({
      ...current,
      projects: current.projects.some((item) => item.id === project.id)
        ? current.projects.map((item) => item.id === project.id ? project : item)
        : [project, ...current.projects],
      tasks: project.executionPlans?.flatMap((plan) => plan.tasks ?? []) ?? current.tasks,
    }));
    setSelectedProjectId(project.id);
    setActiveProjectId(project.id);
  };

  useEffect(() => {
    if (kind !== "strategy" || !activeProject?.id) return;
    let cancelled = false;
    void api.get<{ job: StrategyGenerationJob | null }>(`/api/projects-v2/${activeProject.id}/strategy/jobs/active`).then((result) => {
      if (cancelled || !result.job) return;
      setStrategyJob(result.job);
      setStrategyBusy("generate");
      setStrategyForegroundVisible(false);
      setStrategyMessage("");
      registerBackgroundJob({
        id: result.job.id,
        projectId: activeProject.id,
        type: "strategy-generation",
        title: "Strategy generation",
        subject: activeProject.businessName || activeProject.name,
        status: result.job.status,
        statusUrl: `/api/projects-v2/${activeProject.id}/strategy/jobs/${result.job.id}`,
        resultUrl: `/strategy?projectId=${encodeURIComponent(activeProject.id)}`,
        startedAt: new Date().toISOString(),
        progressMessage: "Strategy generation is continuing in the background. You can leave this page and return when the draft is ready.",
        completedMessage: `${activeProject.businessName || activeProject.name} Strategy is ready to review`,
        failedMessage: "Strategy generation needs attention. Review the error and retry.",
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [kind, activeProject?.id]);

  useEffect(() => {
    if (!strategyForegroundVisible) return;
    const timer = window.setTimeout(() => {
      setStrategyForegroundVisible(false);
      setStrategyMessage("");
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [strategyForegroundVisible]);

  useEffect(() => {
    if (kind !== "strategy" || !activeProject?.id || !strategyJob || !["queued", "running"].includes(strategyJob.status)) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const result = await api.get<{ job: StrategyGenerationJob; project?: GuidedProject }>(`/api/projects-v2/${activeProject.id}/strategy/jobs/${strategyJob.id}`);
        if (cancelled) return;
        setStrategyJob(result.job);
        if (result.job.status === "completed") {
          if (result.project) updateActiveProject(result.project);
          strategyRequestKey.current = "";
          setStrategyBusy(null);
          setStrategyForegroundVisible(false);
          setStrategyMessage(`Strategy v${result.job.strategyVersion ?? ""} is ready. Review and approve this draft before creating or updating the Execution Plan.`);
          return;
        }
        if (result.job.status === "failed") {
          strategyRequestKey.current = "";
          setStrategyBusy(null);
          setStrategyForegroundVisible(false);
          setStrategyMessage(`${result.job.error || "Strategy generation could not be completed."}${result.job.errorCode ? ` Error code: ${result.job.errorCode}` : ""}`);
          return;
        }
        timer = window.setTimeout(() => { void poll(); }, 2000);
      } catch (error) {
        if (cancelled) return;
        setStrategyBusy(null);
        setStrategyForegroundVisible(false);
        setStrategyMessage(error instanceof Error ? error.message : "Strategy progress could not be checked. Refresh the page to resume.");
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [kind, activeProject?.id, strategyJob?.id, strategyJob?.status]);

  const changeProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveProjectId(projectId);
    const next = new URLSearchParams(searchParams);
    if (projectId) next.set("projectId", projectId);
    else next.delete("projectId");
    setSearchParams(next, { replace: true });
    setOpportunityMessage("");
    setStrategyMessage("");
    setStrategyJob(null);
    strategyRequestKey.current = "";
    setSiteAnalysisMessage("");
    setLeadMagnetStartRequest(0);
    setWorkflowController(null);
  };

  const releaseDelayedStrategyJob = async () => {
    if (!activeProject || !strategyJob?.delayed) return;
    try {
      await api.post(`/api/projects-v2/${activeProject.id}/strategy/jobs/${strategyJob.id}/retry`, {});
      strategyRequestKey.current = "";
      setStrategyJob(null);
      setStrategyBusy(null);
      setStrategyMessage("The delayed job was released and its Capacity reservation was refunded. Select Generate Strategy when you are ready to retry.");
    } catch (error) {
      setStrategyMessage(error instanceof Error ? error.message : "The delayed Strategy job could not be released.");
    }
  };

  const closeStrategyGenerateConfirm = (confirmed: boolean) => {
    strategyConfirmResolver.current?.(confirmed);
    strategyConfirmResolver.current = null;
    setStrategyGenerateConfirm(null);
  };

  const confirmStrategyGeneration = (estimate: string) => new Promise<boolean>((resolve) => {
    strategyConfirmResolver.current = resolve;
    setStrategyGenerateConfirm({ estimate });
  });

  const runStrategyAction = async (action: "generate" | "analyze" | "approve" | "execution", options?: { revisionComment?: string; confirmed?: boolean }) => {
    if (!activeProject) return { ok: false, message: "Create or select a project before using strategy actions." };
    if (strategyBusy) return { ok: false, message: "Another strategy action is already running." };
    if (action === "generate") {
      const estimate = strategyCapacityEstimate == null ? "the configured AI Capacity estimate" : `${strategyCapacityEstimate.toLocaleString()} AI Capacity units`;
      if (!options?.confirmed && !await confirmStrategyGeneration(estimate)) return { ok: false, message: "Strategy generation was not started." };
    }
    const endpoint = action === "generate"
      ? `/api/projects-v2/${activeProject.id}/strategy/generate`
      : action === "analyze"
        ? `/api/projects-v2/${activeProject.id}/strategy/analyze`
      : action === "approve"
        ? `/api/projects-v2/${activeProject.id}/strategy/approve`
        : `/api/projects-v2/${activeProject.id}/execution-plan/create`;
    setStrategyBusy(action);
    if (action === "generate") setStrategyForegroundVisible(true);
    setStrategyMessage("");
    let backgroundAccepted = false;
    try {
      if (action === "generate") {
        strategyRequestKey.current ||= window.crypto.randomUUID();
        const result = await api.post<{ job: StrategyGenerationJob }>(endpoint, { ...(options ?? {}), idempotencyKey: strategyRequestKey.current });
        backgroundAccepted = true;
        setStrategyJob(result.job);
        registerBackgroundJob({
          id: result.job.id,
          projectId: activeProject.id,
          type: "strategy-generation",
          title: "Strategy generation",
          subject: activeProject.businessName || activeProject.name,
          status: result.job.status,
          statusUrl: `/api/projects-v2/${activeProject.id}/strategy/jobs/${result.job.id}`,
          resultUrl: `/strategy?projectId=${encodeURIComponent(activeProject.id)}`,
          startedAt: new Date().toISOString(),
          progressMessage: "Strategy generation is continuing in the background. You can leave this page and return when the draft is ready.",
          completedMessage: `${activeProject.businessName || activeProject.name} Strategy is ready to review`,
          failedMessage: "Strategy generation needs attention. Review the error and retry.",
        });
        setStrategyMessage("");
        return { ok: true, message: "Strategy generation started in the background." };
      }
      const request = api.post<{ project: GuidedProject }>(endpoint, {});
      const [result] = await Promise.all([request, action === "execution" ? new Promise((resolve) => window.setTimeout(resolve, 2500)) : Promise.resolve()]);
      updateActiveProject(result.project);
      setStrategyMessage(action === "analyze"
          ? "Strategy Intelligence completed for the current version. Applicable opportunities and Execution Plan tasks are now updated."
        : action === "approve"
          ? "Strategy approved. Its recommendations were added to the Execution Plan without duplicating existing tasks."
          : "Execution plan created from the approved strategy. New execution tasks are now available in the roadmap and module pages.");
      return {
        ok: true,
        message: action === "analyze"
            ? "Strategy Intelligence completed for the current version without changing its approval status."
          : action === "approve"
            ? "Strategy approved. Its recommendations were added to the Execution Plan without duplicating existing tasks."
            : "Execution plan created from the approved strategy. New execution tasks are now available.",
      };
    } catch (error) {
      if (action === "generate" && !backgroundAccepted) strategyRequestKey.current = "";
      if (action === "generate" && !backgroundAccepted) setStrategyForegroundVisible(false);
      const message = error instanceof Error ? error.message : "Strategy action failed.";
      setStrategyMessage(message);
      return { ok: false, message };
    } finally {
      if (action !== "generate" || !backgroundAccepted) setStrategyBusy(null);
    }
  };

  const generateOpportunities = async () => {
    if (!activeProject || opportunityBusy) return;
    const creatingFirstOpportunity = !hasOpportunities;
    const estimateText = opportunityCapacityEstimate == null ? "the configured AI Capacity estimate" : `${opportunityCapacityEstimate.toLocaleString()} AI Capacity units`;
    if (!window.confirm(`${creatingFirstOpportunity ? "Create" : "Reassess"} opportunity recommendations?\n\nSEnuke AI will use the current Business Brain and project evidence. Estimated use: ${estimateText}. If no eligible evidence changed, the saved assessment is reused without another charge.`)) return;
    setOpportunityBusy("generate");
    setOpportunityMessage("");
    try {
      const [result] = await Promise.all([
        api.post<{ project: GuidedProject; generationMode: "ai" | "rule_fallback"; analysisSummary?: string; cached?: boolean }>(`/api/projects-v2/${activeProject.id}/opportunities/generate`, {}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
      ]);
      updateActiveProject(result.project);
      setOpportunityMessage(result.cached
        ? (result.analysisSummary || "No eligible evidence changed. The existing assessment was reused without another AI Capacity charge.")
        : result.generationMode === "rule_fallback"
        ? "The AI provider was unavailable, so a clearly recorded rules-based fallback was created. Refresh when AI is available for a full recommendation."
        : creatingFirstOpportunity
          ? "AI analyzed the Business Brain and created three ranked opportunities. Review the reasoning and select the best direction."
          : "AI refreshed and reranked the opportunities from the latest Business Brain.");
    } catch (error) {
      setOpportunityMessage(error instanceof Error ? error.message : creatingFirstOpportunity ? "Opportunity creation failed." : "Opportunity refresh failed.");
    } finally {
      setOpportunityBusy(null);
    }
  };

  const selectOpportunity = async (opportunityId: string) => {
    if (!activeProject || opportunityBusy) return false;
    setOpportunityBusy(opportunityId);
    setOpportunityMessage("");
    try {
      let result: { project: GuidedProject };
      try {
        result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/${opportunityId}/select`, {});
      } catch (error) {
        if (!(error instanceof Error) || !/confirm changing/i.test(error.message)) throw error;
        if (!window.confirm("Strategy is already approved. Change the active opportunity and refresh downstream work?")) return false;
        result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/${opportunityId}/select`, { confirmation: true, reason: "Confirmed from Opportunity Finder" });
      }
      updateActiveProject(result.project);
      setOpportunityMessage("");
      return true;
    } catch (error) {
      setOpportunityMessage(error instanceof Error ? error.message : "Opportunity selection failed.");
      return false;
    } finally {
      setOpportunityBusy(null);
    }
  };

  const clearOpportunitySelection = async () => {
    if (!activeProject || opportunityBusy) return;
    setOpportunityBusy("clear");
    setOpportunityMessage("");
    try {
      let result: { project: GuidedProject };
      try {
        result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/clear-selection`, {});
      } catch (error) {
        if (!(error instanceof Error) || !/confirm removing/i.test(error.message)) throw error;
        if (!window.confirm("Strategy is already approved. Remove the active direction and block new Strategy generation until another is chosen?")) return;
        result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/clear-selection`, { confirmation: true, reason: "Confirmed from Opportunity Finder" });
      }
      updateActiveProject(result.project);
      setOpportunityMessage("Selected opportunity removed. Choose another opportunity before generating the next strategy version.");
    } catch (error) {
      setOpportunityMessage(error instanceof Error ? error.message : "Could not remove selected opportunity.");
    } finally {
      setOpportunityBusy(null);
    }
  };

  const deleteOpportunityData = async () => {
    if (!activeProject || opportunityBusy) return;
    const confirmed = window.confirm("Delete all saved Opportunity recommendations and their AI run history? Any Strategy and downstream work that depends on the selected Opportunity will also be cleared. Intake, keywords, keyword research, and Site Analysis will be preserved.");
    if (!confirmed) return;
    setOpportunityBusy("delete");
    setOpportunityMessage("");
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/reset-after-strategy`, {
        confirmation: "RESET",
        modules: ["opportunities"],
      });
      updateActiveProject(result.project);
      setOpportunityMessage("Opportunity data deleted. Intake and collected intelligence were preserved; you can now generate fresh AI recommendations.");
    } catch (error) {
      setOpportunityMessage(error instanceof Error ? error.message : "Could not delete Opportunity data.");
    } finally {
      setOpportunityBusy(null);
    }
  };

  const refineOpportunities = async (instructions: string) => {
    if (!activeProject || opportunityBusy) return;
    if (!instructions?.trim()) return;
    setOpportunityBusy("refine"); setOpportunityMessage("");
    try { const result = await api.post<{ project: GuidedProject; generationMode: "ai" | "rule_fallback" }>(`/api/projects-v2/${activeProject.id}/opportunities/refine`, { instructions }); updateActiveProject(result.project); setOpportunityMessage(result.generationMode === "rule_fallback" ? "The AI provider was unavailable, so the saved rules-based recommendations remain a fallback. Refresh when AI is available." : "AI created and reranked three revised opportunities using the Business Brain and your instructions."); }
    catch (error) { setOpportunityMessage(error instanceof Error ? error.message : "Could not refine opportunities."); }
    finally { setOpportunityBusy(null); }
  };

  const skipOpportunityFinder = async () => {
    if (!activeProject || opportunityBusy || !window.confirm("Skip recommendations and confirm the existing project direction?")) return;
    setOpportunityBusy("skip");
    try { const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/skip`, { confirmation: true }); updateActiveProject(result.project); setOpportunityMessage("Existing project direction confirmed."); }
    catch (error) { setOpportunityMessage(error instanceof Error ? error.message : "Could not confirm the existing direction."); }
    finally { setOpportunityBusy(null); }
  };

  const openKeywordResearch = () => {
    if (activeWebsite?.id) navigate(`/keyword-insights?project=${encodeURIComponent(activeWebsite.id)}&add=1`);
    else navigate("/keyword-insights?add=1");
  };

  const primaryDisabled = kind === "backlinks"
    ? (!activeWebsite || refreshingBacklinks || backlinkCooldown.blocked || !canRunModule)
    : kind === "site-analysis"
      ? latestSiteCrawl ? false : (!activeWebsite || Boolean(activeSiteCrawl) || siteAnalysisBusy || siteScanCooldown.blocked || !canRunModule)
    : kind === "ai-citations"
      ? true
    : kind === "strategy"
      ? (!activeProject || strategyBusy === "generate" || !canRunModule || !workflowController?.intelligenceReady)
      : kind === "opportunities"
        ? (!activeProject || Boolean(opportunityBusy) || !canRunModule)
      : kind === "lead-magnets"
        ? (!activeProject || !canRunModule)
      : !canRunModule;
  const primaryLabel = kind === "backlinks"
    ? refreshingBacklinks
      ? "Refreshing..."
      : backlinkCooldown.blocked
        ? `Available ${backlinkCooldown.availableLabel}`
        : copy.primary
    : kind === "site-analysis" && latestSiteCrawl
      ? "Continue to SEO & Gap Analysis"
    : kind === "site-analysis" && siteAnalysisBusy
      ? "Analyzing..."
    : kind === "site-analysis" && activeSiteCrawl
      ? activeSiteCrawl.status === "queued" ? "Crawl queued..." : "Crawl running..."
    : kind === "site-analysis" && siteScanCooldown.blocked
      ? `Available ${siteScanCooldown.remainingLabel}`
    : kind === "ai-citations"
      ? "Citation Snapshot"
    : kind === "strategy" && strategyBusy === "generate"
      ? "Refreshing..."
    : kind === "strategy" && workflowController && !workflowController.intelligenceReady
      ? "Complete intelligence first"
    : kind === "opportunities" && opportunityBusy === "generate"
      ? hasOpportunities ? "Refreshing..." : "Creating..."
    : kind === "opportunities"
      ? hasOpportunities ? "Reassess opportunities" : "Create Opportunity"
    : copy.primary;
  const moduleNextStep = activeProject ? getModuleNextStep({
    kind,
    project: activeProject,
    website: activeWebsite,
    latestCrawl: latestSiteCrawl,
    siteScanBlocked: siteScanCooldown.blocked,
    siteScanRemaining: siteScanCooldown.remainingLabel,
    keywordRuns: scopedKeywordRuns,
  }) : null;

  const runHeaderPrimaryAction = () => {
    if (kind === "backlinks") {
      void refreshBacklinks();
      return;
    }
    if (kind === "site-analysis") {
      if (latestSiteCrawl && activeProject) {
        navigate(`/gap-analysis?projectId=${encodeURIComponent(activeProject.id)}`);
        return;
      }
      void analyzeSite();
      return;
    }
    if (kind === "strategy") {
      setStrategyMessage("Creating a new Strategy version from the latest project data...");
      void runStrategyAction("generate");
      return;
    }
    if (kind === "opportunities") {
      void generateOpportunities();
      return;
    }
    if (kind === "keywords") {
      openKeywordResearch();
      return;
    }
    if (kind === "lead-magnets") {
      setLeadMagnetStartRequest((current) => current + 1);
    }
  };

  const headerActions: ProjectHeaderAction[] = [];
  if (kind === "keywords" && scopedKeywordRuns.length > 0) headerActions.push({ key: "manage-keywords", label: "Manage keyword groups", variant: "secondary", onClick: () => { const next = new URLSearchParams(searchParams); next.set("manageKeywords", "1"); setSearchParams(next, { replace: true }); } });
  if (kind === "ai-citations") headerActions.push({ key: "evidence-workspace", label: "Evidence-led workspace", variant: "status" });
  else if (kind !== "site-architect" && kind !== "keywords" && kind !== "lead-magnets" && !(kind === "site-analysis" && !latestSiteCrawl)) headerActions.push({ key: "primary", label: primaryLabel, disabled: primaryDisabled, onClick: runHeaderPrimaryAction });

  return (
    <div className={kind === "keywords"
      ? "-m-4 min-h-[calc(100vh-4rem)] space-y-5 bg-gradient-to-br from-cyan-50 via-[#f7fbff] to-blue-50 p-4 lg:-m-8 lg:min-h-screen lg:p-8"
      : "space-y-5"}>
      {kind === "strategy" && strategyBusy === "generate" && strategyForegroundVisible && <StrategyCookingOverlay job={strategyJob} />}
      {kind === "strategy" && strategyBusy === "execution" && <ExecutionPlanCookingOverlay />}
      <ProjectModuleHeader eyebrow={copy.title} title={moduleTitle} subtitle={copy.subtitle} project={hasActiveProject ? activeProject : null} projects={data.projects} tasks={scopedData.tasks} notifications={scopedData.notifications} onProjectChange={changeProject} actions={headerActions} showExecution={kind !== "keywords" && kind !== "site-analysis"} />
      {hasActiveProject && activeProject && <ProjectWorkflowController projectId={activeProject.id} refreshKey={`${scopedData.tasks.length}:${scopedKeywordRuns.length}:${activeSiteCrawl?.id ?? ""}:${activeSiteCrawl?.status ?? ""}:${latestSiteCrawl?.id ?? ""}:${latestSiteCrawl?.completedAt ?? ""}`} compact onLoaded={setWorkflowController} />}
      {hasActiveProject && kind === "backlinks" && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${backlinkMessage ? "border-brand-100 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-charcoal-500"}`}>
          {backlinkMessage || (activeWebsite ? backlinkCooldown.helpText : "Connect a website before refreshing backlinks.")}
        </div>
      )}
      {hasActiveProject && kind === "strategy" && workflowController?.strategyStale && activeProject?.strategyPlans?.[0] ? (
        <div className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-amber-700">Approved Strategy remains active · new evidence available</div>
            <div className="mt-1 text-base font-bold text-slate-950">Review what changed since Strategy v{activeProject.strategyPlans[0].version ?? 1}</div>
            <p className="mt-1 leading-6 text-amber-900">Nothing will regenerate automatically and this does not block other work. Review the changed evidence below; create a new version only if you decide the changes justify it. The credit estimate is shown before generation.</p>
            {workflowController.changedEvidence.length > 0 && <div className="mt-2 text-xs font-semibold text-amber-900">Changed: {workflowController.changedEvidence.map((item) => item.label).join(" · ")}</div>}
          </div>
          <span className="shrink-0 rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-black text-amber-900">Review first · regeneration optional</span>
        </div>
      ) : hasActiveProject && kind === "strategy" ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${strategyMessage ? "border-brand-100 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-charcoal-500"}`}>
          <span>{strategyMessage || (activeProject ? "Approve the generated strategy before creating the execution plan." : "Create a guided project before approving a strategy.")}</span>
          {strategyJob?.delayed && <button type="button" onClick={() => void releaseDelayedStrategyJob()} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white">Release and retry safely</button>}
        </div>
      ) : null}
      {hasActiveProject && kind === "site-analysis" && (activeSiteCrawl || siteAnalysisBusy || siteAnalysisMessage) && (
        <div className={`rounded-lg border px-5 py-4 text-sm shadow-sm ${activeSiteCrawl || siteAnalysisBusy || siteAnalysisMessage.includes("started") ? "border-amber-200 bg-amber-50 text-amber-900" : siteAnalysisMessage ? "border-brand-100 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-charcoal-500"}`}>
          {activeSiteCrawl || siteAnalysisBusy || siteAnalysisMessage.includes("started") ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Site analysis in progress</div>
                <div className="mt-1 text-base font-bold text-slate-950">Site analysis started. Crawl results will appear here when the worker finishes.</div>
                <div className="mt-1 text-sm leading-6 text-amber-900">
                  {activeSiteCrawl ? `Current crawl status: ${activeSiteCrawl.status}. The Analyze Site button is disabled until this crawl completes.` : "The Analyze Site button is disabled while the crawl is being created."}
                </div>
              </div>
              <div className="flex w-fit items-center gap-2">
                <span className="inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">{activeSiteCrawl?.status ?? "starting"}</span>
                <button type="button" onClick={() => { void refreshSiteAnalysisStatus(); }} disabled={siteStatusRefreshing || siteAnalysisBusy} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60">{siteStatusRefreshing ? "Refreshing…" : "Refresh Status"}</button>
              </div>
            </div>
          ) : siteAnalysisMessage}
        </div>
      )}
      {hasActiveProject && kind === "opportunities" && opportunityMessage && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700">
          {opportunityMessage}
        </div>
      )}
      {hasActiveProject && hasWorkspaceRecords && canRunModule && kind !== "opportunities" && kind !== "strategy" && kind !== "site-analysis" && kind !== "site-architect" && kind !== "lead-magnets" && kind !== "ai-citations" && kind !== "keywords" && moduleNextStep && (
        <ModuleNextStepCallout
          step={moduleNextStep}
          onAction={moduleNextStep.action === "generate-strategy"
            ? () => { setStrategyMessage("Creating a new Strategy version from the latest project data..."); void runStrategyAction("generate"); }
            : moduleNextStep.action === "analyze-site"
              ? () => { void analyzeSite(); }
              : undefined}
        />
      )}

      {loading && <Card className="p-5 text-sm text-charcoal-500">Loading live project data...</Card>}
      {!loading && workspaceLoadError && <Card className="border-red-200 bg-red-50 p-5"><h2 className="font-bold text-red-900">Project data could not be loaded</h2><p className="mt-2 text-sm text-red-800">{workspaceLoadError}</p><Link to="/projects" className="mt-4 inline-flex rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800">Back to projects</Link></Card>}
      {!loading && !workspaceLoadError && !hasActiveProject && data.projects.length === 0 && (
        <EmptyModuleState
          title="No projects yet"
          detail="Create a project to begin intake, strategy, analysis, execution, approval, and delivery."
          actionTo="/projects/new"
          actionLabel="Create Project"
        />
      )}
      {!loading && !workspaceLoadError && !hasActiveProject && data.projects.length > 0 && searchParams.get("projectId") && <Card className="border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-900">Project unavailable</h2><p className="mt-2 text-sm text-amber-800">This project was not found or is not assigned to your workspace account.</p><Link to="/projects" className="mt-4 inline-flex rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-900">Back to projects</Link></Card>}
      {!loading && hasActiveProject && !hasWorkspaceRecords && <EmptyModuleState title="No data available" detail="Project data will appear here after intake, crawls, tasks, or generation runs exist." />}
      {!loading && hasActiveProject && hasWorkspaceRecords && !canRunModule && kind !== "site-architect" && <ModuleReadinessChecklist moduleTitle={copy.title} items={readiness.items} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "opportunities" && <OpportunityScreen data={scopedData} selectingId={opportunityBusy} capacityEstimate={opportunityCapacityEstimate} onGenerate={generateOpportunities} onSelect={selectOpportunity} onClearSelection={clearOpportunitySelection} onDeleteData={deleteOpportunityData} onRefine={refineOpportunities} onSkip={skipOpportunityFinder} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "strategy" && <StrategyScreen data={scopedData} busy={strategyBusy} workflowController={workflowController} onAction={runStrategyAction} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "keywords" && <KeywordScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "site-analysis" && !latestSiteCrawl && !activeSiteCrawl && !siteAnalysisBusy && (
        <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-12 shadow-sm">
          <div className="max-w-xl text-center">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">Ready for site analysis</div>
            <h2 className="mt-3 text-2xl font-bold text-charcoal-950">Analyze the existing website</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-charcoal-500">Crawl the website to identify technical SEO, content, keyword coverage, internal-linking, local SEO, and conversion opportunities before Strategy.</p>
            <button
              type="button"
              onClick={() => { void analyzeSite(); }}
              disabled={primaryDisabled}
              className="mt-7 inline-flex min-w-[210px] items-center justify-center rounded-lg bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
            >
              Analyze Site
            </button>
            <p className="mt-3 text-xs font-medium text-charcoal-400">Results will appear here automatically when the analysis completes.</p>
          </div>
        </div>
      )}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "site-analysis" && latestSiteCrawl && <SiteAnalysisScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "backlinks" && <BacklinkScreen data={scopedData} autoStart={searchParams.get("start") === "discover"} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "ai-citations" && <CitationScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && kind === "site-architect" && <ArchitectScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "lead-magnets" && <LeadFunnelWorkspace projectId={activeProject.id} suggestedIdeas={leadMagnetIdeas(scopedData)} startRequestKey={leadMagnetStartRequest} />}
      {strategyGenerateConfirm && <StrategyGenerateConfirmModal estimate={strategyGenerateConfirm.estimate} onCancel={() => closeStrategyGenerateConfirm(false)} onConfirm={() => closeStrategyGenerateConfirm(true)} />}
      <ModuleHelpDrawer kind={kind} project={activeProject} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

type HelpSection = { title: string; body?: string; bullets?: string[] };

function moduleHelpSections(kind: ModuleKind, projectName: string): HelpSection[] {
  const sharedSafety = {
    title: "Approval and safety",
    bullets: [
      "SEnuke AI - AI Growth Operating System can recommend, generate, and prepare assets automatically.",
      "Anything that publishes, sends, schedules, changes a live page, or affects an external system requires user approval.",
      "If required data is missing, the module shows a readiness checklist with direct buttons instead of a dead-end error.",
    ],
  };
  const sections: Record<ModuleKind, HelpSection[]> = {
    opportunities: [
      {
        title: "What this module is",
        body: `Opportunity Finder turns the intake profile for ${projectName} into scored growth directions. It helps choose the best focus before strategy, keywords, site architecture, content, backlinks, and publishing tasks are generated.`,
      },
      {
        title: "Data used",
        bullets: [
          "Project type, niche, country, and target market.",
          "Audience, offer, budget, timeline, publishing method, and business constraints from intake.",
          "Connected website and crawl data when available.",
          "Existing keyword, backlink, site analysis, and execution task signals when available.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Complete intake first so the project has enough business context.",
          "Use Create Opportunity when no recommendations exist yet.",
          "Use Reassess opportunities only after recommendations already exist and the project profile or analysis data has changed.",
          "Review the score, fit rationale, execution preview, and insights panel.",
          "Select one opportunity to make it the strategy context.",
        ],
      },
      {
        title: "What happens next",
        bullets: [
          "The selected opportunity becomes the input for AI Strategy Engine.",
          "Downstream tasks are mapped to strategy, site architecture, keyword research, content, backlinks, and publishing.",
        ],
      },
      sharedSafety,
    ],
    strategy: [
      {
        title: "What this module is",
        body: "AI Strategy Engine converts the selected opportunity and completed intake into a structured execution strategy. It defines positioning, audience, offer, SEO priorities, channel plan, funnel plan, and execution roadmap.",
      },
      {
        title: "Data used",
        bullets: [
          "Selected opportunity and project intake answers.",
          "Business profile, audience, offer, goal, budget, and publishing method.",
          "Website crawl, keyword, backlink, citation, and task data when available.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Review the strategy summary cards and score panel.",
          "Regenerate only when project direction, opportunity, or intake context changes.",
          "Approve the strategy when it is correct.",
          "Create the execution plan after approval so tasks are generated from the approved version.",
        ],
      },
      {
        title: "What happens next",
        bullets: [
          "Approval locks the strategy version used by downstream modules.",
          "Execution tasks can then be created for sitemap, homepage, lead magnet, SEO plan, domain, publishing, and related modules.",
        ],
      },
      sharedSafety,
    ],
    keywords: [
      {
        title: "What this module is",
        body: "Keyword Research stores and reviews keyword intelligence for the selected project. It helps identify search demand, intent, difficulty, CPC, clusters, and page targets.",
      },
      {
        title: "Data used",
        bullets: [
          "Project industry, audience, services, locations, and selected strategy context.",
          "Connected website pages and latest crawl data.",
          "Manual keywords added by the user and AI-suggested keyword ideas.",
          "Search provider results when credentials are configured.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Click Add Keywords to add one or more seed keywords with location and target URL context.",
          "Use AI suggestions when you need industry, offer, audience, or location-aware ideas.",
          "Run keyword intelligence to fetch demand, difficulty, intent, CPC, and opportunities.",
          "Use results to map keywords to pages and create content or optimization tasks.",
        ],
      },
      sharedSafety,
    ],
    "site-analysis": [
      {
        title: "What this module is",
        body: "Site Analysis crawls the connected website and turns technical, SEO, page, internal-linking, and readiness issues into actionable project data.",
      },
      {
        title: "Data used",
        bullets: [
          "Connected website URL.",
          "Latest completed crawl and crawl issues.",
          "Pages, status codes, titles, descriptions, headings, internal links, broken links, orphan pages, and performance signals.",
          "Project strategy and keyword context when available.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Run Analyze Site to start a crawl when scanning is available.",
          "The scan button is disabled for 72 hours after a completed scan to avoid repeated crawl load.",
          "Review health cards, issue rows, and page details.",
          "Open or create tasks from issues that need work.",
        ],
      },
      sharedSafety,
    ],
    backlinks: [
      {
        title: "What this module is",
        body: "Backlink Intelligence shows link authority, referring domains, new/lost links, competitor gaps, and outreach opportunities for the selected website.",
      },
      {
        title: "Data used",
        bullets: [
          "Connected website domain.",
          "Cached backlink summary and backlink link records.",
          "Project strategy, authority goals, and execution tasks.",
          "External backlink provider data when configured.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Refresh Backlinks only when the cooldown allows it.",
          "The refresh button is locked for 7 days after a successful refresh to prevent repeated provider calls.",
          "Review link quality, authority score, status, and opportunities.",
          "Create outreach or authority tasks from actionable gaps.",
        ],
      },
      sharedSafety,
    ],
    "ai-citations": [
      {
        title: "What this module is",
        body: "AI Citation Optimization is a smart dashboard for AI search readiness. It shows whether the brand has enough entity, NAP, schema, sitemap, robots, FAQ, breadcrumb, and llms.txt signals to be understood and cited by AI answer engines.",
      },
      {
        title: "Data used",
        bullets: [
          "Latest site crawl and health report.",
          "Local/NAP business profile when configured.",
          "Organization, WebSite, FAQPage, BreadcrumbList, and invalid schema counts.",
          "Sitemap, robots, llms.txt, and citation-related execution tasks.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "This screen is a live snapshot from the latest crawl, not a separate refresh action.",
          "Run Site Analysis first when citation data is missing or stale.",
          "Review missing entity, NAP, schema, and AI-discoverability signals.",
          "Create or complete citation tasks for missing items.",
        ],
      },
      sharedSafety,
    ],
    "site-architect": [
      {
        title: "What this module is",
        body: "AI Site Architect turns approved strategy and keyword/site data into a site structure, page hierarchy, page metadata, internal linking plan, CTA plan, and sitemap-ready blueprint.",
      },
      {
        title: "Data used",
        bullets: [
          "Approved strategy and selected opportunity.",
          "Project niche, audience, offer, goal, location, and publishing target.",
          "Keyword clusters and crawl/page data when available.",
          "Existing execution tasks for sitemap, pages, and publishing.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Review the proposed page hierarchy and selected page details.",
          "Check metadata, slug, CTA, section list, and internal linking recommendations.",
          "Generate or update pages only after the strategy direction is approved.",
          "Use existing crawl data to mark already-present pages as complete where possible.",
        ],
      },
      sharedSafety,
    ],
    "lead-magnets": [
      {
        title: "What this module is",
        body: "Lead Magnet Builder creates conversion assets such as guides, checklists, landing page copy, thank-you page copy, delivery emails, and CTA flows from the project strategy.",
      },
      {
        title: "Data used",
        bullets: [
          "Approved strategy, audience, pain points, offer, and conversion goal.",
          "Project industry, location, tone, and publishing method.",
          "Existing content, keyword, and site data when available.",
          "Execution tasks related to lead capture and follow-up.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Review recommended lead magnet ideas and choose the best fit.",
          "Check the landing page summary, email copy, thank-you page, and CTA flow.",
          "Publish or export only after reviewing the generated asset.",
          "Connect forms or email tools before sending or automating follow-up.",
        ],
      },
      sharedSafety,
    ],
  };
  return sections[kind];
}

function ModuleHelpDrawer({ kind, project, open, onClose }: { kind: ModuleKind; project?: GuidedProject; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const title = `How ${moduleCopy[kind].title} Works`;
  const projectName = project?.businessName || project?.name || "the selected project";
  const sections = moduleHelpSections(kind, projectName);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-charcoal-950/30" aria-label="Close help drawer" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Help</div>
            <h2 className="mt-1 text-xl font-bold text-charcoal-950">{title}</h2>
            {project && <p className="mt-1 text-sm text-charcoal-500">Current project: {projectName}</p>}
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg font-bold text-charcoal-500 hover:bg-slate-50" aria-label="Close">
            ×
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="text-sm font-bold text-charcoal-950">{section.title}</h3>
              {"body" in section && section.body ? <p className="mt-2 text-sm leading-6 text-charcoal-600">{section.body}</p> : null}
              {"bullets" in section && section.bullets ? (
                <div className="mt-3 space-y-2">
                  {section.bullets.map((bullet) => (
                    <div key={bullet} className="flex gap-2 text-sm leading-6 text-charcoal-600">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
        <div className="border-t border-slate-100 p-5">
          <button type="button" onClick={onClose} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
            Got it
          </button>
        </div>
      </aside>
    </div>
  );
}

function ModuleReadinessChecklist({ moduleTitle, items }: { moduleTitle: string; items: ReadinessItem[] }) {
  const missing = items.filter((item) => item.status !== "complete");
  const complete = items.filter((item) => item.status === "complete");
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Readiness Checklist</div>
        <h2 className="mt-2 text-xl font-bold text-charcoal-950">{moduleTitle} is not ready yet.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Before SEnuke AI - AI Growth Operating System can run this, we need to complete these missing steps. Missing data becomes the next recommended action instead of a dead-end error.
        </p>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {missing.map((item) => {
          const inProgress = item.status === "in_progress";
          return (
          <div key={item.key} className={`rounded-xl border p-4 ${inProgress ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`font-bold ${inProgress ? "text-blue-950" : "text-amber-950"}`}>{item.title}</h3>
                <p className={`mt-2 text-sm leading-6 ${inProgress ? "text-blue-900" : "text-amber-900"}`}>{item.description}</p>
              </div>
              <span className={`rounded-full bg-white px-2 py-1 text-xs font-bold ${inProgress ? "text-blue-700" : "text-amber-700"}`}>{inProgress ? "In progress" : "Missing"}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.actions.map((action) => (
                <Link
                  key={`${item.key}-${action.label}`}
                  to={action.url}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
          );
        })}
      </div>
      {complete.length > 0 && (
        <div className="border-t border-slate-100 p-5">
          <div className="text-sm font-bold text-slate-700">Already complete</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {complete.map((item) => (
              <span key={item.key} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">✓ {item.title}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function OpportunityScreen({
  data,
  selectingId,
  capacityEstimate,
  onGenerate,
  onSelect,
  onClearSelection,
  onDeleteData,
  onRefine,
  onSkip,
}: {
  data: ModuleData;
  selectingId: string | null;
  capacityEstimate: number | null;
  onGenerate: () => Promise<void>;
  onSelect: (opportunityId: string) => Promise<boolean>;
  onClearSelection: () => Promise<void>;
  onDeleteData: () => Promise<void>;
  onRefine: (instructions: string) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const project = data.projects[0];
  const opportunities = [...(project?.opportunities ?? [])].sort((a, b) => {
    if (["selected", "confirmed"].includes(a.status) && !["selected", "confirmed"].includes(b.status)) return -1;
    if (["selected", "confirmed"].includes(b.status) && !["selected", "confirmed"].includes(a.status)) return 1;
    return (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
  });
  const visibleOpportunities = opportunities.slice(0, 3);
  const actualSelectedOpportunity = visibleOpportunities.find((opportunity) => ["selected", "confirmed"].includes(opportunity.status));
  const selectedOpportunity = actualSelectedOpportunity ?? visibleOpportunities[0];
  const [focusedId, setFocusedId] = useState(selectedOpportunity?.id ?? "");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [mappedOpportunityName, setMappedOpportunityName] = useState("");
  useEffect(() => {
    if (selectedOpportunity?.id) setFocusedId(selectedOpportunity.id);
  }, [selectedOpportunity?.id]);

  const focusedOpportunity = visibleOpportunities.find((opportunity) => opportunity.id === focusedId) ?? selectedOpportunity;
  const opportunityCount = visibleOpportunities.length;
  const taskCount = data.tasks.filter((task) => task.moduleName.includes("opportun")).length;
  const niche = project?.niche || project?.businessProfile?.businessModel || "Not provided";
  const intakeComplete = Boolean(project?.businessProfile || project?._count?.intakeAnswers);
  const marketEvidenceAvailable = data.keywordRuns.some((run) => run.status === "completed" && run.avgSearchVolume != null && run.avgDifficulty != null);
  const selectAndConfirm = async (opportunityId: string) => {
    const opportunityName = opportunities.find((item) => item.id === opportunityId)?.name || "Selected opportunity";
    const selected = await onSelect(opportunityId);
    if (selected) setMappedOpportunityName(opportunityName);
  };
  if (!project) {
    return <EmptyModuleState title="No project available" detail="Create a project before generating opportunity recommendations." />;
  }
  if (!opportunities.length) {
    return (
      <>
        {selectingId === "generate" && <OpportunityCookingOverlay />}
        <OpportunitySummaryStrip project={project} niche={niche} />
        <EmptyModuleState
          title={intakeComplete ? "No opportunity recommendations yet" : "Complete intake first"}
          detail={intakeComplete
            ? "The project profile is ready. Use Create Opportunity to generate scored options from this project's intake, audience, offer, and constraints."
            : "Opportunity generation needs the intake profile first, including business context, audience, offer, goals, budget, and publishing method."}
          actionTo={intakeComplete ? null : `/guided-projects/${project.id}/intake`}
          actionLabel={intakeComplete ? (selectingId === "generate" ? "Creating Opportunities..." : "Create Opportunity") : "Open Intake"}
          onAction={intakeComplete ? () => { void onGenerate(); } : undefined}
          actionDisabled={selectingId === "generate"}
        />
      </>
    );
  }
  return (
    <>
      {selectingId === "generate" && <OpportunityCookingOverlay />}
      {selectingId && !["generate", "refine", "skip", "clear"].includes(selectingId) && <OpportunityMappingOverlay />}
      <OpportunityInsights project={project} niche={niche} opportunity={focusedOpportunity} opportunityCount={opportunityCount} taskCount={taskCount} marketEvidenceAvailable={marketEvidenceAvailable} reassessing={selectingId === "generate"} onReassess={() => void onGenerate()} onReport={() => {
        setReportOpen(true);
      }} />
      <div id="opportunity-options" className="scroll-mt-6">
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-charcoal-950">Recommended Opportunities</h2><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-800">Preliminary</span></div>
              <p className="text-sm text-charcoal-500">These profile-based findings remain preliminary until required market evidence is checked. Select one to guide validation and Strategy; selection does not make it fully validated. Reassessment uses {capacityEstimate == null ? "the configured AI Capacity estimate" : `${capacityEstimate.toLocaleString()} AI Capacity units`} only when eligible evidence changed.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCompareOpen(true);
                }}
                disabled={opportunityCount < 2}
                title={opportunityCount < 2 ? "At least two valid opportunities are required for comparison." : undefined}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-charcoal-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Compare
              </button>
              <button
                type="button"
                onClick={() => {
                  setReportOpen(true);
                }}
                className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50"
              >
                Full Report
              </button>
              <button type="button" onClick={() => setRefineOpen(true)} disabled={selectingId === "refine"} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">{selectingId === "refine" ? "Refining…" : "Refine recommendation"}</button>
              <button type="button" onClick={() => void onSkip()} disabled={selectingId === "skip"} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-charcoal-700 hover:bg-slate-50 disabled:opacity-50">Keep current direction</button>
              <button type="button" onClick={() => void onDeleteData()} disabled={Boolean(selectingId)} className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{selectingId === "delete" ? "Deleting…" : "Delete Opportunity Data"}</button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {visibleOpportunities.map((opportunity, index) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                rank={index + 1}
                focused={focusedOpportunity?.id === opportunity.id}
                selected={["selected", "confirmed"].includes(opportunity.status)}
                busy={selectingId === opportunity.id}
                onFocus={() => setFocusedId(opportunity.id)}
                onDetails={() => {
                  setFocusedId(opportunity.id);
                  setDetailsOpen(true);
                }}
                onSelect={() => {
                  void selectAndConfirm(opportunity.id);
                }}
                onClearSelection={() => {
                  void onClearSelection();
                }}
                clearing={selectingId === "clear"}
              />
            ))}
          </div>
          <div>
            <Card className="p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><IconBadge icon="↔" /><h2 className="font-bold text-brand-700">Intake → Opportunity Fit</h2></div><p className="mt-2 text-sm leading-6 text-charcoal-500">A visual comparison of the saved project intake and how this opportunity responds to it.</p></div><span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Evidence-based match</span></div>
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                <div className="hidden grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_150px] gap-4 bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-charcoal-400 md:grid"><span>Intake area</span><span>What you provided</span><span>How the opportunity uses it</span><span>Fit signal</span></div>
                <OpportunityFitRow label="Audience" intake={audienceIntakeSummary(project)} response={opportunityAudienceResponse(project)} score={safeScore(focusedOpportunity?.userFitScore, safeScore(focusedOpportunity?.opportunityScore, 72))} />
                <OpportunityFitRow label="Business objective" intake={project.primaryGoal || "Not provided"} response={opportunityGoalResponse(project)} score={safeScore(focusedOpportunity?.monetizationScore, safeScore(focusedOpportunity?.opportunityScore, 72))} />
                <OpportunityFitRow label="Offer & positioning" intake={offerIntakeSummary(project)} response={opportunityOfferResponse(project, focusedOpportunity)} score={Math.round(avg([focusedOpportunity?.userFitScore, focusedOpportunity?.monetizationScore]) ?? safeScore(focusedOpportunity?.opportunityScore, 72))} />
                <OpportunityFitRow label="Market & search" intake={(Array.isArray(project.targetLocations) ? project.targetLocations.map(String).join(", ") : project.targetLocation) || project.businessLocation || "Not provided"} response={opportunityMarketResponse(project)} score={safeScore(focusedOpportunity?.seoScore, safeScore(focusedOpportunity?.opportunityScore, 72))} />
                <OpportunityFitRow label="Execution approach" intake={`${projectTypeLabel(project)} · ${project.targetLaunchTimeline || "Timeline not provided"}`} response={opportunityExecutionApproach(project, focusedOpportunity)} score={safeScore(focusedOpportunity?.executionScore, safeScore(focusedOpportunity?.opportunityScore, 72))} />
              </div>
              <p className="mt-3 text-xs leading-5 text-charcoal-500">Fit signals reuse the opportunity model’s User Fit, Revenue, SEO, and Execution scores. They show how strongly the recommendation matches the saved intake; they are planning estimates, not guaranteed results.</p>
            </Card>
          </div>
        </div>
      </div>
      <OpportunityDetailsDrawer opportunity={focusedOpportunity} open={detailsOpen} onClose={() => setDetailsOpen(false)} onSelect={focusedOpportunity ? () => { void selectAndConfirm(focusedOpportunity.id); } : undefined} selected={Boolean(focusedOpportunity && ["selected", "confirmed"].includes(focusedOpportunity.status))} />
      <OpportunityCompareDrawer opportunities={visibleOpportunities} open={compareOpen} onClose={() => setCompareOpen(false)} onFocus={(id) => { setFocusedId(id); setDetailsOpen(true); }} onSelect={(id) => { void selectAndConfirm(id); }} />
      <OpportunityReportDrawer opportunity={focusedOpportunity} open={reportOpen} onClose={() => setReportOpen(false)} projectId={project.id} />
      <OpportunityRefineModal open={refineOpen} busy={selectingId === "refine"} onClose={() => setRefineOpen(false)} onSubmit={async (instructions) => { await onRefine(instructions); setRefineOpen(false); }} />
      {mappedOpportunityName && <OpportunityMappedModal projectId={project.id} opportunityName={mappedOpportunityName} onReview={() => setMappedOpportunityName("")} />}
    </>
  );
}

function OpportunityCookingOverlay() {
  return <AiPlanningScreen theme="dark" eyebrow="Opportunity research in progress" title="Hang tight — we’re finding your strongest opportunities!" description="SEnuke AI - AI Growth Operating System is reviewing the business, audience, offer, goals, markets, competitors, and constraints to identify practical directions worth pursuing." steps={[{ title: "Review the business", detail: "Business Intake, audience, offer, goals, markets, assets, and operating constraints" }, { title: "Evaluate the market", detail: "Demand, competitor positioning, customer needs, differentiation, and evidence quality" }, { title: "Rank the opportunities", detail: "Business fit, expected value, confidence, effort, dependencies, and recommended next step" }]} checks={["Evidence is separated from inference", "Opportunities are scored consistently", "Nothing is selected without review"]} status="Creating scored opportunity recommendations…" note="You will review, compare, refine, and select an opportunity before it becomes part of the Strategy." ariaLabel="Creating opportunity recommendations" />;
}

function StrategyCookingOverlay({ job }: { job: StrategyGenerationJob | null }) {
  const stage = job?.stage === "queued" ? "Waiting for an available AI worker" : job?.stage === "generating_strategy" ? "Researching and making Strategy decisions" : "Creating an evidence-backed Unified Strategy";
  return <AiPlanningScreen theme="dark" eyebrow="Strategy planning in progress" title="Hang tight — we’re building your unified strategy!" description="SEnuke AI - AI Growth Operating System is connecting the selected opportunity, approved keywords, target markets, project goals, audience, offer, and available website evidence into one prioritized plan of action." steps={[{ title: "Review the intelligence", detail: "Business goals, audience, offer, opportunity, approved keywords, markets, competitors, and website evidence" }, { title: "Make strategic decisions", detail: "Positioning, page and content priorities, funnel gaps, Local SEO, authority, AI visibility, and conversion direction" }, { title: "Build the action plan", detail: "Ranked focus areas, phased actions, channel responsibilities, dependencies, KPIs, and one Next Best Action" }]} stats={job ? [{ value: `${Math.round(job.progress)}%`, label: stage, tone: "emerald" }] : []} progress={job?.progress} checks={["Runs safely in the background", "Duplicate requests reuse one job", "The completed draft loads automatically"]} status={job?.status === "queued" ? "Strategy job queued…" : "Creating an evidence-backed Unified Strategy…"} note="You can leave this page safely. The Strategy job continues in the background and the completed draft will load automatically when you return." ariaLabel="Creating project strategy" />;
}

function ExecutionPlanCookingOverlay() {
  return <AiPlanningScreen eyebrow="Execution planning in progress" title="Hang tight — we’re building your Execution Plan!" description="SEnuke AI - AI Growth Operating System is converting the approved Strategy into clear, ordered work for this project—not running another analysis." steps={[{ title: "Review the approved direction", detail: "Strategy version, keywords, markets, evidence, priorities, safeguards, and project readiness" }, { title: "Create executable tasks", detail: "SEO, content, website, Local SEO, authority, AI citation, publishing, and measurement work" }, { title: "Set the workflow", detail: "Priority, dependencies, AI assistance, approvals, destinations, and success measures" }]} checks={["One task for each approved outcome", "Dependencies remain in order", "Protected changes require approval"]} status="Prioritizing and organizing the next work…" note="The resulting tasks remain reviewable. AI-assisted work prepares drafts; public or protected changes wait for approval." ariaLabel="Creating execution plan" />;
}

function OpportunityMappingOverlay() {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950 p-6 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-7 text-center text-white shadow-2xl">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-emerald-400" />
        <h3 className="mt-5 text-lg font-bold text-white">Mapping your opportunity…</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">Saving this direction to the project and preparing it for Keyword Analysis and Strategy.</p>
      </div>
    </div>
  );
}

function OpportunityMappedModal({ projectId, opportunityName, onReview }: { projectId: string; opportunityName: string; onReview: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-charcoal-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="opportunity-mapped-title">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.32)]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-emerald-100 via-brand-50 to-sky-100" />
        <div className="absolute -right-10 -top-14 h-36 w-36 rounded-full border-[22px] border-white/40" />
        <button type="button" onClick={onReview} aria-label="Close confirmation" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-white/75 text-xl text-charcoal-500 shadow-sm backdrop-blur hover:bg-white hover:text-charcoal-900">×</button>
        <div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
          <div className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white bg-emerald-500 text-3xl font-black text-white shadow-lg shadow-emerald-200">✓</div>
          <div className="mt-5 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">Opportunity mapped successfully</div>
          <h2 id="opportunity-mapped-title" className="mt-3 text-2xl font-black tracking-tight text-charcoal-950 sm:text-3xl">Your project direction is ready</h2>
          <p className="mt-2 text-sm leading-6 text-charcoal-600">This opportunity is now the approved context for the next research and strategy steps.</p>

          <div className="mt-5 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-600">Selected opportunity</div>
            <div className="mt-1 text-base font-bold leading-6 text-charcoal-950">{opportunityName}</div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex items-center">
              {[{ label: "Opportunity", state: "done", icon: "✓" }, { label: "Keywords", state: "current", icon: "2" }, { label: "Gap Analysis", state: "next", icon: "3" }, { label: "Strategy", state: "next", icon: "4" }].map((step, index) => (
                <div key={step.label} className={`flex min-w-0 items-center ${index < 3 ? "flex-1" : ""}`}>
                  <div className="flex min-w-0 flex-col items-center">
                    <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-black ${step.state === "done" ? "bg-emerald-500 text-white" : step.state === "current" ? "bg-brand-600 text-white ring-4 ring-brand-100" : "border-2 border-slate-300 bg-white text-slate-400"}`}>{step.icon}</span>
                    <span className={`mt-2 text-[10px] font-bold ${step.state === "current" ? "text-brand-700" : step.state === "done" ? "text-emerald-700" : "text-slate-400"}`}>{step.label}</span>
                  </div>
                  {index < 3 && <div className={`mx-2 mb-5 h-0.5 flex-1 ${index === 0 ? "bg-gradient-to-r from-emerald-400 to-brand-400" : "bg-slate-200"}`} />}
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-xs leading-5 text-charcoal-500">Next, research demand, buyer intent, topical clusters, competition, and revenue potential.</p>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onReview} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-charcoal-700 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">Review Opportunity</button>
            <Link to={`/keywords?projectId=${encodeURIComponent(projectId)}`} className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-brand-200 transition hover:-translate-y-0.5 hover:shadow-xl">Continue to Keyword Analysis <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const opportunityRefinementIdeas = [
  { title: "Faster results", instruction: "Prioritize opportunities that can produce measurable results quickly with low implementation effort." },
  { title: "More leads", instruction: "Focus on high-intent lead generation opportunities with clear calls to action and conversion potential." },
  { title: "Local growth", instruction: "Prioritize local SEO, Google Business Profile, service-area pages, reviews, and location-based demand." },
  { title: "Lower competition", instruction: "Find realistic opportunities with lower competition and a stronger chance of early visibility." },
  { title: "Higher revenue", instruction: "Rank opportunities by revenue potential, buyer intent, and value per acquired customer." },
  { title: "Content authority", instruction: "Focus on opportunities that build topical authority through useful content and supporting keyword clusters." },
];

function OpportunityRefineModal({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (instructions: string) => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  useEffect(() => { if (!open) { setSelected([]); setCustom(""); } }, [open]);
  if (!open) return null;
  const instructions = [...selected, custom.trim()].filter(Boolean).join(" ");
  const toggle = (instruction: string) => setSelected((current) => current.includes(instruction) ? current.filter((item) => item !== instruction) : [...current, instruction]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-charcoal-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="refine-opportunities-title">
      <button type="button" className="absolute inset-0" aria-label="Close refinement" onClick={busy ? undefined : onClose} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Opportunity Finder</div><h2 id="refine-opportunities-title" className="mt-1 text-xl font-bold text-charcoal-950">What should AI improve?</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">Choose one or more priorities, then add any project-specific direction. Recommendations will be rebuilt using the existing intake and your instructions.</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg text-charcoal-500 disabled:opacity-50" aria-label="Close">×</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-6 text-brand-900"><b>How it works:</b> AI re-evaluates business value, expected impact, effort, and confidence. Your selected direction and saved-for-later ideas remain protected.</div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-bold text-charcoal-900">Choose refinement priorities</div><div className="mt-1 text-xs text-charcoal-500">Select as many options as needed.</div></div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{selected.length} selected</span>
              <button type="button" onClick={() => setSelected(opportunityRefinementIdeas.map((idea) => idea.instruction))} disabled={busy || selected.length === opportunityRefinementIdeas.length} className="text-xs font-bold text-brand-700 disabled:text-charcoal-300">Select all</button>
              <button type="button" onClick={() => setSelected([])} disabled={busy || selected.length === 0} className="text-xs font-bold text-charcoal-600 disabled:text-charcoal-300">Clear</button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{opportunityRefinementIdeas.map((idea) => { const active = selected.includes(idea.instruction); return <label key={idea.title} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition ${active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 hover:border-brand-300"}`}><input type="checkbox" checked={active} disabled={busy} onChange={() => toggle(idea.instruction)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-brand-600" /><span><span className="block font-bold text-charcoal-950">{idea.title}</span><span className="mt-2 block text-xs leading-5 text-charcoal-500">{idea.instruction}</span></span></label>; })}</div>
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${selected.length ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-charcoal-500"}`}><b>{selected.length ? `${selected.length} priorit${selected.length === 1 ? "y" : "ies"} selected` : "No priority selected yet"}</b><span className="ml-1">{selected.length ? "— scores and ranking will change after you click Refine Recommendations." : "Choose a suggestion above or write custom instructions below."}</span></div>
          <label className="mt-5 block text-sm font-bold text-charcoal-800" htmlFor="opportunity-refine-custom">Additional instructions</label>
          <textarea id="opportunity-refine-custom" value={custom} onChange={(event) => setCustom(event.target.value)} rows={4} maxLength={2000} placeholder="Enter your details" className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          <div className="mt-2 text-right text-xs text-charcoal-400">{custom.length}/2000</div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><span className="text-xs text-charcoal-500">Selecting a suggestion prepares it. Click the button to apply the refinement.</span><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 disabled:opacity-50">Cancel</button><button type="button" onClick={() => void onSubmit(instructions)} disabled={busy || instructions.length < 3} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? "Refining recommendations…" : `Refine Recommendations${selected.length ? ` (${selected.length})` : ""}`}</button></div></div>
      </div>
    </div>
  );
}

type StrategyActionResult = { ok: boolean; message: string };

function StrategyRevisionModal({ open, busy, project, strategy, opportunityName, onClose, onSubmit }: {
  open: boolean;
  busy: boolean;
  project: GuidedProject;
  strategy: { version?: number; strategySummary?: string | null; seoStrategy?: string | null; contentStrategy?: string | null; localSeoStrategy?: string | null };
  opportunityName?: string | null;
  onClose: () => void;
  onSubmit: (instruction: string) => Promise<StrategyActionResult | undefined>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => { if (!open) { setSelected([]); setCustom(""); setSubmitError(null); } }, [open]);
  if (!open) return null;
  const markets = Array.isArray(project.targetLocations) ? project.targetLocations.map(String).filter(Boolean).join(", ") : "the selected target markets";
  const suggestions = [
    { title: "Prioritize the primary goal", detail: project.primaryGoal || "Primary goal", instruction: `Revise the strategy so every recommendation is prioritized around the primary goal: ${project.primaryGoal || "the saved primary goal"}.` },
    { title: "Strengthen SEO direction", detail: "Keywords, pages and measurable search actions", instruction: `Strengthen the SEO strategy using the approved keyword groups, search intent, page targets, and the selected opportunity: ${opportunityName || "the approved direction"}.` },
    { title: "Improve the content plan", detail: "Clear topics, formats, funnel stages and CTAs", instruction: `Revise the content strategy with clearer priority topics, funnel stages, conversion calls to action, and non-duplicate deliverables for ${project.niche || "this business"}.` },
    { title: "Make it market-specific", detail: markets, instruction: `Make the recommendations specific to these target markets: ${markets}. Keep Business Location separate from keyword targeting.` },
    { title: "Use site-analysis findings", detail: "Prioritize technical, content and conversion issues", instruction: "Revise the strategy using the latest Site Analysis findings. Prioritize critical and high-impact issues before lower-impact improvements." },
    { title: "Improve KPIs and measurement", detail: "Define targets and success signals", instruction: `Add clearer KPIs, measurement signals, and expected outcomes for ${project.primaryGoal || "the project goal"}.` },
  ];
  const toggle = (instruction: string) => { setSubmitError(null); setSelected((current) => current.includes(instruction) ? current.filter((item) => item !== instruction) : [...current, instruction]); };
  const instruction = [...selected, custom.trim()].filter(Boolean).join("\n");
  const submit = async () => {
    if (instruction.length < 3) {
      setSubmitError("Select at least one revision suggestion or enter your own instruction before creating the revised draft.");
      return;
    }
    setSubmitError(null);
    const result = await onSubmit(instruction);
    if (result?.ok === false) setSubmitError(result.message || "The revised Strategy could not be created. Please try again.");
  };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-charcoal-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="strategy-revision-title">
      <button type="button" className="absolute inset-0" aria-label="Close Strategy revision" onClick={busy ? undefined : onClose} />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {busy && <div className="absolute inset-0 z-20 overflow-y-auto"><AiPlanningScreen mode="contained" eyebrow="Strategy revision in progress" title="Hang tight — we’re revising your Strategy!" description="SEnuke AI - AI Growth Operating System is re-aligning the Strategy with your selected priorities while preserving its relationship to the project goals, markets, keywords, opportunity, and website evidence." steps={[{ title: "Review your instruction", detail: "Selected changes, custom direction, current Strategy version, and approved project priorities" }, { title: "Reconcile the evidence", detail: "Goals, markets, keywords, opportunity, website findings, dependencies, and conflicting signals" }, { title: "Create a new version", detail: "Updated focus areas, phased actions, funnel direction, KPIs, confidence, and Next Best Action" }]} checks={["Keep the current version in history", "Preserve approved project facts", "Require approval for the revised draft"]} status="Creating a new Strategy draft…" note="The current approved version remains unchanged until you review and approve this new draft." ariaLabel="Revising project strategy" /></div>}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Strategy Engine · Version {strategy.version ?? 1}</div><h2 id="strategy-revision-title" className="mt-1 text-xl font-bold text-charcoal-950">What should AI revise?</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-charcoal-600">AI suggested these improvements from the current project intake, goals, markets, opportunity, keywords and site context. Select one or more changes.</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg text-charcoal-500 disabled:opacity-50" aria-label="Close">×</button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Current strategy direction</div><p className="mt-2 line-clamp-3 text-sm leading-6 text-charcoal-700">{strategy.strategySummary || "Current Strategy draft"}</p></div>
          <div className="mt-5 flex items-center justify-between gap-3"><div className="text-sm font-bold text-charcoal-900">AI-suggested revisions</div><div className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">Select multiple</div></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{suggestions.map((suggestion) => { const active = selected.includes(suggestion.instruction); return <button key={suggestion.title} type="button" role="checkbox" aria-checked={active} onClick={() => toggle(suggestion.instruction)} className={`rounded-xl border p-4 text-left transition ${active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 hover:border-brand-300"}`}><div className="flex items-start justify-between gap-3"><div><div className="font-bold text-charcoal-950">{suggestion.title}</div><div className="mt-1 text-xs leading-5 text-charcoal-500">{suggestion.detail}</div></div><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-xs font-bold ${active ? "bg-brand-600 text-white" : "border-2 border-slate-300 bg-white text-transparent"}`}>✓</span></div></button>; })}</div>
          <label htmlFor="strategy-revision-custom" className="mt-5 block text-sm font-bold text-charcoal-800">Anything else you want changed?</label>
          <textarea id="strategy-revision-custom" value={custom} onChange={(event) => { setSubmitError(null); setCustom(event.target.value); }} rows={4} maxLength={2000} placeholder="Example: Keep the plan within a 90-day timeline, focus on qualified B2B leads, and reduce lower-priority social work." className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          <div className="mt-2 flex items-center justify-between text-xs text-charcoal-500"><span>{selected.length ? `${selected.length} AI suggestion${selected.length === 1 ? "" : "s"} selected` : "Select a suggestion or add your own instruction."}</span><span>{custom.length}/2000</span></div>
          {submitError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-800" role="alert"><div className="font-bold">Revised draft was not created</div><div className="mt-1">{submitError}</div></div>}
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><b>A new draft version will be created.</b> The current and previously approved versions remain available for comparison and history.</div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><span className="text-xs text-charcoal-500">The button will explain what is missing instead of silently doing nothing.</span><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 disabled:opacity-50">Cancel</button><button type="button" onClick={() => void submit()} disabled={busy} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:bg-brand-400">{busy ? "Creating revised version…" : `Create Revised Draft${selected.length ? ` (${selected.length})` : ""}`}</button></div></div>
      </div>
    </div>
  );
}

function StrategyGenerateConfirmModal({ estimate, onCancel, onConfirm }: { estimate: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="strategy-generate-confirm-title">
    <button type="button" className="absolute inset-0" aria-label="Cancel Strategy generation" onClick={onCancel} />
    <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
      <div className="bg-gradient-to-br from-brand-50 via-white to-violet-50 px-6 pb-5 pt-6">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-xl text-white shadow-lg shadow-brand-200">✦</div>
        <div className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-brand-700">Unified Strategy</div>
        <h2 id="strategy-generate-confirm-title" className="mt-1 text-2xl font-black text-slate-950">Generate this Strategy?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">SEnuke will use the approved project evidence to create a reviewable Strategy draft in the background.</p>
      </div>
      <div className="space-y-3 px-6 py-5">
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Estimated use</div><div className="mt-1 text-base font-black text-slate-950">{estimate}</div></div>
        <div className="grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2"><div className="rounded-lg border border-slate-200 p-3"><b className="block text-slate-900">Safe reservation</b>Capacity is released automatically if generation fails.</div><div className="rounded-lg border border-slate-200 p-3"><b className="block text-slate-900">Duplicate protection</b>Repeated requests reuse the same active job.</div></div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Cancel</button><button type="button" onClick={onConfirm} autoFocus className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-brand-700">Generate Strategy</button></div>
    </div>
  </div>;
}

function StrategyScreen({ data, busy, workflowController, onAction }: { data: ModuleData; busy: "generate" | "analyze" | "approve" | "execution" | null; workflowController: ProjectWorkflowControllerState | null; onAction: (action: "generate" | "analyze" | "approve" | "execution", options?: { revisionComment?: string; confirmed?: boolean }) => Promise<StrategyActionResult | undefined> }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<StrategyTab>("overview");
  const [inlineNotice, setInlineNotice] = useState<{ tone: "info" | "success" | "error"; message: string } | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [approvalCompleteOpen, setApprovalCompleteOpen] = useState(false);
  const [executionCompleteOpen, setExecutionCompleteOpen] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const project = data.projects[0];
  const strategyCount = project?._count?.strategyPlans ?? 0;
  const latestStrategy = project?.strategyPlans?.[0] as {
    id?: string;
    version?: number;
    createdAt?: string;
    status?: string;
    strategySummary?: string | null;
    positioningStatement?: string | null;
    audienceProfile?: string | null;
    offerRecommendation?: string | null;
    businessModel?: string | null;
    seoStrategy?: string | null;
    localSeoStrategy?: string | null;
    aiCitationStrategy?: string | null;
    contentStrategy?: string | null;
    competitorStrategy?: string | null;
    competitiveInsights?: unknown;
    authorityStrategy?: string | null;
    socialStrategy?: string | null;
    publishingStrategy?: string | null;
    businessObjectives?: unknown;
    growthRecommendations?: unknown;
    kpis?: unknown;
    revisionComment?: string | null;
    strategyScore?: number | null;
    scoreBreakdown?: unknown;
    advancedAnalysis?: unknown;
    prioritizedRecommendations?: unknown;
  } | undefined;
  const strategyVersions = (project?.strategyPlans ?? []) as Array<typeof latestStrategy>;
  const previousStrategy = strategyVersions[1];
  const strategyApproved = latestStrategy?.status === "approved";
  const strategyRevisionAvailable = !strategyApproved || Boolean(workflowController?.strategyStale);
  const unifiedStrategyPlan = unifiedStrategyPlanFrom(latestStrategy?.prioritizedRecommendations);
  const unifiedDecisionSet = unifiedStrategyDecisionSetFrom(latestStrategy?.prioritizedRecommendations);
  const savedAdvancedAnalyses = (Array.isArray(latestStrategy?.advancedAnalysis) ? latestStrategy.advancedAnalysis : []) as StrategyAnalysisItem[];
  const funnelAdvancedAnalyses = unifiedStrategyPlan?.growthFunnel?.evaluationMethod === "ai" ? advancedAnalysesFromFunnel(unifiedStrategyPlan.growthFunnel) : [];
  const advancedAnalyses = savedAdvancedAnalyses.length ? savedAdvancedAnalyses : funnelAdvancedAnalyses;
  const applicableAdvancedAnalyses = advancedAnalyses.filter((item) => item.applicable);
  const selectedOpportunity = project?.opportunities?.find((opportunity) => ["selected", "confirmed"].includes(opportunity.status)) ?? project?.opportunities?.[0];
  const savedScoreBreakdown = latestStrategy?.scoreBreakdown && typeof latestStrategy.scoreBreakdown === "object" ? latestStrategy.scoreBreakdown as Record<string, unknown> : {};
  const savedScore = (key: string) => typeof savedScoreBreakdown[key] === "number" ? Number(savedScoreBreakdown[key]) : null;
  const score = latestStrategy?.strategyScore ?? selectedOpportunity?.opportunityScore ?? strategyScore(data);
  const previousScoreBreakdown = previousStrategy?.scoreBreakdown && typeof previousStrategy.scoreBreakdown === "object" ? previousStrategy.scoreBreakdown as Record<string, unknown> : {};
  const previousSavedScore = (key: string, fallback: number) => typeof previousScoreBreakdown[key] === "number" ? Number(previousScoreBreakdown[key]) : fallback;
  const previousOverallScore = previousStrategy?.strategyScore ?? selectedOpportunity?.opportunityScore ?? score;
  const overallDelta = score - previousOverallScore;
  const opportunityRows = opportunityInsightScoreRows(selectedOpportunity);
  const scoreRows = [
    { key: "profileDemandFit", label: "Profile Demand Fit", value: savedScore("profileDemandFit") ?? opportunityRows[0]?.value ?? 0, tone: "green" },
    { key: "seoPotential", label: "SEO Potential", value: savedScore("seoPotential") ?? opportunityRows[1]?.value ?? 0, tone: "green" },
    { key: "revenuePotential", label: "Revenue Potential", value: savedScore("revenuePotential") ?? opportunityRows[2]?.value ?? 0, tone: "green" },
    { key: "executionComplexity", label: "Execution Complexity", value: savedScore("executionComplexity") ?? opportunityRows[3]?.value ?? 0, tone: "amber" },
    { key: "confidence", label: "Confidence", value: savedScore("confidence") ?? opportunityRows[4]?.value ?? 0, tone: "green" },
  ].map((row, index) => ({ ...row, previousValue: previousSavedScore(row.key, opportunityRows[index]?.value ?? row.value) }));
  const audience = latestStrategy?.audienceProfile || project?.businessProfile?.targetAudience || "Not provided";
  const offer = latestStrategy?.offerRecommendation || project?.businessProfile?.offerSummary || "Offer recommendation pending.";
  const approvedGroups = project?.keywordGroups?.filter((group) => group.status === "approved") ?? [];
  const approvedKeywordCount = approvedGroups.reduce((total, group) => total + (Array.isArray(group.keywords) ? group.keywords.length : 0), 0);
  const targetMarketCount = Array.isArray(project?.targetLocations) ? project.targetLocations.length : 0;
  const completedCrawl = data.websites.flatMap((website) => website.crawlJobs ?? []).find((crawl) => crawl.status === "completed");
  const projectExecutionTasks = data.tasks.filter((task) => !task.projectId || task.projectId === project?.id);
  const audienceSegments = splitAudience(audience);
  const audienceSummary = audienceSegments.length
    ? `${audienceSegments.length} target segments`
    : audience;
  const websiteType = projectTypeLabel(project);
  const businessModel = latestStrategy?.businessModel || project?.businessProfile?.businessModel || "Not provided";
  const roadmap = data.intelligence?.roadmap?.length ? data.intelligence.roadmap : strategyRoadmap(data, strategyApproved);
  const actionLabels = {
    generate: "Regenerate section",
    analyze: "Analyze current strategy",
    approve: "Approve strategy",
    execution: "Create execution plan",
  } as const;

  const runInlineAction = async (action: "generate" | "analyze" | "approve" | "execution", options?: { revisionComment?: string }) => {
    if (busy) {
      setInlineNotice({ tone: "info", message: "Please wait for the current strategy action to finish." });
      return;
    }
    if (action === "approve" && strategyApproved) {
      setInlineNotice({ tone: "success", message: "This strategy is already approved. You can create or refresh the execution plan now." });
      return;
    }
    if (action === "execution" && !strategyApproved) {
      setInlineNotice({ tone: "error", message: "Approve the strategy first. The execution plan is created only from an approved strategy version." });
      return;
    }

    const workingMessage = `${actionLabels[action]} started...`;
    setInlineNotice({ tone: "info", message: workingMessage });
    try {
      const result = await onAction(action, options);
      if (!result) {
        setInlineNotice({ tone: "error", message: `${actionLabels[action]} did not return a result. Please try again.` });
        return;
      }
      setInlineNotice({ tone: result.ok ? "success" : "error", message: result.message });
      if (result.ok && action === "generate") {
        setCompareVersionId(latestStrategy?.id ?? null);
        setActiveTab("overview");
      }
      if (result.ok && action === "approve") setApprovalCompleteOpen(true);
      if (result.ok && action === "execution") {
        setActiveTab("roadmap");
        setExecutionCompleteOpen(true);
      }
      return result;
    } catch (error) {
      setInlineNotice({ tone: "error", message: error instanceof Error ? error.message : `${actionLabels[action]} failed.` });
      return undefined;
    }
  };

  const generateStrategyReport = async () => {
    if (!project || reportBusy) return;
    setReportBusy(true);
    setInlineNotice({ tone: "info", message: "Building the complete Strategy PDF…" });
    try {
      const result = await api.post<{ report: { id: string } }>("/api/project-reports/generate", { projectId: project.id, reportType: "strategy", exportFormat: "pdf" });
      await api.download(`/api/project-reports/${result.report.id}/download`);
      setInlineNotice({ tone: "success", message: "Complete Strategy Report generated and downloaded." });
    } catch (error) {
      setInlineNotice({ tone: "error", message: error instanceof Error ? error.message : "Strategy Report could not be generated." });
    } finally {
      setReportBusy(false);
    }
  };

  if (!project) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-bold text-charcoal-950">No guided project selected</h2>
        <p className="mt-2 text-sm text-charcoal-500">Create a guided project first, then come back here to view and approve the AI strategy.</p>
        <Link to="/projects/new" className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">Create Project</Link>
      </Card>
    );
  }

  return (
    <>
      {!(["advanced", "overview"] as StrategyTab[]).includes(activeTab) && <Card className="overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 p-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <IconBadge icon="☆" />
                <div className="text-xs font-bold uppercase tracking-wide text-brand-700">Selected Opportunity</div>
              </div>
              <h2 className="mt-3 max-w-4xl text-xl font-bold leading-7 text-charcoal-950">
                {selectedOpportunity?.name ?? project.niche ?? "Not selected"}
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-charcoal-600">
                {selectedOpportunity?.summary || latestStrategy?.strategySummary || "Choose an opportunity to guide the strategy."}
              </p>
            </div>
            <StrategyConfidenceBlock score={score} />
          </div>
        </div>
      </Card>}

      {!latestStrategy ? (
        <Card className="overflow-hidden border-brand-100 bg-brand-50/60">
          <EmptyState
            eyebrow="Unified Strategy"
            title="AI strategy has not been generated yet"
            description="Generate the strategy from the guided project intake, opportunity, audience, offer, and publishing destination."
            action={<button type="button" onClick={() => { void runInlineAction("generate"); }} disabled={Boolean(busy)} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{busy === "generate" ? "Generating..." : "Generate AI Strategy"}</button>}
          />
          {inlineNotice && (
            <div className={`mx-auto mb-6 max-w-2xl rounded-lg border px-4 py-3 text-center text-sm font-semibold ${
              inlineNotice.tone === "success"
                ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                : inlineNotice.tone === "error"
                  ? "border-red-100 bg-red-50 text-red-800"
                  : "border-brand-100 bg-brand-50 text-brand-700"
            }`}>
              {inlineNotice.message}
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-5">
          <StrategyTabs activeTab={activeTab} onChange={setActiveTab} />

          <Card className="px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Strategy versions</div><div className="mt-1 text-sm font-semibold text-charcoal-700">{latestStrategy.status === "approved" ? "Current approved Strategy" : "Current Strategy draft"}, version {latestStrategy.version ?? strategyVersions.length} {latestStrategy.createdAt ? `· ${formatDateTime(latestStrategy.createdAt)}` : ""}</div></div><div className="flex flex-wrap items-center gap-2">{activeTab !== "overview" && strategyRevisionAvailable && <button type="button" onClick={() => setRegenerateConfirmOpen(true)} disabled={Boolean(busy)} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50">{busy === "generate" ? "Creating version…" : latestStrategy.status === "approved" ? "Review changed evidence" : "Create new Strategy version"}</button>}<button type="button" onClick={() => void generateStrategyReport()} disabled={reportBusy} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white shadow-sm disabled:bg-slate-300">{reportBusy ? "Generating PDF…" : "Generate Strategy Report ↓"}</button>{strategyVersions.map((version, index) => <button type="button" key={version?.id ?? index} onClick={() => setCompareVersionId(index === 0 || compareVersionId === version?.id ? null : version?.id ?? null)} className={`rounded-full border px-3 py-1 text-xs font-bold ${index === 0 ? "border-brand-300 bg-brand-50 text-brand-700" : compareVersionId === version?.id ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-charcoal-500"}`}>v{version?.version ?? strategyVersions.length - index} · {index === 0 ? label(version?.status ?? "draft") : compareVersionId === version?.id ? "Comparing" : "Compare"}</button>)}</div></div>
            {compareVersionId && (() => {
              const compared = strategyVersions.find((version) => version?.id === compareVersionId);
              if (!compared) return null;
              const fields = [
                ["Executive Summary", "strategySummary"], ["SEO Strategy", "seoStrategy"], ["Local SEO", "localSeoStrategy"], ["Content Strategy", "contentStrategy"], ["Authority Strategy", "authorityStrategy"], ["Growth Recommendations", "growthRecommendations"], ["KPIs", "kpis"],
              ] as const;
              const valueText = (value: unknown) => Array.isArray(value) ? value.map(String).join(" · ") : String(value ?? "Not included");
              const changed = fields.filter(([, key]) => valueText(latestStrategy[key]) !== valueText(compared[key]));
              return <div className="mt-3 border-t border-slate-100 pt-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-sm font-bold text-charcoal-950">What changed in v{latestStrategy.version}</div><div className="mt-1 text-xs text-charcoal-500">Compared with v{compared.version} · {changed.length} section{changed.length === 1 ? "" : "s"} changed</div></div><button type="button" onClick={() => setCompareVersionId(null)} className="self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-charcoal-600">Close comparison</button></div>{latestStrategy.revisionComment && <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Your revision instructions</div><p className="mt-1 whitespace-pre-line text-sm leading-6 text-charcoal-700">{latestStrategy.revisionComment}</p></div>}<div className="mt-3 space-y-3">{changed.length ? changed.map(([title, key]) => <div key={key} className="overflow-hidden rounded-xl border border-slate-200"><div className="flex items-center justify-between bg-slate-50 px-4 py-2"><span className="text-sm font-bold text-charcoal-900">{title}</span><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Changed</span></div><div className="grid md:grid-cols-2"><div className="border-b border-slate-100 p-4 md:border-b-0 md:border-r"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Before · v{compared.version}</div><p className="mt-2 text-sm leading-6 text-charcoal-600">{valueText(compared[key])}</p></div><div className="bg-emerald-50/40 p-4"><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">After · v{latestStrategy.version}</div><p className="mt-2 text-sm leading-6 text-charcoal-800">{valueText(latestStrategy[key])}</p></div></div></div>) : <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">No material section differences were detected.</div>}</div></div>;
            })()}
          </Card>

          {activeTab === "overview" && <UnifiedStrategyOverview
            plan={unifiedStrategyPlan}
            decisionSet={unifiedDecisionSet}
            strategy={latestStrategy}
            score={score}
            scoreRows={scoreRows}
            approved={strategyApproved}
            busy={busy}
            notice={inlineNotice}
            workflowController={workflowController}
            allowRevision={strategyRevisionAvailable}
            onApprove={() => void runInlineAction("approve")}
            onRegenerate={() => setRegenerateConfirmOpen(true)}
            onExecution={() => void runInlineAction("execution")}
          />}

          {activeTab === "score" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card className="p-5">
                <h2 className="font-bold text-charcoal-950">Strategy Score & Next Actions</h2>
                <p className="mt-1 text-sm text-charcoal-500">Review and refine the current Strategy. Execution becomes available only after this version is approved.</p>
                <div className="mt-5 grid gap-4 lg:grid-cols-[280px_1fr]">
                  <div className="grid place-items-center rounded-xl border border-slate-200 bg-slate-50 p-5">
                    <div className="grid h-36 w-36 place-items-center rounded-full border-[12px] border-emerald-600 bg-white text-center shadow-sm">
                      <div><div className="text-4xl font-bold text-charcoal-950">{score}</div><div className="text-xs font-bold text-charcoal-500">Overall Score</div>{previousStrategy && overallDelta !== 0 && <div className={`mt-1 text-xs font-bold ${overallDelta > 0 ? "text-emerald-700" : "text-red-600"}`}>{overallDelta > 0 ? "+" : ""}{overallDelta} from v{previousStrategy.version ?? 1}</div>}</div>
                    </div>
                    <div className="mt-4 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">{strategyApproved ? "Approved" : "Draft"}</div>
                  </div>
                  <div className="space-y-3">
                    {scoreRows.map((row) => (
                      <div key={row.label}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-sm font-semibold text-charcoal-700"><span>{row.label}</span><span className="flex items-center gap-2">{previousStrategy && row.previousValue !== row.value && <span className="text-xs font-medium text-charcoal-400 line-through">{row.previousValue}</span>}<span>{row.value}/100</span>{previousStrategy && row.previousValue !== row.value && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${row.key === "executionComplexity" ? row.value < row.previousValue ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700" : row.value > row.previousValue ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{row.value > row.previousValue ? "+" : ""}{row.value - row.previousValue}</span>}</span></div>
                        <div className="h-3 rounded-full bg-slate-100">
                          <div className={`h-3 rounded-full ${row.tone === "amber" ? "bg-amber-500" : row.value < 80 ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${row.value}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`mt-5 rounded-lg border px-4 py-3 text-sm leading-6 ${strategyApproved ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-100 bg-amber-50 text-amber-800"}`}>
                  {strategyApproved
                    ? "This strategy is approved and its recommendations are in the Execution Plan. You can refresh the plan after project data changes."
                    : "This strategy is still a draft. Approve it to unlock the Execution Plan. Regenerating creates a new draft that also needs approval."}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {!strategyApproved && (
                    <button type="button" onClick={() => { void runInlineAction("approve"); }} disabled={Boolean(busy)} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
                      {busy === "approve" ? "Approving..." : "Approve Strategy"}
                    </button>
                  )}
                  <button type="button" onClick={() => setRegenerateConfirmOpen(true)} disabled={Boolean(busy)} className="rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">
                    {busy === "generate" ? "Regenerating..." : "Regenerate"}
                  </button>
                  {strategyApproved && <button type="button" onClick={() => { void runInlineAction("execution"); }} disabled={Boolean(busy)} className="rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">
                    {busy === "execution" ? "Refreshing..." : "Refresh Execution Plan"}
                  </button>}
                </div>
                {inlineNotice && (
                  <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-semibold ${
                    inlineNotice.tone === "success"
                      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                      : inlineNotice.tone === "error"
                        ? "border-red-100 bg-red-50 text-red-800"
                        : "border-brand-100 bg-brand-50 text-brand-700"
                  }`}>
                    {inlineNotice.message}
                  </div>
                )}
              </Card>
              <Card className="p-5">
                <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                  <IconBadge icon="◇" />
                  <h2 className="font-bold text-charcoal-950">AI Recommendations</h2>
                </div>
                <div className="space-y-4 text-sm">
                  <Recommendation icon="◎" title="Smart Recommendation" text={`Focus on "${selectedOpportunity?.name ?? project.niche ?? project.name}" topics with the highest fit and traffic potential.`} />
                  <Recommendation icon="◌" title="Content Gap Opportunity" text="Unmapped topics and supporting pages should become keyword clusters after approval." />
                  <Recommendation icon="▣" title="Key Dependencies" text="Approved strategy, sitemap generated, domain selected, and lead magnet created." />
                </div>
              </Card>
            </div>
          )}

          {activeTab === "core" && (
            <div className="space-y-5">
              <PredictiveStrategyImpact current={latestStrategy} primaryGoal={project.primaryGoal} approvedGroupCount={approvedGroups.length} approvedKeywordCount={approvedKeywordCount} targetMarketCount={targetMarketCount} siteHealth={completedCrawl?.siteScore ?? null} hasExistingWebsite={isExistingWebsiteFlow(project, data.websites[0])} />
              <div className="grid gap-5 lg:grid-cols-2"><StrategyCard
                icon="◎"
                title="Core Strategy"
                actionLabel="Open Growth Plan"
                onAction={() => setActiveTab("growth")}
                items={[
                  ["Positioning Statement", latestStrategy.positioningStatement || latestStrategy.strategySummary || "Positioning statement pending."],
                  ["Recommended Offer", offer],
                  ["Unique Angle", selectedOpportunity?.summary || project.businessProfile?.businessSummary || "Use intake, opportunity score, proof points, and focused execution to differentiate."],
                  ["Primary Conversion Goal", project.primaryGoal || "Not provided"],
                ]}
              />
              <StrategyCard
                icon="☆"
                title="Opportunity Context"
                actionLabel="Open Opportunities"
                actionTo={`/opportunities?projectId=${project.id}`}
                items={[
                  ["Selected Opportunity", selectedOpportunity?.name ?? project.niche ?? "Not selected"],
                  ["Why This Fits", selectedOpportunity?.summary || project.businessProfile?.businessSummary || "Opportunity context will appear after opportunity selection."],
                  ["Business Model", businessModel],
                  ["Website Type", websiteType],
                ]}
              />
              </div>
            </div>
          )}

          {activeTab === "audience" && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <StrategyCard
                icon="♙"
                title="Target Audience"
                actionLabel="Edit Intake"
                actionTo={`/guided-projects/${project.id}/intake`}
                items={[
                  ["Audience Summary", <AudienceSegmentList segments={audienceSegments} fallback={audience} />],
                  ["Pain Points", arrayText(project.businessProfile?.constraints, "Visibility gaps, low conversions, weak authority, and unclear content focus.")],
                  ["Desired Outcomes", "More qualified traffic, stronger authority, clearer pages, and measurable growth."],
                  ["Buying Intent", "High-intent users researching solutions and comparing providers."],
                ]}
              />
              <Card className="p-5">
                <h2 className="font-bold text-charcoal-950">Audience Notes</h2>
                <div className="mt-4 space-y-3 text-sm leading-6 text-charcoal-600">
                  <p>Use these segments to guide keyword selection, page messaging, lead magnet angles, proof blocks, and CTA copy.</p>
                  <p>When an audience segment is too broad, split it into a dedicated page angle or campaign task instead of forcing one page to target everyone.</p>
                </div>
              </Card>
            </div>
          )}

          {activeTab === "growth" && (
            <div className="space-y-5">
              <GrowthPlanVisual strategy={latestStrategy} targetMarketCount={targetMarketCount} primaryGoal={project.primaryGoal} dependencies={{ intake: Boolean(project.businessProfile), opportunity: Boolean(selectedOpportunity && ["selected", "confirmed"].includes(selectedOpportunity.status)), keywords: approvedGroups.length > 0, siteAnalysis: !isExistingWebsiteFlow(project, data.websites[0]) || Boolean(completedCrawl), strategyApproval: strategyApproved, tracking: Array.isArray(project.analyticsPlatforms) && project.analyticsPlatforms.length > 0, executionPlan: Boolean(project.executionPlans?.[0]) }} />
              <ContentCompetitivePlan strategy={latestStrategy} competitors={Array.isArray(project.competitors) ? project.competitors.map(String).filter(Boolean) : []} primaryGoal={project.primaryGoal} approvedKeywordCount={approvedKeywordCount} />
              <div className="grid gap-5 lg:grid-cols-2"><StrategyCard
                icon="↗"
                title="Channel & Growth Plan"
                actionLabel="Open Funnel Plan"
                onAction={() => setActiveTab("funnel")}
                items={[
                  ["Content Strategy", latestStrategy.contentStrategy || "Content strategy pending."],
                  ["SEO Priority", latestStrategy.seoStrategy || "SEO priority pending."],
                  ["Local SEO", latestStrategy.localSeoStrategy || "Local SEO is included when the project location or target markets require it."],
                  ["Authority & Linking Priority", latestStrategy.authorityStrategy || "Authority and linking plan pending."],
                  ["Lead Generation Angle", offer],
                  ["Social Priority", latestStrategy.socialStrategy || "Social priority pending."],
                ]}
              />
              <Card className="p-5">
                <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                  <IconBadge icon="◇" />
                  <h2 className="font-bold text-charcoal-950">Growth Dependencies</h2>
                </div>
                <div className="space-y-4 text-sm">
                  <Recommendation icon="◎" title="Business Objectives" text={arrayText(latestStrategy.businessObjectives, project.primaryGoal || "Prioritize the primary project goal.")} />
                  <Recommendation icon="◌" title="Growth Recommendations" text={arrayText(latestStrategy.growthRecommendations, `Focus on "${selectedOpportunity?.name ?? project.niche ?? project.name}" topics with the highest business impact.`)} />
                  <Recommendation icon="▣" title="KPIs & Success Metrics" text={arrayText(latestStrategy.kpis, "Track organic visibility, qualified conversions, and execution completion.")} />
                </div>
              </Card>
              </div>
            </div>
          )}

          {activeTab === "funnel" && (
            unifiedStrategyPlan?.growthFunnel ? (
              <AiEvaluatedGrowthFunnel
                projectId={project.id}
                funnel={unifiedStrategyPlan.growthFunnel}
                strategyDecision={unifiedDecisionSet?.nextBestAction ?? null}
                siteHealth={completedCrawl?.siteScore ?? null}
                pagesCrawled={completedCrawl?.pagesCrawled ?? 0}
                strategyApproved={strategyApproved}
                executionTasks={projectExecutionTasks}
                hasExecutionPlan={Boolean(project.executionPlans?.[0])}
                allowRevision={strategyRevisionAvailable}
                busy={busy}
                onApprove={() => void runInlineAction("approve")}
                onCreateExecution={() => void runInlineAction("execution")}
                onNavigate={(url) => navigate(url)}
                onReevaluate={() => void runInlineAction("generate", { revisionComment: "Re-evaluate the complete growth funnel with AI using all current project evidence. Select one Next Best Action, order every applicable execution step by dependency and impact, and make lead magnet, CTA, publishing, and measurement recommendations specific." })}
              />
            ) : (
              <Card className="overflow-hidden border-violet-200">
                <div className="bg-gradient-to-r from-violet-950 via-indigo-950 to-slate-950 px-6 py-7 text-white">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-violet-200">AI Funnel Evaluator</div>
                  <h2 className="mt-2 text-2xl font-bold">Evaluate the complete funnel with the latest project evidence</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-violet-100">This Strategy version predates the AI-guided funnel contract. Create a revised Strategy so AI can select one Next Best Action, explain why, rank the remaining journey, and connect every step to Execution.</p>
                  {strategyRevisionAvailable && <button type="button" onClick={() => void runInlineAction("generate", { revisionComment: "Evaluate the complete growth funnel with AI using all current project evidence. Select one Next Best Action and rank the remaining execution journey by evidence, dependency, expected impact, confidence, and effort." })} disabled={Boolean(busy)} className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-bold text-violet-950 shadow-lg disabled:opacity-60">{busy === "generate" ? "AI is evaluating the funnel…" : "Review changed evidence"}</button>}
                </div>
              </Card>
            )
          )}

          {activeTab === "roadmap" && (
            <Card className="p-5">
              <div className="mb-4 flex items-start gap-2">
                <IconBadge icon="◇" />
                <div><h2 className="font-bold text-brand-700">Project Execution Roadmap</h2><p className="mt-1 text-sm leading-6 text-charcoal-500">Prioritized from approved keywords, keyword-to-page mapping, the latest Site Analysis, and this project’s actual Execution Plan. Optional modules appear only when the evidence and approved Strategy make them applicable.</p></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {roadmap.map((item, index) => (
                  <div key={`${item.title}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3"><div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{index + 1}</div><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${item.status === "Completed" ? "bg-emerald-100 text-emerald-700" : item.status === "Ready" ? "bg-blue-100 text-brand-700" : item.status === "In Progress" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-charcoal-500"}`}>{item.status}</span></div>
                    <div className="mt-3 text-sm font-bold leading-5 text-charcoal-950">{item.title}</div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-charcoal-500">{item.reason}</p>
                    {item.relatedUrl && <Link to={item.relatedUrl} className="mt-3 inline-flex text-xs font-bold text-brand-700 hover:text-brand-800">Open task →</Link>}
                  </div>
                ))}
              </div>
            </Card>
          )}
          {activeTab === "advanced" && <StrategyIntelligencePanel analyses={advancedAnalyses} applicable={applicableAdvancedAnalyses} score={score} strategyApproved={strategyApproved} funnel={unifiedStrategyPlan?.growthFunnel} />}
        </div>
      )}
      {latestStrategy && <StrategyRevisionModal open={revisionOpen} busy={busy === "generate"} project={project} strategy={latestStrategy} opportunityName={selectedOpportunity?.name} onClose={() => setRevisionOpen(false)} onSubmit={async (revisionComment) => { const result = await runInlineAction("generate", { revisionComment, confirmed: true }); if (result?.ok) setRevisionOpen(false); return result; }} />}
      {regenerateConfirmOpen && <StrategyRegenerateConfirmModal currentVersion={latestStrategy?.version ?? strategyVersions.length} busy={busy === "generate"} onClose={() => setRegenerateConfirmOpen(false)} onNeedAiHelp={() => { setRegenerateConfirmOpen(false); setRevisionOpen(true); }} onConfirm={() => { setRegenerateConfirmOpen(false); void runInlineAction("generate", { revisionComment: "Regenerated from the latest approved project information.", confirmed: true }); }} />}
      {approvalCompleteOpen && <StrategyApprovalCompleteModal projectId={project.id} strategyVersion={latestStrategy?.version ?? strategyVersions.length} onReview={() => setApprovalCompleteOpen(false)} />}
      {executionCompleteOpen && <ExecutionPlanCompleteModal projectId={project.id} taskCount={(project.executionPlans ?? []).flatMap((plan) => plan.tasks ?? []).length} onClose={() => setExecutionCompleteOpen(false)} />}
    </>
  );
}

function StrategyExecutiveBrief({ summary, objectives, summaryShown = false }: { summary: string; objectives: string[]; summaryShown?: boolean }) {
  const direction = summary.match(/^Build\s+(.+?)\s+around\s+(.+?)\s+while supporting\s+(.+?)\.\s+Prioritize/i);
  const businessName = direction?.[1]?.trim() ?? null;
  const primaryObjective = direction?.[2]?.trim() || objectives[0] || "Create measurable growth";
  const supportingObjectives = direction?.[3]
    ? direction[3].split(/,|\band\b/i).map((item) => item.trim().replace(/[.;]+$/, "")).filter(Boolean)
    : objectives.slice(1, 6);
  const keywordGroups = [...summary.matchAll(/([A-Za-z][A-Za-z ]+Keywords)\s*\(([^)]*)\)/gi)].map((match) => ({
    label: match[1].trim(),
    keywords: match[2].split(/[,;]/).map((item) => item.trim().replace(/[.;]+$/, "")).filter(Boolean),
  }));
  const executionDirection = summary.match(/Move from\s+(.+?)(?:\.|$)/i)?.[1]?.trim() ?? null;
  const hasStructuredSummary = Boolean(direction || keywordGroups.length || executionDirection);

  if (!hasStructuredSummary) {
    return summaryShown ? null : <div className="mt-5 rounded-2xl border border-white/80 bg-white/75 p-5 text-sm leading-7 text-charcoal-700 shadow-sm backdrop-blur">{summary}</div>;
  }

  return (
    <div className="mt-5 space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
          <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-brand-100/60 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white shadow-sm">↗</span>
              <div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-700">Primary growth objective</div>{businessName && <div className="mt-0.5 text-xs font-semibold text-charcoal-400">{businessName}</div>}</div>
            </div>
            <h3 className="mt-4 text-2xl font-black tracking-tight text-charcoal-950">{primaryObjective.charAt(0).toUpperCase() + primaryObjective.slice(1)}</h3>
            {supportingObjectives.length > 0 && <><div className="mt-5 text-[10px] font-black uppercase tracking-[0.14em] text-charcoal-400">Supporting outcomes</div><div className="mt-2 flex flex-wrap gap-2">{supportingObjectives.map((objective) => <span key={objective} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">✓ {objective.charAt(0).toUpperCase() + objective.slice(1)}</span>)}</div></>}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-charcoal-950 p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-200">Search demand priorities</div><h3 className="mt-1 text-lg font-black">Approved keyword focus</h3></div><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-brand-100">{keywordGroups.reduce((total, group) => total + group.keywords.length, 0)} terms</span></div>
          <div className="mt-4 space-y-4">{keywordGroups.map((group, index) => <div key={`${group.label}-${index}`}><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{group.label}</div><div className="mt-2 flex flex-wrap gap-1.5">{group.keywords.map((keyword) => <span key={keyword} className="rounded-lg border border-white/10 bg-white/[.07] px-2.5 py-1.5 text-xs font-semibold text-slate-100">{keyword}</span>)}</div></div>)}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 via-white to-brand-50 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="min-w-44"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">Execution path</div><div className="mt-1 text-sm font-bold text-charcoal-950">From evidence to measurable work</div></div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5">{["Demand evidence", "Page ownership", "Optimization", "Approval", "Publish / export"].map((step, index) => <div key={step} className="relative rounded-xl border border-white bg-white/80 px-3 py-2 text-center shadow-sm"><div className="text-[10px] font-black text-violet-600">0{index + 1}</div><div className="mt-0.5 text-[11px] font-bold text-charcoal-700">{step}</div></div>)}</div>
        </div>
        {executionDirection && <p className="mt-3 text-xs leading-5 text-charcoal-500">{executionDirection.charAt(0).toUpperCase() + executionDirection.slice(1)}.</p>}
      </div>
    </div>
  );
}

function UnifiedStrategyOverview({ plan, decisionSet, strategy, score, scoreRows, approved, busy, notice, workflowController, allowRevision, onApprove, onRegenerate, onExecution }: {
  plan: UnifiedStrategyPlanView | null;
  decisionSet: UnifiedStrategyDecisionSet | null;
  strategy: { version?: number; strategySummary?: string | null; positioningStatement?: string | null; audienceProfile?: string | null; offerRecommendation?: string | null };
  score: number;
  scoreRows: Array<{ key: string; label: string; value: number }>;
  approved: boolean;
  busy: "generate" | "analyze" | "approve" | "execution" | null;
  notice: { tone: "info" | "success" | "error"; message: string } | null;
  workflowController: ProjectWorkflowControllerState | null;
  allowRevision: boolean;
  onApprove: () => void;
  onRegenerate: () => void;
  onExecution: () => void;
}) {
  const reviewActions = <div className="flex flex-wrap gap-3">{!approved && <button type="button" onClick={onApprove} disabled={Boolean(busy)} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-black text-white shadow-md shadow-brand-200 transition hover:bg-brand-700 disabled:bg-slate-300 disabled:shadow-none">{busy === "approve" ? "Approving…" : "Approve Strategy"}</button>}{allowRevision && <button type="button" onClick={onRegenerate} disabled={Boolean(busy)} className="rounded-xl border-2 border-brand-200 bg-white px-5 py-3 text-sm font-black text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 disabled:text-slate-400">{plan ? (approved ? "Review changed evidence" : "Create new Strategy version") : "Generate Unified AI Strategy"}</button>}</div>;
  const nextAction = workflowController?.nextBestAction;
  const executionReady = approved && (!nextAction || /execution plan/i.test(nextAction.title));
  const executionAction = approved && (executionReady
    ? <button type="button" onClick={onExecution} disabled={Boolean(busy)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 disabled:text-slate-400">{busy === "execution" ? "Synchronizing…" : "Sync Execution Plan"}</button>
    : nextAction?.action ? <Link to={nextAction.action.url} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-800 hover:bg-amber-100">{nextAction.action.label} →</Link> : null);
  const actions = <div className="flex flex-wrap items-center gap-2">{reviewActions}{executionAction}</div>;
  if (!plan) return <Card className="overflow-hidden"><div className="border-b border-amber-200 bg-amber-50 px-5 py-4"><div className="text-xs font-black uppercase tracking-wide text-amber-700">Legacy Strategy v{strategy.version ?? 1}</div><h2 className="mt-1 text-xl font-black text-charcoal-950">This version is a project summary, not the unified plan of action</h2><p className="mt-2 text-sm leading-6 text-amber-900">Create a new version with the Integrated Strategy Engine to add ranked focus areas, a phased action plan, audience journeys, channel responsibilities, dependencies, and shared direction for Website Development, SEO, Lead Magnets, AI Citations, Growth, Social, and Publishing.</p></div><div className="grid gap-4 p-5 lg:grid-cols-3"><StrategySnapshot label="Current summary" value={strategy.strategySummary || "Not available"} /><StrategySnapshot label="Positioning" value={strategy.positioningStatement || "Not available"} /><StrategySnapshot label="Audience and offer" value={`${strategy.audienceProfile || "Audience not available"}\n${strategy.offerRecommendation || "Offer not available"}`} /></div><div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-charcoal-600">The current version remains in history after the new draft is created.</p>{actions}</div></Card>;

  return <div className="space-y-5">
    <Card className="overflow-hidden"><div className="border-b border-slate-100 bg-gradient-to-br from-brand-50 via-white to-emerald-50 px-5 py-5 sm:px-6"><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-600 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white">Unified Strategy & Decision Engine</span><span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase ${approved ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{approved ? "Approved" : "Draft"}</span>{decisionSet && <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-black text-violet-700">Brain v{decisionSet.businessBrainVersion} · Evidence v{decisionSet.evidenceVersion}</span>}</div><h2 className="mt-3 text-2xl font-black tracking-tight text-charcoal-950">One plan of action for the complete platform</h2><div className="mt-4">{reviewActions}</div><p className="mt-4 max-w-3xl text-sm font-medium leading-6 text-charcoal-600">{plan.executiveSummary}</p></div><div className="w-full shrink-0 rounded-2xl border border-white bg-white/90 px-5 py-4 shadow-sm lg:w-[420px]"><div className="flex items-end justify-between gap-4"><div><div className="text-4xl font-black leading-none text-charcoal-950">{score}</div><div className="mt-1 text-[11px] font-black uppercase tracking-wide text-charcoal-400">Strategy readiness</div></div></div><div className="mt-4 grid grid-cols-2 gap-2">{scoreRows.slice(0, 4).map((row) => <div key={row.key} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"><div className="text-xl font-black leading-none text-charcoal-950">{row.value}</div><div className="mt-1 text-[11px] font-black leading-4 text-charcoal-600">{row.label}</div></div>)}</div></div></div><StrategyExecutiveBrief summary={plan.executiveSummary} objectives={plan.objectives} summaryShown />{executionAction && <div className="mt-5">{executionAction}</div>}</div>{notice && <div className={`mx-5 my-4 rounded-lg border px-4 py-3 text-sm font-semibold sm:mx-6 ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-brand-200 bg-brand-50 text-brand-800"}`}>{notice.message}</div>}</Card>

    {decisionSet && <Card className="overflow-hidden border-slate-800"><div className="grid gap-5 bg-slate-950 p-5 text-white lg:grid-cols-[minmax(0,1fr)_300px] sm:p-6"><div><div className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-300">Your Next Best Action</div><h3 className="mt-2 text-2xl font-black">{decisionSet.nextBestAction.title}</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{decisionSet.nextBestAction.whyNow}</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-white/[0.06] p-3"><div className="text-[10px] font-black uppercase text-slate-400">Expected impact</div><p className="mt-1 text-sm font-bold leading-5">{decisionSet.nextBestAction.expectedImpact}</p></div><div className="rounded-xl border border-white/10 bg-white/[0.06] p-3"><div className="text-[10px] font-black uppercase text-slate-400">Evidence confidence</div><div className="mt-1 text-2xl font-black text-emerald-300">{decisionSet.nextBestAction.confidence}%</div><div className="text-xs text-slate-400">{decisionSet.nextBestAction.confidenceLabel}</div></div><div className="rounded-xl border border-white/10 bg-white/[0.06] p-3"><div className="text-[10px] font-black uppercase text-slate-400">Decision score</div><div className="mt-1 text-2xl font-black">{decisionSet.nextBestAction.priorityScore}/100</div><div className="text-xs capitalize text-slate-400">{decisionSet.nextBestAction.effort} effort</div></div></div><div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-xs leading-5 text-emerald-100"><b>After approval:</b> {decisionSet.nextBestAction.whatHappensAfterApproval}</div>{decisionSet.audit.evidenceWarnings?.length > 0 && <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100"><b>Evidence caution:</b> {decisionSet.audit.evidenceWarnings.join(" ")}</div>}</div><div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Why AI selected this</div><div className="mt-3 space-y-2">{decisionSet.nextBestAction.evidence.slice(0, 5).map((item) => <div key={item} className="flex gap-2 text-xs leading-5 text-slate-200"><span className="font-black text-emerald-300">✓</span><span>{item}</span></div>)}</div><div className="mt-4 border-t border-white/10 pt-3 text-xs leading-5 text-slate-300"><b>Success looks like:</b> {decisionSet.nextBestAction.successMeasure}</div><div className="mt-3 text-[10px] text-slate-500">{decisionSet.formula} · {decisionSet.audit.candidateCount} valid actions compared{decisionSet.audit.invalidCandidates?.length ? ` · ${decisionSet.audit.invalidCandidates.length} unsupported action(s) removed` : ""}</div></div></div></Card>}

    <Card className="p-5"><div className="mb-4"><div className="text-xs font-black uppercase tracking-wide text-brand-700">Strategic diagnosis</div><h3 className="mt-1 text-xl font-bold text-charcoal-950">What must change and why</h3></div><div className="grid gap-3 lg:grid-cols-3"><StrategySnapshot label="Current state" value={plan.diagnosis.currentState} /><StrategySnapshot label="Primary constraint" value={plan.diagnosis.keyChallenge} tone="amber" /><StrategySnapshot label="Strategic opportunity" value={plan.diagnosis.strategicOpportunity} tone="emerald" /></div></Card>

    <StrategyPlanExplorer plan={plan} />

    <Card className="p-5"><div className="text-xs font-black uppercase tracking-wide text-amber-700">Risks and validation</div><h3 className="mt-1 text-xl font-bold text-charcoal-950">What must be checked</h3><div className="mt-4 grid gap-3 lg:grid-cols-2">{plan.risks.map((item) => <div key={item.risk} className="rounded-xl border border-amber-100 bg-amber-50 p-3"><div className="text-sm font-bold text-amber-900">{item.risk}</div><p className="mt-1 text-xs leading-5 text-amber-800">{item.mitigation}</p></div>)}{plan.assumptionsToValidate.map((item) => <div key={item} className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-charcoal-600"><span className="font-black text-amber-600">?</span>{item}</div>)}</div></Card>
  </div>;
}

type StrategyExplorerSection = "positioning" | "focus" | "channels" | "phases" | "measurement";

function StrategyPlanExplorer({ plan }: { plan: UnifiedStrategyPlanView }) {
  const [selectedSection, setSelectedSection] = useState<StrategyExplorerSection>("positioning");
  const [selectedFocusKey, setSelectedFocusKey] = useState(plan.focusAreas[0]?.key ?? "");
  const [selectedChannelKey, setSelectedChannelKey] = useState(Object.keys(plan.channels).find((key) => plan.channels[key]) ?? "");
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState(0);
  const selectedFocus = plan.focusAreas.find((area) => area.key === selectedFocusKey) ?? plan.focusAreas[0];
  const channelEntries = Object.entries(plan.channels).filter(([, channel]) => Boolean(channel)) as Array<[string, UnifiedChannelPlan]>;
  const selectedChannel = channelEntries.find(([key]) => key === selectedChannelKey) ?? channelEntries[0];
  const selectedPhase = plan.phases[selectedPhaseIndex] ?? plan.phases[0];
  const channelLabels: Record<string, string> = { website: "Website", seo: "SEO", content: "Content", leadMagnet: "Lead Magnet", aiCitations: "AI Citations", localSeo: "Local SEO", authority: "Authority", social: "Social", publishing: "Publishing", measurement: "Growth & Measurement" };
  const sections: Array<{ key: StrategyExplorerSection; title: string; note: string; count: string }> = [
    { key: "positioning", title: "Positioning, audience, and offer", note: "The strategic choice and buyer journey", count: `${plan.audience.primarySegments.length} segment${plan.audience.primarySegments.length === 1 ? "" : "s"}` },
    { key: "focus", title: "Ranked focus areas", note: "Where the project will focus first", count: `${plan.focusAreas.length} priorit${plan.focusAreas.length === 1 ? "y" : "ies"}` },
    { key: "channels", title: "Cross-platform alignment", note: "How each module supports the Strategy", count: `${channelEntries.length} modules` },
    { key: "phases", title: "Phased action plan", note: "What happens first, next, and later", count: `${plan.phases.length} phases` },
    { key: "measurement", title: "Measurement framework", note: "How the Strategy will be judged", count: `${plan.kpis.length} KPIs` },
  ];

  return <Card className="overflow-hidden">
    <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
      <div className="text-xs font-black uppercase tracking-wide text-violet-700">Integrated Strategy report</div>
      <h3 className="mt-1 text-xl font-bold text-charcoal-950">Explore the complete plan of action</h3>
      <p className="mt-1 text-sm leading-6 text-charcoal-500">Select a Strategy section to review its decisions, evidence, actions, dependencies, destinations, and measurement direction.</p>
    </div>
    <div className="grid lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.7fr)]">
      <div className="border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-200 bg-white px-4 py-3"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Strategy sections</div><div className="mt-1 text-xs text-charcoal-500">Five connected parts of one plan</div></div>
        <div className="divide-y divide-slate-200">{sections.map((section, index) => { const active = selectedSection === section.key; return <button key={section.key} type="button" onClick={() => setSelectedSection(section.key)} className={`flex w-full items-start gap-3 px-4 py-4 text-left transition ${active ? "bg-violet-600 text-white" : "bg-white hover:bg-violet-50"}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black ${active ? "bg-white/20 text-white" : "bg-violet-100 text-violet-700"}`}>{index + 1}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-5">{section.title}</span><span className={`mt-1 block text-xs leading-5 ${active ? "text-violet-100" : "text-charcoal-500"}`}>{section.note}</span><span className={`mt-1 block text-[10px] font-black uppercase tracking-wide ${active ? "text-white" : "text-violet-700"}`}>{section.count}</span></span><span className={`mt-1 text-lg ${active ? "text-white" : "text-charcoal-300"}`}>›</span></button>; })}</div>
      </div>

      <div className="min-w-0 p-5 sm:p-6">
        {selectedSection === "positioning" && <div><div className="mb-5"><div className="text-xs font-black uppercase tracking-wide text-violet-700">Positioning, audience, and offer</div><h4 className="mt-1 text-xl font-black text-charcoal-950">The strategic choice</h4><p className="mt-1 text-sm leading-6 text-charcoal-500">Review who the Strategy prioritizes, what it offers, how it differentiates, and the journey that moves the audience toward action.</p></div><div className="grid gap-4 xl:grid-cols-2"><div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"><StrategyDetail label="Positioning" value={plan.positioning.statement} /><StrategyDetail label="Priority audience" value={plan.positioning.audience} /><StrategyDetail label="Offer strategy" value={plan.positioning.offer} /><StrategyDetail label="Differentiation" value={plan.positioning.differentiation} /></div><div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Priority audience segments</div><div className="mt-3 space-y-3">{plan.audience.primarySegments.map((segment) => <div key={segment.name} className="rounded-xl border border-slate-200 p-4"><div className="font-bold text-charcoal-950">{segment.name}</div><p className="mt-1 text-sm leading-6 text-charcoal-600">{segment.need}</p><div className="mt-2 text-xs text-brand-700"><b>Intent:</b> {segment.intent}</div><div className="mt-1 text-xs text-charcoal-600"><b>Message:</b> {segment.message}</div></div>)}</div></div></div><div className="mt-5"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Audience journey</div><div className="mt-3 grid gap-3 md:grid-cols-2">{plan.audience.journey.map((stage, index) => <div key={`${stage.stage}-${index}`} className="rounded-xl border border-brand-100 bg-brand-50/50 p-4"><div className="text-xs font-black uppercase text-brand-700">{index + 1}. {stage.stage}</div><p className="mt-2 text-sm font-bold leading-5 text-charcoal-900">{stage.question}</p><p className="mt-2 text-xs leading-5 text-charcoal-600"><b>Required asset:</b> {stage.requiredAsset}</p><p className="mt-1 text-xs font-semibold leading-5 text-emerald-700"><b>Next:</b> {stage.nextAction}</p></div>)}</div></div></div>}

        {selectedSection === "focus" && selectedFocus && <div><div className="mb-5"><div className="text-xs font-black uppercase tracking-wide text-red-700">Ranked focus areas</div><h4 className="mt-1 text-xl font-black text-charcoal-950">Focus on these opportunities first</h4><p className="mt-1 text-sm leading-6 text-charcoal-500">Select a priority to see its evidence, planned actions, dependencies, responsible channels, and success measures.</p></div><div className="mb-5 flex flex-wrap gap-2">{plan.focusAreas.map((area, index) => <button key={area.key} type="button" onClick={() => setSelectedFocusKey(area.key)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${selectedFocus.key === area.key ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-charcoal-600 hover:border-violet-300"}`}>{index + 1}. {area.title}</button>)}</div><div className="overflow-hidden rounded-2xl border border-violet-200"><div className="bg-gradient-to-r from-violet-50 to-white p-5"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${selectedFocus.priority === "critical" || selectedFocus.priority === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{selectedFocus.priority} priority</span>{selectedFocus.channels.map((channel) => <span key={channel} className="rounded-full border border-brand-200 bg-white px-2.5 py-1 text-[10px] font-bold text-brand-700">{channel}</span>)}</div><h5 className="mt-3 text-xl font-black text-charcoal-950">{selectedFocus.title}</h5><p className="mt-2 text-sm leading-6 text-charcoal-700">{selectedFocus.objective}</p><p className="mt-2 text-sm leading-6 text-charcoal-600"><b>Why now:</b> {selectedFocus.whyNow}</p></div><div className="grid gap-5 p-5 xl:grid-cols-2"><div><div className="text-xs font-black uppercase text-charcoal-400">Evidence used</div><ul className="mt-2 space-y-2">{selectedFocus.evidence.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-charcoal-600"><span className="text-violet-500">•</span>{item}</li>)}</ul><div className="mt-5 text-xs font-black uppercase text-charcoal-400">Success measures</div><ul className="mt-2 space-y-2">{selectedFocus.successMeasures.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-emerald-700"><span>✓</span>{item}</li>)}</ul></div><div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4"><div className="text-xs font-black uppercase text-brand-700">Plan of action</div><ol className="mt-3 space-y-3">{selectedFocus.actions.map((action, index) => <li key={action} className="flex gap-3 text-sm leading-6 text-charcoal-800"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-600 text-[10px] font-black text-white">{index + 1}</span>{action}</li>)}</ol>{selectedFocus.dependencies.length > 0 && <div className="mt-4 border-t border-brand-100 pt-3 text-xs leading-5 text-charcoal-600"><b>Dependencies:</b> {selectedFocus.dependencies.join(" · ")}</div>}</div></div></div></div>}

        {selectedSection === "channels" && selectedChannel && <div><div className="mb-5"><div className="text-xs font-black uppercase tracking-wide text-brand-700">Cross-platform alignment</div><h4 className="mt-1 text-xl font-black text-charcoal-950">How every module supports the same Strategy</h4><p className="mt-1 text-sm leading-6 text-charcoal-500">Select a module to review its objective, assigned actions, dependencies, destination, and success signal.</p></div><div className="mb-5 flex flex-wrap gap-2">{channelEntries.map(([key]) => <button key={key} type="button" onClick={() => setSelectedChannelKey(key)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${selectedChannel[0] === key ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-charcoal-600 hover:border-brand-300"}`}>{channelLabels[key] ?? label(key)}</button>)}</div><div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Selected module</div><h5 className="mt-1 text-xl font-black text-charcoal-950">{channelLabels[selectedChannel[0]] ?? label(selectedChannel[0])}</h5></div><span className="rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-bold text-brand-700">{selectedChannel[1].destination}</span></div><p className="mt-4 text-sm leading-6 text-charcoal-700">{selectedChannel[1].objective}</p><div className="mt-5 grid gap-4 lg:grid-cols-2"><div><div className="text-xs font-black uppercase text-charcoal-400">Assigned actions</div><ol className="mt-3 space-y-3">{selectedChannel[1].actions.map((action, index) => <li key={action} className="flex gap-3 text-sm leading-6 text-charcoal-700"><span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-brand-600 text-[10px] font-black text-white">{index + 1}</span>{action}</li>)}</ol></div><div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><b>Success signal</b><span className="mt-1 block">{selectedChannel[1].successSignal}</span></div>{selectedChannel[1].dependencies.length > 0 && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-5 text-charcoal-600"><b>Dependencies:</b> {selectedChannel[1].dependencies.join(" · ")}</div>}</div></div></div></div>}

        {selectedSection === "channels" && selectedChannel?.[0] === "website" && plan.websiteStrategy && <WebsiteStrategyDetails strategy={plan.websiteStrategy} />}

        {selectedSection === "phases" && selectedPhase && <div><div className="mb-5"><div className="text-xs font-black uppercase tracking-wide text-emerald-700">Phased action plan</div><h4 className="mt-1 text-xl font-black text-charcoal-950">What happens first, next, and later</h4><p className="mt-1 text-sm leading-6 text-charcoal-500">Select a phase to review its timeframe, actions, deliverables, and the criteria required before the Strategy advances.</p></div><div className="mb-5 flex flex-wrap gap-2">{plan.phases.map((phase, index) => <button key={`${phase.name}-${index}`} type="button" onClick={() => setSelectedPhaseIndex(index)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${selectedPhaseIndex === index ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-charcoal-600 hover:border-emerald-300"}`}>{index + 1}. {phase.name}</button>)}</div><div className="rounded-2xl border border-emerald-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-emerald-700">Phase {selectedPhaseIndex + 1}</div><h5 className="mt-1 text-xl font-black text-charcoal-950">{selectedPhase.name}</h5></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{selectedPhase.timeframe}</span></div><p className="mt-3 text-sm leading-6 text-charcoal-700">{selectedPhase.objective}</p><div className="mt-5 grid gap-4 lg:grid-cols-3"><div><div className="text-xs font-black uppercase text-charcoal-400">Actions</div><ol className="mt-2 space-y-2">{selectedPhase.actions.map((action, index) => <li key={action} className="flex gap-2 text-xs leading-5 text-charcoal-600"><span className="font-black text-emerald-600">{index + 1}.</span>{action}</li>)}</ol></div><div><div className="text-xs font-black uppercase text-charcoal-400">Deliverables</div><ul className="mt-2 space-y-2">{selectedPhase.deliverables.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-charcoal-600"><span className="text-brand-600">•</span>{item}</li>)}</ul></div><div><div className="text-xs font-black uppercase text-charcoal-400">Exit criteria</div><ul className="mt-2 space-y-2">{selectedPhase.exitCriteria.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-emerald-700"><span>✓</span>{item}</li>)}</ul></div></div></div></div>}

        {selectedSection === "measurement" && <div><div className="mb-5"><div className="text-xs font-black uppercase tracking-wide text-violet-700">Measurement framework</div><h4 className="mt-1 text-xl font-black text-charcoal-950">How the Strategy will be judged</h4><p className="mt-1 text-sm leading-6 text-charcoal-500">Review why each KPI matters, how it will be measured, and the expected direction without inventing unsupported numeric forecasts.</p></div><div className="space-y-3">{plan.kpis.map((kpi, index) => <div key={kpi.name} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-100 text-xs font-black text-violet-700">{index + 1}</span><div className="min-w-0"><div className="font-black text-charcoal-950">{kpi.name}</div><p className="mt-1 text-sm leading-6 text-charcoal-600">{kpi.why}</p></div></div><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-charcoal-600"><b className="text-charcoal-800">Measurement</b><span className="mt-1 block">{kpi.measurement}</span></div><div className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-800"><b>Target direction</b><span className="mt-1 block">{kpi.targetDirection}</span></div></div></div>)}</div></div>}
      </div>
    </div>
  </Card>;
}

function StrategySnapshot({ label: snapshotLabel, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "amber" | "emerald" }) {
  return <div className={`rounded-xl border p-4 ${tone === "amber" ? "border-amber-100 bg-amber-50" : tone === "emerald" ? "border-emerald-100 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">{snapshotLabel}</div><p className="mt-2 whitespace-pre-line text-sm leading-6 text-charcoal-700">{value}</p></div>;
}

function StrategyDetail({ label: detailLabel, value }: { label: string; value: string }) {
  return <div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">{detailLabel}</div><p className="mt-1 text-sm leading-6 text-charcoal-700">{value}</p></div>;
}

function WebsiteStrategyDetails({ strategy }: { strategy: NonNullable<UnifiedStrategyPlanView["websiteStrategy"]> }) {
  return <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white"><div className="border-b border-white/10 p-5"><div className="text-xs font-black uppercase tracking-wide text-emerald-300">Website Strategy decision layer</div><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><h5 className="text-xl font-black">What the approved Strategy tells the Website Plan to build</h5><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-slate-200">{strategy.mode.replaceAll("_", " ")}</span></div><p className="mt-2 text-sm leading-6 text-slate-300">This is broader than SEO. The separate Website Plan will turn these decisions into exact pages, URLs, content briefs, forms, schema, media, files, and publishing requirements.</p></div><div className="grid gap-4 p-5 lg:grid-cols-2"><div className="rounded-xl bg-white/5 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-300">Recommended scope</div><div className="mt-2 text-lg font-black">{strategy.scope.recommendedPageRange}</div><p className="mt-2 text-xs leading-5 text-slate-300">{strategy.scope.rationale}</p><p className="mt-2 text-xs leading-5 text-slate-400"><b className="text-slate-200">Release approach:</b> {strategy.scope.releaseApproach}</p></div><div className="rounded-xl bg-white/5 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-300">Conversion architecture</div><p className="mt-2 text-sm leading-6 text-slate-200">{strategy.conversionArchitecture}</p></div></div><div className="border-t border-white/10 p-5"><div className="text-xs font-black uppercase tracking-wide text-slate-400">Sitemap priorities</div><div className="mt-3 grid gap-3 lg:grid-cols-3">{strategy.sitemapPriorities.map((item) => <div key={`${item.pageType}-${item.priority}`} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="flex items-start justify-between gap-2"><b className="text-sm text-white">{item.pageType}</b><span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[9px] font-black uppercase text-emerald-200">{item.priority}</span></div><p className="mt-2 text-xs leading-5 text-slate-300">{item.purpose}</p><div className="mt-2 text-[10px] font-bold text-slate-400">Intent: {item.searchIntent}</div></div>)}</div></div><div className="grid gap-4 border-t border-white/10 p-5 lg:grid-cols-2"><StrategyDarkDetail label="Navigation" value={strategy.navigationApproach} /><StrategyDarkDetail label="Content architecture" value={strategy.contentArchitecture} /><StrategyDarkDetail label="Local authority" value={strategy.localAuthorityApproach} /><div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-300">Launch requirements</div><ul className="mt-3 space-y-2">{strategy.launchRequirements.map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-slate-300"><span className="text-emerald-300">✓</span>{item}</li>)}</ul></div></div></div>;
}

function StrategyDarkDetail({ label: detailLabel, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-300">{detailLabel}</div><p className="mt-2 text-sm leading-6 text-slate-200">{value}</p></div>;
}

function StrategyRegenerateConfirmModal({ currentVersion, busy, onClose, onNeedAiHelp, onConfirm }: { currentVersion: number; busy: boolean; onClose: () => void; onNeedAiHelp: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-charcoal-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="regenerate-strategy-title"><button type="button" className="absolute inset-0" aria-label="Cancel new Strategy version" onClick={busy ? undefined : onClose}/><div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"><div className="border-b border-slate-100 bg-gradient-to-r from-brand-50 via-white to-violet-50 px-6 py-5"><div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-100 text-xl text-brand-700">✦</div><div className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-brand-700">Create Strategy v{currentVersion + 1}</div><h2 id="regenerate-strategy-title" className="mt-1 text-xl font-black text-charcoal-950">How should the new Strategy draft be created?</h2><p className="mt-2 text-sm leading-6 text-charcoal-600"><b>Creating a new Strategy version uses credits.</b> You can cancel and continue with the currently approved Strategy, or choose how to create an optional updated draft below.</p></div><div className="space-y-3 px-6 py-5"><button type="button" onClick={onNeedAiHelp} disabled={busy} className="flex w-full items-start gap-3 rounded-xl border border-brand-300 bg-brand-50 p-4 text-left transition hover:border-brand-500 hover:bg-brand-100 disabled:opacity-50"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-lg text-white">✦</span><span><span className="block text-sm font-bold text-charcoal-950">Guide the new version</span><span className="mt-1 block text-xs leading-5 text-charcoal-600">Choose suggested improvements and add your own instructions before creating the new draft.</span></span></button><button type="button" onClick={onConfirm} disabled={busy} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-lg font-bold text-emerald-700">↻</span><span><span className="block text-sm font-bold text-charcoal-950">Use latest approved evidence</span><span className="mt-1 block text-xs leading-5 text-charcoal-600">Use the latest approved opportunity, keywords, Site Analysis, markets, and project profile without extra instructions.</span></span></button><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-sm font-bold text-emerald-900">Your current version remains safe</div><p className="mt-1 text-xs leading-5 text-emerald-800">Strategy v{currentVersion} stays in version history. The new version is created as a draft and must be approved before changing the active Execution Plan.</p></div></div><div className="flex justify-end border-t border-slate-100 bg-slate-50 px-6 py-4"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 disabled:opacity-50">Cancel</button></div></div></div>;
}

function StrategyApprovalCompleteModal({ projectId, strategyVersion, onReview }: { projectId: string; strategyVersion: number; onReview: () => void }) {
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-charcoal-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="strategy-approved-title"><div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.32)]"><div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-emerald-100 via-brand-50 to-sky-100"/><div className="absolute -right-10 -top-14 h-36 w-36 rounded-full border-[22px] border-white/40"/><button type="button" onClick={onReview} aria-label="Close confirmation" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-white/75 text-xl text-charcoal-500 shadow-sm backdrop-blur hover:bg-white hover:text-charcoal-900">×</button><div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8"><div className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white bg-emerald-500 text-3xl font-black text-white shadow-lg shadow-emerald-200">✓</div><div className="mt-5 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">Strategy approved successfully</div><h2 id="strategy-approved-title" className="mt-3 text-2xl font-black tracking-tight text-charcoal-950 sm:text-3xl">Your execution direction is ready</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">Strategy v{strategyVersion} is now the official project direction. Its approved recommendations and Advanced Analysis priorities can now guide the Execution Plan.</p><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4"><div className="flex items-center"><div className="flex min-w-0 flex-1 items-center"><div className="flex flex-col items-center"><span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-xs font-black text-white">✓</span><span className="mt-2 text-[10px] font-bold text-emerald-700">Strategy</span></div><div className="mx-2 mb-5 h-0.5 flex-1 bg-gradient-to-r from-emerald-400 to-brand-400"/></div><div className="flex flex-col items-center"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-black text-white ring-4 ring-brand-100">2</span><span className="mt-2 text-[10px] font-bold text-brand-700">Execution Plan</span></div></div><p className="mt-3 text-center text-xs leading-5 text-charcoal-500">Next, review the prioritized tasks, owners, approvals, automation level, and publishing sequence.</p></div><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onReview} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-charcoal-700 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">Review Strategy</button><Link to={`/guided-projects/${encodeURIComponent(projectId)}?tab=execution#execution-tasks`} className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-brand-200 transition hover:-translate-y-0.5 hover:shadow-xl">Continue to Execution Plan <span aria-hidden="true">→</span></Link></div></div></div></div>;
}

function ExecutionPlanCompleteModal({ projectId, taskCount, onClose }: { projectId: string; taskCount: number; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-charcoal-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="execution-plan-ready-title"><div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.32)]"><div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-emerald-100 via-brand-50 to-violet-100"/><button type="button" onClick={onClose} aria-label="Close confirmation" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-white/80 text-xl text-charcoal-500 shadow-sm">×</button><div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8"><div className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white bg-emerald-500 text-3xl font-black text-white shadow-lg shadow-emerald-200">✓</div><div className="mt-5 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">Execution Plan created</div><h2 id="execution-plan-ready-title" className="mt-3 text-2xl font-black tracking-tight text-charcoal-950">Your prioritized work is ready</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">{taskCount > 0 ? `${taskCount} tasks were created` : "Your tasks were created"} from the approved Strategy and organized by priority, dependency, automation level, and approval requirement.</p><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-black uppercase tracking-wide text-charcoal-500">What happens next</div><div className="mt-3 space-y-3">{[["1", "Review the first ready task", "Confirm the recommendation, expected outcome and destination."],["2", "Complete or generate the work", "AI-assisted tasks prepare drafts; protected actions wait for approval."],["3", "Move approved work forward", "Content and website work proceeds to review, Publishing and measurement."]].map(([number,title,detail])=><div key={number} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-100 text-xs font-black text-brand-700">{number}</span><div><div className="text-sm font-bold text-charcoal-900">{title}</div><div className="mt-0.5 text-xs leading-5 text-charcoal-500">{detail}</div></div></div>)}</div></div><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-charcoal-700">Stay on Strategy</button><Link to={`/guided-projects/${encodeURIComponent(projectId)}?tab=execution#execution-tasks`} className="rounded-xl bg-brand-600 px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-brand-200 hover:bg-brand-700">Review Execution Plan <span aria-hidden="true">→</span></Link></div></div></div></div>;
}

type StrategyAnalysisItem = {
  key: string;
  title: string;
  applicable: boolean;
  priority: string;
  impact: number;
  confidence: number;
  why: string;
  evidence: string[];
  actions: string[];
  evidenceType?: "measured" | "verified_project_data" | "inferred";
  expectedImpact?: string;
  effort?: "low" | "medium" | "high";
  timeHorizon?: "now" | "next" | "later";
  dependencies?: string[];
  affectedPages?: string[];
  destination?: string;
  funnelStage?: UnifiedGrowthFunnelStep["funnelStage"];
  audienceIntent?: string;
  successMetric?: string;
  leakOrGap?: string;
  recommendedExperiment?: string;
  validationRequirement?: string;
  conversionAction?: string;
  handoffToNext?: string;
  businessObjective?: string;
  problemOrOpportunity?: string;
  whyNow?: string;
  goalAlignment?: number;
  urgency?: number;
  priorityScore?: number;
  confidenceLabel?: "High" | "Medium" | "Low";
  confidenceReason?: string;
  confidenceComponents?: Record<string, number>;
  requiredPermissions?: string[];
  capacityRequirement?: string;
  executionMethod?: string;
  successMeasure?: string;
  whatHappensAfterApproval?: string;
  reasonNotSelected?: string | null;
  disposition?: "selected" | "queued" | "deferred";
  selected?: boolean;
  destinationUrl?: string;
  sourceModule?: string;
};

function advancedAnalysesFromFunnel(funnel: UnifiedGrowthFunnel): StrategyAnalysisItem[] {
  return funnel.steps.map((step, index) => {
    const impact = step.impactScore ?? step.confidence;
    const isNextBestAction = step.key === funnel.nextBestActionKey;
    const actions = [...new Set([step.recommendedAction, step.recommendedExperiment, step.validationRequirement, ...step.details].filter((item): item is string => Boolean(item)))];
    return {
      key: `funnel_${step.key}`,
      title: `${customerFunnelMeta(step, index).label}: ${step.title}`,
      applicable: true,
      priority: isNextBestAction ? "critical" : impact >= 80 ? "high" : impact >= 60 ? "medium" : "low",
      impact,
      confidence: step.confidence,
      why: step.leakOrGap ?? step.whyNow,
      evidence: step.sourceSignals,
      actions,
      evidenceType: step.evidenceType ?? (step.affectedPages.length ? "verified_project_data" : "inferred"),
      expectedImpact: step.expectedImpact,
      effort: step.effort,
      timeHorizon: step.executionHorizon ?? (isNextBestAction ? "now" : index < 3 ? "next" : "later"),
      dependencies: step.dependencies,
      affectedPages: step.affectedPages,
      destination: customerFunnelMeta(step, index).label === "Measure & Improve" ? "Growth Intelligence" : step.destination.replaceAll("_", " "),
      funnelStage: step.funnelStage,
      audienceIntent: step.audienceIntent,
      successMetric: step.successMetric,
      leakOrGap: step.leakOrGap,
      recommendedExperiment: step.recommendedExperiment,
      validationRequirement: step.validationRequirement,
      conversionAction: step.conversionAction,
      handoffToNext: step.handoffToNext,
    };
  });
}

function StrategyIntelligencePanel({ analyses, applicable, score, strategyApproved, funnel }: { analyses: StrategyAnalysisItem[]; applicable: StrategyAnalysisItem[]; score: number; strategyApproved: boolean; funnel?: UnifiedGrowthFunnel }) {
  const hasAnalysis = analyses.length > 0;
  const isAiFunnel = funnel?.evaluationMethod === "ai";
  const highPriorities = applicable.filter((item) => item.priority === "critical" || item.priority === "high").length;
  const averageImpact = applicable.length ? Math.round(applicable.reduce((sum, item) => sum + item.impact, 0) / applicable.length) : 0;
  const averageConfidence = applicable.length ? Math.round(applicable.reduce((sum, item) => sum + item.confidence, 0) / applicable.length) : 0;
  const evidenceCount = new Set(applicable.flatMap((item) => item.evidence)).size;
  const phases = (["now", "next", "later"] as const).map((phase) => ({
    phase,
    items: applicable.filter((item, index) => (item.timeHorizon ?? (index < 3 ? "now" : index < 7 ? "next" : "later")) === phase),
  }));
  return <Card className="overflow-hidden">
    <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-violet-50/40 px-5 py-6 sm:px-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="max-w-3xl"><div className="text-xs font-black uppercase tracking-[0.14em] text-violet-700">{isAiFunnel ? "Advanced Analysis · Unified Decision Intelligence" : "Advanced Analysis · Strategy Intelligence"}</div><h2 className="mt-2 text-2xl font-black tracking-tight text-charcoal-950">{isAiFunnel ? "Why each opportunity matters and what AI will improve" : "What the evidence says—and what the project should do next"}</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">{isAiFunnel ? "This is the same saved decision set used by the Strategy overview, customer funnel, downloadable report, Next Best Action, and Execution Plan. Each recommendation keeps its evidence, expected impact, calculated confidence, destination, experiment, approval rule, and success measure." : "This analysis combines approved keywords, canonical page findings, Site Analysis, business intake, markets and competitors. Measured evidence is kept separate from AI planning inferences, so every recommendation shows what is known, what requires validation and where the work continues. Create a new Strategy version to refresh this evidence while preserving the current approved version."}</p></div><div className="shrink-0 text-center"><div className="relative grid h-24 w-24 place-items-center rounded-full" style={{ background: `conic-gradient(#10b981 ${Math.min(100, Math.max(0, score)) * 3.6}deg, #e2e8f0 0deg)` }}><div className="grid h-[76px] w-[76px] place-items-center rounded-full bg-white shadow-sm"><div><div className="text-xl font-black leading-none text-charcoal-950">{score}</div><div className="mt-1 text-[9px] font-bold uppercase text-charcoal-400">of 100</div></div></div></div><div className="mt-2 text-[10px] font-black uppercase tracking-wide text-emerald-700">Strategy score</div></div></div>
      {hasAnalysis && <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4"><AnalysisSummaryMetric value={applicable.length} label="actionable priorities" /><AnalysisSummaryMetric value={highPriorities} label="high priority" /><AnalysisSummaryMetric value={`${averageImpact}/100`} label="average impact" /><AnalysisSummaryMetric value={`${averageConfidence}%`} label="evidence confidence" /></div>}
      {isAiFunnel && funnel && <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{funnel.steps.map((step, index) => { const meta = customerFunnelMeta(step, index); const priority = step.key === funnel.nextBestActionKey; return <div key={step.key} className={`rounded-xl border px-3 py-3 ${priority ? "border-amber-300 bg-amber-50 ring-2 ring-amber-100" : "border-slate-200 bg-white"}`}><div className="text-[9px] font-black uppercase tracking-[0.12em] text-charcoal-400">Stage {index + 1}</div><div className="mt-1 text-sm font-black text-charcoal-950">{meta.label}</div><div className={`mt-2 text-[9px] font-black uppercase ${priority ? "text-amber-700" : "text-emerald-700"}`}>{priority ? "Biggest opportunity" : `${step.confidence}% confidence`}</div></div>; })}</div>}
      {hasAnalysis && applicable.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-3">{phases.map(({ phase, items }, phaseIndex) => <div key={phase} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">{phaseIndex + 1} · {phase}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-charcoal-500">{items.length}</span></div><div className="mt-2 text-sm font-bold text-charcoal-900">{items[0]?.title ?? "No priority assigned"}</div>{items.length > 1 && <div className="mt-1 text-xs text-charcoal-500">+ {items.length - 1} more prioritized actions</div>}</div>)}</div>}
      {hasAnalysis && applicable.length > 0 && <div className="mt-5 rounded-2xl border border-slate-200 bg-white/90 px-4 py-5 shadow-sm sm:px-5"><div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">From evidence to execution</div><div className="mt-1 text-sm font-bold text-charcoal-900">How Advanced Analysis becomes project work</div></div><div className="text-xs text-charcoal-500">{strategyApproved ? "Strategy approved · create or refresh execution tasks next" : "Analysis complete · review and Strategy approval next"}</div></div><div className="relative"><div className="absolute left-[12.5%] right-[12.5%] top-5 hidden h-0.5 bg-slate-200 md:block"><div className={`h-full bg-gradient-to-r from-emerald-500 to-violet-500 ${strategyApproved ? "w-5/6" : "w-1/2"}`} /></div><div className="relative grid gap-4 md:grid-cols-4">{[{ marker: "✓", title: "Evidence reviewed", detail: `${evidenceCount} project signals`, state: "done" }, { marker: "✓", title: "Priorities ranked", detail: "Impact · confidence · urgency", state: "done" }, { marker: strategyApproved ? "✓" : "3", title: strategyApproved ? "Strategy approved" : "Review actions", detail: strategyApproved ? "Direction is locked" : "Confirm through Strategy approval", state: strategyApproved ? "done" : "current" }, { marker: "4", title: "Create tasks", detail: "Send approved actions to execution", state: strategyApproved ? "current" : "pending" }].map((step, index) => <div key={step.title} className="flex items-center gap-3 md:flex-col md:text-center"><div className={`relative z-[1] grid h-10 w-10 shrink-0 place-items-center rounded-full border-4 border-white text-xs font-black shadow-sm ${step.state === "done" ? "bg-emerald-500 text-white" : step.state === "current" ? "bg-violet-600 text-white ring-4 ring-violet-100" : "border-slate-300 bg-white text-slate-400"}`}>{step.marker}</div><div className="min-w-0 md:mt-2"><div className={`text-sm font-bold ${step.state === "current" ? "text-violet-800" : step.state === "done" ? "text-emerald-800" : "text-charcoal-500"}`}>{step.title}</div><div className="mt-0.5 text-xs leading-5 text-charcoal-500">{step.detail}</div></div>{index < 3 && <span className="ml-auto text-lg text-slate-300 md:hidden">↓</span>}</div>)}</div></div></div>}
    </div>

    {hasAnalysis && applicable.length > 0 && <>
      <AdvancedDecisionMasterDetail analyses={applicable} />
      <div className="border-t border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900 sm:px-6"><b>How this creates value:</b> approving the Strategy converts applicable recommendations into traceable execution tasks. Every task keeps its evidence and priority context, so the team knows why it exists and what outcome it supports.</div>
    </>}
    {hasAnalysis && applicable.length === 0 && <div className="p-6"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-800"><b>No additional optimization priorities were detected.</b><span className="mt-1 block">The current project evidence was reviewed successfully. Refresh the analysis after keywords, crawl findings, competitors, goals or target markets change.</span></div></div>}
    {!hasAnalysis && <div className="p-6"><div className="rounded-xl border border-violet-200 bg-violet-50 p-5"><h3 className="font-bold text-charcoal-950">Create the evidence-backed action plan</h3><p className="mt-2 text-sm leading-6 text-charcoal-600">Use Create new Strategy version above. It reviews the latest keywords, site findings, competitors, markets and project goals, then saves a new draft for review and approval.</p></div></div>}
  </Card>;
}

function AnalysisSummaryMetric({ value, label }: { value: string | number; label: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="text-2xl font-black text-charcoal-950">{value}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div></div>;
}

function AdvancedDecisionMasterDetail({ analyses }: { analyses: StrategyAnalysisItem[] }) {
  const [selectedKey, setSelectedKey] = useState(analyses[0]?.key ?? "");
  const selected = analyses.find((analysis) => analysis.key === selectedKey) ?? analyses[0];
  if (!selected) return null;
  const urgent = selected.priority === "critical" || selected.priority === "high";
  const evidenceLabel = selected.evidenceType === "measured" ? "Measured evidence" : selected.evidenceType === "verified_project_data" ? "Verified project data" : "AI planning inference";
  const phaseLabel = selected.timeHorizon === "later" ? "Later" : selected.timeHorizon === "next" ? "Next" : "Now";
  return <div className="border-b border-slate-200 px-5 py-6 sm:px-6">
    <div className="mb-5"><div className="text-xs font-black uppercase tracking-wide text-violet-700">Ranked decision report</div><h3 className="mt-1 text-xl font-bold text-charcoal-950">Focus on these opportunities first</h3><p className="mt-1 text-sm leading-6 text-charcoal-500">Select a priority to see every part of the saved decision: finding, business reason, evidence, calculated confidence, approvals, destination and success measure.</p></div>
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.7fr)]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"><div className="border-b border-slate-200 bg-white px-4 py-3"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">All priorities</div><div className="mt-1 text-xs text-charcoal-500">{analyses.length} ranked decisions · one selected Next Best Action</div></div><div className="max-h-[760px] divide-y divide-slate-200 overflow-y-auto">{analyses.map((analysis, index) => { const active = analysis.key === selected.key; const high = analysis.priority === "critical" || analysis.priority === "high"; return <button key={analysis.key} type="button" onClick={() => setSelectedKey(analysis.key)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${active ? "bg-violet-600 text-white" : "bg-white hover:bg-violet-50"}`}><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black ${active ? "bg-white/20 text-white" : high ? "bg-red-100 text-red-700" : "bg-slate-100 text-charcoal-600"}`}>{index + 1}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-5">{analysis.title}</span><span className={`mt-1 block text-[10px] font-bold uppercase ${active ? "text-violet-100" : high ? "text-red-600" : "text-charcoal-400"}`}>{analysis.selected ? "Next Best Action" : analysis.disposition ?? analysis.priority} · score {analysis.priorityScore ?? analysis.impact} · {analysis.timeHorizon ?? "next"}</span></span><span className={`mt-1 text-lg ${active ? "text-white" : "text-charcoal-300"}`}>›</span></button>; })}</div></div>
      <div className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
        <div className={`px-5 py-5 ${urgent ? "bg-gradient-to-r from-red-50 to-white" : "bg-gradient-to-r from-violet-50 to-white"}`}><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{selected.priority} priority</span><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase text-violet-700 ring-1 ring-violet-200">{evidenceLabel}</span><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase text-charcoal-600 ring-1 ring-slate-200">{phaseLabel} · {selected.effort ?? "medium"} effort</span></div><h4 className="mt-3 text-xl font-black text-charcoal-950">{selected.title}</h4><p className="mt-2 text-sm leading-6 text-charcoal-700"><b>What we found:</b> {selected.why}</p>{selected.evidenceType === "inferred" && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">This is a planning inference, not a confirmed defect. Validate the affected pages before creating implementation work.</p>}</div><div className="flex shrink-0 gap-2"><AnalysisScore value={selected.impact} label="Impact" tone="emerald" /><AnalysisScore value={`${selected.confidence}%`} label="Confidence" tone="brand" /></div></div></div>
        <div className="grid gap-5 p-5 xl:grid-cols-[0.9fr_1.1fr]">
          {selected.funnelStage && <div className="grid gap-3 xl:col-span-2 md:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-sky-100 bg-sky-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-sky-700">Audience intent</div><p className="mt-2 text-xs leading-5 text-sky-950">{selected.audienceIntent}</p></div><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Stage action / CTA</div><p className="mt-2 text-xs leading-5 text-emerald-950">{selected.conversionAction}</p></div><div className="rounded-xl border border-brand-100 bg-brand-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Handoff</div><p className="mt-2 text-xs leading-5 text-brand-950">{selected.handoffToNext}</p></div><div className="rounded-xl border border-violet-100 bg-violet-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-violet-700">Success measure</div><p className="mt-2 text-xs leading-5 text-violet-950">{selected.successMetric}</p></div></div>}
          <div className="space-y-4"><DecisionAnswer label="Why this matters" value={selected.problemOrOpportunity ?? selected.why} /><DecisionAnswer label="Why this is recommended now" value={selected.whyNow ?? selected.why} /><DecisionAnswer label="Business objective supported" value={selected.businessObjective ?? "Supports the approved project objective recorded in this Strategy version."} /><DecisionAnswer label="Expected result" value={selected.expectedImpact ?? "Improves the project's ability to match search intent and support its approved business goal."} /><DecisionAnswer label="How success will be measured" value={selected.successMeasure ?? selected.successMetric ?? selected.expectedImpact ?? "Compare the result with the recorded baseline."} tone="emerald" /><div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Evidence used</div><div className="mt-2 flex flex-wrap gap-2">{selected.evidence.length ? selected.evidence.slice(0, 10).map((item) => <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-charcoal-600">{item}</span>) : <span className="text-xs text-charcoal-500">No supporting evidence was stored.</span>}</div></div>{Boolean(selected.affectedPages?.length) && <div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Affected pages</div><div className="mt-2 space-y-1.5">{selected.affectedPages?.slice(0, 6).map((url) => <div key={url} className="break-all rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] font-medium text-charcoal-600">{url}</div>)}{(selected.affectedPages?.length ?? 0) > 6 && <div className="text-xs text-charcoal-500">+ {(selected.affectedPages?.length ?? 0) - 6} more pages</div>}</div></div>}</div>
          <div className="space-y-4"><div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4"><div className="text-xs font-black uppercase tracking-wide text-brand-700">Recommended execution</div><ol className="mt-3 space-y-3">{selected.actions.map((action, index) => <li key={action} className="flex gap-3 text-sm leading-6 text-charcoal-800"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-600 text-[10px] font-black text-white">{index + 1}</span><span>{action}</span></li>)}</ol><div className="mt-4 border-t border-brand-100 pt-3 text-xs text-brand-800"><b>Continue in:</b> {selected.destination ?? "Strategy Review"}</div>{selected.destinationUrl && <Link to={selected.destinationUrl} className="mt-3 inline-flex rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white">Open destination →</Link>}</div><DecisionAnswer label="Calculated confidence" value={selected.confidenceReason ?? `${selected.confidenceLabel ?? evidenceLabel} confidence based on the evidence stored with this Strategy version.`} tone="violet" /><DecisionAnswer label="Effort, capacity, and permissions" value={`${selected.capacityRequirement ?? `${selected.effort ?? "medium"} implementation effort`}${selected.requiredPermissions?.length ? ` Permissions: ${selected.requiredPermissions.join("; ")}.` : ""}`} /><DecisionAnswer label="What happens after approval" value={selected.whatHappensAfterApproval ?? selected.executionMethod ?? "The approved action will be synchronized into the governed Execution Plan."} tone="emerald" />{selected.reasonNotSelected && <DecisionAnswer label="Why this is not the current Next Best Action" value={selected.reasonNotSelected} tone="amber" />}{selected.recommendedExperiment && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-black uppercase tracking-wide text-emerald-700">AI-recommended experiment</div><p className="mt-2 text-xs leading-5 text-emerald-950">{selected.recommendedExperiment}</p></div>}{selected.validationRequirement && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-xs font-black uppercase tracking-wide text-amber-700">Validate before execution</div><p className="mt-2 text-xs leading-5 text-amber-950">{selected.validationRequirement}</p></div>}{Boolean(selected.dependencies?.length) && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-black uppercase tracking-wide text-charcoal-500">Required before execution</div><ul className="mt-2 space-y-2">{selected.dependencies?.map((dependency) => <li key={dependency} className="flex gap-2 text-xs leading-5 text-charcoal-600"><span className="text-violet-500">•</span><span>{dependency}</span></li>)}</ul></div>}</div>
        </div>
      </div>
    </div>
  </div>;
}

function DecisionAnswer({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "emerald" | "violet" | "amber" }) {
  const classes = tone === "emerald" ? "border-emerald-100 bg-emerald-50 text-emerald-950" : tone === "violet" ? "border-violet-100 bg-violet-50 text-violet-950" : tone === "amber" ? "border-amber-100 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-charcoal-700";
  return <div className={`rounded-xl border p-4 ${classes}`}><div className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</div><p className="mt-2 text-xs leading-5">{value}</p></div>;
}

function AnalysisScore({ value, label, tone }: { value: string | number; label: string; tone: "emerald" | "brand" }) {
  return <span className={`rounded-xl border bg-white px-4 py-2 text-center ${tone === "emerald" ? "border-emerald-200" : "border-brand-200"}`}><span className={`block text-xl font-black ${tone === "emerald" ? "text-emerald-700" : "text-brand-700"}`}>{value}</span><span className="block text-[9px] font-bold uppercase text-charcoal-400">{label}</span></span>;
}

function IconBadge({ icon }: { icon: string }) {
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">{icon}</span>;
}

function GrowthPlanVisual({ strategy, targetMarketCount, primaryGoal, dependencies }: {
  strategy: { seoStrategy?: string | null; contentStrategy?: string | null; localSeoStrategy?: string | null; authorityStrategy?: string | null; socialStrategy?: string | null; strategyScore?: number | null };
  targetMarketCount: number;
  primaryGoal?: string | null;
  dependencies: { intake: boolean; opportunity: boolean; keywords: boolean; siteAnalysis: boolean; strategyApproval: boolean; tracking: boolean; executionPlan: boolean };
}) {
  const score = strategy.strategyScore ?? 75;
  const channels = [
    { name: "SEO", priority: strategy.seoStrategy ? Math.min(96, score + 10) : 45, fill: "#0f9f8f" },
    { name: "Content", priority: strategy.contentStrategy ? Math.min(92, score + 5) : 40, fill: "#3b82f6" },
    { name: "Local", priority: strategy.localSeoStrategy && targetMarketCount ? Math.min(90, 68 + targetMarketCount * 4) : 30, fill: "#8b5cf6" },
    { name: "Authority", priority: strategy.authorityStrategy ? Math.min(82, score) : 35, fill: "#f59e0b" },
    { name: "Social", priority: strategy.socialStrategy ? Math.min(74, score - 5) : 25, fill: "#ec4899" },
  ].sort((a, b) => b.priority - a.priority);
  const phases = [
    { label: "Now", title: `${channels[0].name} foundation`, detail: "Complete the highest-impact setup and remove critical blockers.", tone: "bg-brand-600 text-white" },
    { label: "Next", title: `${channels[1].name} expansion`, detail: "Build supporting assets and connect them to the primary conversion path.", tone: "bg-blue-600 text-white" },
    { label: "Then", title: "Authority & optimization", detail: "Strengthen proof, links and performance using measured results.", tone: "bg-amber-500 text-white" },
  ];
  const dependencyRows = [
    { label: "Project intake", complete: dependencies.intake, weight: 15 },
    { label: "Opportunity selected", complete: dependencies.opportunity, weight: 10 },
    { label: "Keywords approved", complete: dependencies.keywords, weight: 20 },
    { label: "Site Analysis", complete: dependencies.siteAnalysis, weight: 20 },
    { label: "Strategy approved", complete: dependencies.strategyApproval, weight: 15 },
    { label: "Analytics connected", complete: dependencies.tracking, weight: 10 },
    { label: "Execution Plan", complete: dependencies.executionPlan, weight: 10 },
  ];
  const completedDependencies = dependencyRows.filter((item) => item.complete);
  const dependencyConfidence = completedDependencies.reduce((sum, item) => sum + item.weight, 0);
  const dependencyChart = [{ name: "Ready", value: dependencyConfidence }, { name: "Remaining", value: 100 - dependencyConfidence }];
  const nextBlocker = dependencyRows.find((item) => !item.complete);
  return <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50 via-white to-blue-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Growth priority map</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">Where the Strategy puts effort first</h2><p className="mt-1 text-sm text-charcoal-600">Priority is based on the approved project evidence and the contribution each channel makes to {primaryGoal || "the primary goal"}.</p></div><span className="self-start rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-700">Strategic priority · not forecast revenue</span></div><div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_380px]"><div className="space-y-3">{channels.map((channel, index) => <div key={channel.name} className="grid grid-cols-[86px_minmax(0,1fr)_44px] items-center gap-3"><div className="flex items-center gap-2 text-sm font-bold text-charcoal-700"><span className="text-xs text-charcoal-400">{index + 1}</span>{channel.name}</div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${channel.priority}%`, backgroundColor: channel.fill }} /></div><div className="text-right text-xs font-bold text-charcoal-600">{channel.priority}</div></div>)}</div><div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">{phases.map((phase, index) => <div key={phase.label} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3"><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${phase.tone}`}>{index + 1}</div><div><div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">{phase.label}</div><div className="mt-0.5 text-sm font-bold text-charcoal-900">{phase.title}</div><p className="mt-1 text-xs leading-5 text-charcoal-500">{phase.detail}</p></div></div>)}</div></div><div className="border-t border-slate-100 bg-slate-50/60 p-5"><div className="mb-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Dependency readiness</div><h3 className="mt-1 text-lg font-bold text-charcoal-950">Estimated delivery confidence</h3><p className="mt-1 text-sm text-charcoal-500">Confidence increases as the evidence, approval, measurement, and execution dependencies become ready.</p></div><div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_280px]"><div className="relative h-[190px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dependencyChart} dataKey="value" innerRadius={62} outerRadius={82} startAngle={90} endAngle={-270} stroke="none"><Cell fill="#0f9f8f" /><Cell fill="#e2e8f0" /></Pie></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-bold text-charcoal-950">{dependencyConfidence}%</div><div className="text-[11px] font-bold uppercase text-charcoal-400">confidence</div></div></div></div><div className="grid gap-2 sm:grid-cols-2">{dependencyRows.map((dependency) => <div key={dependency.label} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 ${dependency.complete ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}><div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-md text-xs font-bold ${dependency.complete ? "bg-emerald-600 text-white" : "bg-white text-amber-700"}`}>{dependency.complete ? "✓" : "!"}</span><span className="text-sm font-bold text-charcoal-800">{dependency.label}</span></div><span className={`text-[11px] font-bold ${dependency.complete ? "text-emerald-700" : "text-amber-700"}`}>{dependency.complete ? "Complete" : "Pending"}</span></div>)}</div><div className="space-y-3"><div className="rounded-xl border border-white bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Dependency metrics</div><div className="mt-3 grid grid-cols-2 gap-3"><div><div className="text-2xl font-bold text-emerald-700">{completedDependencies.length}</div><div className="text-xs text-charcoal-500">completed</div></div><div><div className="text-2xl font-bold text-amber-600">{dependencyRows.length - completedDependencies.length}</div><div className="text-xs text-charcoal-500">remaining</div></div></div></div><div className={`rounded-xl border p-4 ${nextBlocker ? "border-amber-100 bg-amber-50" : "border-emerald-100 bg-emerald-50"}`}><div className={`text-xs font-bold uppercase tracking-wide ${nextBlocker ? "text-amber-700" : "text-emerald-700"}`}>{nextBlocker ? "Next dependency" : "Dependencies ready"}</div><p className="mt-2 text-sm font-bold text-charcoal-900">{nextBlocker?.label ?? "Ready for measured execution"}</p><p className="mt-1 text-xs leading-5 text-charcoal-600">{nextBlocker ? `Completing this adds ${nextBlocker.weight} points to delivery confidence.` : "Continue monitoring KPIs as approved tasks are executed."}</p></div></div></div><div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><b>Dependency confidence is not a guaranteed business success rate.</b> It estimates how ready the project is to execute and measure this Growth Plan successfully.</div></div></Card>;
}

function ContentCompetitivePlan({ strategy, competitors, primaryGoal, approvedKeywordCount }: {
  strategy: { contentStrategy?: string | null; competitorStrategy?: string | null; competitiveInsights?: unknown };
  competitors: string[];
  primaryGoal?: string | null;
  approvedKeywordCount: number;
}) {
  const namedCompetitors = competitors.filter((name) => name && name !== "[object Object]").slice(0, 5);
  const effort = [
    { label: "Content gaps", value: 35, color: "bg-brand-600", detail: "New pages and supporting topics" },
    { label: "On-page improvement", value: 25, color: "bg-blue-600", detail: "Intent, structure, metadata and internal links" },
    { label: "Differentiation", value: 20, color: "bg-violet-600", detail: "Positioning, proof and clearer offers" },
    { label: "Authority", value: 20, color: "bg-amber-500", detail: "Sources, links, citations and trust signals" },
  ];
  const changes = [
    { title: "Close priority topic gaps", detail: `${approvedKeywordCount} approved keywords will be mapped against existing and competitor coverage.` },
    { title: "Improve useful depth", detail: "Add clearer answers, proof, FAQs and supporting sections where competing pages are stronger." },
    { title: "Differentiate the offer", detail: `Align pages and calls to action around ${primaryGoal || "the primary business goal"}, without copying competitor language.` },
  ];
  return <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-brand-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-violet-700">Content & competitive strategy</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">What competitors cover—and how we will respond</h2><p className="mt-1 text-sm text-charcoal-600">Competitors are used as a benchmark for gaps, quality and differentiation. Their content is never copied.</p></div><span className={`self-start rounded-full px-3 py-1.5 text-xs font-bold ${namedCompetitors.length ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-700"}`}>{namedCompetitors.length ? `${namedCompetitors.length} competitors in scope` : "Competitor data needed"}</span></div><div className="grid gap-5 p-5 xl:grid-cols-3"><div className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Competitor benchmark</div>{namedCompetitors.length ? <div className="mt-3 space-y-2">{namedCompetitors.map((competitor, index) => <div key={competitor} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5"><span className="grid h-7 w-7 place-items-center rounded-md bg-violet-100 text-xs font-bold text-violet-700">{index + 1}</span><div className="min-w-0"><div className="truncate text-sm font-bold text-charcoal-900">{competitor}</div><div className="text-xs text-charcoal-500">Topics · formats · proof · CTA · authority</div></div></div>)}</div> : <div className="mt-3 rounded-lg border border-dashed border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">No saved competitors are available. Add primary competitors in Project Intake so the next Strategy version can identify evidence-based content gaps.</div>}<p className="mt-3 text-xs leading-5 text-charcoal-500">{strategy.competitorStrategy}</p></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Proposed changes</div><div className="mt-3 space-y-3">{changes.map((change, index) => <div key={change.title} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">{index + 1}</span><div><div className="text-sm font-bold text-charcoal-900">{change.title}</div><p className="mt-1 text-xs leading-5 text-charcoal-500">{change.detail}</p></div></div>)}</div><div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-3 text-xs leading-5 text-brand-900"><b>Content direction:</b> {strategy.contentStrategy || "Content priorities will be generated from approved project evidence."}</div></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Our planned effort</div><div className="mt-3 space-y-4">{effort.map((item) => <div key={item.label}><div className="mb-1.5 flex items-center justify-between gap-3"><div><div className="text-sm font-bold text-charcoal-800">{item.label}</div><div className="text-[11px] text-charcoal-400">{item.detail}</div></div><span className="text-xs font-bold text-charcoal-600">{item.value}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.value}%` }} /></div></div>)}</div><div className="mt-4 rounded-lg bg-charcoal-950 px-4 py-3 text-xs leading-5 text-white"><b>Expected advantage:</b> clearer coverage, stronger proof, better intent alignment and a more direct path to the primary goal.</div></div></div></Card>;
}

function PredictiveStrategyImpact({ current, primaryGoal, approvedGroupCount, approvedKeywordCount, targetMarketCount, siteHealth, hasExistingWebsite }: {
  current: { strategyScore?: number | null; seoStrategy?: string | null; localSeoStrategy?: string | null; contentStrategy?: string | null; kpis?: unknown };
  primaryGoal?: string | null;
  approvedGroupCount: number;
  approvedKeywordCount: number;
  targetMarketCount: number;
  siteHealth: number | null;
  hasExistingWebsite: boolean;
}) {
  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const keywordBaseline = clamp(30 + approvedGroupCount * 9 + Math.min(25, approvedKeywordCount));
  const localBaseline = clamp(targetMarketCount ? 35 + targetMarketCount * 8 : 20);
  const technicalBaseline = hasExistingWebsite ? clamp(siteHealth ?? 40) : 45;
  const conversionBaseline = clamp(35 + (primaryGoal ? 15 : 0) + (current.contentStrategy ? 8 : 0));
  const projectionLift = clamp((current.strategyScore ?? 70) / 12);
  const chartData = [
    { name: "Keyword", current: keywordBaseline, projected: clamp(keywordBaseline + 8 + projectionLift) },
    { name: "Local", current: localBaseline, projected: clamp(localBaseline + (current.localSeoStrategy ? 14 : 5) + projectionLift) },
    { name: "Site", current: technicalBaseline, projected: clamp(technicalBaseline + (current.seoStrategy ? 10 : 4) + projectionLift) },
    { name: "Conversion", current: conversionBaseline, projected: clamp(conversionBaseline + (current.contentStrategy ? 13 : 6) + projectionLift) },
  ];
  const averageCurrent = Math.round(chartData.reduce((sum, item) => sum + item.current, 0) / chartData.length);
  const averageProjected = Math.round(chartData.reduce((sum, item) => sum + item.projected, 0) / chartData.length);
  const lift = averageProjected - averageCurrent;
  const strongest = [...chartData].sort((a, b) => (b.projected - b.current) - (a.projected - a.current))[0];
  return <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Predictive strategy impact</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">Current evidence vs projected impact</h2><p className="mt-1 text-sm text-charcoal-600">A directional forecast based on the project data currently available and the actions proposed in this Strategy.</p></div><div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-white px-4 py-3 shadow-sm"><div><div className="text-xs font-bold uppercase text-charcoal-400">Projected lift</div><div className="mt-1 text-2xl font-bold text-emerald-700">+{lift}</div></div><div className="text-xs leading-5 text-charcoal-500">readiness<br />points</div></div></div><div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_300px]"><div><div className="h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 12, fill: "#475569" }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`${value}/100`]} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="current" name="Current evidence" fill="#94a3b8" radius={[6, 6, 0, 0]} /><Bar dataKey="projected" name="With Strategy" fill="#0f9f8f" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-charcoal-600">{approvedGroupCount} approved keyword groups</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-charcoal-600">{approvedKeywordCount} approved keywords</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-charcoal-600">{targetMarketCount} target markets</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-charcoal-600">Site health: {hasExistingWebsite ? siteHealth ?? "Pending" : "New website"}</span></div></div><div className="space-y-3"><div className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Baseline readiness</div><div className="mt-2 flex items-end gap-2"><span className="text-3xl font-bold text-charcoal-950">{averageCurrent}</span><span className="pb-1 text-sm text-charcoal-400">/100</span></div><p className="mt-2 text-xs leading-5 text-charcoal-500">Calculated from keyword approval, market coverage, crawl health and conversion context.</p></div><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Projected readiness</div><div className="mt-2 flex items-end gap-2"><span className="text-3xl font-bold text-emerald-800">{averageProjected}</span><span className="pb-1 text-sm text-emerald-600">/100</span></div><p className="mt-2 text-xs leading-5 text-emerald-800">Strongest predicted movement: <b>{strongest.name}</b> (+{strongest.projected - strongest.current}).</p></div><div className="rounded-xl border border-brand-100 bg-brand-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Business objective</div><p className="mt-2 text-sm font-bold leading-5 text-charcoal-900">{primaryGoal || "Improve project performance"}</p></div></div></div><div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-900"><b>Forecast, not a guarantee:</b> projections estimate readiness improvement if the approved Strategy tasks are completed. Actual traffic, rankings, leads and sales are measured later through connected analytics and reports.</div></Card>;
}

function StrategyImpactMap({ current, previous, primaryGoal, score, previousScore }: {
  current: { version?: number; strategySummary?: string | null; positioningStatement?: string | null; revisionComment?: string | null; growthRecommendations?: unknown; kpis?: unknown };
  previous?: { version?: number; strategySummary?: string | null; positioningStatement?: string | null };
  primaryGoal?: string | null;
  score: number;
  previousScore: number;
}) {
  const instructions = current.revisionComment?.split(/\n+/).map((item) => item.trim()).filter(Boolean) ?? [];
  const affectedAreas = [
    /seo|keyword|search|site|technical/i.test(current.revisionComment ?? "") ? "SEO" : null,
    /content|topic|funnel|cta|conversion/i.test(current.revisionComment ?? "") ? "Content & Conversion" : null,
    /local|location|market/i.test(current.revisionComment ?? "") ? "Local Markets" : null,
    /kpi|measure|metric|outcome|goal/i.test(current.revisionComment ?? "") ? "KPIs" : null,
  ].filter((item): item is string => Boolean(item));
  const impactText = arrayText(current.growthRecommendations, `Align execution around ${primaryGoal || "the primary project goal"} and measure the resulting business impact.`);
  return <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Strategy impact</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">What this version changes</h2></div><div className="flex flex-wrap gap-2">{affectedAreas.length ? affectedAreas.map((area) => <span key={area} className="rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-bold text-brand-700">{area}</span>) : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-charcoal-500">Initial direction</span>}</div></div><div className="grid lg:grid-cols-[1fr_42px_1fr_42px_1fr]"><div className="p-5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Current state</span>{previous && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-charcoal-500">v{previous.version ?? 1}</span>}</div><p className="mt-3 text-sm leading-6 text-charcoal-600">{previous?.positioningStatement || previous?.strategySummary || "The saved project direction before this Strategy version."}</p></div><div className="hidden place-items-center border-x border-slate-100 bg-slate-50 text-xl font-bold text-brand-600 lg:grid">→</div><div className="border-y border-brand-100 bg-brand-50/60 p-5 lg:border-y-0"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-brand-700">Strategic change</span><span className="rounded-full bg-brand-600 px-2 py-1 text-[11px] font-bold text-white">v{current.version ?? 1}</span></div><p className="mt-3 text-sm font-semibold leading-6 text-charcoal-800">{current.positioningStatement || current.strategySummary}</p>{instructions.length > 0 && <ul className="mt-3 space-y-1.5">{instructions.slice(0, 4).map((instruction) => <li key={instruction} className="flex gap-2 text-xs leading-5 text-brand-900"><span className="font-bold">✓</span><span>{instruction.replace(/^Revise the strategy so /i, "").replace(/^Revise the /i, "")}</span></li>)}</ul>}</div><div className="hidden place-items-center border-x border-slate-100 bg-slate-50 text-xl font-bold text-emerald-600 lg:grid">→</div><div className="p-5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Expected impact</span>{score !== previousScore && <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${score > previousScore ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{score > previousScore ? "+" : ""}{score - previousScore} score</span>}</div><p className="mt-3 text-sm leading-6 text-charcoal-700">{impactText}</p><div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">Primary outcome: {primaryGoal || "Improved project performance"}</div></div></div></Card>;
}

function StrategyTabs({ activeTab, onChange }: { activeTab: StrategyTab; onChange: (tab: StrategyTab) => void }) {
  const tabs: Array<{ key: StrategyTab; label: string }> = [
    { key: "overview", label: "Strategy Overview" },
    { key: "growth", label: "Channels & Growth" },
    { key: "funnel", label: "Funnel Plan" },
    { key: "advanced", label: "Advanced Analysis" },
    { key: "roadmap", label: "Roadmap" },
  ];
  return (
    <Card className="p-2">
      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition ${activeTab === tab.key ? "bg-brand-600 text-white shadow-sm" : "text-charcoal-600 hover:bg-slate-50"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function StrategySummaryFact({ icon, label, value, detail }: { icon: string; label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="min-w-0 border-t border-slate-100 p-4 sm:border-l sm:first:border-l-0">
      <div className="flex items-center gap-2">
        <IconBadge icon={icon} />
        <div className="text-xs font-bold uppercase tracking-wide text-charcoal-500">{label}</div>
      </div>
      <div className="mt-3 break-words text-sm font-bold leading-5 text-charcoal-950">{value}</div>
      {detail && <div className="mt-1 break-words text-xs leading-5 text-charcoal-500">{detail}</div>}
    </div>
  );
}

function StrategyConfidenceBlock({ score }: { score: number }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/85 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-charcoal-500">Confidence Score</div>
          <div className="mt-1 text-2xl font-bold text-charcoal-950">
            {score} <span className="text-sm font-semibold text-charcoal-400">/ 100</span>
          </div>
        </div>
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-[6px] border-emerald-500 text-sm font-bold text-charcoal-950">{score}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
    </div>
  );
}

function splitAudience(value: string) {
  if (!value || value === "Not provided") return [];
  return value
    .split(/,(?=\s*(?:local|operations|service|business|startups|founders|teams|companies|decision|people|clients|customers)\b)/i)
    .map((item) => item.trim().replace(/[.]+$/, ""))
    .filter(Boolean);
}

function AudienceSegmentList({ segments, fallback }: { segments: string[]; fallback: string }) {
  if (!segments.length) return <p className="text-sm leading-6 text-charcoal-600">{fallback}</p>;
  const visible = segments.slice(0, 4);
  const hidden = segments.slice(4);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((segment, index) => (
          <AudienceChip key={`${segment}-${index}`} segment={segment} />
        ))}
      </div>
      {hidden.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-bold text-brand-700">
            Show {hidden.length} more audience segment{hidden.length === 1 ? "" : "s"}
          </summary>
          <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2">
            {hidden.map((segment, index) => (
              <AudienceChip key={`${segment}-${index}`} segment={segment} muted />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AudienceChip({ segment, muted = false }: { segment: string; muted?: boolean }) {
  const normalized = segment.replace(/\s+/g, " ").trim();
  const words = normalized.split(" ");
  const title = words.slice(0, Math.min(words.length, 6)).join(" ");
  const detail = words.length > 6 ? words.slice(6).join(" ") : "";
  return (
    <div className={`rounded-lg border px-3 py-2 ${muted ? "border-slate-200 bg-slate-50" : "border-brand-100 bg-brand-50/70"}`}>
      <div className="text-sm font-bold leading-5 text-charcoal-950">{title}</div>
      {detail && (
        <div className="mt-1 line-clamp-2 text-xs leading-5 text-charcoal-500">
          {detail}
        </div>
      )}
    </div>
  );
}

function StrategyCard({
  icon,
  title,
  items,
  actionLabel,
  actionTo,
  onAction,
}: {
  icon: string;
  title: string;
  items: [string, ReactNode][];
  actionLabel: string;
  actionTo?: string;
  onAction?: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
        <IconBadge icon={icon} />
        <h2 className="font-bold text-brand-700">{title}</h2>
      </div>
      <div className="space-y-4">
        {items.map(([labelText, text], index) => (
          <div key={`${title}-${index}`} className="flex gap-3">
            <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-brand-200 text-[11px] font-bold text-brand-700">✓</span>
            <div>
              <div className="text-sm font-bold text-charcoal-950">{labelText}</div>
              <div className="mt-1 text-sm leading-6 text-charcoal-600">{text}</div>
            </div>
          </div>
        ))}
      </div>
      {actionTo ? (
        <Link to={actionTo} className="mx-auto mt-5 flex w-fit rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-bold text-brand-700 hover:bg-slate-50">
          {actionLabel}
        </Link>
      ) : (
        <button type="button" onClick={onAction} className="mx-auto mt-5 flex rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-bold text-brand-700 hover:bg-slate-50">
          {actionLabel}
        </button>
      )}
    </Card>
  );
}

function funnelDestinationUrl(step: UnifiedGrowthFunnelStep, projectId: string) {
  const encoded = encodeURIComponent(projectId);
  const planningIntent = `${step.title} ${step.recommendedAction} ${step.details.join(" ")}`;
  if (/(?:seo\s+(?:page\s+map|plan)|website\s+plan|keyword[-\s]to[-\s]page)/i.test(planningIntent)) {
    return `/seo-page-map?projectId=${encoded}&autoPrepare=1`;
  }
  const destination = step.destination;
  const destinations: Record<UnifiedGrowthFunnelStep["destination"], string> = {
    seo: `/seo-growth?projectId=${encoded}`,
    gap_analysis: `/gap-analysis?projectId=${encoded}`,
    content: `/ai-content?projectId=${encoded}`,
    website: `/site-architect?projectId=${encoded}`,
    lead_magnets: `/lead-magnets?projectId=${encoded}`,
    ai_citations: `/ai-citations?projectId=${encoded}`,
    local_seo: `/local-seo?projectId=${encoded}`,
    authority: `/backlinks?projectId=${encoded}`,
    publishing: `/ai-content?projectId=${encoded}&tab=publishing`,
    execution_plan: `/guided-projects/${encoded}?tab=execution#execution-tasks`,
    measurement: `/growth?projectId=${encoded}`,
  };
  return destinations[destination];
}

function funnelTaskMatchesStep(task: GuidedExecutionTask, step: UnifiedGrowthFunnelStep) {
  const moduleTerms: Record<UnifiedGrowthFunnelStep["destination"], RegExp> = {
    seo: /seo|keyword|search/i,
    gap_analysis: /gap|site analysis|technical|internal link/i,
    content: /content|page|article|copy/i,
    website: /website|site architect|page build|schema/i,
    lead_magnets: /lead.?magnet|opt.?in|funnel|email capture/i,
    ai_citations: /citation|entity|answer|schema/i,
    local_seo: /local|google business|citation|nap|location/i,
    authority: /authority|backlink|outreach|mention/i,
    publishing: /publish|release|wordpress|deployment/i,
    execution_plan: /execution|strategy/i,
    measurement: /measure|analytics|tracking|conversion|kpi/i,
  };
  const haystack = `${task.moduleName} ${task.sourceType} ${task.title} ${task.description}`;
  return moduleTerms[step.destination].test(haystack) || step.details.some((detail) => haystack.toLowerCase().includes(detail.toLowerCase().slice(0, 36)));
}

const customerFunnelStageMeta = {
  discover: { label: "Discover", color: "from-sky-600 to-cyan-500", caption: "Find the business" },
  evaluate: { label: "Evaluate", color: "from-cyan-600 to-teal-500", caption: "Understand the solution" },
  trust: { label: "Build Trust", color: "from-teal-600 to-emerald-500", caption: "Reduce risk with proof" },
  convert: { label: "Convert", color: "from-emerald-600 to-green-500", caption: "Take the primary action" },
  delight: { label: "Delight", color: "from-green-600 to-lime-500", caption: "Deliver the promise" },
  grow_refer: { label: "Grow & Refer", color: "from-violet-600 to-indigo-500", caption: "Retain, expand, advocate" },
} as const;

function customerFunnelMeta(step: UnifiedGrowthFunnelStep, index: number) {
  const fallbackStages = ["discover", "evaluate", "trust", "convert", "delight", "grow_refer"] as const;
  return customerFunnelStageMeta[step.funnelStage ?? fallbackStages[Math.min(index, fallbackStages.length - 1)]];
}

function AiEvaluatedGrowthFunnel({ projectId, funnel, strategyDecision, siteHealth, pagesCrawled, strategyApproved, executionTasks, hasExecutionPlan, allowRevision, busy, onApprove, onCreateExecution, onNavigate, onReevaluate }: {
  projectId: string;
  funnel: UnifiedGrowthFunnel;
  strategyDecision: UnifiedStrategyDecision | null;
  siteHealth: number | null;
  pagesCrawled: number;
  strategyApproved: boolean;
  executionTasks: GuidedExecutionTask[];
  hasExecutionPlan: boolean;
  allowRevision: boolean;
  busy: "generate" | "analyze" | "approve" | "execution" | null;
  onApprove: () => void;
  onCreateExecution: () => void;
  onNavigate: (url: string) => void;
  onReevaluate: () => void;
}) {
  const aiEvaluated = funnel.evaluationMethod === "ai";
  const completedStatuses = new Set(["completed", "published", "skipped"]);
  const activeStatuses = new Set(["in_progress", "running", "processing"]);
  const stepStates = funnel.steps.map((step) => {
    const matchingTasks = executionTasks.filter((task) => funnelTaskMatchesStep(task, step));
    const complete = matchingTasks.length > 0 && matchingTasks.every((task) => completedStatuses.has(task.status));
    const blocked = matchingTasks.some((task) => ["blocked", "failed"].includes(task.status));
    const inProgress = matchingTasks.some((task) => activeStatuses.has(task.status));
    return { step, matchingTasks, complete, blocked, inProgress };
  });
  const aiNext = stepStates.find((item) => item.step.key === funnel.nextBestActionKey);
  const next = aiNext && !aiNext.complete ? aiNext : stepStates.find((item) => !item.complete) ?? stepStates[0];
  const strategyFunnelStage = strategyDecision?.analysisKey.startsWith("funnel_") ? strategyDecision.analysisKey.replace(/^funnel_/, "") : null;
  const strategyFunnelStep = strategyFunnelStage ? stepStates.find((item) => item.step.funnelStage === strategyFunnelStage) : null;
  const heroTitle = strategyDecision?.title ?? next?.step.title ?? "Review the approved Strategy";
  const heroReason = strategyDecision?.whyNow ?? next?.step.whyNow ?? funnel.summary;
  const heroImpact = strategyDecision?.expectedImpact ?? next?.step.expectedImpact ?? "Complete the next approved growth action.";
  const heroConfidence = strategyDecision?.confidence ?? next?.step.confidence ?? 0;
  const heroEffort = strategyDecision?.effort ?? next?.step.effort ?? "medium";
  const heroEvidence = strategyDecision?.evidence ?? next?.step.sourceSignals ?? funnel.evidenceSummary;
  const [selectedKey, setSelectedKey] = useState(next?.step.key ?? funnel.steps[0]?.key ?? "");
  const selected = stepStates.find((item) => item.step.key === selectedKey) ?? next;
  const completedTasks = executionTasks.filter((task) => completedStatuses.has(task.status)).length;
  const executionProgress = executionTasks.length ? Math.round(completedTasks / executionTasks.length * 100) : 0;
  const runtimeStage = !strategyApproved ? "Strategy awaiting approval" : !hasExecutionPlan ? "Ready for execution planning" : executionTasks.some((task) => activeStatuses.has(task.status)) ? "Execution in progress" : "Execution plan ready";
  const primaryButton = !strategyApproved ? "Approve Strategy to Start" : !hasExecutionPlan ? "Create Execution Plan" : "Start Highest Priority Work";
  const startPrimary = () => {
    if (!strategyApproved) return onApprove();
    if (!hasExecutionPlan) return onCreateExecution();
    if (strategyDecision?.destinationUrl) return onNavigate(strategyDecision.destinationUrl);
    if (next) onNavigate(funnelDestinationUrl(next.step, projectId));
  };
  const statusFor = (item: typeof stepStates[number], index: number) => item.complete
    ? { label: "Complete", tone: "bg-emerald-100 text-emerald-700", marker: "✓" }
    : item.blocked
      ? { label: "Needs attention", tone: "bg-red-100 text-red-700", marker: "!" }
      : item.inProgress
        ? { label: "In progress", tone: "bg-amber-100 text-amber-700", marker: String(index + 1) }
        : item.step.key === next?.step.key
          ? { label: "Next", tone: "bg-brand-100 text-brand-700", marker: String(index + 1) }
          : { label: "Waiting", tone: "bg-slate-100 text-charcoal-500", marker: String(index + 1) };

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-slate-800 shadow-xl">
        <div className="grid gap-6 bg-slate-950 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.20),transparent_38%)] p-6 text-white lg:grid-cols-[minmax(0,1fr)_300px] lg:p-7">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-400/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-300">{aiEvaluated ? "AI-evaluated Growth Funnel" : "Strategy-derived Growth Funnel"}</span><span className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold text-slate-300">Saved with this Strategy version</span></div>
            <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">Your Next Best Action</h2>
            <h3 className="mt-4 max-w-3xl text-xl font-bold text-emerald-300">{heroTitle}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{heroReason}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Expected impact</div><div className="mt-1 text-sm font-bold leading-5 text-white">{heroImpact}</div></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Evidence confidence</div><div className="mt-1 text-2xl font-black text-emerald-300">{heroConfidence}%</div></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Planning effort</div><div className="mt-1 text-lg font-black capitalize text-white">{heroEffort}</div>{!strategyDecision && next?.step.planningTimeEstimate && <div className="mt-1 text-xs text-slate-400">{next.step.planningTimeEstimate}</div>}</div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={startPrimary} disabled={Boolean(busy)} className="rounded-xl bg-emerald-400 px-6 py-3 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300 disabled:opacity-60">{busy ? "Working…" : primaryButton} <span aria-hidden="true">→</span></button>
              {!aiEvaluated && allowRevision && <button type="button" onClick={onReevaluate} disabled={Boolean(busy)} className="rounded-xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-black text-white transition hover:bg-white/15 disabled:opacity-60">{busy === "generate" ? "AI is evaluating…" : "Review changed evidence"}</button>}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Growth Summary</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/[0.06] p-3"><div className="text-2xl font-black text-white">{siteHealth ?? "—"}{siteHealth != null ? "/100" : ""}</div><div className="mt-1 text-[11px] text-slate-400">Site health{pagesCrawled ? ` · ${pagesCrawled} pages` : ""}</div></div>
              <div className="rounded-xl bg-white/[0.06] p-3"><div className="text-2xl font-black text-white">{executionProgress}%</div><div className="mt-1 text-[11px] text-slate-400">Execution progress</div></div>
            </div>
            <div className="mt-3 rounded-xl bg-white/[0.06] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Current stage</div><div className="mt-1 text-sm font-bold text-white">{runtimeStage}</div></div>
            <div className="mt-4 text-[10px] font-black uppercase tracking-wide text-slate-400">Recommendation evidence</div>
            <div className="mt-2 flex flex-wrap gap-2">{heroEvidence.map((signal) => <span key={signal} className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200">✓ {signal}</span>)}</div>
          </div>
        </div>
      </Card>

      {!aiEvaluated && allowRevision && <Card className="border-amber-200 bg-amber-50 p-4"><div className="text-sm font-bold text-amber-950">Changed evidence is ready for review</div><p className="mt-1 text-xs leading-5 text-amber-800">Review the workflow-detected changes before deciding whether a revised Strategy is worth the additional credits.</p></Card>}

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Customer conversion funnel</div>
          <h2 className="mt-1 text-xl font-black text-charcoal-950">How attention becomes a measurable business outcome</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-charcoal-500">AI maps how customers discover, evaluate, trust, convert, receive value, and become repeat customers or advocates. Select a stage to review why it matters, how customers arrive, recommended assets, the next action, and what success looks like.</p>
        </div>
        <div className="grid xl:grid-cols-[minmax(440px,0.9fr)_minmax(0,1.1fr)]">
          <div className="border-b border-slate-100 bg-slate-950 p-5 sm:p-7 xl:border-b-0 xl:border-r">
            <div className="mb-4 flex items-center justify-between gap-3 text-white">
              <div><div className="text-xs font-black uppercase tracking-[0.14em] text-cyan-300">Audience journey</div><div className="mt-1 text-sm text-slate-300">Wide awareness narrows into qualified action and feeds learning back to the top.</div></div>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-300">6 connected stages</span>
            </div>
            <div className="space-y-1.5">
              {stepStates.map((item, index) => {
                const meta = customerFunnelMeta(item.step, index);
                const status = statusFor(item, index);
                const active = selected?.step.key === item.step.key;
                const isPriorityLeak = item.step.key === (strategyFunnelStep?.step.key ?? next?.step.key);
                return <div key={item.step.key}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(item.step.key)}
                    style={{ width: `${Math.max(58, 100 - index * 8)}%`, clipPath: "polygon(3% 0,97% 0,94% 100%,6% 100%)" }}
                    className={`mx-auto flex min-h-[72px] items-center justify-between gap-3 bg-gradient-to-r ${meta.color} px-8 py-3 text-left text-white shadow-lg transition hover:brightness-110 ${active ? "ring-4 ring-cyan-200 ring-offset-2 ring-offset-slate-950" : ""}`}
                  >
                    <div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/75">Stage {index + 1} · {meta.caption}</div><div className="mt-0.5 truncate text-base font-black">{meta.label}</div><div className="truncate text-[11px] font-semibold text-white/80">{item.step.title}</div></div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wide ${isPriorityLeak ? "bg-amber-300 text-amber-950" : "bg-black/20 text-white"}`}>{isPriorityLeak ? "Biggest opportunity" : status.label}</span>
                  </button>
                  {index < stepStates.length - 1 && <div className="mx-auto h-3 w-px bg-cyan-200/35" aria-hidden="true"/>}
                </div>;
              })}
            </div>
            <div className="mx-auto mt-3 flex w-fit items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-[10px] font-bold text-violet-200"><span className="text-base">↻</span> Measured learning improves the next cycle</div>
          </div>
          <div className="bg-slate-50/70 p-5 sm:p-7">
            {selected && <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full bg-gradient-to-r ${customerFunnelMeta(selected.step, stepStates.indexOf(selected)).color} px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white`}>{customerFunnelMeta(selected.step, stepStates.indexOf(selected)).label} stage</span>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold capitalize text-charcoal-600 ring-1 ring-slate-200">{selected.step.effort} effort</span>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-charcoal-600 ring-1 ring-slate-200">{selected.step.confidence}% confidence</span>
              </div>
              <h3 className="mt-3 text-2xl font-black text-charcoal-950">{selected.step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-charcoal-600">{selected.step.objective}</p>
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-amber-700">Why this matters</div><p className="mt-1.5 text-sm font-semibold leading-6 text-amber-950">{selected.step.leakOrGap ?? selected.step.whyNow}</p></div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Audience intent</div><p className="mt-2 text-xs leading-5 text-charcoal-600">{selected.step.audienceIntent ?? selected.step.objective}</p></div>
                <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Success looks like</div><p className="mt-2 text-xs leading-5 text-charcoal-600">{selected.step.successMetric ?? selected.step.expectedImpact}</p></div>
                <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">How customers reach this stage</div><div className="mt-2 flex flex-wrap gap-1.5">{(selected.step.trafficSources?.length ? selected.step.trafficSources : selected.step.sourceSignals).map((source) => <span key={source} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-charcoal-600">{source}</span>)}</div></div>
                <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Recommended assets</div><div className="mt-2 space-y-1">{(selected.step.entryAssets?.length ? selected.step.entryAssets : selected.step.affectedPages).map((asset) => <div key={asset} className="truncate text-xs font-semibold text-brand-700" title={asset}>• {asset}</div>)}{!selected.step.entryAssets?.length && !selected.step.affectedPages.length && <div className="text-xs text-charcoal-500">AI will confirm the exact asset during execution.</div>}</div></div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Stage action / CTA</div><p className="mt-2 text-xs font-semibold leading-5 text-emerald-950">{selected.step.conversionAction ?? selected.step.recommendedAction}</p></div>
                <div className="grid place-items-center text-xl font-black text-brand-500">→</div>
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Handoff to next stage</div><p className="mt-2 text-xs font-semibold leading-5 text-brand-950">{selected.step.handoffToNext ?? selected.step.whyNow}</p></div>
              </div>
              <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-violet-700">AI-recommended improvement</div><p className="mt-2 text-sm font-bold leading-6 text-violet-950">{selected.step.recommendedAction}</p><p className="mt-2 text-xs leading-5 text-violet-800">{selected.step.confidenceReason}</p></div>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-900"><b>What happens after approval:</b> AI prepares the recommended assets and implementation instructions in {selected.step.destination.replaceAll("_", " ")}. Public or protected changes remain review-gated, and the saved success measure is used for validation.</div>
              <button type="button" onClick={() => onNavigate(funnelDestinationUrl(selected.step, projectId))} className="mt-4 rounded-lg bg-brand-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-700">Improve This Stage →</button>
            </>}
          </div>
        </div>
      </Card>

      <Card className="hidden overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6"><div className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Guided growth journey</div><h2 className="mt-1 text-xl font-black text-charcoal-950">{aiEvaluated ? "AI has prioritized what happens first, next, and later" : "This Strategy version provides a preliminary execution order"}</h2><p className="mt-1 max-w-4xl text-sm leading-6 text-charcoal-500">{funnel.summary}</p></div>
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
          <div className="border-b border-slate-100 p-5 lg:border-b-0 lg:border-r sm:p-6">
            <div className="space-y-0">
              {stepStates.map((item, index) => {
                const status = statusFor(item, index);
                const active = selected?.step.key === item.step.key;
                return <div key={item.step.key} className="relative flex gap-3 pb-5 last:pb-0">{index < stepStates.length - 1 && <span className="absolute left-[17px] top-9 h-[calc(100%-28px)] w-px bg-slate-200"/>}<button type="button" onClick={() => setSelectedKey(item.step.key)} className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black ${item.complete ? "bg-emerald-600 text-white" : active ? "bg-brand-600 text-white ring-4 ring-brand-100" : "border border-slate-200 bg-white text-charcoal-500"}`}>{status.marker}</button><button type="button" onClick={() => setSelectedKey(item.step.key)} className={`min-w-0 flex-1 rounded-xl border p-3 text-left transition ${active ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-200"}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="font-bold text-charcoal-950">Step {index + 1} · {item.step.title}</div><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${status.tone}`}>{status.label}</span></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-charcoal-500">{item.step.objective}</p>{item.step.affectedPages.length > 0 && <div className="mt-2 text-[11px] font-bold text-brand-700">{item.step.affectedPages.length} affected page{item.step.affectedPages.length === 1 ? "" : "s"}</div>}</button></div>;
              })}
            </div>
          </div>
          <div className="bg-slate-50/60 p-5 sm:p-6">
            {selected && <><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-brand-700">{aiEvaluated ? "AI priority detail" : "Strategy priority detail"}</span><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold capitalize text-charcoal-600 ring-1 ring-slate-200">{selected.step.effort} effort</span><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-charcoal-600 ring-1 ring-slate-200">{selected.step.confidence}% confidence</span></div><h3 className="mt-3 text-xl font-black text-charcoal-950">{selected.step.title}</h3><p className="mt-2 text-sm leading-6 text-charcoal-600">{selected.step.recommendedAction}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Why this position</div><p className="mt-2 text-xs leading-5 text-charcoal-600">{selected.step.whyNow}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Expected impact</div><p className="mt-2 text-xs leading-5 text-charcoal-600">{selected.step.expectedImpact}</p></div></div><div className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">What SEnuke AI - AI Growth Operating System will work through</div><div className="mt-2 space-y-2">{selected.step.details.map((detail) => <div key={detail} className="flex gap-2 text-xs leading-5 text-charcoal-600"><span className="font-black text-emerald-600">✓</span><span>{detail}</span></div>)}</div></div>{selected.step.affectedPages.length > 0 && <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Affected pages</div><div className="mt-2 max-h-36 space-y-1 overflow-y-auto">{selected.step.affectedPages.map((url) => <div key={url} className="truncate text-xs font-semibold text-brand-700" title={url}>{url}</div>)}</div></div>}<div className="mt-4 rounded-xl border border-violet-100 bg-violet-50 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-violet-700">{aiEvaluated ? "Why AI is confident" : "Confidence basis"}</div><p className="mt-2 text-xs leading-5 text-violet-900">{selected.step.confidenceReason}</p><div className="mt-3 flex flex-wrap gap-2">{selected.step.sourceSignals.map((signal) => <span key={signal} className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-violet-700 ring-1 ring-violet-100">{signal}</span>)}</div></div><button type="button" onClick={() => onNavigate(funnelDestinationUrl(selected.step, projectId))} className="mt-4 rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-xs font-bold text-brand-700 hover:bg-brand-50">Open {selected.step.title} workspace →</button></>}
          </div>
        </div>
      </Card>
    </div>
  );
}

function PlanList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-charcoal-950">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="flex gap-2 text-sm leading-5 text-charcoal-600">
            <span className="font-bold text-emerald-600">✓</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Recommendation({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <IconBadge icon={icon} />
      <div>
        <div className="font-bold text-charcoal-950">{title}</div>
        <p className="mt-1 text-sm leading-6 text-charcoal-600">{text}</p>
      </div>
    </div>
  );
}

function OpportunitySummaryStrip({ project, niche }: { project: GuidedProject; niche: string }) {
  const items = [
    { label: "Type", value: projectTypeLabel(project) },
    { label: "Niche", value: niche },
    { label: "Audience", value: project.businessProfile?.targetAudience || "Not provided" },
    { label: "Goal", value: project.primaryGoal || "Not provided" },
    { label: "Budget", value: project.businessProfile?.budgetLevel || "Not provided" },
    { label: "Publishing", value: project.preferredPublishingMethod || "Not provided" },
  ];

  return (
    <Card className="grid gap-0 overflow-hidden md:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="min-h-[58px] border-t border-slate-100 px-4 py-3 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">{item.label}</div>
          <div className="mt-1 truncate text-sm font-bold leading-5 text-charcoal-950" title={item.value}>
            {item.value}
          </div>
        </div>
      ))}
    </Card>
  );
}

function KeywordScreen({ data }: { data: ModuleData }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const project = data.projects[0];
  const website = data.websites[0];
  const siteAnalysisInProgress = hasActiveSiteAnalysis(project, website);
  const activeCrawlStatus = [
    ...((project?.website as ({ crawlJobs?: Website["crawlJobs"] } | undefined))?.crawlJobs ?? []),
    ...(website?.crawlJobs ?? []),
  ].find((crawl) => crawl.status === "queued" || crawl.status === "running")?.status ?? "running";
  const successfulRuns = latestSuccessfulKeywordRuns(data.keywordRuns);
  const processingRuns = data.keywordRuns.filter((run) => ["queued", "pending", "running", "processing", "in_progress"].includes(run.status.toLowerCase()));
  const keywordAnalysisProcessing = processingRuns.length > 0;
  const [groups, setGroups] = useState(project?.keywordGroups ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [manualSeed, setManualSeed] = useState("");
  const [showGroupManagement, setShowGroupManagement] = useState(false);
  const [showKeywordAttentionDetails, setShowKeywordAttentionDetails] = useState(false);
  const [resultsTab, setResultsTab] = useState<"keywords" | "competitors">("keywords");
  const [marketFilter, setMarketFilter] = useState("");
  const [seedFilter, setSeedFilter] = useState("");
  const [selectedRelatedKeywords, setSelectedRelatedKeywords] = useState<Record<string, { keyword: string; category: "primary" | "supporting_topics" }>>({});
  const [keywordResultPage, setKeywordResultPage] = useState(1);
  const [aiIdeasOpen, setAiIdeasOpen] = useState(false);
  const [aiIdeaPrompt, setAiIdeaPrompt] = useState("");
  const [aiKeywordPreview, setAiKeywordPreview] = useState<{ category: string; title: string; keywords: string[] }[]>([]);
  const [selectedAiKeywords, setSelectedAiKeywords] = useState<string[]>([]);
  const [aiPreviewBusy, setAiPreviewBusy] = useState(false);
  const [aiIdeasMessage, setAiIdeasMessage] = useState("");
  const [manualKeywords, setManualKeywords] = useState("");
  const [manualCategory, setManualCategory] = useState("supporting");
  const [manualGroupTitle, setManualGroupTitle] = useState("Supporting Topics");
  const [manualGroupId, setManualGroupId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<NonNullable<GuidedProject["keywordGroups"]>[number] | null>(null);
  const [editingKeywords, setEditingKeywords] = useState("");
  const automaticGenerationProjectId = useRef<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const marketOptions = keywordMarketOptions(successfulRuns);
  const projectGeographies = [...new Set([
    ...(Array.isArray(project?.targetLocations) ? project.targetLocations : []),
    project?.targetLocation,
  ].filter((item): item is string => typeof item === "string").flatMap((item) => item.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean)))];
  const marketRuns = marketFilter ? successfulRuns.filter((run) => keywordMarketKey(run.locationName) === marketFilter) : successfulRuns;
  const seedOptions = [...new Set(marketRuns.map((run) => run.seedKeyword).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const runs = seedFilter ? marketRuns.filter((run) => run.seedKeyword === seedFilter) : marketRuns;
  const groupKeywords = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    const locations = new Set((Array.isArray(project?.targetLocations) ? project.targetLocations : []).map(String).map((item) => item.trim().toLocaleLowerCase()));
    return [...new Set(splitKeywordEntries(value).filter((part) => {
      const normalized = part.toLocaleLowerCase().replace(/[.!]+$/, "").trim();
      if (!normalized || locations.has(normalized)) return false;
      if (/^(?:and|or)\b|^(?:and\s+)?others?\b/.test(normalized)) return false;
      if (/\bincluding\s+\S+$/.test(normalized)) return false;
      return !(/^(find|explore|create|suggest|expand|generate)\b/i.test(part) && /\b(keywords?|topics?|ideas?)\b/i.test(part) && part.split(/\s+/).length > 6);
    }))] ;
  };
  const updateFromProject = (next: GuidedProject) => setGroups(next.keywordGroups ?? []);
  const generate = async (regenerate = false, seed?: string, append = false, expansion = false) => {
    if (!project || busy || siteAnalysisInProgress) return;
    setBusy(regenerate ? "regenerate" : "generate");
    setMessage("");
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/generate`, { regenerate, append, manualSeed: expansion ? null : seed || null, expansionInstruction: expansion ? seed || null : null });
      updateFromProject(result.project);
      setManualSeed("");
      setMessage(append ? "Additional keyword ideas were added to the existing groups." : regenerate ? "Keyword recommendations regenerated from the latest project information." : "Keyword recommendations generated automatically from project intake.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Keyword recommendations could not be generated.");
    } finally { setBusy(null); }
  };
  useEffect(() => {
    const incomingGroups = project?.keywordGroups ?? [];
    setGroups(incomingGroups);
    if (project && !siteAnalysisInProgress && incomingGroups.length === 0 && automaticGenerationProjectId.current !== project.id) {
      automaticGenerationProjectId.current = project.id;
      void generate(false);
    }
  }, [project?.id, siteAnalysisInProgress]);
  useEffect(() => {
    if (searchParams.get("manageKeywords") === "1") {
      setShowGroupManagement(true);
      window.setTimeout(() => document.getElementById("keyword-group-management")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }, [searchParams]);
  useEffect(() => {
    if (marketFilter && !marketOptions.some((option) => option.value === marketFilter)) setMarketFilter("");
  }, [marketFilter, marketOptions]);
  useEffect(() => {
    if (seedFilter && !seedOptions.includes(seedFilter)) setSeedFilter("");
  }, [seedFilter, seedOptions]);
  useEffect(() => { setKeywordResultPage(1); }, [marketFilter, seedFilter]);
  const approve = async (groupId: string) => {
    if (!project) return;
    setBusy(groupId);
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/${groupId}/approve`, {});
      updateFromProject(result.project);
      navigate(`/keywords?projectId=${encodeURIComponent(project.id)}&groupId=${encodeURIComponent(groupId)}`, { replace: true });
      setMessage("Keyword group approved. Start Keyword Analysis to load demand, difficulty, CPC, ranking, competitor, and page-target data.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Approval failed."); } finally { setBusy(null); }
  };
  const editGroup = (group: NonNullable<GuidedProject["keywordGroups"]>[number]) => {
    setEditingGroup(group);
    setEditingKeywords(groupKeywords(group.keywords).join("\n"));
  };
  const saveGroupEdits = async () => {
    if (!project || !editingGroup) return;
    const keywords = editingKeywords.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
    if (!keywords.length) return setMessage("Keep at least one keyword in the group.");
    setBusy(editingGroup.id);
    try {
      const result = await api.patch<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/${editingGroup.id}`, { keywords });
      updateFromProject(result.project);
      setEditingGroup(null);
      setMessage("Keyword edits saved and recorded in Activity History.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Changes could not be saved."); } finally { setBusy(null); }
  };
  const removeKeyword = async (group: NonNullable<GuidedProject["keywordGroups"]>[number], keyword: string) => {
    if (!project || busy) return;
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    const keywords = groupKeywords(group.keywords).filter((item) => item.trim().toLocaleLowerCase() !== normalizedKeyword);
    if (!groupKeywords(keywords).length) { setMessage("A keyword group must keep at least one keyword. Delete or replace the group through Edit Group instead."); return; }
    setBusy(group.id);
    setMessage("");
    try {
      const result = await api.patch<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/${group.id}`, { keywords });
      updateFromProject(result.project);
      setMessage(`Removed “${keyword}” from ${group.title}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The keyword could not be removed."); }
    finally { setBusy(null); }
  };
  const openAddKeywords = (category = "supporting", groupTitle = "Supporting Topics", groupId: string | null = null) => {
    if (siteAnalysisInProgress) return;
    setManualCategory(category);
    setManualGroupTitle(groupTitle);
    setManualGroupId(groupId);
    setManualKeywords("");
    setAiIdeaPrompt("");
    setAiKeywordPreview([]);
    setSelectedAiKeywords([]);
    setAiIdeasMessage("");
    setAiIdeasOpen(true);
  };
  const addManual = async () => {
    if (!project) return;
    const baseKeywords = manualKeywords.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
    const keywords = [...new Set(baseKeywords)];
    if (!keywords.length) return;
    setBusy("manual");
    setAiIdeasMessage("");
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/manual`, { keywords, category: manualCategory, groupId: manualGroupId });
      updateFromProject(result.project);
      setAiIdeasOpen(false);
      setMessage(`${keywords.length} keyword${keywords.length === 1 ? "" : "s"} added to ${manualGroupTitle}.`);
    } catch (error) { setAiIdeasMessage(error instanceof Error ? error.message : "Manual keywords could not be added."); } finally { setBusy(null); }
  };
  const addSelectedRelatedKeywords = async () => {
    const selected = Object.values(selectedRelatedKeywords);
    if (!project || !selected.length) return;
    setBusy("related-keywords");
    setMessage("");
    try {
      const primaryGroup = groups.find((group) => group.category.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_") === "primary");
      const supportingGroup = groups.find((group) => ["supporting", "supporting_topics", "secondary", "secondary_keywords"].includes(group.category.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_")));
      let updatedProject: GuidedProject | null = null;
      for (const destination of ["primary", "supporting_topics"] as const) {
        const keywords = selected.filter((item) => item.category === destination).map((item) => item.keyword);
        if (!keywords.length) continue;
        const group = destination === "primary" ? primaryGroup : supportingGroup;
        const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/manual`, {
          keywords,
          category: group?.category ?? destination,
          groupId: group?.id ?? null,
        });
        updatedProject = result.project;
      }
      if (updatedProject) updateFromProject(updatedProject);
      const primaryCount = selected.filter((item) => item.category === "primary").length;
      const secondaryCount = selected.length - primaryCount;
      setSelectedRelatedKeywords({});
      setMessage(`${selected.length} related keyword${selected.length === 1 ? " was" : "s were"} added (${primaryCount} Primary · ${secondaryCount} Secondary). Approved additions now feed Keyword Intelligence and will enter SEO planning after their direct analysis is complete.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The selected related keywords could not be added.");
    } finally {
      setBusy(null);
    }
  };
  const refreshRun = async (run: KeywordResearchRun) => {
    if (!canRefreshKeyword(run)) return;
    setRefreshingId(run.id);
    try {
      const result = await api.post<{ run: KeywordResearchRun }>("/api/keyword-research/" + run.id + "/refresh", {});
      window.location.href = "/keyword-insights/" + result.run.id;
    } finally {
      setRefreshingId(null);
    }
  };
  if (!groups.length && !successfulRuns.length) {
    return (
      <Card className="p-6">
        <h2 className="text-xl font-bold text-charcoal-950">Preparing keyword recommendations</h2>
        <p className="mt-2 text-sm leading-6 text-charcoal-600">SEnuke AI - AI Growth Operating System starts with project intake, goals, markets, competitors, and the selected opportunity. A manual seed is only needed when that information is insufficient.</p>
        {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</div>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={manualSeed} onChange={(event) => setManualSeed(event.target.value)} placeholder="Fallback manual seed keyword" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"/><button type="button" disabled={busy !== null || manualSeed.trim().length < 2} onClick={() => void generate(false, manualSeed)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">{busy ? "Generating…" : "Generate from seed"}</button></div>
      </Card>
    );
  }
  const keywordDetailTo = (run: KeywordResearchRun, keyword: string) => {
    const query = new URLSearchParams();
    if (project?.id) query.set("projectId", project.id);
    query.set("keyword", keyword);
    return `/keyword-insights/${run.id}?${query.toString()}`;
  };
  const approvedKeywordGroup = new Map(groups.flatMap((group) => groupKeywords(group.keywords).map((keyword) => [keyword.toLocaleLowerCase(), group] as const)));
  const allKeywordRows = keywordRows(runs, (run, keyword) => (
    <div className="flex justify-end gap-3">
      <ActionIconLink icon="view" label={`View analysis for ${keyword}`} to={keywordDetailTo(run, keyword)} />
      <ActionIconButton
        icon="refresh"
        label={refreshingId === run.id ? "Refreshing keyword" : canRefreshKeyword(run) ? "Refresh keyword" : refreshBlockedLabel(run)}
        onClick={() => void refreshRun(run)}
        disabled={refreshingId === run.id || !canRefreshKeyword(run)}
      />
    </div>
  ), (_run, keyword) => {
    const key = keyword.toLocaleLowerCase();
    const approvedGroup = approvedKeywordGroup.get(key);
    const selection = selectedRelatedKeywords[key];
    const choose = (category: "primary" | "supporting_topics", checked: boolean) => setSelectedRelatedKeywords((current) => {
      const next = { ...current };
      if (checked) next[key] = { keyword, category };
      else if (next[key]?.category === category) delete next[key];
      return next;
    });
    const approvedCategory = approvedGroup?.category.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
    return <div><span className="block font-bold text-brand-700">{keyword}</span>{approvedGroup ? <div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Already in {approvedCategory === "primary" ? "Primary" : "Secondary"}</span><button type="button" onClick={() => void removeKeyword(approvedGroup, keyword)} disabled={busy === approvedGroup.id} className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[10px] font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50">{busy === approvedGroup.id ? "Removing…" : "Remove"}</button></div> : <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-black uppercase tracking-wide text-charcoal-600"><label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={selection?.category === "primary"} onChange={(event) => choose("primary", event.target.checked)} />Primary</label><label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={selection?.category === "supporting_topics"} onChange={(event) => choose("supporting_topics", event.target.checked)} />Secondary</label></div>}</div>;
  });
  const keywordResultPageSize = 25;
  const keywordResultPageCount = Math.max(1, Math.ceil(allKeywordRows.length / keywordResultPageSize));
  const currentKeywordResultPage = Math.min(keywordResultPage, keywordResultPageCount);
  const keywordResultStart = (currentKeywordResultPage - 1) * keywordResultPageSize;
  const keywordResultRows = allKeywordRows.slice(keywordResultStart, keywordResultStart + keywordResultPageSize);
  const keywordPagination = <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs font-semibold text-charcoal-500">Showing {allKeywordRows.length ? keywordResultStart + 1 : 0}–{Math.min(keywordResultStart + keywordResultPageSize, allKeywordRows.length)} of {allKeywordRows.length} related keyword result{allKeywordRows.length === 1 ? "" : "s"}</div><div className="flex items-center gap-2"><button type="button" onClick={() => setKeywordResultPage((page) => Math.max(1, page - 1))} disabled={currentKeywordResultPage <= 1} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-charcoal-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button><span className="min-w-[92px] text-center text-xs font-black text-charcoal-600">Page {currentKeywordResultPage} of {keywordResultPageCount}</span><button type="button" onClick={() => setKeywordResultPage((page) => Math.min(keywordResultPageCount, page + 1))} disabled={currentKeywordResultPage >= keywordResultPageCount} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-charcoal-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></div>;
  const topRun = runs[0];
  const analyzedKeywords = [...new Set(runs.map((run) => run.seedKeyword).filter(Boolean))];
  const analyzedLocations = [...new Set(runs.map((run) => run.locationName).filter(Boolean))];
  const approvedCount = groups.filter((group) => group.status === "approved").length;
  const focusedGroupId = searchParams.get("groupId");
  const analysisGroupId = focusedGroupId ?? groups.find((group) => group.status === "approved")?.id ?? null;
  const analysisGroupIds = groups.filter((group) => group.status === "approved").map((group) => group.id);
  const approvedKeywordDirections = [...new Map(groups
    .filter((group) => group.status === "approved")
    .flatMap((group) => groupKeywords(group.keywords))
    .map((keyword) => [keyword.toLocaleLowerCase(), keyword])).values()];
  const keywordAnalysisLocations = project ? projectAnalysisLocations(project).locationNames : [];
  const keywordMarketSetupRequired = approvedKeywordDirections.length > 0 && keywordAnalysisLocations.length === 0;
  const fixedResearchKeywords = keywordResearchScopeKeywords(groups, data.keywordRuns);
  const expectedKeywordChecks = expectedApprovedKeywordResearchChecks([{ status: "approved", keywords: fixedResearchKeywords }], keywordAnalysisLocations);
  const incompleteKeywordChecks = incompleteApprovedKeywordResearchChecks(groups, data.keywordRuns, keywordAnalysisLocations);
  const completedRequiredKeywordChecks = Math.max(0, expectedKeywordChecks.length - incompleteKeywordChecks.length);
  const incompleteKeywordSet = new Set(incompleteKeywordChecks.map((check) => normalizeKeywordPhrase(check.keyword)));
  const missingApprovedKeywords = approvedKeywordDirections.filter((keyword) => incompleteKeywordSet.has(normalizeKeywordPhrase(keyword)));
  const keywordAttentionStatuses = new Set(["failed", "cancelled", "canceled"]);
  const approvedKeywordSet = new Set(approvedKeywordDirections.map(normalizeKeywordPhrase));
  const latestKeywordLocationRuns = [...data.keywordRuns]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .reduce((latest, run) => {
      const identity = keywordResearchRequestIdentity({ keyword: run.seedKeyword, location: run.locationName, languageCode: run.languageCode, device: run.device });
      if (!latest.has(identity)) latest.set(identity, run);
      return latest;
    }, new Map<string, KeywordResearchRun>());
  const failedKeywordLocationRuns = [...latestKeywordLocationRuns.values()].filter((run) =>
    approvedKeywordSet.has(normalizeKeywordPhrase(run.seedKeyword))
    && keywordAttentionStatuses.has(run.status.toLocaleLowerCase())
  );
  const failedKeywordAttentionRows = failedKeywordLocationRuns.map((failedRun) => {
    const normalized = normalizeKeywordPhrase(failedRun.seedKeyword);
    const sourceGroup = groups.find((group) => groupKeywords(group.keywords).some((item) => normalizeKeywordPhrase(item) === normalized));
    return {
      id: failedRun.id,
      keyword: failedRun.seedKeyword,
      location: failedRun.locationName,
      sourceGroup,
      issue: failedRun.error ? failedRun.error.slice(0, 220) : "The provider could not complete this keyword-location check.",
    };
  });
  const failedKeywordLocationChecks = failedKeywordAttentionRows.length;
  const retryingFailedKeywords = failedKeywordLocationChecks > 0;
  const totalApprovedKeywords = approvedKeywordDirections.length;
  const analysisWebsiteId = website?.id ?? project?.websiteId ?? project?.website?.id ?? null;
  const keywordAnalysisTo = analysisWebsiteId
    ? `/keyword-insights?project=${encodeURIComponent(analysisWebsiteId)}&projectId=${encodeURIComponent(project?.id ?? "")}${analysisGroupIds.length ? `&groupIds=${encodeURIComponent(analysisGroupIds.join(","))}` : analysisGroupId ? `&groupId=${encodeURIComponent(analysisGroupId)}` : ""}&add=1&remaining=1`
    : `/keyword-insights?projectId=${encodeURIComponent(project?.id ?? "")}${analysisGroupIds.length ? `&groupIds=${encodeURIComponent(analysisGroupIds.join(","))}` : analysisGroupId ? `&groupId=${encodeURIComponent(analysisGroupId)}` : ""}&add=1&remaining=1`;
  const keywordReportsTo = keywordAnalysisTo.replace("&add=1&remaining=1", "");
  const failedKeywordAnalysisTo = `${keywordAnalysisTo}&failed=1`;
  const keywordReportsReady = !keywordMarketSetupRequired && expectedKeywordChecks.length > 0 && runs.length > 0 && !keywordAnalysisProcessing && missingApprovedKeywords.length === 0 && failedKeywordLocationChecks === 0;
  const existingWebsiteFlow = isExistingWebsiteFlow(project, website);
  const preLaunchWebsiteFlow = Boolean(project && ["new_website_required", "website_planned"].includes(project.websiteStatus ?? "") && !existingWebsiteFlow);
  const siteAnalysisComplete = hasCompletedSiteAnalysis(data, project, website);
  const completedKeywordNextRoute = existingWebsiteFlow
    ? siteAnalysisComplete
      ? `/gap-analysis?projectId=${encodeURIComponent(project?.id ?? "")}`
      : `/site-analysis?projectId=${encodeURIComponent(project?.id ?? "")}`
    : `/site-architect?projectId=${encodeURIComponent(project?.id ?? "")}&step=foundation`;
  const completedKeywordNextLabel = existingWebsiteFlow
    ? siteAnalysisComplete ? "Continue to SEO & Gap Analysis" : "Continue to Site Analysis"
    : "Review Website Plan";
  const completedKeywordNextDescription = existingWebsiteFlow
    ? siteAnalysisComplete
      ? "Site Analysis is already complete. Continue to SEO & Gap Analysis to map every approved keyword to the most relevant existing page."
      : "Continue to Site Analysis so every approved keyword can be compared with the live website and mapped to the right page."
    : "Keyword analysis is complete. Review how every approved Primary and Secondary keyword is assigned to the governed Website Plan before approving the next Strategy version.";
  const audience = project?.businessProfile?.targetAudience || "the project audience";
  const offer = project?.businessProfile?.offerSummary || project?.niche || project?.businessName || project?.name || "the project offer";
  const markets = projectGeographies;
  const manualKeywordCombinations = [...new Set(manualKeywords.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
  const selectedOpportunity = project?.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status))?.name;
  const aiPromptIdeas = [
    `Find high-intent service and purchase keywords for ${offer}.`,
    `Explore long-tail questions and problems searched by ${audience}.`,
    markets.length ? `Create local keyword opportunities for ${markets.slice(0, 4).join(", ")}.` : "Find location-based keyword opportunities for this project.",
    selectedOpportunity ? `Expand keyword themes supporting the selected opportunity: ${selectedOpportunity}.` : `Find keyword gaps that support the primary goal: ${project?.primaryGoal || "business growth"}.`,
    `Suggest related topics that are not already covered by the existing keyword groups.`,
  ];
  const openAiIdeas = () => {
    if (siteAnalysisInProgress) return;
    openAddKeywords();
    setAiIdeaPrompt(aiPromptIdeas[0]);
  };
  const aiSelectionKey = (category: string, keyword: string) => `${category}::${keyword}`;
  const previewAiKeywords = async () => {
    if (!project) return;
    setAiPreviewBusy(true);
    setAiIdeasMessage("");
    try {
      const baseInstruction = aiIdeaPrompt.trim() || "Generate relevant buyer-intent, service, topical, and long-tail keyword opportunities for this project.";
      const instruction = `${baseInstruction}${projectGeographies.length ? ` Use the project's saved markets (${projectGeographies.join(", ")}) as context. Do not append city, province, or country names to the seed keyword text.` : ""}`;
      const result = await api.post<{ groups: { category: string; title: string; keywords: string[] }[] }>(`/api/projects-v2/${project.id}/keyword-groups/preview`, {
        instruction,
        topic: aiIdeaPrompt.trim() || undefined,
        geographies: projectGeographies.length ? projectGeographies : undefined,
        supportingOnly: true,
      });
      const existing = new Set(groups.flatMap((group) => groupKeywords(group.keywords)).map((keyword) => keyword.toLowerCase()));
      const preview = result.groups.map((group) => ({ ...group, keywords: group.keywords.filter((keyword) => !existing.has(keyword.toLowerCase())) })).filter((group) => group.keywords.length);
      setAiKeywordPreview(preview);
      setSelectedAiKeywords(preview.flatMap((group) => group.keywords.map((keyword) => aiSelectionKey(group.category, keyword))));
    } catch (error) { setAiIdeasMessage(error instanceof Error ? error.message : "Keyword preview could not be generated."); }
    finally { setAiPreviewBusy(false); }
  };
  const addSelectedAiKeywords = async () => {
    if (!project || !selectedAiKeywords.length) return;
    setAiPreviewBusy(true);
    setAiIdeasMessage("");
    try {
      const keywords = [...new Set(aiKeywordPreview.flatMap((group) => group.keywords.filter((keyword) => selectedAiKeywords.includes(aiSelectionKey(group.category, keyword)))))].slice(0, 50);
      if (!keywords.length) throw new Error("Select at least one keyword to add.");
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/manual`, { category: manualCategory, groupId: manualGroupId, keywords });
      updateFromProject(result.project);
      setAiIdeasOpen(false);
      setMessage(`${keywords.length} selected supporting keyword${keywords.length === 1 ? " was" : "s were"} added to ${manualGroupTitle}.`);
    } catch (error) { setAiIdeasMessage(error instanceof Error ? error.message : "Selected keywords could not be added."); }
    finally { setAiPreviewBusy(false); }
  };
  return (
    <>
      {siteAnalysisInProgress && <Card className="border-amber-300 bg-gradient-to-r from-amber-50 via-white to-brand-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600" aria-hidden="true" />
            <div>
              <div className="text-sm font-black text-amber-950">Site Analysis is {activeCrawlStatus}</div>
              <p className="mt-1 text-xs leading-5 text-amber-800">Add Keywords, Ask AI for More Ideas, and Regenerate are paused until the crawl finishes. This keeps one stable keyword direction while page evidence is collected. They will unlock automatically.</p>
            </div>
          </div>
          <Link to={`/site-analysis?projectId=${encodeURIComponent(project?.id ?? "")}`} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-50">View Site Analysis progress →</Link>
        </div>
      </Card>}
      <Card className={`${keywordAnalysisProcessing ? "border-amber-300 bg-gradient-to-r from-amber-50 via-white to-brand-50" : keywordReportsReady ? "border-emerald-300 bg-gradient-to-r from-emerald-50 via-white to-brand-50" : retryingFailedKeywords && !keywordMarketSetupRequired ? "border-rose-200 bg-gradient-to-r from-rose-50 via-white to-amber-50" : approvedCount > 0 ? "border-brand-200 bg-gradient-to-r from-brand-50 via-white to-emerald-50" : ""} p-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className={`text-xs font-bold uppercase tracking-wide ${keywordAnalysisProcessing ? "text-amber-700" : keywordReportsReady ? "text-emerald-700" : retryingFailedKeywords ? "text-rose-700" : "text-brand-600"}`}>Keyword Intelligence</div>
            <h2 className="mt-1 text-lg font-bold text-charcoal-950">{keywordAnalysisProcessing ? "Keyword analysis is in progress" : keywordReportsReady ? "Keyword reports are ready" : keywordMarketSetupRequired ? "Choose target areas for keyword analysis" : retryingFailedKeywords ? `${failedKeywordLocationChecks} keyword-location check${failedKeywordLocationChecks === 1 ? " needs" : "s need"} a retry` : approvedCount > 0 ? "Approved direction ready for analysis" : "Approve and manage keyword direction"}</h2>
            <p className="mt-1 text-sm leading-6 text-charcoal-600">{keywordAnalysisProcessing ? "SEnuke AI - AI Growth Operating System is collecting demand, competition, CPC, intent and SERP competitor signals. You can leave this page and return to review completed reports." : keywordReportsReady ? "Every approved Primary and Secondary keyword has been analyzed. Open the reports to review market demand, competition, CPC, intent and SERP opportunities." : keywordMarketSetupRequired ? `Select at least one exact city, region, or country for the ${totalApprovedKeywords} approved keyword${totalApprovedKeywords === 1 ? "" : "s"}. SEnuke AI will then calculate the required keyword-market checks before analysis starts.` : retryingFailedKeywords ? `The provider could not complete ${failedKeywordLocationChecks} exact keyword-location check${failedKeywordLocationChecks === 1 ? "" : "s"}. The completed checks are preserved; retry only the failed pairs.` : approvedCount > 0 ? `${incompleteKeywordChecks.length} exact market check${incompleteKeywordChecks.length === 1 ? "" : "s"} across ${missingApprovedKeywords.length} approved keyword${missingApprovedKeywords.length === 1 ? " is" : "s are"} still waiting for analysis. Website and Strategy will use the complete approved set for page mapping.` : "Review, approve, edit, or add keywords before continuing."}</p>
            <p className="mt-1 text-xs font-semibold text-charcoal-500">{groups.length} groups · {approvedCount} approved · {totalApprovedKeywords} approved keywords · {keywordMarketSetupRequired ? "target areas not selected · required checks calculate after selection" : <>{completedRequiredKeywordChecks}/{expectedKeywordChecks.length} required checks complete · {retryingFailedKeywords ? `${failedKeywordLocationChecks} failed checks · ${missingApprovedKeywords.length} keywords still awaiting complete evidence` : `${incompleteKeywordChecks.length} remaining checks across ${missingApprovedKeywords.length} keywords`}</>} · {keywordAnalysisProcessing ? `${processingRuns.length} analysis run${processingRuns.length === 1 ? "" : "s"} processing` : keywordReportsReady ? `${runs.length} completed analysis run${runs.length === 1 ? "" : "s"}` : existingWebsiteFlow ? "existing website context" : "pre-launch market research"}</p>
          </div>
          {keywordAnalysisProcessing ? <Link to={keywordReportsTo} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-5 py-2.5 text-sm font-bold text-amber-800 shadow-sm hover:bg-amber-50"><span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600" />View analysis status →</Link> : keywordReportsReady ? <Link to={completedKeywordNextRoute} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700">{completedKeywordNextLabel} →</Link> : approvedCount > 0 ? <Link to={keywordMarketSetupRequired ? keywordAnalysisTo : retryingFailedKeywords ? failedKeywordAnalysisTo : keywordAnalysisTo} className={`inline-flex shrink-0 items-center justify-center rounded-lg px-5 py-2.5 text-sm font-bold text-white shadow-sm ${retryingFailedKeywords && !keywordMarketSetupRequired ? "bg-rose-700 hover:bg-rose-800" : "bg-brand-600 hover:bg-brand-700"}`}>{keywordMarketSetupRequired ? "Choose target areas" : retryingFailedKeywords ? `Review & Retry ${failedKeywordLocationChecks || missingApprovedKeywords.length} Failed Check${(failedKeywordLocationChecks || missingApprovedKeywords.length) === 1 ? "" : "s"}` : `Review & Start ${incompleteKeywordChecks.length} Remaining Check${incompleteKeywordChecks.length === 1 ? "" : "s"}`} →</Link> : null}
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-950 px-4 py-3 text-white">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500 text-xs font-black" aria-hidden="true">→</span>
          <div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-200">Next action</div><p className="mt-1 text-sm font-semibold leading-5 text-white">{keywordAnalysisProcessing ? "Let the current analysis finish, then review the completed keyword reports. You do not need to start another run." : keywordReportsReady ? completedKeywordNextDescription : keywordMarketSetupRequired ? "Choose the target areas this project should compete in. After you save them, review the calculated checks and start the analysis." : retryingFailedKeywords ? `Review and retry the ${failedKeywordLocationChecks} failed checks. Successful results will not be rerun.` : approvedCount > 0 ? `Analyze ${incompleteKeywordChecks.length} exact market check${incompleteKeywordChecks.length === 1 ? "" : "s"} for the ${missingApprovedKeywords.length} remaining approved keyword${missingApprovedKeywords.length === 1 ? "" : "s"}.` : "Review and approve the Primary and Secondary keyword groups before analysis begins."}</p></div>
        </div>
      </Card>
      {failedKeywordAttentionRows.length > 0 && !keywordAnalysisProcessing && <Card className="overflow-hidden border-rose-200">
        <div className={`flex flex-col gap-3 bg-rose-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${showKeywordAttentionDetails ? "border-b border-rose-100" : ""}`}>
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-rose-700">Keyword Intelligence · Needs attention</div>
            <h3 className="mt-1 text-base font-black text-rose-950">{failedKeywordAttentionRows.length} keyword-location check{failedKeywordAttentionRows.length === 1 ? " has" : "s have"} failed</h3>
            <p className="mt-1 text-xs leading-5 text-rose-800">Use the single retry action above. Open the details to see the exact keyword, location, and provider reason.</p>
          </div>
          <button type="button" onClick={() => setShowKeywordAttentionDetails((current) => !current)} aria-expanded={showKeywordAttentionDetails} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-white px-4 py-2.5 text-xs font-black text-rose-800 hover:bg-rose-100">{showKeywordAttentionDetails ? "Hide details" : `View ${failedKeywordAttentionRows.length} failure${failedKeywordAttentionRows.length === 1 ? "" : "s"}`}</button>
        </div>
        {showKeywordAttentionDetails && <div className="divide-y divide-slate-100">
          {failedKeywordAttentionRows.map((row) => <div key={row.id} className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(180px,.8fr)_minmax(170px,.65fr)_minmax(240px,1.2fr)_minmax(190px,.7fr)] md:items-start">
            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Keyword</div><div className="mt-1 text-sm font-black text-charcoal-900">{row.keyword}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{row.sourceGroup?.title ?? "Approved keywords"}</div></div>
            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Location</div><div className="mt-1 text-xs font-bold leading-5 text-charcoal-700">{row.location}</div></div>
            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">What is wrong</div><div className="mt-1 text-xs leading-5 text-charcoal-700">{row.issue}</div></div>
            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">How to resolve</div><div className="mt-1 text-xs font-bold leading-5 text-brand-700">Use Review & Retry Failed Checks above. Only this failed pair will be queued.</div>{row.sourceGroup && <div className="mt-2"><button type="button" onClick={() => void removeKeyword(row.sourceGroup!, row.keyword)} disabled={busy === row.sourceGroup.id} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-[10px] font-black text-rose-700 disabled:opacity-50">{busy === row.sourceGroup.id ? "Removing…" : "Remove keyword"}</button></div>}</div>
          </div>)}
        </div>}
      </Card>}
      {runs.length > 0 && <>
        <KeywordInsightsBanner data={data} runs={runs} analyzedKeywords={analyzedKeywords} analyzedLocations={analyzedLocations} language={topRun?.languageCode?.toUpperCase() || "EN"} />
        <Card className="p-2"><div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between"><div className="flex items-center gap-2"><button type="button" onClick={() => setResultsTab("keywords")} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${resultsTab === "keywords" ? "bg-brand-600 text-white shadow-sm" : "text-charcoal-600 hover:bg-slate-50"}`}>Related keyword ideas <span className={resultsTab === "keywords" ? "text-brand-100" : "text-charcoal-400"}>{seedOptions.length} seeds</span></button><button type="button" onClick={() => setResultsTab("competitors")} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${resultsTab === "competitors" ? "bg-brand-600 text-white shadow-sm" : "text-charcoal-600 hover:bg-slate-50"}`}>SERP Domains <span className={resultsTab === "competitors" ? "text-brand-100" : "text-charcoal-400"}>{uniqueSerpDomains(runs, website?.domain ?? project?.website?.domain).size}</span></button></div><div className="flex flex-col gap-2 sm:flex-row"><label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5"><span className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Seed keyword</span><select value={seedFilter} onChange={(event) => setSeedFilter(event.target.value)} className="min-w-[190px] bg-transparent text-sm font-bold text-charcoal-700 outline-none"><option value="">All analyzed seeds</option>{seedOptions.map((seed) => <option key={seed} value={seed}>{seed}</option>)}</select></label><label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5"><span className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Market</span><select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} className="min-w-[150px] bg-transparent text-sm font-bold text-charcoal-700 outline-none"><option value="">All markets</option>{marketOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div></div></Card>
        {resultsTab === "keywords" ? <div className="space-y-2"><div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-xs leading-5 text-charcoal-700"><b>How to read this:</b> a seed keyword is an approved phrase submitted for analysis. Each related idea below was returned while the seed shown in <b>Related to seed keyword</b> was analyzed. Mark each useful idea as <b>Primary</b> or <b>Secondary</b>. Approved selections become part of the shared keyword source used by SEO planning, Strategy, Local SEO, AI Citations, Website Development, and Growth.</div>{Object.keys(selectedRelatedKeywords).length > 0 && <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-black text-emerald-950">{Object.keys(selectedRelatedKeywords).length} related keyword{Object.keys(selectedRelatedKeywords).length === 1 ? "" : "s"} selected</div><div className="mt-0.5 text-xs leading-5 text-emerald-800">Primary and Secondary choices are saved separately. Newly approved phrases must complete direct keyword analysis before evidence-dependent SEO work is considered ready.</div></div><button type="button" onClick={() => void addSelectedRelatedKeywords()} disabled={busy === "related-keywords"} className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50">{busy === "related-keywords" ? "Adding…" : "Add selected keywords →"}</button></div>}<div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs leading-5 text-charcoal-600"><b>Search data note:</b> repeated low-volume estimates such as 10 can be returned for several keywords. A dash means the metric was not available. Opportunity is shown only when both search volume and SEO difficulty are available.</div><DataTable title={seedFilter ? `Related keyword ideas for “${seedFilter}”` : "Related keyword ideas grouped by their analyzed seed"} columns={["Related keyword idea · add as", "Related to seed keyword", "Location & metric scope", "Search volume", "SEO difficulty", "CPC", "Opportunity", "Seed rank", "Actions"]} rows={keywordResultRows} footerAction={keywordPagination} /></div> : <KeywordCompetitorAnalysis runs={runs} projectCompetitors={Array.isArray(project?.competitors) ? project.competitors.map(String).filter((item) => item && item !== "[object Object]") : []} ownDomain={website?.domain ?? project?.website?.domain ?? null} />}
      </>}
      {message && !message.startsWith("Keyword group approved.") && <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700">{message}</div>}
      {runs.length > 0 && showGroupManagement && <div id="keyword-group-management" className="flex scroll-mt-4 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4"><div><div className="text-sm font-bold text-charcoal-900">Keyword group management</div><div className="mt-1 text-xs text-charcoal-500">Add keywords, request more ideas, edit approvals, or regenerate recommendations.</div></div><button type="button" onClick={() => { setShowGroupManagement(false); const next = new URLSearchParams(searchParams); next.delete("manageKeywords"); navigate({ search: next.toString() }, { replace: true }); }} className="ml-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-charcoal-600">Close</button></div>}
      {(runs.length === 0 || showGroupManagement) && <>
      <div className="flex flex-col gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0 text-xs font-semibold leading-5 text-brand-800">{message?.startsWith("Keyword group approved.") ? message : "Manage the approved keyword direction before starting or refreshing analysis."}</div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => openAddKeywords()} disabled={busy !== null || siteAnalysisInProgress} title={siteAnalysisInProgress ? "Available when Site Analysis finishes" : undefined} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">Add Keywords</button><button type="button" onClick={openAiIdeas} disabled={busy !== null || siteAnalysisInProgress} title={siteAnalysisInProgress ? "Available when Site Analysis finishes" : undefined} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">Ask AI for More Ideas</button><button type="button" onClick={() => { if (window.confirm("Regenerate recommendations from the latest intake? Existing approvals will be reset.")) void generate(true); }} disabled={busy !== null || siteAnalysisInProgress} title={siteAnalysisInProgress ? "Available when Site Analysis finishes" : undefined} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">{busy === "regenerate" ? "Regenerating…" : "Regenerate"}</button></div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.map((group) => { const keywords = groupKeywords(group.keywords); const gaps = groupKeywords(group.gapKeywords); const focused = focusedGroupId === group.id; return <Card id={`keyword-group-${group.id}`} key={group.id} className={`flex flex-col p-5 transition ${focused ? "border-brand-500 ring-2 ring-brand-200" : group.status === "approved" ? "border-emerald-300 bg-emerald-50/30" : ""}`}><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">{group.status === "approved" ? "Approved · Manage group" : "Recommended"}</div><h3 className="mt-1 text-lg font-bold text-charcoal-950">{group.title}</h3></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-charcoal-600">{keywords.length}</span></div><p className="mt-3 text-sm leading-6 text-charcoal-600">{group.explanation}</p><div className="mt-3 rounded-lg bg-white p-3 text-xs leading-5 text-charcoal-600"><b>Expected value:</b> {group.expectedValue}<br/><b>Goal:</b> {group.goalSupport}</div><div className="mt-4 flex flex-wrap gap-2">{keywords.map((keyword) => <span key={keyword} className={`inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-xs font-semibold ${gaps.includes(keyword) ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-charcoal-700"}`}><span>{keyword}{gaps.includes(keyword) ? " · gap" : ""}</span><button type="button" onClick={() => void removeKeyword(group, keyword)} disabled={busy !== null} aria-label={`Remove ${keyword}`} title="Remove keyword" className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-sm font-black leading-none hover:bg-white hover:text-rose-600 disabled:opacity-40">×</button></span>)}</div><div className="mt-auto grid grid-cols-2 gap-2 pt-5"><button type="button" onClick={() => editGroup(group)} disabled={busy !== null} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">Edit Group</button><button type="button" onClick={() => openAddKeywords(group.category, group.title, group.id)} disabled={busy !== null || siteAnalysisInProgress} title={siteAnalysisInProgress ? "Available when Site Analysis finishes" : undefined} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">Add Keywords</button><button type="button" onClick={() => void approve(group.id)} disabled={busy !== null || group.status === "approved"} className="col-span-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300">{group.status === "approved" ? "Approved — Continue Managing" : busy === group.id ? "Approving…" : "Approve & Manage Group"}</button></div></Card>; })}</div>
      </>}
      {aiIdeasOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="keyword-ai-ideas-title"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-5"><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Project-aware keyword expansion</div><h2 id="keyword-ai-ideas-title" className="mt-1 text-xl font-bold text-charcoal-950">Ask AI for more keyword ideas</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">Preview actual keywords, select the useful phrases, and add only those selections to their relevant groups.</p></div>
        <div className="space-y-5 px-6 py-5">
          {aiIdeasMessage && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{aiIdeasMessage}</div>}
          <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
            <label><span className="text-xs font-bold uppercase tracking-wide text-charcoal-500">Enter base keywords</span><textarea value={manualKeywords} onChange={(event) => setManualKeywords(event.target.value)} rows={3} placeholder={"custom software development\nCRM implementation"} className="mt-2 w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"/><span className="mt-1 block text-xs text-charcoal-500">Type one per line or separate them with commas. Project locations are selected when you start Keyword Analysis and stay separate from the keyword text.</span>{manualKeywordCombinations.length > 0 && <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Keywords to add</div><div className="mt-2 flex flex-wrap gap-2">{manualKeywordCombinations.map((keyword) => <span key={keyword} className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900">{keyword}</span>)}</div></div>}</label>
          </div>
          {!aiKeywordPreview.length && <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wide text-charcoal-400">AI keyword direction</span><textarea value={aiIdeaPrompt} onChange={(event) => { setAiIdeaPrompt(event.target.value); setAiKeywordPreview([]); setSelectedAiKeywords([]); }} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" placeholder="Example: website development" /><span className="mt-1 block text-xs text-charcoal-500">Enter a supporting keyword direction, then click Generate AI Keyword List. Project locations are used automatically as AI context and are selected separately when running Keyword Analysis.</span>{aiPreviewBusy && <span className="mt-3 flex items-center gap-2 text-xs font-bold text-brand-700"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />Generating keyword suggestions…</span>}</label>}
          {aiKeywordPreview.length > 0 && <div><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Select supporting keywords to add</div><div className="mt-1 text-sm text-charcoal-600">{selectedAiKeywords.length} selected · the approved primary keyword direction remains unchanged</div></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setSelectedAiKeywords(aiKeywordPreview.flatMap((group) => group.keywords.map((keyword) => aiSelectionKey(group.category, keyword))))} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50">Check all</button><button type="button" onClick={() => setSelectedAiKeywords([])} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-charcoal-600 hover:bg-slate-50">Uncheck all</button><button type="button" onClick={() => { setAiIdeaPrompt(""); setAiKeywordPreview([]); setSelectedAiKeywords([]); }} className="px-2 py-2 text-sm font-bold text-brand-700">Change direction</button></div></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{aiKeywordPreview.map((group) => <div key={group.category} className="rounded-xl border border-slate-200 p-4"><div className="font-bold text-charcoal-900">{group.title}</div><div className="mt-3 space-y-2">{group.keywords.map((keyword) => { const key = aiSelectionKey(group.category, keyword); const selected = selectedAiKeywords.includes(key); return <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${selected ? "border-brand-300 bg-brand-50" : "border-slate-100 bg-white"}`}><input type="checkbox" checked={selected} onChange={() => setSelectedAiKeywords((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} className="mt-0.5"/><span className="font-semibold text-charcoal-800">{keyword}</span></label>; })}</div></div>)}</div></div>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setAiIdeasOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">Cancel</button>{manualKeywords.trim() && !aiKeywordPreview.length ? <button type="button" disabled={busy === "manual"} onClick={() => void addManual()} className="rounded-lg border border-brand-200 bg-white px-5 py-2.5 text-sm font-bold text-brand-700 disabled:opacity-50">{busy === "manual" ? "Adding…" : "Add My Keywords"}</button> : null}{aiKeywordPreview.length ? <button type="button" disabled={!selectedAiKeywords.length || aiPreviewBusy} onClick={() => void addSelectedAiKeywords()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{aiPreviewBusy ? "Adding…" : `Add Selected Keywords (${selectedAiKeywords.length})`}</button> : <button type="button" disabled={aiPreviewBusy} onClick={() => void previewAiKeywords()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{aiPreviewBusy ? "Generating preview…" : "Generate AI Keyword List"}</button>}</div>
      </div></div>}
      {editingGroup && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="edit-keyword-group-title"><div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 px-6 py-5"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Keyword group editor</div><h2 id="edit-keyword-group-title" className="mt-1 text-xl font-bold text-charcoal-950">Edit {editingGroup.title}</h2><p className="mt-1 text-sm text-charcoal-500">Add, remove, or revise keywords before approval.</p></div><button type="button" onClick={() => setEditingGroup(null)} disabled={busy === editingGroup.id} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-xl text-charcoal-500">×</button></div><div className="px-6 py-5"><label className="text-xs font-bold uppercase tracking-wide text-charcoal-500">Keywords</label><textarea value={editingKeywords} onChange={(event) => setEditingKeywords(event.target.value)} rows={12} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"/><div className="mt-2 flex justify-between text-xs text-charcoal-500"><span>One keyword per line, or separate with commas.</span><span>{editingKeywords.split(/[,;\n]/).filter((item) => item.trim()).length} keywords</span></div></div><div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4"><button type="button" onClick={() => setEditingGroup(null)} disabled={busy === editingGroup.id} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold">Cancel</button><button type="button" onClick={() => void saveGroupEdits()} disabled={busy === editingGroup.id || !editingKeywords.trim()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{busy === editingGroup.id ? "Saving…" : "Save Group"}</button></div></div></div>}
    </>
  );
}

function KeywordCompetitorAnalysis({ runs, projectCompetitors, ownDomain }: { runs: KeywordResearchRun[]; projectCompetitors: string[]; ownDomain: string | null }) {
  type CompetitorSummary = { domain: string; appearances: number; bestRank: number; scores: number[]; keywords: Set<string>; locations: Set<string>; missingTopics: Set<string>; exampleUrl: string; title: string | null };
  const normalizedOwnDomain = (ownDomain ?? "").replace(/^www\./, "").toLowerCase();
  const byDomain = new Map<string, CompetitorSummary>();
  for (const run of runs) {
    const seenInRun = new Set<string>();
    for (const competitor of run.competitors ?? []) {
      const domain = competitor.domain.replace(/^www\./, "").toLowerCase();
      if (!domain || domain === normalizedOwnDomain) continue;
      const current = byDomain.get(domain) ?? { domain, appearances: 0, bestRank: competitor.rank, scores: [], keywords: new Set<string>(), locations: new Set<string>(), missingTopics: new Set<string>(), exampleUrl: competitor.url, title: competitor.title };
      if (!seenInRun.has(domain)) { current.appearances += 1; seenInRun.add(domain); }
      current.bestRank = Math.min(current.bestRank, competitor.rank);
      if (typeof competitor.contentScore === "number") current.scores.push(competitor.contentScore);
      current.keywords.add(run.seedKeyword);
      if (run.locationName) current.locations.add(run.locationName);
      for (const topic of competitor.missingTopicsJson ?? []) if (typeof topic === "string" && topic.trim()) current.missingTopics.add(topic.trim());
      if (!current.title && competitor.title) current.title = competitor.title;
      byDomain.set(domain, current);
    }
  }
  const competitors = [...byDomain.values()].map((item) => ({ ...item, averageScore: item.scores.length ? Math.round(item.scores.reduce((sum, score) => sum + score, 0) / item.scores.length) : null })).sort((a, b) => a.bestRank - b.bestRank || b.appearances - a.appearances || (b.averageScore ?? 0) - (a.averageScore ?? 0));
  const top = competitors;
  const runsWithCompetitors = runs.filter((run) => (run.competitors?.length ?? 0) > 0).length;
  const commonTopics = [...competitors.reduce((counts, item) => { for (const topic of item.missingTopics) counts.set(topic, (counts.get(topic) ?? 0) + 1); return counts; }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const analysisCount = runs.reduce((total, run) => total + (run.competitorCount ?? 0), 0);
  return <Card className="overflow-hidden">
    <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-brand-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="text-xs font-bold uppercase tracking-wide text-violet-700">SERP Competitor Analysis</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">Who ranks for the analyzed keywords</h2><p className="mt-1 text-sm leading-6 text-charcoal-600">Built from stored Google result pages for this project—not only from manually saved competitors.</p></div>
      <div className="flex flex-wrap gap-2"><span className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-700">{competitors.length} unique domains</span><span className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">{runsWithCompetitors}/{runs.length} runs compared</span></div>
    </div>
    {top.length > 0 ? <div className="p-5">
      <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[860px] border-collapse text-left"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-charcoal-400"><tr><th className="px-4 py-3">Competitor</th><th className="px-4 py-3 text-center">Best rank</th><th className="px-4 py-3 text-center">Runs</th><th className="px-4 py-3 text-center">Keywords</th><th className="px-4 py-3 text-center">Content score</th><th className="px-4 py-3">Markets</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{top.map((competitor) => <tr key={competitor.domain} className="text-sm hover:bg-violet-50/30"><td className="max-w-[280px] px-4 py-3"><div className="truncate font-bold text-charcoal-950">{competitor.domain}</div><div className="mt-0.5 truncate text-xs text-charcoal-500">{competitor.title || "Search result competitor"}</div></td><td className="px-4 py-3 text-center"><span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">#{competitor.bestRank}</span></td><td className="px-4 py-3 text-center font-bold text-charcoal-700">{competitor.appearances}</td><td className="px-4 py-3 text-center font-bold text-charcoal-700">{competitor.keywords.size}</td><td className="px-4 py-3 text-center font-bold text-charcoal-700">{competitor.averageScore ?? "—"}</td><td className="max-w-[220px] px-4 py-3 text-xs text-charcoal-600">{[...competitor.locations].slice(0, 2).join(", ") || "General"}</td><td className="px-4 py-3 text-right"><a href={competitor.exampleUrl} target="_blank" rel="noreferrer" className="font-bold text-brand-700">View result →</a></td></tr>)}</tbody></table></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Competitor coverage signals</div><div className="mt-3 flex flex-wrap gap-2">{commonTopics.length ? commonTopics.map(([topic, count]) => <span key={topic} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">{topic} · {count}</span>) : <span className="text-sm text-charcoal-500">No repeated competitor topic gaps were stored.</span>}</div></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">How to use this</div><p className="mt-2 text-sm leading-6 text-charcoal-600">Compare page intent, useful topic coverage, proof, schema, FAQs and calls to action. Use missing coverage as evidence for content and page improvements; do not copy competitor wording.</p><div className="mt-3 text-xs font-semibold text-charcoal-500">{analysisCount} result positions reviewed across {runs.length} runs · {projectCompetitors.length ? `${projectCompetitors.length} manually saved competitors also available` : "No manually saved competitors—the live SERP set is still analyzed"}</div></div></div>
    </div> : <div className="p-6 text-center"><h3 className="font-bold text-charcoal-950">Detailed competitor results are not available yet</h3><p className="mt-2 text-sm text-charcoal-500">{analysisCount > 0 ? "The runs contain competitor counts but no stored competitor profiles. Refresh the Keyword Analysis to capture the detailed result pages." : "Start Keyword Analysis to collect ranking competitors, content scores and topic gaps."}</p></div>}
  </Card>;
}

function SiteAnalysisScreen({ data }: { data: ModuleData }) {
  const website = data.websites[0];
  const project = data.projects[0];
  const crawls = data.websites.flatMap((site) => site.crawlJobs ?? []);
  const latest = crawls.find((crawl) => crawl.status === "completed" && (crawl.pagesCrawled > 0 || crawl.siteScore != null)) ?? crawls[0];
  const [issues, setIssues] = useState<CrawlIssue[]>([]);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [crawlPages, setCrawlPages] = useState<CrawlPageRow[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issueMessage, setIssueMessage] = useState("");
  const [activeDetail, setActiveDetail] = useState<ScanDetailKey>(null);
  const [reportTab, setReportTab] = useState<"pages" | "issues">("pages");
  const [issueAction, setIssueAction] = useState<string | null>(null);
  const [issueActionMessage, setIssueActionMessage] = useState("");
  const [reviewIssue, setReviewIssue] = useState<CrawlIssue | null>(null);
  const [reviewTask, setReviewTask] = useState<ExecutionTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCrawlData(crawlId: string) {
      setIssuesLoading(true);
      setIssueMessage("");
      try {
        const [issueResult, reportResult, pagesResult] = await Promise.all([
          api.get<{ issues: CrawlIssue[] }>(`/api/crawls/${crawlId}/issues`),
          api.get<HealthReport>(`/api/crawls/${crawlId}/health-report`),
          api.get<{ total: number; rawTotal?: number; pages: CrawlPageRow[] }>(`/api/crawls/${crawlId}/pages?take=100&logical=1`),
        ]);
        if (!cancelled) {
          setIssues(issueResult.issues ?? []);
          setHealthReport(reportResult);
          setCrawlPages(pagesResult.pages ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setIssues([]);
          setHealthReport(null);
          setCrawlPages([]);
          setIssueMessage(error instanceof Error ? error.message : "Could not load crawl issues.");
        }
      } finally {
        if (!cancelled) setIssuesLoading(false);
      }
    }
    if (latest?.id && latest.status === "completed") void loadCrawlData(latest.id);
    else {
      setIssues([]);
      setHealthReport(null);
      setCrawlPages([]);
      setIssueMessage("");
    }
    return () => { cancelled = true; };
  }, [latest?.id, latest?.status]);

  if (!website && !crawls.length && !data.tasks.length) {
    return <EmptyModuleState title="No site analysis yet" detail="Add a website project and run a crawl to populate site analysis." />;
  }
  const issueCount = issues.length || latest?.errorCount || data.tasks.filter((task) => task.priority === "high").length;
  const citationTaskCount = data.tasks.filter((task) => /citation|schema|structured data|faqpage/i.test(`${task.moduleName} ${task.title} ${task.description}`)).length;
  const approvedKeywords = approvedKeywordEntries(project?.keywordGroups ?? []);
  const keywordAnalysisLocations = project ? projectAnalysisLocations(project).locationNames : [];
  const missingKeywordResearch = missingApprovedKeywordResearch(project?.keywordGroups ?? [], data.keywordRuns, keywordAnalysisLocations);
  const updateIssue = async (issue: CrawlIssue, status: "open" | "ignored") => {
    if (!latest) return;
    setIssueAction(issue.id);
    setIssueActionMessage("");
    try {
      const result = await api.patch<{ issue: CrawlIssue }>(`/api/crawls/${latest.id}/issues/${issue.id}`, { status });
      setIssues((current) => current.map((item) => item.id === issue.id ? { ...item, ...result.issue } : item));
      setIssueActionMessage(status === "ignored" ? "Issue ignored. It remains in this report for audit history." : "Issue restored to the open list.");
    } catch (error) {
      setIssueActionMessage(error instanceof Error ? error.message : "Issue could not be updated.");
    } finally {
      setIssueAction(null);
    }
  };
  const sendIssueToExecutionPlan = async (issue: CrawlIssue) => {
    if (!website) return;
    setIssueAction(issue.id);
    try {
      let result = await api.get<{ tasks: ExecutionTask[] }>(`/api/websites/${website.id}/execution-tasks`);
      let task = result.tasks.find((item) => item.dedupeKey === `crawl:${issue.id}`);
      if (!task) {
        result = await api.post<{ tasks: ExecutionTask[] }>(`/api/websites/${website.id}/execution-tasks/sync`, { issueIds: [issue.id] });
        task = result.tasks.find((item) => item.dedupeKey === `crawl:${issue.id}`);
      }
      if (!task) throw new Error("The matching Execution task could not be loaded.");
      setReviewIssue(issue);
      setReviewTask(task);
    } catch (error) {
      setIssueActionMessage(error instanceof Error ? error.message : "The Execution task could not be opened.");
    } finally {
      setIssueAction(null);
    }
  };
  const updateReviewTask = async (status: "completed" | "skipped" | "approved" | "ready") => {
    if (!reviewTask) return;
    const endpoint = status === "completed" ? "complete" : status === "skipped" ? "skip" : null;
    const result = endpoint ? await api.post<{ task: ExecutionTask }>(`/api/execution-tasks/${reviewTask.id}/${endpoint}`, {}) : await api.patch<{ task: ExecutionTask }>(`/api/execution-tasks/${reviewTask.id}`, { status });
    setReviewTask(result.task);
  };
  return (
    <>
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Analyzed website</div><a href={website?.rootUrl || `https://${website?.domain}`} target="_blank" rel="noreferrer" className="mt-1 block break-all text-base font-bold text-brand-700 hover:underline">{website?.rootUrl || website?.domain || "No website selected"}</a></div>
          <div className="text-left sm:text-right"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Latest analysis</div><div className="mt-1 text-sm font-semibold text-charcoal-700">{latest?.completedAt ? formatDateTime(latest.completedAt) : "Not completed"}</div></div>
        </div>
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-6">
          {[
            ["Overall Health", `${latest?.siteScore ?? "—"} /100`, latest ? `${label(latest.status)} · ${crawlSource(latest)}` : "No crawl", "text-emerald-700"],
            ["Issues Found", formatNumber(issueCount), issuesLoading ? "Loading issues" : "Latest crawl", issueCount ? "text-amber-700" : "text-emerald-700"],
            ["Pages Crawled", formatNumber(latest?.pagesCrawled), "Latest analysis", "text-charcoal-950"],
            ["Ranking Keywords", formatNumber(data.keywordRuns.reduce((sum, run) => sum + (run.keywordCount || 0), 0)), "Keyword research", "text-charcoal-950"],
            ["Referring Domains", formatNumber(data.backlinkSummary?.referringDomains), "Authority data", "text-charcoal-950"],
            ["Citation Tasks", formatNumber(citationTaskCount), "Execution tasks", "text-charcoal-950"],
          ].map(([title, value, detail, tone]) => <div key={title} className="min-w-0 px-5 py-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{title}</div><div className={`mt-2 text-2xl font-bold leading-none ${tone}`}>{value}</div><div className="mt-2 truncate text-xs font-semibold text-charcoal-500">{detail}</div></div>)}
        </div>
        <ScanSummaryCards report={healthReport} loading={issuesLoading} onOpen={setActiveDetail} embedded />
        {project && <SiteCapabilityExtension projectId={project.id} crawlCompletedAt={latest?.completedAt} />}
      </Card>
      <Card className={`border ${missingKeywordResearch.length ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/50"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className={`text-xs font-black uppercase tracking-wide ${missingKeywordResearch.length ? "text-amber-700" : "text-emerald-700"}`}>Shared keyword evidence</div><h3 className="mt-1 font-black text-slate-950">{approvedKeywords.length} approved Primary and Secondary keyword{approvedKeywords.length === 1 ? "" : "s"} connected to this crawl</h3><p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">Site Analysis captures each page’s URL, title, meta description, H1, H2, body, links, and schema. SEO &amp; Gap Analysis compares those exact crawl signals with every approved keyword, so the crawl does not invent page targets from the Industry / Niche field.</p></div>
          <Link to={missingKeywordResearch.length ? `/keywords?projectId=${project?.id ?? ""}` : `/gap-analysis?projectId=${project?.id ?? ""}`} className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-black text-white ${missingKeywordResearch.length ? "bg-amber-600" : "bg-emerald-600"}`}>{missingKeywordResearch.length ? `Analyze ${missingKeywordResearch.length} remaining` : "Map keywords to pages"}</Link>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex" role="tablist" aria-label="Site Analysis report sections">
            <button type="button" role="tab" aria-selected={reportTab === "pages"} onClick={() => setReportTab("pages")} className={`rounded-t-lg border border-b-0 px-5 py-2.5 text-sm font-bold transition ${reportTab === "pages" ? "border-slate-200 bg-white text-brand-700" : "border-transparent text-charcoal-500 hover:text-brand-700"}`}>Crawled Pages <span className="ml-1 text-xs opacity-70">({crawlPages.length})</span></button>
            <button type="button" role="tab" aria-selected={reportTab === "issues"} onClick={() => setReportTab("issues")} className={`rounded-t-lg border border-b-0 px-5 py-2.5 text-sm font-bold transition ${reportTab === "issues" ? "border-slate-200 bg-white text-brand-700" : "border-transparent text-charcoal-500 hover:text-brand-700"}`}>Site Issues <span className="ml-1 text-xs opacity-70">({issues.length})</span></button>
          </div>
          <div className="flex flex-wrap gap-2 pb-2">
            <Link to={`/crawls/${latest?.id}?returnTo=${encodeURIComponent(`/site-analysis?projectId=${data.projects[0]?.id ?? ""}`)}`} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 shadow-sm hover:bg-brand-50">Open full crawl report</Link>
            <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-700">Export Report</button>
          </div>
        </div>
        <div role="tabpanel">
          {reportTab === "pages" ? <CrawledPagesTable pages={crawlPages} total={latest?.pagesCrawled ?? crawlPages.length} loading={issuesLoading} message={issueMessage} embedded /> : <SiteIssueList issues={issues} loading={issuesLoading} busyId={issueAction} message={issueActionMessage} onStatus={updateIssue} onSend={sendIssueToExecutionPlan} embedded />}
        </div>
      </Card>
      <ScanDetailDrawer active={activeDetail} report={healthReport} onClose={() => setActiveDetail(null)} />
      {reviewIssue && reviewTask && <ExecutionTaskDrawer task={reviewTask} issue={reviewIssue as unknown as IssueRow} onClose={() => { setReviewIssue(null); setReviewTask(null); }} onApprove={() => { void updateReviewTask("approved"); }} onComplete={() => { void updateReviewTask("completed"); }} onReopen={() => { void updateReviewTask("ready"); }} onSkip={() => { void updateReviewTask("skipped"); }} />}
    </>
  );
}

function SiteIssueList({ issues, loading, busyId, message, onStatus, onSend, embedded = false }: {
  issues: CrawlIssue[];
  loading: boolean;
  busyId: string | null;
  message: string;
  onStatus: (issue: CrawlIssue, status: "open" | "ignored") => void;
  onSend: (issue: CrawlIssue) => void;
  embedded?: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "critical" | "high" | "medium" | "low" | "open" | "ignored">("all");
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const priority = (issue: CrawlIssue) => issue.severity === "high" && (issue.weightImpact ?? 0) >= 8 ? "critical" : issue.severity;
  const filteredIssues = issues.filter((issue) => filter === "all" || filter === "open" || filter === "ignored" ? filter === "all" || issue.status === filter : priority(issue) === filter);
  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const visibleIssues = filteredIssues.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
  const groups = ["critical", "high", "medium", "low"].map((level) => ({ level, issues: visibleIssues.filter((issue) => priority(issue) === level) }));
  const filters = (["all", "critical", "high", "medium", "low", "open", "ignored"] as const).map((value) => ({
    value,
    count: value === "all" ? issues.length : value === "open" || value === "ignored" ? issues.filter((issue) => issue.status === value).length : issues.filter((issue) => priority(issue) === value).length,
  }));
  return (
    <Card className={`overflow-hidden ${embedded ? "rounded-none border-0 shadow-none" : ""}`}>
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-bold text-charcoal-950">Prioritized site issues</h2>
        <p className="mt-1 text-sm text-charcoal-500">Review what was found here. Approved findings become Execution Plan tasks; fixes are completed from the plan, not directly inside this report.</p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter site-analysis issues">
          {filters.map((item) => <button key={item.value} type="button" onClick={() => { setFilter(item.value); setPage(1); }} aria-pressed={filter === item.value} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${filter === item.value ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-200 bg-white text-charcoal-600 hover:border-brand-300 hover:text-brand-700"}`}><span>{label(item.value)}</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] ${filter === item.value ? "bg-white/20 text-white" : "bg-slate-100 text-charcoal-500"}`}>{item.count}</span></button>)}
        </div>
        {message && <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">{message}</div>}
      </div>
      {loading ? <div className="p-6 text-sm text-charcoal-500">Loading prioritized issues…</div> : (
        <div className="divide-y divide-slate-100">
          {groups.map((group) => group.issues.length > 0 && <section key={group.level} className="p-5">
            <div className="mb-3 flex items-center gap-2"><StatusPill status={group.level} /><span className="text-xs font-bold text-charcoal-400">{group.issues.length} issue{group.issues.length === 1 ? "" : "s"}</span></div>
            <div className="space-y-3">{group.issues.map((issue) => <details key={issue.id} className={`rounded-lg border p-4 ${issue.status === "ignored" ? "border-slate-100 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
              <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-bold text-charcoal-950">{issue.message}</div><div className="mt-1 text-xs font-semibold text-charcoal-400">{label(issue.category)} · {issue.page?.url ? shortUrl(issue.page.url) : "Site-wide"}</div></div><StatusPill status={issue.status} /></div></summary>
              <div className="mt-4 flex flex-col gap-4 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Why it matters and recommended fix</div><p className="mt-2 text-sm leading-6 text-charcoal-700">{issue.recommendation || "Review the affected page and resolve this issue to improve crawlability, search visibility, and user experience."}</p></div><div className="flex shrink-0 flex-wrap gap-2">{issue.status === "ignored" ? <button type="button" disabled={busyId === issue.id} onClick={() => onStatus(issue, "open")} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100">Restore</button> : <><button type="button" onClick={() => onSend(issue)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Review & Fix</button><button type="button" disabled={busyId === issue.id} onClick={() => onStatus(issue, "ignored")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ignore</button></>}</div></div>
            </details>)}</div>
          </section>)}
          {!filteredIssues.length && <div className="p-6 text-sm text-charcoal-500">{issues.length ? `No ${label(filter).toLowerCase()} issues match this filter.` : "No crawl issues were found in the latest analysis."}</div>}
          {filteredIssues.length > pageSize && <div className="border-t border-slate-100 px-5 py-3"><CompactPagination page={effectivePage} totalPages={totalPages} onPage={setPage} /></div>}
        </div>
      )}
    </Card>
  );
}

function ScanSummaryCards({ report, loading, onOpen, embedded = false }: { report: HealthReport | null; loading: boolean; onOpen: (key: Exclude<ScanDetailKey, null>) => void; embedded?: boolean }) {
  const cards = [
    { key: "highIssues" as const, label: "High issues", value: report?.severityCounts.high ?? 0, detail: `${report?.details?.technicalIssues.filter((issue) => issue.severity === "high").length ?? 0} detailed rows`, tone: "text-red-700", surface: "border-red-200 bg-red-50 hover:bg-red-100/70" },
    { key: "brokenLinks" as const, label: "Broken links", value: report?.technical.brokenLinks ?? 0, detail: "Internal targets to repair", tone: "text-red-700", surface: "border-red-200 bg-red-50 hover:bg-red-100/70" },
    { key: "orphanPages" as const, label: "Orphan pages", value: report?.internalLinking.orphanPages ?? 0, detail: "Pages needing internal links", tone: "text-amber-700", surface: "border-amber-200 bg-amber-50 hover:bg-amber-100/70" },
    { key: "weakAnchors" as const, label: "Weak anchors", value: report?.internalLinking.weakAnchorText ?? 0, detail: "Anchor text to improve", tone: "text-amber-700", surface: "border-amber-200 bg-amber-50 hover:bg-amber-100/70" },
  ];
  const content = (
      <div className={`grid sm:grid-cols-2 xl:grid-cols-4 ${embedded ? "gap-2 border-t border-slate-100 bg-white p-3" : "gap-3"}`}>
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onOpen(card.key)}
            disabled={!report}
            className={`${embedded ? `min-h-[68px] rounded-md border px-3 py-2 ${card.surface}` : "rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:bg-brand-50/50"} text-left transition disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <div className="flex items-center justify-between gap-3"><div className={`text-xs font-bold uppercase tracking-wide ${card.tone}`}>{card.label}</div><div className={`text-xl font-bold leading-none ${card.tone}`}>{loading ? "..." : formatNumber(card.value)}</div></div>
            <div className={`mt-1 text-xs font-medium ${card.tone} opacity-75`}>{card.detail}</div>
          </button>
        ))}
      </div>
  );
  return embedded ? content : <Card className="p-4">{content}</Card>;
}

function CrawledPagesTable({ pages, total, loading, message, embedded = false }: { pages: CrawlPageRow[]; total: number; loading: boolean; message: string; embedded?: boolean }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(pages.length / pageSize));
  const visiblePages = pages.slice((page - 1) * pageSize, page * pageSize);
  const fetchedUrlCount = pages.reduce((sum, item) => sum + Math.max(1, item.aliasCount ?? item.aliasUrls?.length ?? 1), 0);
  const hasGroupedAliases = fetchedUrlCount > pages.length;
  return (
    <Card className={`overflow-hidden ${embedded ? "rounded-none border-0 shadow-none" : ""}`}>
      <div className="border-b border-slate-100 p-4">
        <h2 className="font-bold text-charcoal-950">Crawled Pages</h2>
        <p className="mt-1 text-sm text-charcoal-500">
          {loading ? "Loading pages from the latest completed crawl." : message || (hasGroupedAliases
            ? `Showing ${formatNumber(pages.length)} logical pages from ${formatNumber(fetchedUrlCount)} crawled URLs. URL aliases are grouped; redirect problems remain in Site Issues.`
            : `Showing ${formatNumber(pages.length)} of ${formatNumber(total || pages.length)} pages from the latest completed crawl.`)}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-white text-xs text-charcoal-500">
            <tr>
              {["URL", "Status", "Internal score", "In / Out", "Depth", "Words", "Performance"].map((column) => (
                <th key={column} className="px-4 py-3 font-bold">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visiblePages.length ? visiblePages.map((page) => (
              <tr key={page.id} className="align-top hover:bg-slate-50">
                <td className="max-w-[460px] px-4 py-3">
                  <a href={page.finalUrl || page.url} target="_blank" rel="noreferrer" className="break-all font-bold text-brand-700 hover:underline">{page.finalUrl || page.url}</a>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-charcoal-500">
                    <span>Broken: {formatNumber(page.brokenInternalLinkCount ?? 0)}</span>
                    <span>Weak anchors: {formatNumber(page.weakAnchorCount ?? 0)}</span>
                    {(page.aliasCount ?? page.aliasUrls?.length ?? 1) > 1 ? <details className="group">
                      <summary className="cursor-pointer font-bold text-amber-700">{formatNumber(page.aliasCount ?? page.aliasUrls?.length ?? 1)} URL aliases grouped</summary>
                      <div className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] font-medium text-amber-950">
                        {(page.aliasUrls ?? []).map((url) => <div key={url} className="break-all">{url}</div>)}
                        <div className="pt-1 font-bold">Configure one preferred-host redirect; SEO and Website planning use this as one page.</div>
                      </div>
                    </details> : null}
                  </div>
                </td>
                <td className="px-4 py-3 font-semibold text-charcoal-800">{page.statusCode ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="font-bold text-charcoal-900">{page.internalLinkScore ?? "—"}/100</div>
                  <div className={`text-xs font-semibold ${internalScoreTone(page.internalLinkScore)}`}>{internalScoreLabel(page.internalLinkScore)}</div>
                </td>
                <td className="px-4 py-3 text-charcoal-700">
                  {formatNumber(page.inlinkCount ?? 0)} / {formatNumber(page.outlinkCount ?? 0)}
                  {page.isOrphan ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">orphan</span> : null}
                </td>
                <td className="px-4 py-3 text-charcoal-700">{formatNumber(page.depth)}</td>
                <td className="px-4 py-3 text-charcoal-700">{formatNumber(page.wordCount)}</td>
                <td className="px-4 py-3">
                  <div className="font-bold text-charcoal-900">{formatNumber(pagePerformanceScore(page))}/100</div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-charcoal-400">{loading ? "Loading crawled pages..." : "No crawled pages found for this scan."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages.length > pageSize && <div className="border-t border-slate-100 px-4 py-3"><CompactPagination page={Math.min(page, totalPages)} totalPages={totalPages} onPage={setPage} /></div>}
    </Card>
  );
}

function CompactPagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-semibold text-charcoal-500">Page {page} of {totalPages}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-charcoal-700 hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-40">Previous</button><button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-charcoal-700 hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></div>;
}

function ScanDetailDrawer({ active, report, onClose }: { active: ScanDetailKey; report: HealthReport | null; onClose: () => void }) {
  if (!active || !report) return null;
  const title = {
    highIssues: "High priority issues",
    brokenLinks: "Broken internal links",
    orphanPages: "Orphan pages",
    weakAnchors: "Weak anchor text",
  }[active];
  const rows = scanDetailRows(active, report);
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Scan details</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-950">{title}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-charcoal-600 hover:bg-slate-50">Close</button>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-6">
          {rows.length ? rows.map((row, index) => (
            <div key={`${row.title}-${index}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="font-bold text-charcoal-950">{row.title}</div>
              {row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs font-semibold text-brand-600 hover:underline">{row.url}</a> : null}
              <div className={`mt-2 text-sm ${row.tone}`}>{row.detail}</div>
            </div>
          )) : <EmptyModuleState title="No details found" detail="This scan did not return rows for this category." compact />}
        </div>
      </aside>
    </div>
  );
}

function BacklinkScreen({ data, autoStart = false }: { data: ModuleData; autoStart?: boolean }) {
  const project = data.projects[0];
  if (!project) return <EmptyModuleState title="Select a project" detail="Choose a project before opening authority research." />;
  return <AuthorityGrowthWorkspace projectId={project.id} backlinkSummary={data.backlinkSummary} backlinkLinks={data.backlinkLinks} autoStart={autoStart} />;
}

function CitationScreen({ data }: { data: ModuleData }) {
  const project = data.projects[0];
  if (!project) return <EmptyModuleState title="Select a project" detail="Choose a project before opening AI citation research and monitoring." />;
  return <AiCitationVisibilityWorkspace projectId={project.id} />;
}

function CitationPanel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: { label: string; value: string; ok: boolean; action: string; href?: string }[];
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 p-4">
        <h2 className="font-bold text-charcoal-950">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-charcoal-500">{subtitle}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-sm font-bold text-charcoal-900">{row.label}</div>
              <div className="mt-0.5 truncate text-xs text-charcoal-500">{row.value}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${row.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {row.ok ? "Found" : "Needs work"}
              </span>
              {row.href ? <Link to={row.href} className="rounded-md border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-50">{row.action}</Link> : <span className="text-xs font-bold text-charcoal-400">{row.action}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

type SavedArchitecturePage = { id: string; pageKey: string; parentPageKey?: string | null; title: string; suggestedUrl: string; pageType: string; navigationGroup: string; category?: string | null; searchIntent: string; purpose: string; recommendationWhy: string; targetKeywordsJson: unknown; status: string; sortOrder: number; executionTaskId?: string | null };
type SavedArchitectureLink = { id: string; sourcePageKey: string; targetPageKey: string; anchorText: string; linkType: string; rationale: string; executionTaskId?: string | null };
type SavedArchitecture = { id: string; version: number; status: string; title: string; executiveSummary: string; rationale: string; createdAt: string; approvedAt?: string | null; rejectionReason?: string | null; pages: SavedArchitecturePage[]; links: SavedArchitectureLink[]; decisions: { id: string; decision: string; comments?: string | null; createdAt: string }[] };

function ArchitectScreen({ data }: { data: ModuleData }) {
  const project = data.projects[0];
  const website = data.websites[0];
  const latestCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "completed");
  const strategy = project?.strategyPlans?.[0];
  const [architectures, setArchitectures] = useState<SavedArchitecture[]>([]);
  const [capabilities, setCapabilities] = useState({ canGenerate: false, canApprove: false, readOnly: true, clientViewer: false });
  const [selectedPageKey, setSelectedPageKey] = useState("");
  const [view, setView] = useState<"pages" | "navigation" | "links" | "versions">("pages");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const current = architectures[0] ?? null;
  const selectedPage = current?.pages.find((page) => page.pageKey === selectedPageKey) ?? current?.pages[0] ?? null;

  const load = async () => {
    if (!project) return;
    const result = await api.get<{ versions: SavedArchitecture[]; capabilities: typeof capabilities }>(`/api/projects/${project.id}/site-architecture`);
    setArchitectures(result.versions); setCapabilities(result.capabilities);
    if (!selectedPageKey && result.versions[0]?.pages[0]) setSelectedPageKey(result.versions[0].pages[0].pageKey);
  };
  useEffect(() => { setArchitectures([]); setSelectedPageKey(""); setMessage(""); if (project?.id) void load().catch((error) => setMessage(error instanceof Error ? error.message : "Architecture could not be loaded.")); }, [project?.id]);

  const action = async (name: string, request: () => Promise<unknown>, success: string) => {
    setBusy(name); setMessage("");
    try { await request(); await load(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Architecture action failed."); }
    finally { setBusy(""); }
  };
  const generate = () => action("generate", () => api.post(`/api/projects/${project!.id}/site-architecture/generate`, {}), "A new architecture version is ready for review.");
  const approve = () => action("approve", () => api.post(`/api/projects/${project!.id}/site-architecture/${current!.id}/approve`, { comments: "Approved from Site Architect" }), "Architecture approved and added to the Execution Plan.");
  const reject = () => { const comments = window.prompt("What should change in this architecture?"); if (comments?.trim()) void action("reject", () => api.post(`/api/projects/${project!.id}/site-architecture/${current!.id}/reject`, { comments }), "Architecture rejected with revision guidance."); };

  if (!project) return <EmptyModuleState title="No site architecture yet" detail="Create or select a project before generating site structure." />;
  const approvedKeywords = project.keywordGroups?.filter((group) => group.status === "approved").length ?? 0;
  return <div className="space-y-5">
    {message && <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${/failed|could not|complete|approve/i.test(message) && !/approved|completed/i.test(message) ? "border-rose-200 bg-rose-50 text-rose-800" : "border-brand-100 bg-brand-50 text-brand-700"}`}>{message}</div>}
    <SiteBuilderWorkflow projectId={project.id} architectureId={current?.id} architectureStatus={current?.status} onArchitectureChanged={load} />
    {!current ? null : <>
      <Card className="overflow-hidden p-0"><div className="flex flex-col gap-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-black uppercase tracking-wide text-brand-700">Architecture v{current.version}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${current.status === "approved" ? "bg-emerald-100 text-emerald-700" : current.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{current.status}</span></div><h2 className="mt-2 text-xl font-black text-charcoal-950">{current.title}</h2><p className="mt-1 max-w-4xl text-sm leading-6 text-charcoal-600">{current.executiveSummary}</p></div><div className="flex flex-wrap gap-2">{capabilities.canGenerate && <button type="button" onClick={() => void generate()} disabled={busy === "generate"} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-xs font-black text-brand-700">{busy === "generate" ? "Generating…" : "Generate New Version"}</button>}{current.status === "draft" && capabilities.canApprove && <><button type="button" onClick={reject} disabled={Boolean(busy)} className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs font-black text-rose-700">Reject</button><button type="button" onClick={() => void approve()} disabled={Boolean(busy)} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-black text-white">{busy === "approve" ? "Approving…" : "Approve Structure"}</button></>}</div></div><div className="grid grid-cols-2 divide-x divide-slate-100 sm:grid-cols-4"><ArchitectureMetric label="Pages" value={current.pages.length} /><ArchitectureMetric label="Internal links" value={current.links.length} /><ArchitectureMetric label="Main navigation" value={current.pages.filter((page) => page.navigationGroup === "main").length} /><ArchitectureMetric label="Pillar pages" value={current.pages.filter((page) => page.pageType === "pillar").length} /></div></Card>
      <div className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">{([['pages','Pages & URLs'],['navigation','Navigation'],['links','Internal Linking'],['versions','Version History']] as const).map(([key, labelText]) => <button key={key} type="button" onClick={() => setView(key)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-black ${view === key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{labelText}</button>)}</div>
      {view === "pages" && <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"><Card className="overflow-hidden p-0"><div className="border-b px-4 py-3"><h3 className="font-black text-charcoal-950">Page hierarchy</h3><p className="mt-1 text-xs text-charcoal-500">Select a page to review why it belongs.</p></div><div className="max-h-[650px] divide-y divide-slate-100 overflow-y-auto">{current.pages.map((page) => <button key={page.id} type="button" onClick={() => setSelectedPageKey(page.pageKey)} className={`block w-full p-4 text-left ${selectedPage?.id === page.id ? "bg-brand-50" : "bg-white hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-charcoal-900">{page.title}</div><div className="mt-1 text-xs font-semibold text-brand-700">{page.suggestedUrl}</div></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-600">{page.pageType}</span></div>{page.parentPageKey && <div className="mt-2 text-[10px] text-charcoal-400">Parent: {page.parentPageKey.replaceAll("_", " ")}</div>}</button>)}</div></Card>{selectedPage && <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">{selectedPage.pageType} · {selectedPage.searchIntent} intent</div><h3 className="mt-1 text-2xl font-black text-charcoal-950">{selectedPage.title}</h3><div className="mt-1 font-mono text-sm font-bold text-brand-700">{selectedPage.suggestedUrl}</div></div><span className={`rounded-full px-3 py-1 text-xs font-black ${selectedPage.status === "existing" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{selectedPage.status}</span></div><div className="mt-5 grid gap-4 md:grid-cols-2"><ArchitectureDetail title="Page purpose" value={selectedPage.purpose} /><ArchitectureDetail title="Why recommended" value={selectedPage.recommendationWhy} /><ArchitectureDetail title="Navigation group" value={label(selectedPage.navigationGroup)} /><ArchitectureDetail title="Category" value={selectedPage.category || "Core website"} /></div><div className="mt-5"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Target keywords</div><div className="mt-2 flex flex-wrap gap-2">{(Array.isArray(selectedPage.targetKeywordsJson) ? selectedPage.targetKeywordsJson.map(String) : []).map((keyword) => <span key={keyword} className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">{keyword}</span>)}{!Array.isArray(selectedPage.targetKeywordsJson) || !selectedPage.targetKeywordsJson.length ? <span className="text-sm text-charcoal-400">Intent and navigation page—no dedicated keyword target required.</span> : null}</div></div><div className="mt-5"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Planned links</div><div className="mt-2 space-y-2">{current.links.filter((link) => link.sourcePageKey === selectedPage.pageKey || link.targetPageKey === selectedPage.pageKey).map((link) => <div key={link.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm"><b>{link.sourcePageKey.replaceAll("_", " ")} → {link.targetPageKey.replaceAll("_", " ")}</b><span className="ml-2 text-charcoal-500">“{link.anchorText}”</span></div>)}</div></div></Card>}</div>}
      {view === "navigation" && <ArchitectureNavigation pages={current.pages} />}
      {view === "links" && <Card className="overflow-hidden p-0"><div className="border-b px-5 py-4"><h3 className="font-black text-charcoal-950">Internal linking plan</h3><p className="mt-1 text-sm text-charcoal-500">Every link has a source, target, suggested anchor, type, and reason.</p></div><div className="divide-y divide-slate-100">{current.links.map((link) => <div key={link.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)]"><div><div className="text-xs font-black uppercase text-slate-400">Route</div><div className="mt-1 text-sm font-black text-slate-900">{link.sourcePageKey.replaceAll("_", " ")} <span className="text-brand-600">→</span> {link.targetPageKey.replaceAll("_", " ")}</div></div><div><div className="text-xs font-black uppercase text-slate-400">Anchor</div><div className="mt-1 text-sm font-semibold">{link.anchorText}</div></div><div><div className="text-xs font-black uppercase text-slate-400">Why</div><div className="mt-1 text-sm leading-6 text-slate-600">{link.rationale}</div></div></div>)}</div></Card>}
      {view === "versions" && <Card className="overflow-hidden p-0"><div className="border-b px-5 py-4"><h3 className="font-black text-charcoal-950">Architecture versions</h3><p className="mt-1 text-sm text-charcoal-500">Previous versions remain available for comparison and audit history.</p></div><div className="divide-y divide-slate-100">{architectures.map((architecture) => <div key={architecture.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-black text-charcoal-900">Version {architecture.version} · {architecture.title}</div><div className="mt-1 text-xs text-charcoal-500">{new Date(architecture.createdAt).toLocaleString()} · {architecture.pages.length} pages · {architecture.links.length} links</div>{architecture.rejectionReason && <div className="mt-1 text-xs font-semibold text-rose-700">Changes requested: {architecture.rejectionReason}</div>}</div><span className={`self-start rounded-full px-3 py-1 text-xs font-black uppercase ${architecture.status === "approved" ? "bg-emerald-50 text-emerald-700" : architecture.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{architecture.status}</span></div>)}</div></Card>}
      <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><b>No structural changes are made from a draft.</b> Approval creates or updates Execution Plan tasks for recommended pages and internal links; publishing and live-site changes remain separately protected.</div>
    </>}
  </div>;
}

function ArchitectureMetric({ label: labelText, value }: { label: string; value: number }) { return <div className="px-4 py-3 text-center"><div className="text-2xl font-black text-charcoal-950">{value}</div><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">{labelText}</div></div>; }

function ArchitectureNavigation({ pages }: { pages: SavedArchitecturePage[] }) {
  const groups = [...new Set(pages.map((page) => page.navigationGroup))];
  return <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{groups.map((group) => <Card key={group} className="p-5"><div className="text-xs font-black uppercase tracking-wide text-brand-700">{label(group)} navigation</div><div className="mt-4 space-y-2">{pages.filter((page) => page.navigationGroup === group).map((page) => <div key={page.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3"><div className="text-sm font-black text-charcoal-900">{page.title}</div><div className="mt-1 text-xs font-semibold text-brand-700">{page.suggestedUrl}</div>{page.parentPageKey && <div className="mt-1 text-[10px] text-charcoal-400">Under {page.parentPageKey.replaceAll("_", " ")}</div>}</div>)}</div></Card>)}</div>;
}

function ArchitectureDetail({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{title}</div>
      <div className="mt-2 text-sm font-semibold leading-6 text-charcoal-800">{value}</div>
    </div>
  );
}

function ArchitectureReadinessPanel({ score, rows }: { score: number; rows: { label: string; value: string; ok: boolean }[] }) {
  const safe = Math.max(0, Math.min(100, score));
  const chart = [{ name: "score", value: safe, color: "#0f9f87" }, { name: "rest", value: 100 - safe, color: "#e8eef8" }];
  return (
    <Card className="p-5">
      <h2 className="font-bold text-charcoal-950">Architecture Readiness</h2>
      <div className="my-5 flex justify-center">
        <div className="relative h-32 w-32">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={chart} dataKey="value" innerRadius={44} outerRadius={58} startAngle={90} endAngle={-270}>{chart.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-bold text-charcoal-950">{safe}</div><div className="text-xs text-charcoal-500">Score</div></div></div>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-bold text-charcoal-800">{row.label}</div>
              <div className="truncate text-xs text-charcoal-500">{row.value}</div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${row.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {row.ok ? "Ready" : "Needed"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function GeneratedBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-4">
      <div className="text-sm font-bold text-charcoal-950">{title}</div>
      <div className="mt-3 space-y-2">
        {items.filter(Boolean).slice(0, 5).map((item, index) => (
          <div key={`${title}-${index}`} className="text-sm leading-6 text-charcoal-600">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadMagnetScreen({ data, selectedIdea: selectedInput, instructions, onSelectIdea, onChangeInstructions }: {
  data: ModuleData;
  selectedIdea: string;
  instructions: string;
  onSelectIdea: (value: string) => void;
  onChangeInstructions: (value: string) => void;
}) {
  const project = data.projects[0];
  const leadTasks = data.tasks.filter((task) => task.moduleName.includes("lead") || task.title.toLowerCase().includes("lead"));
  const approvedStrategy = project?.strategyPlans?.find((strategy) => typeof strategy === "object" && strategy !== null && "status" in strategy && strategy.status === "approved") as {
    status?: string;
    strategySummary?: string | null;
    offerRecommendation?: string | null;
    contentStrategy?: string | null;
    seoStrategy?: string | null;
  } | undefined;
  const ideas = leadMagnetIdeas(data);
  const latestGeneration = data.leadMagnetGenerations[0] ?? null;
  const generatedPackage = latestGeneration ? normalizeLeadMagnetPackage(latestGeneration.resultJson) : null;
  const selectedIdea = selectedInput || generatedPackage?.leadMagnet.title || ideas[0];
  const audience = project?.businessProfile?.targetAudience || "Target audience not provided";
  const offer = approvedStrategy?.offerRecommendation || project?.businessProfile?.offerSummary || project?.primaryGoal || "Offer not provided";
  const readiness = leadMagnetReadiness(data, approvedStrategy);
  const [contextOpen, setContextOpen] = useState(false);
  const [showAllIdeas, setShowAllIdeas] = useState(false);
  if (!project && !ideas.length && !leadTasks.length) {
    return <EmptyModuleState title="No lead magnet data yet" detail="Create a project and strategy before generating lead magnet ideas." />;
  }
  return (
    <>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Project context</div>
          <div className="mt-1 truncate text-sm font-bold text-charcoal-950">{project?.businessName || project?.name || "Not selected"}</div>
          <div className="mt-1 text-xs text-charcoal-500">Strategy {approvedStrategy ? "approved" : "missing"} · {formatNumber(leadTasks.length)} lead tasks</div>
        </div>
        <Button type="button" variant="ghost" onClick={() => setContextOpen(true)}>View details</Button>
      </Card>
      {contextOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Lead magnet project context">
          <button type="button" className="absolute inset-0 bg-slate-950/40" onClick={() => setContextOpen(false)} aria-label="Close project context" />
          <aside className="relative z-10 h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Lead Magnet</div>
                <h2 className="mt-1 text-xl font-bold text-charcoal-950">Project context details</h2>
              </div>
              <button type="button" onClick={() => setContextOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-charcoal-700 hover:bg-slate-50">Close</button>
            </div>
            <div className="mt-5 space-y-5">
              {[
                ["Project", project?.businessName || project?.name || "Not selected"],
                ["Audience", audience],
                ["Offer", offer],
                ["Strategy", approvedStrategy ? "Approved" : "Missing"],
                ["Lead tasks", formatNumber(leadTasks.length)],
              ].map(([detailLabel, value]) => (
                <div key={detailLabel} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{detailLabel}</div>
                  <div className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-charcoal-900">{value}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="font-bold text-charcoal-950">Recommended Lead Magnets</h2>
          <p className="mt-1 text-sm leading-6 text-charcoal-500">A lead magnet is a useful gated asset that gives visitors a reason to share contact details before booking or buying.</p>
          <div className="mt-4 space-y-3">
            {ideas.length ? ideas.slice(0, showAllIdeas ? 5 : 3).map((item, index) => (
              <button type="button" onClick={() => onSelectIdea(item)} key={`${item}-${index}`} className={`w-full rounded-lg border p-3 text-left ${selectedIdea === item ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-brand-200"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-charcoal-950">{item}</div>
                    <div className="mt-1 text-xs leading-5 text-charcoal-500">{leadMagnetIdeaReason(project, item, index)}</div>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-brand-700">{leadMagnetScore(data, index)}</span>
                </div>
              </button>
            )) : <EmptyModuleState title="No ideas yet" detail="Approve strategy first. SEnuke AI - AI Growth Operating System will use the offer, audience, and goal to create lead magnet ideas." compact />}
          {ideas.length > 3 && <button type="button" onClick={() => setShowAllIdeas((value) => !value)} className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-charcoal-700 hover:bg-slate-50">
            {showAllIdeas ? "Show fewer ideas" : `Show ${ideas.length - 3} more ideas`}
          </button>}
          </div>
          <label className="mt-5 block border-t border-slate-100 pt-4">
            <span className="text-sm font-bold text-charcoal-950">Selected concept</span>
            <span className="mt-1 block text-xs leading-5 text-charcoal-500">Choose a recommendation above or edit the concept in your own words.</span>
            <input value={selectedInput || ideas[0] || ""} onChange={(event) => onSelectIdea(event.target.value)} maxLength={240} className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
          </label>
          <label className="mt-5 block border-t border-slate-100 pt-4">
            <span className="text-sm font-bold text-charcoal-950">Your criteria or instructions</span>
            <span className="mt-1 block text-xs leading-5 text-charcoal-500">Optional. Add the format, tone, must-cover points, CTA, audience concern, or anything to avoid.</span>
            <textarea value={instructions} onChange={(event) => onChangeInstructions(event.target.value)} maxLength={2000} rows={5} placeholder="Example: Make this a one-page scorecard for clinic owners, use a professional tone, and end with a consultation CTA." className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            <span className="mt-1 block text-right text-xs text-charcoal-400">{instructions.length}/2000</span>
          </label>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Selected Lead Magnet</div>
                <h2 className="mt-1 text-xl font-bold text-charcoal-950">{selectedIdea || "Lead magnet pending"}</h2>
                <p className="mt-2 text-sm leading-6 text-charcoal-500">{leadMagnetSummary(project, approvedStrategy)}</p>
                {latestGeneration ? <p className="mt-2 text-xs font-semibold text-charcoal-400">Generated {formatDateTime(latestGeneration.createdAt)} with {latestGeneration.model || "AI model"}</p> : null}
              </div>
              <StatusPill status={generatedPackage ? "needs_review" : leadTasks.length ? "ready" : "pending"} />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ArchitectureDetail title="Audience Promise" value={generatedPackage?.leadMagnet.promise || leadMagnetPromise(project, approvedStrategy)} />
              <ArchitectureDetail title="Primary CTA" value={generatedPackage?.landingPage.ctaText || (project?.primaryGoal?.toLowerCase().includes("lead") ? "Get the resource, then book a consultation" : "Download the resource and continue to the next best action")} />
              <ArchitectureDetail title="Data Source" value="Approved strategy, intake profile, project goal, offer, keyword runs, and lead-magnet tasks." />
              <ArchitectureDetail title="Safety Rule" value="SEnuke AI - AI Growth Operating System can generate drafts, but publishing pages or sending emails requires approval." />
            </div>
          </Card>

          {generatedPackage ? (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <IconBadge icon="✦" />
                  <h2 className="font-bold text-brand-700">AI Generated Package</h2>
                </div>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Needs review</span>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <GeneratedBlock title="Lead Asset" items={[generatedPackage.leadMagnet.assetType, generatedPackage.leadMagnet.problemSolved, ...generatedPackage.leadMagnet.outline.slice(0, 4)]} />
                <GeneratedBlock title="Landing Page" items={[generatedPackage.landingPage.headline, generatedPackage.landingPage.subheadline, ...generatedPackage.landingPage.benefitBullets.slice(0, 3)]} />
                <GeneratedBlock title="Delivery Email" items={[generatedPackage.deliveryEmail.subject, generatedPackage.deliveryEmail.previewText]} />
                <GeneratedBlock title="Follow-up Flow" items={generatedPackage.followUpSequence.slice(0, 4).map((item) => `${item.day}: ${item.subject}`)} />
              </div>
            </Card>
          ) : null}

          <details className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer list-none font-bold text-charcoal-950">What will be generated <span className="float-right text-charcoal-400 group-open:rotate-180">⌄</span></summary>
            <p className="mt-1 text-sm text-charcoal-500">Asset, landing page, delivery flow, and tracking package.</p>
            <div className="grid gap-5 lg:grid-cols-4">
              <PlanList title="Lead Asset" items={leadMagnetAssetPlan(project, selectedIdea)} />
              <PlanList title="Landing Page" items={["Headline and promise", "Benefits and proof", "Form CTA copy", "FAQ / objection blocks"]} />
              <PlanList title="Delivery Flow" items={["Thank-you page copy", "Delivery email", "Follow-up email outline", "Next-step CTA"]} />
              <PlanList title="Tracking Tasks" items={["Capture form check", "Conversion event", "Traffic source note", "Review after launch"]} />
            </div>
          </details>

          <details id="lead-magnet-tasks" className="group scroll-mt-24 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer list-none font-bold text-charcoal-950">Execution tasks ({leadTasks.length}) <span className="float-right text-charcoal-400 group-open:rotate-180">⌄</span></summary>
            <DataTable
              title="Lead Magnet Tasks"
              columns={["Task", "Priority", "Status", "Approval", "Action"]}
              rows={leadTasks.length ? leadTasks.slice(0, 8).map((task) => [
                task.title,
                label(task.priority),
                label(task.status),
                task.requiresApproval ? "Required" : "Draft only",
                task.actionButtonLabel || "Review",
              ]) : [["Create lead magnet task", "Medium", "Not created", "Required before publish/send", "Generate Lead Magnet"]]}
              footerAction={<span className="text-sm font-semibold text-charcoal-500">Tasks are created from the approved strategy execution plan. They should not publish, send, or schedule anything without approval.</span>}
            />
          </details>
        </div>

        <div className="space-y-3 xl:col-span-2">
          <details className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer list-none font-bold text-charcoal-950">Readiness details · {readiness.score}% <span className="float-right text-charcoal-400 group-open:rotate-180">⌄</span></summary>
            <div className="mt-4"><ArchitectureReadinessPanel score={readiness.score} rows={readiness.rows} /></div>
          </details>
          <details className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer list-none font-bold text-charcoal-950">How it works <span className="float-right text-charcoal-400 group-open:rotate-180">⌄</span></summary>
            <div className="mt-4 space-y-3 text-sm leading-6 text-charcoal-600">
              <p>1. SEnuke AI - AI Growth Operating System reads the approved strategy, audience, offer, and goal.</p>
              <p>2. It recommends the best gated asset for the current funnel stage.</p>
              <p>3. It prepares the asset outline, landing-page copy, delivery email, thank-you copy, and follow-up flow.</p>
              <p>4. You review and approve before anything is published or sent.</p>
            </div>
            <Link to={project ? `/strategy?projectId=${project.id}` : "/strategy"} className="mt-5 inline-flex w-full justify-center rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 hover:bg-brand-50">
              Review Strategy
            </Link>
          </details>
        </div>
      </div>
    </>
  );
}

function ContextBar({ items }: { items: string[] }) {
  return (
    <Card className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => {
        const [label, value] = item.split(": ");
        return <div key={item}><div className="text-xs font-semibold text-charcoal-500">{label}</div><div className="mt-1 text-sm font-bold text-charcoal-950">{value}</div></div>;
      })}
    </Card>
  );
}

function FilterBar({ labels }: { labels: string[] }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{labels.map((label) => <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-charcoal-800 shadow-sm">{label}</div>)}</div>;
}

function EmptyModuleState({
  title,
  detail,
  compact = false,
  actionTo = "/projects/new",
  actionLabel = "Create Project",
  onAction,
  actionDisabled = false,
}: {
  title: string;
  detail: string;
  compact?: boolean;
  actionTo?: string | null;
  actionLabel?: string | null;
  onAction?: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <Card className={`border-dashed border-slate-200 bg-white ${compact ? "p-4" : "p-6"}`}>
      <h2 className="text-base font-bold text-charcoal-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-charcoal-500">{detail}</p>
      {!compact && actionLabel && onAction ? <button type="button" onClick={onAction} disabled={actionDisabled} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">{actionLabel}</button> : null}
      {!compact && actionTo && actionLabel && !onAction ? <Link to={actionTo} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">{actionLabel}</Link> : null}
    </Card>
  );
}

type ModuleNextStep = {
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel: string;
  actionTo?: string;
  action?: "generate-strategy" | "analyze-site" | "generate-lead-magnet";
  helper?: string;
  tone: "blue" | "emerald" | "amber" | "violet";
};

function getModuleNextStep({
  kind,
  project,
  website,
  latestCrawl,
  siteScanBlocked,
  siteScanRemaining,
  keywordRuns,
}: {
  kind: ModuleKind;
  project: GuidedProject;
  website?: Website | null;
  latestCrawl?: CrawlSummary | null;
  siteScanBlocked: boolean;
  siteScanRemaining: string;
  keywordRuns?: KeywordResearchRun[];
}): ModuleNextStep | null {
  const latestStrategy = project.strategyPlans?.[0];
  const selectedOpportunity = project.opportunities?.find((opportunity) => ["selected", "confirmed"].includes(opportunity.status));
  const strategyApproved = latestStrategy?.status === "approved";
  const projectQuery = `?projectId=${project.id}`;
  if (kind === "strategy") {
    if (!latestStrategy) {
      return {
        eyebrow: "Next step",
        title: "Generate the AI strategy",
        detail: selectedOpportunity
          ? "Use the selected opportunity and intake profile to create positioning, audience, SEO, content, authority, funnel, and execution recommendations."
          : "Select an opportunity first if available, then generate the strategy from the project profile.",
        actionLabel: "Generate Strategy",
        action: "generate-strategy",
        helper: selectedOpportunity ? `Selected opportunity: ${selectedOpportunity.name}` : "Opportunity selection improves strategy quality.",
        tone: "blue",
      };
    }
    if (!strategyApproved) {
      return {
        eyebrow: "Next step",
        title: "Review and approve strategy",
        detail: "Approve the strategy before SEnuke AI - AI Growth Operating System creates downstream execution tasks for sitemap, content, lead magnets, SEO, domains, publishing, and social.",
        actionLabel: "Review Strategy",
        actionTo: `/strategy${projectQuery}`,
        helper: "Draft strategies do not create live execution tasks until approved.",
        tone: "amber",
      };
    }
    return {
      eyebrow: "Next step",
      title: "Create or open execution plan",
      detail: "The approved strategy can now be turned into actionable project and module tasks.",
      actionLabel: "Open Project Plan",
      actionTo: `/guided-projects/${project.id}#execution-tasks`,
      helper: "Execution tasks inherit the approved strategy context.",
      tone: "emerald",
    };
  }
  if (kind === "site-analysis") {
    if (!website) {
      return {
        eyebrow: "Next step",
        title: "Connect a website",
        detail: "Site Analysis needs a website URL before SEnuke AI - AI Growth Operating System can crawl pages, issues, internal links, schema, AI readiness, and conversion opportunities.",
        actionLabel: "Edit Project",
        actionTo: `/guided-projects/${project.id}/intake`,
        helper: "Add the primary website URL in project intake.",
        tone: "amber",
      };
    }
    if (siteScanBlocked) {
      return {
        eyebrow: "Next step",
        title: "Review latest site analysis",
        detail: `A recent crawl already exists. To avoid repeated crawl load, the next scan unlocks in ${siteScanRemaining}.`,
        actionLabel: "Open Site Report",
        actionTo: `/website-projects/${website.id}`,
        helper: latestCrawl ? `${formatNumber(latestCrawl.pagesCrawled)} page(s) crawled in the latest scan.` : "Latest crawl data is available.",
        tone: "emerald",
      };
    }
    return {
      eyebrow: "Next step",
      title: "Run site analysis",
      detail: "Run a crawl to create health, SEO issue, page, internal link, AI citation readiness, and optimization task data.",
      actionLabel: "Analyze Site",
      action: "analyze-site",
      helper: website.url,
      tone: "blue",
    };
  }
  if (kind === "keywords") {
    if (keywordRuns?.some((run) => run.status === "completed" || run.keywordCount > 0 || (run.ideas?.length ?? 0) > 0)) return null;
    return {
      eyebrow: "Next step",
      title: "Add seed keywords",
      detail: "Start with keywords the project actually wants to rank for. SEnuke AI - AI Growth Operating System will fetch demand, SERP competitors, visibility, and page mapping signals.",
      actionLabel: "Add Keywords",
      actionTo: website?.id ? `/keyword-insights?project=${encodeURIComponent(website.id)}&add=1` : "/keyword-insights?add=1",
      helper: website?.url ?? "Keyword runs become available after a website is connected.",
      tone: "violet",
    };
  }
  if (kind === "backlinks") {
    return {
      eyebrow: "Next step",
      title: "Review authority opportunities",
      detail: "Use backlink data with strategy context to identify authority gaps, outreach assets, and linkable content opportunities.",
      actionLabel: "Review Backlinks",
      actionTo: `/backlinks${projectQuery}`,
      helper: "Refresh is rate-limited so users cannot repeatedly run provider calls.",
      tone: "blue",
    };
  }
  if (kind === "ai-citations") {
    return {
      eyebrow: "Next step",
      title: "Review AI search readiness",
      detail: "Check llms.txt, organization schema, NAP profile, sitemap, robots, FAQ, breadcrumbs, and structured-data tasks from the latest crawl.",
      actionLabel: "Open Citation Dashboard",
      actionTo: `/ai-citations${projectQuery}`,
      helper: "Citation tasks should come from live crawl and project data.",
      tone: "violet",
    };
  }
  if (kind === "site-architect") {
    return {
      eyebrow: "Next step",
      title: "Generate or validate site structure",
      detail: "Use the approved strategy, existing crawl, and keyword direction to plan pages, sections, internal links, metadata, and publishing tasks.",
      actionLabel: "Open Site Architect",
      actionTo: `/site-architect${projectQuery}`,
      helper: strategyApproved ? "Strategy is approved." : "Approve strategy first for stronger sitemap recommendations.",
      tone: strategyApproved ? "emerald" : "amber",
    };
  }
  return {
    eyebrow: "Next step",
    title: strategyApproved ? "Generate lead magnet package" : "Approve strategy first",
    detail: strategyApproved
      ? "Create the recommended lead magnet, landing-page copy, delivery email, thank-you page, and CTA flow from the approved strategy."
      : "Lead magnets depend on the approved strategy so the offer, audience, CTA, and funnel are aligned.",
    actionLabel: strategyApproved ? "Generate Lead Magnet" : "Review Strategy",
    action: strategyApproved ? "generate-lead-magnet" : undefined,
    actionTo: strategyApproved ? undefined : `/strategy${projectQuery}`,
    helper: "Nothing publishes or sends until the user approves it.",
    tone: strategyApproved ? "emerald" : "amber",
  };
}

function ModuleNextStepCallout({ step, onAction }: { step: ModuleNextStep; onAction?: () => void }) {
  const toneClass = {
    blue: "border-brand-200 bg-gradient-to-r from-brand-50 via-white to-sky-50 text-brand-700",
    emerald: "border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-brand-50 text-emerald-700",
    amber: "border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 text-amber-700",
    violet: "border-violet-200 bg-gradient-to-r from-violet-50 via-white to-brand-50 text-violet-700",
  }[step.tone];
  const iconClass = {
    blue: "bg-brand-600 text-white",
    emerald: "bg-emerald-600 text-white",
    amber: "bg-amber-500 text-white",
    violet: "bg-violet-600 text-white",
  }[step.tone];
  const buttonClass = {
    blue: "bg-brand-600 hover:bg-brand-700",
    emerald: "bg-emerald-600 hover:bg-emerald-700",
    amber: "bg-amber-500 hover:bg-amber-600",
    violet: "bg-violet-600 hover:bg-violet-700",
  }[step.tone];
  const content = (
    <span className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow-sm ${buttonClass}`}>
      {step.actionLabel} <span className="ml-2">→</span>
    </span>
  );
  return (
    <Card className={`overflow-hidden border ${toneClass}`}>
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-bold shadow-sm ${iconClass}`}>→</div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide">{step.eyebrow}</div>
            <h2 className="mt-1 text-xl font-bold text-charcoal-950">{step.title}</h2>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">{step.detail}</p>
            {step.helper && <div className="mt-3 inline-flex rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-charcoal-600">{step.helper}</div>}
          </div>
        </div>
        <div className="shrink-0">
          {step.actionTo ? <Link to={step.actionTo}>{content}</Link> : <button type="button" onClick={onAction}>{content}</button>}
        </div>
      </div>
    </Card>
  );
}

function MetricGrid({ items }: { items: [string, string, string][] }) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">{items.map(([label, value, detail]) => <Card key={label} className="p-4"><div className="text-xs font-semibold text-charcoal-500">{label}</div><div className="mt-2 text-2xl font-bold text-charcoal-950">{value}</div><div className="mt-1 text-xs font-semibold text-emerald-600">{detail}</div></Card>)}</div>;
}

function OpportunityCard({
  opportunity,
  rank,
  focused,
  selected,
  busy,
  clearing,
  onFocus,
  onDetails,
  onSelect,
  onClearSelection,
}: {
  opportunity: Opportunity;
  rank: number;
  focused: boolean;
  selected: boolean;
  busy: boolean;
  clearing: boolean;
  onFocus: () => void;
  onDetails: () => void;
  onSelect: () => void;
  onClearSelection: () => void;
}) {
  const scoreEvidenceComplete = [opportunity.opportunityScore, opportunity.seoScore, opportunity.monetizationScore, opportunity.competitionScore, opportunity.executionScore, opportunity.userFitScore].every((value) => typeof value === "number" && Number.isFinite(value));
  const score = safeScore(opportunity.opportunityScore, 0);
  const shortOpportunityName = opportunity.name.length > 44 ? `${opportunity.name.slice(0, 41)}...` : opportunity.name;
  return (
    <Card className={`relative flex min-h-[330px] flex-col p-4 transition ${selected ? "pt-10" : ""} ${focused ? "border-brand-500 ring-1 ring-brand-200" : "hover:border-brand-200"}`}>
      {selected && <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-xl bg-emerald-600 px-5 py-1.5 text-xs font-black uppercase tracking-wide text-white shadow-sm">Selected</span>}
      <button type="button" onClick={onFocus} className="flex flex-1 flex-col text-left">
        <div className="flex items-center justify-between gap-3">
          {!selected ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${rank === 1 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-charcoal-600"}`}>
            {rank === 1 ? "Recommended" : `Option ${rank}`}
          </span> : <span />}
        </div>
        <h2 className="mt-4 min-h-[52px] text-lg font-bold leading-6 text-charcoal-950">{opportunity.name}</h2>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-charcoal-500">{opportunity.summary || opportunity.problemSolved || "AI-generated opportunity from project intake."}</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="min-w-0 flex-1 space-y-1 text-xs leading-5 text-charcoal-600"><p><b>Expected outcome:</b> {opportunity.recommendedOffer || opportunity.problemSolved || "A focused, measurable project direction."}</p><p><b>Estimated effort:</b> {(opportunity.executionScore ?? 50) >= 82 ? "Low" : (opportunity.executionScore ?? 50) >= 68 ? "Medium" : "High"} · <b>Confidence:</b> {scoreEvidenceComplete ? Math.round(((opportunity.opportunityScore ?? 0) * 0.6) + ((opportunity.userFitScore ?? 0) * 0.4)) : "Insufficient evidence"}{scoreEvidenceComplete ? "%" : ""}</p></div>
          <div className="shrink-0 border-l border-slate-200 pl-3 text-center"><div className="text-3xl font-black leading-none text-emerald-600">{scoreEvidenceComplete ? score : "Not scored"}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-charcoal-400">Overall Score</div></div>
        </div>
        <div className={scoreEvidenceComplete ? "mt-4 grid grid-cols-2 gap-2" : "hidden"}>
          <OpportunityMetricChip label="SEO Potential" value={safeScore(opportunity.seoScore, score)} />
          <OpportunityMetricChip label="Monetization" value={safeScore(opportunity.monetizationScore, score)} />
          <OpportunityMetricChip label="Competition" value={safeScore(opportunity.competitionScore, 50)} tone="amber" />
          <OpportunityMetricChip label="Speed to Launch" value={safeScore(opportunity.executionScore, score)} />
          <OpportunityMetricChip label="User Fit" value={safeScore(opportunity.userFitScore, score)} />
        </div>
      </button>
      {selected ? (
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={onDetails} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-charcoal-800 hover:bg-slate-50">View Details</button>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={clearing}
            className="w-full rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          >
            {clearing ? `Removing ${shortOpportunityName}...` : "Remove Strategy Direction"}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2"><button type="button" onClick={onDetails} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-charcoal-800 hover:bg-slate-50">View Details</button><button
          type="button"
          onClick={onSelect}
          disabled={busy}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {busy ? `Selecting ${shortOpportunityName}...` : opportunity.status === "confirmation_required" ? "Confirm Direction" : "Select Opportunity"}
        </button></div>
      )}
    </Card>
  );
}

function OpportunityMetricChip({ label, value, tone = "emerald" }: { label: string; value: number; tone?: "emerald" | "amber" }) {
  const valueLabel = tone === "amber" ? competitionLabel(value) : scoreQuality(value);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11px] font-bold text-charcoal-600" title={label}>{label}</span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{valueLabel}</span>
        </div>
      </div>
      <div className={`shrink-0 text-sm font-black ${tone === "amber" ? "text-amber-600" : "text-emerald-600"}`}>{value}</div>
    </div>
  );
}

function OpportunityFitRow({ label, intake, response, score }: { label: string; intake: string; response: string; score: number }) {
  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  const quality = scoreQuality(normalized);
  const comparable = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const directMatch = comparable(intake) === comparable(response);
  return <div className="grid gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_150px] md:items-center md:gap-4">
    <div className="text-xs font-black uppercase tracking-wide text-charcoal-700">{label}</div>
    <div><div className="mb-1 text-[10px] font-bold uppercase text-charcoal-400 md:hidden">Saved intake</div><p className="line-clamp-3 text-xs leading-5 text-charcoal-600" title={intake}>{intake}</p></div>
    <div><div className="mb-1 text-[10px] font-bold uppercase text-charcoal-400 md:hidden">Opportunity response</div>{directMatch ? <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"><span>✓</span><span>Direct match — uses saved intake unchanged</span></div> : <p className="line-clamp-3 text-xs font-semibold leading-5 text-charcoal-800" title={response}>{response}</p>}</div>
    <div><div className="flex items-center justify-between text-[10px] font-bold"><span className="text-emerald-700">{quality}</span><span className="text-charcoal-500">{normalized}/100</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-emerald-600" style={{ width: `${normalized}%` }} /></div></div>
  </div>;
}

function intakeItems(value: string | null | undefined) {
  return (value || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function audienceIntakeSummary(project: GuidedProject) {
  const items = intakeItems(project.businessProfile?.targetAudience);
  if (!items.length) return "No target audience has been saved.";
  return `${items.length} audience segment${items.length === 1 ? "" : "s"} saved: ${items.slice(0, 2).join("; ")}${items.length > 2 ? `; +${items.length - 2} more` : ""}.`;
}

function opportunityAudienceResponse(project: GuidedProject) {
  const count = intakeItems(project.businessProfile?.targetAudience).length;
  if (!count) return "Define the audience before using it for messaging and targeting.";
  return `Use the ${count} saved audience segment${count === 1 ? "" : "s"} to shape buyer-intent keywords, benefit-led page messaging, and lead-focused calls to action.`;
}

function opportunityGoalResponse(project: GuidedProject) {
  const goal = (project.primaryGoal || "").toLowerCase();
  if (/lead|enquir|booking|appointment/.test(goal)) return "Prioritize high-intent searches, service landing pages, proof, and enquiry or booking calls to action.";
  if (/sale|revenue|conversion/.test(goal)) return "Prioritize commercial keywords, offer pages, conversion improvements, and measurable purchase actions.";
  if (/traffic|ranking|seo/.test(goal)) return "Prioritize keyword coverage, content gaps, technical SEO, and pages capable of gaining organic visibility.";
  if (/brand|authority|visibility/.test(goal)) return "Prioritize expert content, topical coverage, trusted citations, and consistent brand visibility.";
  return "Use the primary objective to rank recommendations and select the highest-impact next actions.";
}

function offerIntakeSummary(project: GuidedProject) {
  const offers = intakeItems(project.businessProfile?.offerSummary);
  const niche = project.niche || "Niche not provided";
  if (!offers.length) return niche;
  return `${offers.length} core offer${offers.length === 1 ? "" : "s"}: ${offers.slice(0, 3).join("; ")}${offers.length > 3 ? `; +${offers.length - 3} more` : ""}.`;
}

function opportunityOfferResponse(project: GuidedProject, opportunity: Opportunity | undefined) {
  const offers = intakeItems(project.businessProfile?.offerSummary);
  const savedRecommendation = opportunity?.recommendedOffer?.trim();
  const genericRecommendation = savedRecommendation && /^(lead|leads|sale|sales|traffic|ranking|rankings|branding)$/i.test(savedRecommendation);
  const leadOffer = offers[0] || (!genericRecommendation ? savedRecommendation : null) || project.niche || "the core offer";
  return `Position ${leadOffer} as the primary solution, then support it with clear benefits, proof, service pages, and conversion paths.`;
}

function opportunityExecutionApproach(project: GuidedProject, opportunity: Opportunity | undefined) {
  const speed = safeScore(opportunity?.executionScore, safeScore(opportunity?.opportunityScore, 72));
  const pace = speed >= 82 ? "Fast-track" : speed >= 68 ? "Phased" : "Longer-term";
  const websitePath = project.websiteStatus === "existing_website" || project.projectType === "existing_website"
    ? "existing-site optimization"
    : project.websiteStatus === "no_website_required"
      ? "campaign execution without a website dependency"
      : "new-site planning and launch";
  const timeline = project.targetLaunchTimeline ? ` prioritized for the ${project.targetLaunchTimeline} delivery window` : " sequenced around project readiness";
  return `${pace} ${websitePath}${timeline}.`;
}

function opportunityMarketResponse(project: GuidedProject) {
  const markets = Array.isArray(project.targetLocations) ? project.targetLocations.map(String).filter(Boolean) : project.targetLocation ? [project.targetLocation] : [];
  if (!markets.length) return "Add at least one Target Market to create a market-specific search recommendation.";
  const niche = project.niche || project.businessProfile?.businessSummary || "the project offer";
  const goal = (project.primaryGoal || "the primary project goal").toLowerCase();
  return `Build localized keyword, landing-page, AI citation, and conversion coverage for ${niche} across ${markets.join(", ")}, prioritizing ${goal}.`;
}

function OpportunityNextStepCallout({ project, opportunity }: { project: GuidedProject; opportunity: Opportunity }) {
  const nextStep = opportunityFlowNextStep(project);
  return (
    <Card className="overflow-hidden border-brand-200 bg-gradient-to-r from-brand-50 via-white to-emerald-50">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4 p-5">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-sm">→</div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-700">Next step after opportunity selection</div>
            <h2 className="mt-1 text-xl font-bold text-charcoal-950">{nextStep.title}</h2>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">{nextStep.description}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-white/90 px-3 py-1 text-brand-700 shadow-sm">Selected: {opportunity.name}</span>
              <span className="rounded-full bg-white/90 px-3 py-1 text-charcoal-600 shadow-sm">Score {safeScore(opportunity.opportunityScore, 72)}/100</span>
              <span className="rounded-full bg-white/90 px-3 py-1 text-charcoal-600 shadow-sm">{nextStep.badge}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 px-5 pb-5 lg:px-5 lg:py-5">
          <Link
            to={nextStep.to}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
          >
            {nextStep.actionLabel} <span className="ml-2">→</span>
          </Link>
          <Link
            to={`/guided-projects/${project.id}`}
            className="inline-flex items-center justify-center rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 shadow-sm hover:bg-brand-50"
          >
            View Project
          </Link>
        </div>
      </div>
    </Card>
  );
}

function opportunityFlowNextStep(project: GuidedProject) {
  return nextProjectFlowStep(project);
}

function OpportunityDetailsDrawer({
  opportunity,
  open,
  onClose,
  onSelect,
  selected,
}: {
  opportunity: Opportunity | undefined;
  open: boolean;
  onClose: () => void;
  onSelect?: () => void;
  selected: boolean;
}) {
  if (!open || !opportunity) return null;
  const score = safeScore(opportunity.opportunityScore, 72);
  const metrics = opportunityMetrics(opportunity);
  const reasons = opportunityReasons(opportunity);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Opportunity details">
      <button type="button" className="absolute inset-0 bg-charcoal-950/30" aria-label="Close opportunity details" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Opportunity Details</div>
            <h2 className="mt-1 text-xl font-bold leading-7 text-charcoal-950">{opportunity.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg font-bold text-charcoal-500 hover:bg-slate-50" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Overall Score</div>
            <div className="mt-1 text-4xl font-bold text-emerald-700">{score}</div>
            <p className="mt-2 text-sm leading-6 text-charcoal-700">{opportunity.summary || "This opportunity was generated from the project intake and current business profile."}</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-charcoal-500">{metric.label}</div>
                <div className="mt-1 text-xl font-bold text-charcoal-950">{metric.value}</div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className={`h-1.5 rounded-full ${metric.tone === "amber" ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${metric.value}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-4">
            <AudienceDetailBlock value={opportunity.targetAudience} />
            <DetailBlock title="Problem solved" value={opportunity.problemSolved} />
            <DetailBlock title="Recommended offer" value={opportunity.recommendedOffer} />
            <DetailBlock title="Business model" value={opportunity.businessModel} />
          </div>
          <div className="mt-5 rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-charcoal-950">Why choose this</h3>
            <div className="mt-3 space-y-2">
              {reasons.map((reason) => (
                <div key={reason} className="flex gap-2 text-sm leading-6 text-charcoal-600">
                  <span className="font-bold text-emerald-600">✓</span>
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={selected ? undefined : onSelect}
            disabled={selected || !onSelect}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
          >
            {selected ? "Already selected for strategy" : "Select Opportunity"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function OpportunityCompareDrawer({
  opportunities,
  open,
  onClose,
  onFocus,
  onSelect,
}: {
  opportunities: Opportunity[];
  open: boolean;
  onClose: () => void;
  onFocus: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Compare opportunities">
      <button type="button" className="absolute inset-0 bg-charcoal-950/30" aria-label="Close comparison" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Compare</div>
            <h2 className="mt-1 text-xl font-bold text-charcoal-950">Why Choose One Opportunity</h2>
            <p className="mt-1 text-sm text-charcoal-500">Compare scores, tradeoffs, and best-fit reasons before selecting the strategy direction.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg font-bold text-charcoal-500 hover:bg-slate-50" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-3">
            {opportunities.map((opportunity, index) => {
              const score = safeScore(opportunity.opportunityScore, 72);
              const reasons = opportunityReasons(opportunity).slice(0, 3);
              return (
                <div key={opportunity.id} className={`flex min-h-[360px] flex-col rounded-lg border p-4 ${["selected", "confirmed"].includes(opportunity.status) ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-charcoal-600">{["selected", "confirmed"].includes(opportunity.status) ? (opportunity.status === "confirmed" ? "Confirmed" : "Selected") : opportunity.status === "saved" ? "Saved" : `Option ${index + 1}`}</span>
                    <span className="text-2xl font-bold text-emerald-600">{score}</span>
                  </div>
                  <h3 className="mt-3 text-base font-bold leading-6 text-charcoal-950">{opportunity.name}</h3>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-charcoal-600">
                    {reasons.map((reason) => <div key={reason}>✓ {reason}</div>)}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    {opportunityMetrics(opportunity).slice(0, 4).map((metric) => (
                      <div key={metric.label} className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                        <div className="font-semibold text-charcoal-500">{metric.label}</div>
                        <div className="mt-1 font-bold text-charcoal-950">{metric.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto pt-4">
                    <button type="button" onClick={() => onFocus(opportunity.id)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-charcoal-800 hover:bg-slate-50">View Details</button>
                    <button type="button" onClick={() => onSelect(opportunity.id)} disabled={["selected", "confirmed"].includes(opportunity.status)} className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
                      {["selected", "confirmed"].includes(opportunity.status) ? (opportunity.status === "confirmed" ? "Confirmed" : "Selected") : "Choose This"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailBlock({ title, value }: { title: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{title}</div>
      <p className="mt-1 text-sm leading-6 text-charcoal-700">{value || "Not provided"}</p>
    </div>
  );
}

function AudienceDetailBlock({ value }: { value: string | null }) {
  const segments = splitAudience(value || "");
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Audience</div>
      {segments.length > 0 ? (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-3">
          {segments.map((segment, index) => (
            <li key={`${segment}-${index}`} className="py-2 text-sm leading-6 text-charcoal-700">{segment}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm leading-6 text-charcoal-700">Not provided</p>
      )}
    </div>
  );
}

function opportunityMetrics(opportunity: Opportunity) {
  const score = safeScore(opportunity.opportunityScore, 72);
  return [
    { label: "SEO", value: safeScore(opportunity.seoScore, score), tone: "emerald" },
    { label: "Revenue", value: safeScore(opportunity.monetizationScore, score), tone: "emerald" },
    { label: "Competition", value: safeScore(opportunity.competitionScore, 50), tone: "amber" },
    { label: "Speed", value: safeScore(opportunity.executionScore, score), tone: "emerald" },
    { label: "User Fit", value: safeScore(opportunity.userFitScore, score), tone: "emerald" },
  ] as const;
}

function opportunityReasons(opportunity: Opportunity) {
  const metrics = opportunityMetrics(opportunity);
  const best = [...metrics].sort((a, b) => b.value - a.value).slice(0, 2);
  return [
    opportunity.problemSolved ? `Solves: ${opportunity.problemSolved}` : null,
    opportunity.recommendedOffer ? `Best offer angle: ${opportunity.recommendedOffer}` : null,
    ...best.map((metric) => `${metric.label} is ${scoreQuality(metric.value).toLowerCase()} at ${metric.value}/100.`),
    opportunity.businessModel ? `Fits the ${opportunity.businessModel} model.` : null,
  ].filter((item): item is string => Boolean(item));
}

function opportunityInsightScoreRows(opportunity: Opportunity | undefined) {
  const score = safeScore(opportunity?.opportunityScore, 72);
  const demand = Math.round(avg([opportunity?.seoScore, opportunity?.userFitScore, opportunity?.opportunityScore]) ?? score);
  const seoPotential = safeScore(opportunity?.seoScore, score);
  const revenue = safeScore(opportunity?.monetizationScore, score);
  const executionSpeed = safeScore(opportunity?.executionScore, score);
  const complexity = Math.max(0, 100 - executionSpeed);
  const confidence = Math.round(avg([opportunity?.seoScore, opportunity?.monetizationScore, opportunity?.userFitScore, opportunity?.executionScore]) ?? score);

  return [
    { label: "Profile Demand Fit", value: demand, tone: "emerald" },
    { label: "SEO Potential", value: seoPotential, tone: "emerald" },
    { label: "Revenue Potential", value: revenue, tone: "emerald" },
    { label: "Execution Complexity", value: complexity, tone: "amber" },
    { label: "Confidence", value: confidence, tone: "emerald" },
  ] as const;
}

function OpportunityInsights({ project, niche, opportunity, opportunityCount, taskCount, marketEvidenceAvailable, reassessing, onReassess, onReport }: { project: GuidedProject; niche: string; opportunity: Opportunity | undefined; opportunityCount: number; taskCount: number; marketEvidenceAvailable: boolean; reassessing: boolean; onReassess: () => void; onReport: () => void }) {
  const score = safeScore(opportunity?.opportunityScore, 72);
  const scoreRows = opportunityInsightScoreRows(opportunity);
  const scoreEvidenceComplete = Boolean(opportunity && [opportunity.opportunityScore, opportunity.seoScore, opportunity.monetizationScore, opportunity.competitionScore, opportunity.executionScore, opportunity.userFitScore].every((value) => typeof value === "number" && Number.isFinite(value)));
  const details = [
    { label: "Type", value: projectTypeLabel(project) },
    { label: "Niche", value: niche },
    { label: "Goal", value: project.primaryGoal || "Not provided" },
    { label: "Budget", value: project.businessProfile?.budgetLevel || "Not provided" },
    { label: "Publishing", value: project.preferredPublishingMethod || "Not provided" },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="text-lg font-bold text-charcoal-950">Opportunity Insights</h2><p className="mt-1 max-w-4xl text-xs leading-5 text-charcoal-500">Planning estimates from project profile, niche, location, timeline, outputs, and website readiness. Keyword/crawl data will refine these later.</p></div>
        <button type="button" onClick={onReport} className="shrink-0 rounded-xl border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 shadow-sm hover:bg-brand-50">Opportunity Factors →</button>
      </div>
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.5fr)_220px_minmax(0,1fr)]">
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {scoreEvidenceComplete ? scoreRows.map((row) => <OpportunityScoreBar key={row.label} label={row.label} value={row.value} tone={row.tone} />) : <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900 sm:col-span-2"><b>Numeric scores need Keyword Analysis evidence.</b><p className="mt-1">Your Business Profile and opportunity options are complete. Select the best direction using its audience, offer, and business-fit explanation. Numeric scores will become available after Keyword Analysis returns valid search volume and SEO difficulty.</p>{marketEvidenceAvailable ? <button type="button" disabled={reassessing} onClick={onReassess} className="mt-3 inline-flex rounded-lg bg-amber-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{reassessing ? "Reassessing…" : "Reassess opportunities with completed evidence →"}</button> : opportunity && ["selected", "confirmed"].includes(opportunity.status) ? <Link to={"/keywords?projectId=" + encodeURIComponent(project.id)} className="mt-3 inline-flex rounded-lg bg-amber-700 px-4 py-2 text-xs font-black text-white">Continue to Keyword Analysis →</Link> : <a href="#opportunity-options" className="mt-3 inline-flex rounded-lg bg-amber-700 px-4 py-2 text-xs font-black text-white">Review and select an opportunity →</a>}</div>}
          {scoreEvidenceComplete && <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-charcoal-600 sm:col-span-2">Complexity is inverted from speed to launch. Lower complexity means easier to execute.</div>}
        </div>
        <div className="grid grid-cols-3 gap-2 xl:grid-cols-1">
          <div className="grid place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 p-3 text-center text-white shadow-sm"><div className={scoreEvidenceComplete ? "text-3xl font-black" : "text-sm font-black"}>{scoreEvidenceComplete ? score : "Not scored"}</div><div className="text-[11px] font-bold uppercase tracking-wide text-brand-50">Overall Score</div></div>
          <div className="grid place-items-center rounded-xl border border-slate-200 bg-white p-3 text-center"><div className="text-2xl font-black text-charcoal-950">{opportunityCount}</div><div className="text-[11px] font-bold uppercase text-charcoal-400">Generated options</div></div>
          <div className="grid place-items-center rounded-xl border border-slate-200 bg-white p-3 text-center"><div className="text-2xl font-black text-charcoal-950">{taskCount}</div><div className="text-[11px] font-bold uppercase text-charcoal-400">Related tasks</div></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {details.map((item) => <div key={item.label}><div className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{item.label}</div><div className="mt-1 text-sm font-bold leading-5 text-charcoal-900">{item.value}</div></div>)}
        </div>
      </div>
    </Card>
  );
}

function OpportunityReportDrawer({ opportunity, open, onClose, projectId }: { opportunity: Opportunity | undefined; open: boolean; onClose: () => void; projectId: string }) {
  if (!open) return null;
  const score = safeScore(opportunity?.opportunityScore, 72);
  const metrics = opportunity ? opportunityMetrics(opportunity) : [];
  const reasons = opportunity ? opportunityReasons(opportunity) : [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-charcoal-950/30" aria-label="Close opportunity report" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Opportunity Report</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-950">{opportunity?.name ?? "No opportunity selected"}</h2>
              <p className="mt-2 text-sm leading-6 text-charcoal-500">Scored recommendation, fit rationale, execution path, and strategy handoff context.</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg font-bold text-charcoal-500 hover:bg-slate-50" aria-label="Close">×</button>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <Card className="p-5">
            <div className="grid gap-4 md:grid-cols-[140px_1fr]">
              <div className="grid h-32 w-32 place-items-center rounded-full border-[10px] border-emerald-600 text-center">
                <div><div className="text-3xl font-bold text-charcoal-950">{score}</div><div className="text-xs text-charcoal-500">Overall Score</div></div>
              </div>
              <div>
                <h3 className="font-bold text-charcoal-950">Recommendation Summary</h3>
                <p className="mt-2 text-sm leading-6 text-charcoal-600">{opportunity?.summary || opportunity?.problemSolved || "Refresh opportunities to generate a detailed opportunity report."}</p>
                <div className="mt-4 overflow-x-auto pb-1">
                  <div className="grid min-w-[560px] grid-cols-5 gap-2">
                    {metrics.map((metric) => (
                      <div key={metric.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
                        <div className="truncate text-[11px] font-bold text-charcoal-500">{metric.label}</div>
                        <div className={`mt-0.5 text-base font-black ${metric.tone === "amber" ? "text-amber-600" : "text-emerald-600"}`}>{metric.value}/100</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="font-bold text-charcoal-950">Why SEnuke AI - AI Growth Operating System Recommends This</h3>
            <div className="mt-4 space-y-3">
              {(reasons.length ? reasons : ["No scored rationale is available yet. Refresh opportunities after completing intake."]).map((reason, index) => (
                <div key={`${opportunity?.id ?? "report"}-reason-${index}`} className="flex gap-2 text-sm leading-6 text-charcoal-600">
                  <span className="font-bold text-emerald-600">✓</span>
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="font-bold text-charcoal-950">Strategy Handoff</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailBlock title="Target audience" value={opportunity?.targetAudience ?? null} />
              <DetailBlock title="Problem solved" value={opportunity?.problemSolved ?? null} />
              <DetailBlock title="Recommended offer" value={opportunity?.recommendedOffer ?? null} />
              <DetailBlock title="Business model" value={opportunity?.businessModel ?? null} />
            </div>
          </Card>
        </div>
        <div className="sticky bottom-0 border-t border-slate-100 bg-white p-5">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 hover:bg-slate-50">Close</button>
            <Link to={`/keywords?projectId=${projectId}`} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700">Run Keyword Analysis</Link>
          </div>
        </div>
      </aside>
    </div>
  );
}

function OpportunityScoreBar({ label, value, tone = "emerald" }: { label: string; value: number; tone?: "emerald" | "amber" }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-semibold text-charcoal-600"><span>{label}</span><span>{value}/100</span></div>
      <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${tone === "amber" ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

function InfoCard({ title, items }: { title: string; items: string[] }) {
  return <Card className="p-5"><h2 className="font-bold text-brand-700">{title}</h2><div className="mt-4 flex flex-wrap gap-2">{items.map((item) => <span key={item} className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-semibold text-charcoal-700">✓ {item}</span>)}</div></Card>;
}

function StepsCard({ title, steps }: { title: string; steps: string[] }) {
  return <Card className="p-5"><h2 className="font-bold text-brand-700">{title}</h2><div className="mt-3 divide-y divide-slate-100">{steps.map((step, index) => <div key={step} className="flex items-center gap-3 py-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{index + 1}</span><span className="font-semibold text-charcoal-900">{step}</span><span className="ml-auto text-brand-600">›</span></div>)}</div></Card>;
}

function InsightPanel({
  title,
  score,
  lines,
  action,
  onAction,
  actionDisabled,
  secondaryAction,
  onSecondaryAction,
  secondaryDisabled,
}: {
  title: string;
  score: number;
  lines: string[];
  action?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  secondaryDisabled?: boolean;
}) {
  const chart = [{ name: "score", value: score, color: "#0f9f87" }, { name: "rest", value: 100 - score, color: "#e8eef8" }];
  return (
    <Card className="p-5">
      <h2 className="font-bold text-charcoal-950">{title}</h2>
      <div className="my-5 flex justify-center">
        <div className="relative h-36 w-36">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={chart} dataKey="value" innerRadius={48} outerRadius={64} startAngle={90} endAngle={-270}>{chart.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-bold text-charcoal-950">{score}</div><div className="text-xs text-charcoal-500">Overall Score</div></div></div>
        </div>
      </div>
      <div className="space-y-3">{lines.map((line, index) => <div key={`${title}-line-${index}`} className="flex justify-between gap-3 text-sm"><span className="text-charcoal-600">{line}</span><span className="font-bold text-emerald-600">✓</span></div>)}</div>
      {action ? (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {action}
        </button>
      ) : null}
      {secondaryAction ? (
        <button
          type="button"
          onClick={onSecondaryAction}
          disabled={secondaryDisabled}
          className="mt-2 w-full rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
        >
          {secondaryAction}
        </button>
      ) : null}
    </Card>
  );
}

function TextPanel({ title, items }: { title: string; items: string[] }) {
  return <Card className="p-5"><h2 className="font-bold text-brand-700">{title}</h2><div className="mt-4 space-y-4">{items.map((item, index) => <div key={`${title}-item-${index}`} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-sm leading-6 text-charcoal-700">{item}</div>)}</div></Card>;
}

function DataTable({ title, columns, rows, footerAction }: { title: string; columns: string[]; rows: ReactNode[][]; footerAction?: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 p-4 font-bold text-charcoal-950">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white text-xs text-charcoal-500"><tr>{columns.map((column) => <th key={column} className="px-4 py-3 font-bold">{column}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? rows.map((row, rowIndex) => <tr key={`${row.join("|")}-${rowIndex}`} className="hover:bg-slate-50">{row.map((cell, index) => <td key={`${cell}-${index}`} className={`px-4 py-3 ${index === 0 ? "font-bold text-brand-700" : "text-charcoal-700"}`}>{cell}</td>)}</tr>) : (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-charcoal-400">No records yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {footerAction && <div className="border-t border-slate-100 p-4">{footerAction}</div>}
    </Card>
  );
}

function AuthorityInsights({ data }: { data: ModuleData }) {
  const summary = data.backlinkSummary;
  const hasProviderFacts = Boolean(summary && [summary.referringDomains, summary.backlinks, summary.dofollow, summary.spamScore].some((value) => value != null));
  if (!hasProviderFacts) return <InfoCard title="Backlink Data" items={["Provider data unavailable", "Run an approved refresh or allow scheduled authority monitoring to establish the first baseline.", "Unavailable provider values are not treated as zero."]} />;
  const authorityScore = backlinkAuthorityScore(data);
  const followRate = percentage(summary?.dofollow, summary?.backlinks);
  const lostRate = percentage(summary?.backlinksLost, summary?.backlinks);
  const newRate = percentage(summary?.backlinksNew, summary?.backlinks);
  const lines = [
    `Referring Domains ${summary?.referringDomains == null ? "Unavailable" : formatNumber(summary.referringDomains)}`,
    `Dofollow Ratio ${followRate}%`,
    `New Link Rate ${newRate}%`,
    `Lost Link Rate ${lostRate}%`,
    `Spam Score ${formatNumber(summary?.spamScore)}`,
  ];
  return (
    <div className="space-y-4">
      <InsightPanel title="Authority Insights" score={authorityScore} lines={lines} />
      <InfoCard
        title="Backlink Data"
        items={[
          `Target ${summary?.target || data.websites[0]?.domain || "No website"}`,
          `Cached ${summary?.cached ? "Yes" : "No"}`,
          `Fetched ${summary?.fetchedAt ? new Date(summary.fetchedAt).toLocaleDateString() : "Not yet"}`,
        ]}
      />
    </div>
  );
}

function SideStack({ title = "Keyword Insights", data }: { title?: string; data: ModuleData }) {
  return (
    <div className="space-y-4">
      <InsightPanel title={title} score={averageOpportunityScore(data)} lines={[`Average Search Volume ${formatNumber(avg(data.keywordRuns.map((run) => run.avgSearchVolume ?? null)))}`, `Average CPC $${money(avg(data.keywordRuns.map((run) => run.avgCpc ?? null)))}`, `Keyword runs ${data.keywordRuns.length}`, `Open tasks ${data.tasks.length}`]} />
      <InfoCard title="Recommended Next Actions" items={taskSteps(data.tasks, ["keyword", "content", "backlink"]).slice(0, 4)} />
    </div>
  );
}

function KeywordInsightsBanner({ data, runs, analyzedKeywords, analyzedLocations, language }: { data: ModuleData; runs: KeywordResearchRun[]; analyzedKeywords: string[]; analyzedLocations: string[]; language: string }) {
  const score = averageOpportunityScore(data);
  const chart = [{ name: "score", value: score, color: "#0f9f87" }, { name: "rest", value: 100 - score, color: "#e8eef8" }];
  const metrics = [
    ["Keywords analyzed", formatNumber(analyzedKeywords.length)],
    ["Completed analysis runs", formatNumber(runs.length)],
    ["Locations", analyzedLocations.length <= 3 ? analyzedLocations.join(", ") : `${analyzedLocations.length} markets`],
    ["Language", language],
    ["Search engine", "Google"],
    ["Average Search Volume", formatNumber(avg(data.keywordRuns.map((run) => run.avgSearchVolume ?? null)))],
    ["Average CPC", "$" + money(avg(data.keywordRuns.map((run) => run.avgCpc ?? null)))],
    ["Open tasks", formatNumber(data.tasks.length)],
  ];
  return (
    <Card className="overflow-hidden"><div className="grid bg-gradient-to-r from-white via-brand-50/40 to-emerald-50/40 lg:grid-cols-[300px_1fr]"><div className="flex items-center gap-4 border-b border-slate-200 px-5 py-5 lg:border-b-0 lg:border-r"><div className="relative h-20 w-20 shrink-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chart} dataKey="value" innerRadius={26} outerRadius={36} startAngle={90} endAngle={-270} stroke="none">{chart.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer><div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-lg font-bold leading-none text-charcoal-950">{score}</div><div className="mt-0.5 text-[9px] font-semibold uppercase text-charcoal-400">Score</div></div></div></div><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Keyword Intelligence</div><div className="mt-1 font-bold text-charcoal-950">Research coverage & health</div><div className="mt-1 text-xs leading-5 text-charcoal-500">Campaign scope, demand, cost, and workflow signals.</div></div></div><div><div className="grid grid-cols-2 sm:grid-cols-4">{metrics.slice(4).map(([labelText, value]) => <KeywordOverviewMetric key={labelText} label={labelText} value={value} />)}</div><div className="grid grid-cols-2 border-t border-slate-200 sm:grid-cols-4">{metrics.slice(0, 4).map(([labelText, value]) => <KeywordOverviewMetric key={labelText} label={labelText} value={value} />)}</div></div></div>
    </Card>
  );
}

function KeywordOverviewMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-l border-t border-slate-100 px-4 py-4 first:border-l-0 sm:border-t-0"><div className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div><div className="mt-1 truncate text-base font-bold text-charcoal-950" title={value}>{value || "—"}</div></div>;
}

function TreePanel({ data }: { data: ModuleData }) {
  const pages = websitePlanItems(data);
  return (
    <Card className="p-4">
      <h2 className="font-bold text-charcoal-950">Site Structure <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs text-charcoal-500">{pages.length} Pages</span></h2>
      {pages.length ? (
        <>
          <div className="mt-4 space-y-2">{pages.map((page, index) => <div key={page} className={`rounded-lg px-3 py-2 text-sm font-semibold ${index === 0 ? "bg-brand-50 text-brand-700" : "text-charcoal-700"}`}>{index > 2 ? "  " : ""}{page}</div>)}</div>
          <button className="mt-4 w-full rounded-lg border border-brand-100 px-3 py-2 text-sm font-bold text-brand-600">+ Add Page</button>
        </>
      ) : <EmptyModuleState title="No site pages yet" detail="Site structure will appear after a project, crawl, or sitemap generation exists." compact />}
    </Card>
  );
}

function label(value: string | null | undefined) {
  if (!value) return "Not provided";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function projectTypeLabel(project: GuidedProject | null | undefined) {
  if (!project) return "Not provided";
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website);
  if (project.projectType === "existing_website" && !hasWebsite) return "Pre-website project";
  if (project.projectType === "new_business") return hasWebsite ? "New website launch" : "Pre-website project";
  return label(project.projectType);
}

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "0";
  return Math.round(value).toLocaleString();
}

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "0.00";
  return value.toFixed(2);
}

function safeScore(value: number | null | undefined, fallback: number) {
  const score = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreQuality(value: number) {
  if (value >= 85) return "Excellent";
  if (value >= 70) return "Good";
  if (value >= 50) return "Medium";
  return "Low";
}

function competitionLabel(value: number) {
  if (value >= 75) return "High";
  if (value >= 50) return "Medium";
  return "Low";
}

function avg(values: (number | null | undefined)[]) {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function latestSiteScore(data: ModuleData) {
  return data.websites.flatMap((site) => site.crawlJobs ?? []).find((crawl) => crawl.siteScore != null)?.siteScore ?? null;
}

function keywordIdeaCount(data: ModuleData) {
  return data.keywordRuns.reduce((sum, run) => sum + (run.ideas?.length ?? 0), 0);
}

function canRefreshKeyword(run: KeywordResearchRun): boolean {
  if (typeof run.canRefresh === "boolean") return run.canRefresh;
  return run.status === "completed" || run.status === "failed";
}

function refreshBlockedLabel(run: KeywordResearchRun): string {
  if (run.refreshBlockedUntil) return "Refresh available " + formatDateTime(run.refreshBlockedUntil);
  return "Refresh unavailable";
}

function keywordRankLabel(run: KeywordResearchRun): string {
  const rank = run.manualRank ?? run.targetRank ?? null;
  return rank ? "#" + rank : "Not found";
}

function RankMovement({ change }: { change: number | null | undefined }) {
  if (change == null || change === 0) return <span className="text-xs font-semibold text-charcoal-400">-</span>;
  const improved = change < 0;
  return (
    <span className={"inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold " + (improved ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
      <span>{improved ? "+" : "-"}</span>
      <span>{Math.abs(change)}</span>
    </span>
  );
}

function difficultyLabel(value: number) {
  if (value >= 60) return "High";
  if (value >= 35) return "Medium";
  return "Low";
}

function arrayText(value: unknown, fallback: string) {
  if (Array.isArray(value) && value.length) return value.map(String).join(", ");
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function averageOpportunityScore(data: ModuleData) {
  const scores = [
    ...data.keywordRuns.map((run) => run.opportunityScore ?? null),
    latestSiteScore(data),
    data.projects[0]?._count?.opportunities ? 80 + Math.min(15, data.projects[0]._count.opportunities) : null,
  ];
  return Math.max(0, Math.min(100, Math.round(avg(scores) ?? 72)));
}

function strategyScore(data: ModuleData) {
  const project = data.projects[0];
  const completeness = [
    project?.businessProfile?.businessSummary,
    project?.businessProfile?.targetAudience,
    project?.primaryGoal,
    project?.niche,
    project?._count?.strategyPlans,
  ].filter(Boolean).length;
  return Math.min(100, 50 + completeness * 8 + Math.min(10, data.tasks.length));
}

type RoadmapStatus = "Completed" | "In Progress" | "Ready" | "Pending";

function strategyRoadmap(data: ModuleData, strategyApproved: boolean): { title: string; status: RoadmapStatus; reason: string; relatedUrl?: string }[] {
  const project = data.projects[0];
  const projectId = project?.id;
  const approvedGroups = (project?.keywordGroups ?? []).filter((group) => group.status === "approved");
  const approvedKeywords = new Set(approvedGroups.flatMap((group) => Array.isArray(group.keywords) ? group.keywords.map(String) : []).map((keyword) => keyword.trim().toLowerCase()).filter(Boolean));
  const pagePriorities = data.strategyPagePriorities ?? [];
  const completedCrawl = data.websites.flatMap((website) => website.crawlJobs ?? []).find((crawl) => crawl.status === "completed");
  const approval = {
    title: "Approve Strategy",
    status: strategyApproved ? "Completed" as const : "Pending" as const,
    reason: strategyApproved ? "The current Strategy is approved." : "Approve the current Strategy before project-specific execution work is created.",
    relatedUrl: projectId ? `/strategy?projectId=${encodeURIComponent(projectId)}` : "/strategy",
  };
  if (!strategyApproved) return [approval];

  const tasks = data.tasks
    .filter((task) => task.moduleName !== "strategy_approval" && !/approve strategy/i.test(task.title))
    .sort((left, right) => {
      const evidenceRank = (task: GuidedExecutionTask) => {
        const text = `${task.moduleName} ${task.title}`.toLowerCase();
        if (pagePriorities.length > 0 && /site_analysis|site analysis|technical|internal link|page map|content/.test(text)) return 0;
        if (approvedKeywords.size > 0 && /keyword|seo|content|page map/.test(text)) return 1;
        return 2;
      };
      const leftEvidence = evidenceRank(left);
      const rightEvidence = evidenceRank(right);
      if (leftEvidence !== rightEvidence) return leftEvidence - rightEvidence;
      const statusOrder = (status: string) => ["running", "in_progress", "queued", "needs_review", "ready", "pending", "completed", "skipped", "published"].indexOf(status);
      const leftStatus = statusOrder(left.status);
      const rightStatus = statusOrder(right.status);
      if (leftStatus !== rightStatus) return (leftStatus < 0 ? 99 : leftStatus) - (rightStatus < 0 ? 99 : rightStatus);
      const priorityOrder = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      return (priorityOrder[left.priority] ?? 3) - (priorityOrder[right.priority] ?? 3);
    });
  if (!tasks.length) return [approval, {
    title: "Create Project Execution Plan",
    status: "Ready",
    reason: "No downstream tasks exist yet. Create the Execution Plan from this approved Strategy.",
    relatedUrl: projectId ? `/guided-projects/${encodeURIComponent(projectId)}?tab=execution#execution-tasks` : "/guided-projects",
  }];

  const taskStatus = (status: string): RoadmapStatus => {
    if (["completed", "skipped", "approved", "published"].includes(status)) return "Completed";
    if (["running", "queued", "in_progress", "needs_review", "submitted_for_approval", "awaiting_confirmation"].includes(status)) return "In Progress";
    if (status === "ready") return "Ready";
    return "Pending";
  };
  const visible = tasks.slice(0, tasks.length > 8 ? 7 : 8);
  const milestones = visible.map((task) => {
    const taskText = `${task.moduleName} ${task.title}`.toLowerCase();
    const evidence = [
      pagePriorities.length > 0 && /site_analysis|site analysis|technical|internal link|page map|content/.test(taskText) ? `${pagePriorities.length} canonical page priorities from the latest ${completedCrawl?.pagesCrawled ?? 0}-page Site Analysis` : null,
      approvedKeywords.size > 0 && /keyword|seo|content|page map/.test(taskText) ? `${approvedKeywords.size} approved keywords across ${approvedGroups.length} group${approvedGroups.length === 1 ? "" : "s"}` : null,
    ].filter((item): item is string => Boolean(item));
    return {
      title: task.title,
      status: taskStatus(task.status),
      reason: task.blockedReason || `${evidence.length ? `Evidence: ${evidence.join("; ")}. ` : ""}${task.priority ? `${task.priority} priority · ` : ""}${task.status.replace(/_/g, " ")}. ${task.description || "Created from the approved project Strategy."}`,
      relatedUrl: task.relatedUrl || (projectId ? `/guided-projects/${encodeURIComponent(projectId)}?tab=execution#execution-tasks` : "/guided-projects"),
    };
  });
  if (tasks.length > visible.length) milestones.push({
    title: `Review ${tasks.length - visible.length} more execution task${tasks.length - visible.length === 1 ? "" : "s"}`,
    status: tasks.slice(visible.length).some((task) => !["completed", "skipped", "approved", "published"].includes(task.status)) ? "Ready" as const : "Completed" as const,
    reason: "Open the Execution Plan to review the remaining project-specific work.",
    relatedUrl: projectId ? `/guided-projects/${encodeURIComponent(projectId)}?tab=execution#execution-tasks` : "/guided-projects",
  });
  return [approval, ...milestones];
}

function citationTaskScore(tasks: GuidedExecutionTask[]) {
  if (!tasks.length) return 0;
  const completed = tasks.filter((task) => ["completed", "skipped"].includes(task.status)).length;
  return Math.round((completed / tasks.length) * 100);
}

function schemaTypeCount(report: HealthReport | null, type: string, includes = false) {
  if (!report) return 0;
  if (!includes) return report.schema.types[type] ?? 0;
  return Object.entries(report.schema.types).reduce((sum, [schemaType, count]) => schemaType.toLowerCase().includes(type.toLowerCase()) ? sum + count : sum, 0);
}

function smartCitationNextRows(data: ModuleData, report: HealthReport | null, localProfile: NonNullable<Website["localBusinessProfiles"]>[number] | null, napContext?: { ready: boolean; profileUrl: string }) {
  const project = data.projects[0];
  const website = data.websites[0];
  const latestCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "completed");
  const profileUrl = napContext?.profileUrl ?? (project && website ? `/local-seo?projectId=${encodeURIComponent(project.id)}&project=${encodeURIComponent(website.id)}&editProfile=1` : project ? `/guided-projects/${encodeURIComponent(project.id)}/intake` : "/projects");
  const generatorUrl = (type: string, topic: string) => `/ai-content?${new URLSearchParams({ ...(project?.id ? { projectId: project.id } : {}), type, topic, open: "1", ...(website?.rootUrl ? { targetUrl: website.rootUrl } : {}) }).toString()}`;
  const crawlUrl = latestCrawl?.id ? `/crawls/${encodeURIComponent(latestCrawl.id)}` : project ? `/site-analysis?projectId=${encodeURIComponent(project.id)}` : "/site-analysis";
  const rows: { label: string; value: string; ok: boolean; action: string; href?: string }[] = [];
  if (!(napContext?.ready ?? Boolean(localProfile))) {
    rows.push({ label: "Set up NAP profile", value: "Business name, phone, and address are needed for entity confidence.", ok: false, action: "Create profile", href: profileUrl });
  }
  if (!report?.schema.hasOrganization) {
    rows.push({ label: "Add Organization schema", value: "Entity schema is the highest-impact AI citation foundation.", ok: false, action: "Generate", href: generatorUrl("domain_schema", "Generate Organization schema for AI citation readiness") });
  }
  if (!report?.aiSearch.llmsTxtPresent) {
    rows.push({ label: "Create llms.txt", value: "Guide AI crawlers to priority pages and brand facts.", ok: false, action: "Generate", href: generatorUrl("domain_llms_txt", "Generate domain llms.txt for AI citation readiness") });
  }
  if (!report?.faq.hasFAQSchema) {
    rows.push({ label: "Add FAQ schema", value: "Answer-first FAQ sections improve extractability.", ok: false, action: "Generate", href: generatorUrl("page_schema", "Generate FAQPage schema and answer-first FAQ content") });
  }
  if ((report?.schema.invalid ?? 0) > 0) {
    rows.push({ label: "Fix invalid schema", value: `${report?.schema.invalid ?? 0} structured-data issue(s) need cleanup.`, ok: false, action: "Fix", href: crawlUrl });
  }
  const openCitationTasks = data.tasks.filter((task) => {
    const text = `${task.moduleName} ${task.title} ${task.description}`.toLowerCase();
    return !["completed", "skipped"].includes(task.status) && /citation|schema|structured data|faqpage/.test(text);
  }).length;
  if (openCitationTasks > 0) {
    rows.push({ label: "Review open citation tasks", value: `${openCitationTasks} task(s) are waiting for action.`, ok: false, action: "Review", href: project ? `/guided-projects/${encodeURIComponent(project.id)}?tab=execution#execution-tasks` : "/projects" });
  }
  if (!rows.length) {
    rows.push({ label: "Citation foundation", value: "Core AI citation signals are present from the latest crawl.", ok: true, action: "Monitor" });
  }
  return rows.slice(0, 5);
}

function citationTableRows(data: ModuleData, tasks: GuidedExecutionTask[], report: HealthReport | null, localProfile: NonNullable<Website["localBusinessProfiles"]>[number] | null, napReady = Boolean(localProfile), inheritedProfileUrl?: string): ReactNode[][] {
  const project = data.projects[0];
  const website = data.websites[0];
  const latestCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "completed");
  const profileUrl = inheritedProfileUrl ?? (project && website ? `/local-seo?projectId=${encodeURIComponent(project.id)}&project=${encodeURIComponent(website.id)}&editProfile=1` : project ? `/guided-projects/${encodeURIComponent(project.id)}/intake` : "/projects");
  const siteAnalysisUrl = project ? `/site-analysis?projectId=${encodeURIComponent(project.id)}` : "/site-analysis";
  const crawlUrl = latestCrawl?.id ? `/crawls/${encodeURIComponent(latestCrawl.id)}` : siteAnalysisUrl;
  const generatorUrl = (type: string, topic: string) => `/ai-content?${new URLSearchParams({ ...(project?.id ? { projectId: project.id } : {}), type, topic, open: "1", ...(website?.rootUrl ? { targetUrl: website.rootUrl } : {}) }).toString()}`;
  const action = (labelText: string, href: string) => <Link to={href} className="inline-flex rounded-md border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50">{labelText}</Link>;
  if (tasks.length) return tasks.slice(0, 8).map((task) => [task.title, label(task.priority), label(task.status), label(task.priority), action(task.actionButtonLabel || "Open", task.relatedUrl && task.relatedUrl !== "/ai-citations" ? task.relatedUrl : project ? `/guided-projects/${encodeURIComponent(project.id)}?tab=execution&actionTask=${encodeURIComponent(task.id)}#execution-tasks` : "/projects")]);
  const rows: ReactNode[][] = [];
  if (!napReady) {
    rows.push(["Set up NAP profile", "High", "Recommended from profile", "High", action("Create profile", profileUrl)]);
  }
  if (!report) {
    rows.push(["Run site analysis for AI citation data", "High", "Missing crawl data", "High", action("Analyze Site", siteAnalysisUrl)]);
    return rows;
  }
  if (!report.schema.hasOrganization) {
    rows.push(["Add Organization schema", "High", "Missing from latest scan", "High", action("Generate", generatorUrl("domain_schema", "Generate Organization schema for AI citation readiness"))]);
  }
  if (!report.aiSearch.llmsTxtPresent) {
    rows.push(["Create llms.txt", "Medium", "Missing from latest scan", "Medium", action("Generate", generatorUrl("domain_llms_txt", "Generate domain llms.txt for AI citation readiness"))]);
  }
  if (!report.faq.hasFAQSchema) {
    rows.push(["Add FAQPage schema", "Medium", "Missing from latest scan", "Medium", action("Generate", generatorUrl("page_schema", "Generate FAQPage schema and answer-first FAQ content"))]);
  }
  if (!report.breadcrumb.hasBreadcrumbSchema) {
    rows.push(["Add BreadcrumbList schema", "Medium", "Missing from latest scan", "Medium", action("Generate", generatorUrl("page_schema", "Generate BreadcrumbList schema"))]);
  }
  if ((report.schema.invalid ?? 0) > 0) {
    rows.push(["Fix invalid structured data", "High", `${formatNumber(report.schema.invalid)} issue(s) found`, "High", action("Fix", crawlUrl)]);
  }
  if ((report.siteFiles.sitemapUrls ?? 0) === 0) {
    rows.push(["Review sitemap availability", "Medium", "No sitemap URLs found", "Medium", action("Review", crawlUrl)]);
  }
  if (report.siteFiles.robotsStatus !== 200) {
    rows.push(["Review robots.txt access", "Medium", report.siteFiles.robotsStatus ? `Status ${report.siteFiles.robotsStatus}` : "Not checked", "Medium", action("Review", crawlUrl)]);
  }
  return rows.length ? rows.slice(0, 8) : [["Monitor AI citation readiness", "Low", "Core scan signals look ready", "Low", action("Review crawl", crawlUrl)]];
}

function citationReadinessRows(data: ModuleData) {
  const project = data.projects[0];
  const website = data.websites[0];
  const latestCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "completed");
  const strategy = project?.strategyPlans?.[0];
  const rows: string[][] = [
    [
      "Organization / LocalBusiness schema",
      "Helps AI search and answer engines understand the business entity, website, location, and contact identity.",
      latestCrawl ? "Needs validation" : "Needs crawl",
      "High",
      latestCrawl ? "Create schema task" : "Analyze site",
    ],
    [
      "FAQ and answer-first sections",
      "Creates extractable answers for buyer questions and supports AI citation eligibility.",
      strategy?.aiCitationStrategy ? "Strategy guidance available" : "Can start from crawl",
      "High",
      "Create FAQ task",
    ],
    [
      "Source clarity blocks",
      "Adds clear About, services, proof, contact, and policy signals that make the brand easier to cite.",
      project?.businessProfile ? "Profile available" : "Profile missing",
      "Medium",
      project?.businessProfile ? "Create improvement task" : "Complete intake",
    ],
    [
      "llms.txt and sitemap clarity",
      "Gives AI crawlers and search systems a clearer map of priority pages and brand facts.",
      latestCrawl ? "Needs validation" : "Needs crawl",
      "Medium",
      latestCrawl ? "Check files" : "Analyze site",
    ],
  ];
  if (data.keywordRuns.length > 0) {
    rows.push([
      "Keyword-to-answer mapping",
      "Uses researched keywords to create citable answer sections and FAQ targets.",
      `${data.keywordRuns.length} run(s) available`,
      "Medium",
      "Map keywords",
    ]);
  }
  return rows;
}

function taskSteps(tasks: GuidedExecutionTask[], includes: string[]) {
  const lowerIncludes = includes.map((item) => item.toLowerCase());
  return tasks
    .filter((task) => lowerIncludes.some((term) => `${task.moduleName} ${task.title} ${task.description}`.toLowerCase().includes(term)))
    .slice(0, 7)
    .map((task) => task.title);
}

function opportunityCards(data: ModuleData) {
  const project = data.projects[0];
  const fromKeywords = data.keywordRuns.slice(0, 3).map((run) => ({
    title: run.seedKeyword,
    score: Math.round(run.opportunityScore ?? (run.keywordCount ? Math.min(95, 60 + run.keywordCount / 20) : 76)),
    tag: run.intent || "Keyword Opportunity",
  }));
  if (fromKeywords.length) return fromKeywords;
  if (!project) return [];
  return [{ title: project.niche || project.name, score: averageOpportunityScore(data), tag: "Recommended" }];
}

type WebsiteKeywordCandidate = {
  keyword: string;
  volume: number;
  difficulty: number | null;
  opportunity: number;
  competitorCount: number;
  approved: boolean;
};

const PAGE_QUERY_MODIFIERS = new Set(["best", "top", "rated", "leading", "affordable", "cheap", "cheapest", "budget", "economical", "trusted", "reputable", "recommended", "local", "near", "nearby", "closest", "around", "me", "my", "area", "review", "reviews", "rating", "ratings"]);
const PAGE_PROVIDER_ALIASES: Record<string, string> = {
  agent: "provider", agents: "provider", broker: "provider", brokers: "provider",
  advisor: "provider", advisors: "provider", adviser: "provider", advisers: "provider",
  professional: "provider", professionals: "provider", specialist: "provider", specialists: "provider",
  company: "provider", companies: "provider", agency: "provider", agencies: "provider",
  provider: "provider", providers: "provider",
};
const QUESTION_PREFIX = /^(what|why|when|where|who|how|can|does|do|is|are|should)\b/i;
const COMPARISON_SIGNAL = /\b(vs\.?|versus|compare|comparison|alternative|alternatives)\b/i;

function normalizedKeyword(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function pageKeywordTokens(value: string) {
  return normalizedKeyword(value).split(" ")
    .map((token) => PAGE_PROVIDER_ALIASES[token] ?? token)
    .filter((token) => token && !PAGE_QUERY_MODIFIERS.has(token));
}

function keywordSimilarity(left: string, right: string) {
  const leftTokens = new Set(pageKeywordTokens(left));
  const rightTokens = new Set(pageKeywordTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function keywordPageIntent(keyword: string, geographicTerms: string[]) {
  const normalized = normalizedKeyword(keyword);
  if (COMPARISON_SIGNAL.test(normalized)) return "comparison";
  if (QUESTION_PREFIX.test(normalized) || /\b(cost|price|pricing|guide|benefits|process|timeline|checklist)\b/.test(normalized)) return "informational";
  if (geographicTerms.some((term) => normalized.includes(term))) return "local";
  return "commercial";
}

function keywordGeography(keyword: string, geographicTerms: string[]) {
  const normalized = normalizedKeyword(keyword);
  return geographicTerms.filter((term) => normalized.includes(term)).sort().join("|");
}

function displayPageTitle(keyword: string, intent: string) {
  const cleaned = normalizedKeyword(keyword)
    .replace(/\b(near me|around me|close to me|in my area)\b/g, "")
    .replace(/^\s*(best|top rated|top|leading|affordable|cheap|cheapest|budget|economical|trusted|reputable|recommended|local|closest|nearby)\s+/, "")
    .replace(/\s+(reviews?|ratings?)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = (cleaned || normalizedKeyword(keyword)).replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (intent === "comparison" && !/Comparison$/i.test(title)) return `${title} Comparison`;
  return title;
}

function websitePlanItems(data: ModuleData) {
  const website = data.websites[0];
  const project = data.projects[0];
  if (!project && !website) return [];

  const approvedKeywords = approvedKeywordEntries(project?.keywordGroups ?? []);
  const approvedSet = new Set(approvedKeywords.map(normalizedKeyword).filter(Boolean));
  const analyzedByKeyword = new Map<string, WebsiteKeywordCandidate>();
  for (const run of data.keywordRuns.filter((item) => item.status === "completed" || (item.ideas?.length ?? 0) > 0)) {
    const runCandidates = [{ keyword: run.seedKeyword, volume: run.avgSearchVolume ?? run.averageVolume ?? 0, difficulty: run.avgDifficulty ?? null }, ...(run.ideas ?? []).map((idea) => ({ keyword: idea.keyword, volume: idea.avgMonthlySearches ?? 0, difficulty: idea.competitionIndex }))];
    for (const item of runCandidates) {
      const key = normalizedKeyword(item.keyword);
      if (!key) continue;
      const existing = analyzedByKeyword.get(key);
      const candidate: WebsiteKeywordCandidate = {
        keyword: item.keyword.trim(),
        volume: item.volume,
        difficulty: item.difficulty,
        opportunity: run.opportunityScore ?? 0,
        competitorCount: Math.max(run.competitorCount ?? 0, run.competitorsAboveJson?.length ?? 0, run.competitors?.length ?? 0),
        approved: approvedSet.has(key),
      };
      if (!existing || candidate.volume > existing.volume || candidate.opportunity > existing.opportunity) analyzedByKeyword.set(key, candidate);
    }
  }

  // Approved groups define scope. Analyzed related terms may support those
  // clusters, but cannot create unrelated pages merely because an API returned them.
  const candidates = [...new Set(approvedKeywords.map((keyword) => keyword.trim()).filter(Boolean))].map((keyword) => {
    const analyzed = analyzedByKeyword.get(normalizedKeyword(keyword));
    return analyzed ?? { keyword, volume: 0, difficulty: null, opportunity: 0, competitorCount: 0, approved: true };
  });

  const geographicTerms = [...new Set([
    ...(Array.isArray(project?.targetLocations) ? project.targetLocations.map(String) : []),
    project?.targetLocation,
    project?.businessLocationJson?.city,
    project?.businessLocationJson?.stateProvince,
    project?.businessLocationJson?.country,
  ].filter((value): value is string => Boolean(value)).flatMap((value) => value.split(/[,|]/)).map(normalizedKeyword).filter((value) => value.length > 2))];

  const clusters: Array<{ intent: string; primary: WebsiteKeywordCandidate; keywords: WebsiteKeywordCandidate[] }> = [];
  const rankedCandidates = candidates.sort((left, right) => Number(right.approved) - Number(left.approved) || right.opportunity - left.opportunity || right.volume - left.volume || right.competitorCount - left.competitorCount);
  for (const candidate of rankedCandidates) {
    const intent = keywordPageIntent(candidate.keyword, geographicTerms);
    const geography = keywordGeography(candidate.keyword, geographicTerms);
    const cluster = clusters.find((item) => item.intent === intent
      && (intent !== "local" || keywordGeography(item.primary.keyword, geographicTerms) === geography)
      && keywordSimilarity(item.primary.keyword, candidate.keyword) >= 0.66);
    if (cluster) {
      cluster.keywords.push(candidate);
      if (candidate.opportunity + Math.log10(candidate.volume + 1) * 5 > cluster.primary.opportunity + Math.log10(cluster.primary.volume + 1) * 5) cluster.primary = candidate;
    } else {
      clusters.push({ intent, primary: candidate, keywords: [candidate] });
    }
  }

  const pageTitles = clusters
    .sort((left, right) => {
      const intentOrder: Record<string, number> = { commercial: 0, local: 1, comparison: 2, informational: 3 };
      const leftScore = left.primary.opportunity + Math.log10(left.primary.volume + 1) * 5 + Math.min(10, left.primary.competitorCount);
      const rightScore = right.primary.opportunity + Math.log10(right.primary.volume + 1) * 5 + Math.min(10, right.primary.competitorCount);
      return (intentOrder[left.intent] ?? 9) - (intentOrder[right.intent] ?? 9) || rightScore - leftScore;
    })
    .map((cluster) => displayPageTitle(cluster.primary.keyword, cluster.intent));

  return [...new Set([
    "Home",
    ...pageTitles,
    project?.businessName ? `About ${project.businessName}` : "About",
    "Resources / Blog",
    "Contact",
  ])];
}

type ArchitecturePage = { title: string; purpose: string; source: string; status: "Existing" | "Ready" | "Recommended"; slug: string };

function architecturePageBlueprint(data: ModuleData): ArchitecturePage[] {
  const project = data.projects[0];
  const website = data.websites[0];
  const latestCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "completed");
  const keywordIdeas = data.keywordRuns.flatMap((run) => run.ideas?.map((idea) => idea.keyword) ?? [run.seedKeyword]).filter(Boolean).slice(0, 4);
  const businessName = project?.businessName || project?.name || website?.domain || "Project";
  const niche = project?.niche || "core offer";
  const offer = project?.businessProfile?.offerSummary || project?.primaryGoal || niche;
  const rows: ArchitecturePage[] = [
    {
      title: "Home",
      purpose: `Introduce ${businessName}, clarify the offer, and route visitors to the primary conversion path.`,
      source: latestCrawl ? "Existing website scanned" : "Core website requirement",
      status: latestCrawl ? "Existing" : "Ready",
      slug: "/",
    },
    {
      title: "Services / Solutions",
      purpose: `Explain ${offer} and connect each service to proof, FAQs, and conversion CTAs.`,
      source: "Project intake and strategy",
      status: "Recommended",
      slug: "/services",
    },
    {
      title: "About",
      purpose: "Build trust with company context, expertise, process, proof, and entity clarity.",
      source: "Entity and conversion requirement",
      status: "Recommended",
      slug: "/about",
    },
    {
      title: "Resources / Blog",
      purpose: `Support ${niche} search demand with educational pages, comparisons, FAQs, and internal links.`,
      source: data.keywordRuns.length ? "Keyword research" : "SEO content requirement",
      status: "Recommended",
      slug: "/resources",
    },
    {
      title: "Contact / Consultation",
      purpose: "Give high-intent visitors a clear path to request help, book a call, or submit details.",
      source: "Primary conversion goal",
      status: "Recommended",
      slug: "/contact",
    },
    ...keywordIdeas.map((keyword) => ({
      title: label(keyword),
      purpose: `Create or optimize a page around "${keyword}" and map it to the correct funnel stage.`,
      source: "Keyword research",
      status: "Recommended" as const,
      slug: `/${slugify(keyword)}`,
    })),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function architecturePrimaryCta(
  project: GuidedProject | undefined,
  strategy: { offerRecommendation?: string | null } | null,
) {
  if (project?.primaryGoal?.toLowerCase().includes("lead")) return "Book a consultation / Request a quote";
  if (strategy?.offerRecommendation) return `Convert through: ${strategy.offerRecommendation}`;
  return project?.businessProfile?.offerSummary ? "Request a consultation for the primary offer" : "Primary CTA pending from strategy";
}

function architectureSeoFocus(project: GuidedProject | undefined, data: ModuleData) {
  const firstKeyword = data.keywordRuns[0]?.seedKeyword;
  if (firstKeyword) return `Map ${firstKeyword} and related keywords to the strongest matching page.`;
  if (project?.niche) return `Build topical coverage around ${project.niche}.`;
  return "Add keyword research to define page targets.";
}

function architectureSeoInputs(project: GuidedProject | undefined, data: ModuleData) {
  const inputs = [
    project?.niche ? `Niche: ${project.niche}` : "Niche pending",
    Array.isArray(project?.targetLocations) && project.targetLocations.length ? `Target markets: ${project.targetLocations.join(", ")}` : project?.targetLocation ? `Target markets: ${project.targetLocation}` : "Target markets pending",
    data.keywordRuns.length ? `${formatNumber(data.keywordRuns.length)} keyword run(s)` : "Keyword research needed",
    data.keywordRuns[0]?.intent ? `Primary intent: ${label(data.keywordRuns[0].intent)}` : "Intent mapping pending",
  ];
  return inputs;
}

function architectureConversionFlow(project: GuidedProject | undefined, strategy: { offerRecommendation?: string | null } | null) {
  return [
    "Home page clarifies offer and routes by intent",
    "Service pages answer buyer questions and objections",
    strategy?.offerRecommendation || project?.businessProfile?.offerSummary || "Primary offer pending",
    project?.primaryGoal || "Primary goal pending",
  ];
}

function architecturePublishingChecks(project: GuidedProject | undefined, latestCrawl: NonNullable<Website["crawlJobs"]>[number] | undefined) {
  return [
    project?.preferredPublishingMethod ? `Target: ${project.preferredPublishingMethod}` : "Publishing target pending",
    latestCrawl ? "Use latest crawl to avoid duplicate pages" : "Run site analysis before final sitemap",
    "Review URLs, titles, meta, CTAs, schema, and internal links",
    "Publish only after approval",
  ];
}

function architectureActionRows(
  project: GuidedProject | undefined,
  strategy: { status?: string | null } | null,
  latestCrawl: NonNullable<Website["crawlJobs"]>[number] | undefined,
  data: ModuleData,
  tasks: GuidedExecutionTask[],
) {
  if (tasks.length) return taskRows(tasks);
  const rows: string[][] = [];
  if (!project?.businessProfile && !(project?.intakeAnswers?.length)) {
    rows.push(["Complete project profile", "High", "Missing intake context", "High", "Complete Intake"]);
  }
  if (strategy?.status !== "approved") {
    rows.push(["Approve strategy", "High", strategy ? "Draft exists" : "Missing strategy", "High", strategy ? "Approve" : "Generate"]);
  }
  if (!latestCrawl) {
    rows.push(["Analyze existing website", "High", "No crawl data", "High", "Analyze Site"]);
  }
  if (!data.keywordRuns.length) {
    rows.push(["Add keyword targets", "Medium", "No keyword runs", "Medium", "Add Keywords"]);
  }
  rows.push(["Generate sitemap blueprint", "Medium", "Ready after required inputs", "Medium", "Generate"]);
  rows.push(["Map internal links", "Medium", latestCrawl ? "Crawl data available" : "Needs crawl", "Medium", "Prepare"]);
  rows.push(["Prepare page metadata", "Medium", data.keywordRuns.length ? "Keyword data available" : "Needs keywords", "Medium", "Generate"]);
  return rows.slice(0, 8);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page";
}

function keywordRows(runs: KeywordResearchRun[], renderActions?: (run: KeywordResearchRun, keyword: string) => ReactNode, renderKeyword?: (run: KeywordResearchRun, keyword: string) => ReactNode) {
  const rows: ReactNode[][] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const ideas = run.ideas?.length ? run.ideas : [{ keyword: run.seedKeyword, avgMonthlySearches: run.avgSearchVolume ?? null, competitionIndex: run.avgDifficulty ?? null, cpc: run.avgCpc ?? null, currency: "USD", rawJson: null }];
    let showedRunSummary = false;
    for (const idea of ideas) {
      const key = `${idea.keyword.trim().toLowerCase()}|${run.seedKeyword.trim().toLowerCase()}|${run.locationName.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const difficulty = idea.competitionIndex;
      const score = keywordOpportunityScore(idea.avgMonthlySearches, difficulty);
      const includeRunSummary = !showedRunSummary;
      showedRunSummary = true;
      rows.push([
        renderKeyword ? renderKeyword(run, idea.keyword) : idea.keyword,
        run.seedKeyword,
        <div><div className="font-semibold text-charcoal-800">{run.locationName}</div><div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{keywordMetricScope(run, idea.rawJson)}</div></div>,
        formatOptionalNumber(idea.avgMonthlySearches),
        difficulty == null ? "—" : `${Math.round(difficulty)} ${difficultyLabel(difficulty)}`,
        idea.cpc == null ? "—" : `$${money(idea.cpc)}`,
        score == null ? "—" : String(score),
        includeRunSummary ? keywordRankLabel(run) : "—",
        ...(renderActions ? [renderActions(run, idea.keyword)] : []),
      ]);
    }
  }
  return rows;
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? "—" : Math.round(value).toLocaleString();
}

function keywordMetricScope(run: KeywordResearchRun, rawJson: unknown): string {
  const evidence = rawJson && typeof rawJson === "object" && !Array.isArray(rawJson) ? rawJson as Record<string, unknown> : null;
  const metricScope = typeof evidence?.metricScope === "string" ? evidence.metricScope : null;
  const metricSource = typeof evidence?.metricSource === "string" ? evidence.metricSource : null;
  if (metricScope) {
    const conciseScope = metricScope.split(",")[0]?.trim() || metricScope;
    if (metricSource === "country_fallback") return `${conciseScope} fallback`;
    if (metricSource === "parent_city") return `${conciseScope} parent market`;
    if (metricSource === "unavailable") return `${conciseScope} · no exact metrics`;
    const difficultyScope = typeof evidence?.seoDifficultyScope === "string" ? evidence.seoDifficultyScope.trim() : "";
    if (difficultyScope && difficultyScope.toLocaleLowerCase() !== conciseScope.toLocaleLowerCase()) {
      return `${conciseScope} volume/CPC · ${difficultyScope} SEO difficulty`;
    }
    return conciseScope;
  }
  const locationParts = run.locationName.split(",").map((part) => part.trim()).filter(Boolean);
  return locationParts.length > 1 ? `${locationParts.at(-1)} legacy` : `${run.locationName} legacy`;
}

function crawlIssueRows(issues: CrawlIssue[], data: ModuleData, latest?: CrawlSummary) {
  if (issues.length) {
    return issues.slice(0, 8).map((issue) => [
      issue.message || label(issue.issueType),
      label(issue.category),
      label(issue.severity),
      issue.page?.url ? shortUrl(issue.page.url) : "Site-wide",
      issue.recommendation ? "Review Fix" : label(issue.status || "Open"),
    ]);
  }
  return siteIssueRows(data, latest);
}

function siteIssueRows(data: ModuleData, latest?: CrawlSummary) {
  const siteTerms = ["site_analysis", "site analysis", "technical", "seo", "crawl", "schema", "page", "metadata", "internal link", "canonical", "sitemap"];
  const excludedTerms = ["growth", "experiment", "lead magnet", "social", "backlink", "opportunity", "strategy_approval"];
  const rows = data.tasks
    .filter((task) => {
      const text = `${task.moduleName} ${task.relatedModule ?? ""} ${task.title} ${task.description}`.toLowerCase();
      return siteTerms.some((term) => text.includes(term)) && !excludedTerms.some((term) => text.includes(term));
    })
    .slice(0, 8)
    .map((task) => [task.title, label(task.moduleName), label(task.priority), "1", task.actionButtonLabel || "View"]);
  if (rows.length) return rows;
  return latest ? [[`Latest crawl status: ${label(latest.status)}`, "Crawl", latest.status === "failed" ? "High" : "Low", formatNumber(latest.pagesCrawled), "Open"]] : [];
}

function crawlSource(crawl: CrawlSummary) {
  const options = crawl.options && typeof crawl.options === "object" ? crawl.options as Record<string, unknown> : {};
  return options.scheduled ? "Scheduled scan" : "Manual crawl";
}

function formatDateTime(value?: string | null) {
  if (!value) return "not yet";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function shortUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.pathname || "/"}`.slice(0, 80);
  } catch {
    return value.slice(0, 80);
  }
}

function internalScoreLabel(score?: number | null) {
  if (score == null) return "not scored";
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  return "weak";
}

function internalScoreTone(score?: number | null) {
  if (score == null) return "text-charcoal-400";
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-brand-600";
  return "text-amber-600";
}

function pagePerformanceScore(page: CrawlPageRow) {
  const performance = page.crawlerPerformance;
  if (typeof performance === "number") return performance;
  if (performance && typeof performance === "object" && "score" in performance && typeof performance.score === "number") return performance.score;
  return page.statusCode && page.statusCode >= 200 && page.statusCode < 300 ? 100 : 0;
}

function scanDetailRows(active: Exclude<ScanDetailKey, null>, report: HealthReport) {
  if (active === "highIssues") {
    return (report.details?.technicalIssues ?? [])
      .filter((issue) => issue.severity === "high")
      .map((issue) => ({
        title: issue.message,
        url: issue.pageUrl,
        detail: issue.recommendation || `${label(issue.category)} · ${label(issue.issueType)}`,
        tone: "text-red-600",
      }));
  }
  if (active === "brokenLinks") {
    return (report.details?.brokenInternalLinks ?? []).map((link) => ({
      title: link.sourceTitle || "Broken internal link",
      url: link.sourceUrl,
      detail: `Broken target: ${link.targetUrl} · Status ${link.targetStatus ?? "No response"} · Anchor: ${link.anchorText || "empty"}`,
      tone: "text-red-600",
    }));
  }
  if (active === "orphanPages") {
    return (report.details?.orphanPages ?? []).map((page) => ({
      title: page.title || "Orphan page",
      url: page.url,
      detail: `Depth ${page.depth} · Internal score ${page.internalLinkScore ?? "—"}/100 · Broken ${page.brokenInternalLinkCount} · Weak anchors ${page.weakAnchorCount}`,
      tone: "text-amber-600",
    }));
  }
  return (report.details?.weakAnchorLinks ?? []).map((link) => ({
    title: link.sourceTitle || "Weak anchor text",
    url: link.sourceUrl,
    detail: `Anchor: ${link.anchorText || "empty"} · ${link.placement} · Target: ${link.targetUrl}`,
    tone: "text-amber-600",
  }));
}

function backlinkRows(data: ModuleData, limit = 10) {
  const rows = data.backlinkLinks?.links?.slice(0, limit).map((link) => [
    link.sourceDomain || link.sourceUrl || "Unknown source",
    link.targetUrl || data.backlinkLinks?.target || "Unknown target",
    link.anchor || "No anchor",
    formatNumber(link.sourceRank ?? link.pageRank),
    link.lastSeen ? "Active" : "Unknown",
    link.dofollow ? "Follow" : "Nofollow",
  ]) ?? [];
  return rows;
}

function backlinkAuthorityScore(data: ModuleData) {
  const summary = data.backlinkSummary;
  const linkRanks = data.backlinkLinks?.links?.map((link) => link.sourceRank ?? link.pageRank ?? null) ?? [];
  const rankScore = avg(linkRanks);
  if (rankScore != null && rankScore > 0) return Math.max(0, Math.min(100, Math.round(rankScore)));
  const domainScore = summary?.referringDomains ? Math.min(100, Math.round(Math.log10(summary.referringDomains + 1) * 25)) : 0;
  const spamPenalty = summary?.spamScore ? Math.min(35, summary.spamScore) : 0;
  return Math.max(0, Math.min(100, domainScore - spamPenalty));
}

function percentage(part: number | null | undefined, total: number | null | undefined) {
  if (!part || !total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

function taskRows(tasks: GuidedExecutionTask[]) {
  return tasks.slice(0, 8).map((task) => [task.title, label(task.priority), label(task.status), label(task.priority), task.actionButtonLabel || "Start"]);
}

function leadMagnetIdeas(data: ModuleData) {
  const project = data.projects[0];
  if (!project) return [];
  const strategy = project.strategyPlans?.find((item) => typeof item === "object" && item !== null && "status" in item && item.status === "approved") as { offerRecommendation?: string | null } | undefined;
  const compact = (value: string | null | undefined, fallback: string) => ((value || fallback).split(/[.;|\n]/)[0]?.trim() || fallback).slice(0, 72);
  const niche = compact(project.niche, project.businessName || project.name || "Business");
  const offer = compact(strategy?.offerRecommendation || project.businessProfile?.offerSummary, niche);
  const keyword = compact(data.keywordRuns[0]?.seedKeyword, niche);
  return Array.from(new Set([
    `${label(keyword)} Quick-Win Checklist`,
    `${label(niche)} Readiness Scorecard`,
    `${label(offer)} Buyer's Guide`,
    `${label(niche)} Planning Template`,
    `${label(keyword)} Mistakes and Fixes Guide`,
  ])).slice(0, 5);
}

type LeadMagnetPackage = {
  leadMagnet: {
    title: string;
    assetType: string;
    promise: string;
    problemSolved: string;
    outline: string[];
  };
  landingPage: {
    headline: string;
    subheadline: string;
    benefitBullets: string[];
    ctaText: string;
  };
  deliveryEmail: {
    subject: string;
    previewText: string;
  };
  followUpSequence: Array<{ day: string; subject: string }>;
};

function normalizeLeadMagnetPackage(value: unknown): LeadMagnetPackage | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const leadMagnet = objectValue(root.leadMagnet);
  const landingPage = objectValue(root.landingPage);
  const deliveryEmail = objectValue(root.deliveryEmail);
  const followUp = Array.isArray(root.followUpSequence) ? root.followUpSequence : [];
  if (!leadMagnet && !landingPage) return null;
  return {
    leadMagnet: {
      title: stringValue(leadMagnet?.title, "Generated lead magnet"),
      assetType: stringValue(leadMagnet?.assetType, "Lead magnet"),
      promise: stringValue(leadMagnet?.promise, "Help the audience make progress before the next conversion step."),
      problemSolved: stringValue(leadMagnet?.problemSolved, "Clarifies the main problem and next action."),
      outline: stringArray(leadMagnet?.outline),
    },
    landingPage: {
      headline: stringValue(landingPage?.headline, "Landing page headline pending review"),
      subheadline: stringValue(landingPage?.subheadline, "Landing page subheadline pending review"),
      benefitBullets: stringArray(landingPage?.benefitBullets),
      ctaText: stringValue(landingPage?.ctaText, "Get the resource"),
    },
    deliveryEmail: {
      subject: stringValue(deliveryEmail?.subject, "Your resource is ready"),
      previewText: stringValue(deliveryEmail?.previewText, "Open this email to access the resource."),
    },
    followUpSequence: followUp.map((item, index) => {
      const row = objectValue(item);
      return { day: stringValue(row?.day, `Day ${index + 1}`), subject: stringValue(row?.subject, "Follow-up message") };
    }),
  };
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function leadMagnetScore(data: ModuleData, index: number) {
  const base = averageOpportunityScore(data) || 76;
  return Math.max(55, Math.min(96, Math.round(base - index * 5)));
}

function leadMagnetIdeaReason(project: GuidedProject | undefined, idea: string, index: number) {
  const goal = project?.primaryGoal || "the primary conversion goal";
  if (index === 0) return `Best match for the current audience and ${goal}.`;
  if (/checklist/i.test(idea)) return "Useful for quick lead capture because it promises a practical, low-friction takeaway.";
  if (/guide|report/i.test(idea)) return "Useful for higher-intent visitors who need education before they convert.";
  return "Recommended from current project context and available task signals.";
}

function leadMagnetSummary(project: GuidedProject | undefined, strategy: { strategySummary?: string | null; offerRecommendation?: string | null } | undefined) {
  if (strategy?.strategySummary) return strategy.strategySummary;
  const business = project?.businessName || project?.name || "this project";
  const offer = strategy?.offerRecommendation || project?.businessProfile?.offerSummary || project?.primaryGoal || "the primary offer";
  return `Create a focused conversion asset for ${business} that supports ${offer} and moves qualified visitors to the next step.`;
}

function leadMagnetPromise(project: GuidedProject | undefined, strategy: { offerRecommendation?: string | null } | undefined) {
  const offer = strategy?.offerRecommendation || project?.businessProfile?.offerSummary || project?.primaryGoal || "your offer";
  return `Give qualified visitors a useful, actionable resource that moves them toward ${offer} before asking for a consultation or conversion.`;
}

function leadMagnetAssetPlan(project: GuidedProject | undefined, selectedIdea: string | undefined) {
  const niche = project?.niche || "the core topic";
  return [
    selectedIdea || `${label(niche)} Checklist`,
    "Clear problem and promise",
    "Actionable steps or scorecard",
    "Next-step consultation CTA",
  ];
}

function leadMagnetReadiness(data: ModuleData, strategy: { status?: string | null } | undefined) {
  const project = data.projects[0];
  const rows = [
    { label: "Project profile", ok: Boolean(project?.businessProfile || project?.intakeAnswers?.length), value: project?.businessProfile ? "Complete" : "Needs intake" },
    { label: "Approved strategy", ok: strategy?.status === "approved", value: strategy?.status === "approved" ? "Approved" : "Missing" },
    { label: "Audience", ok: Boolean(project?.businessProfile?.targetAudience), value: project?.businessProfile?.targetAudience || "Missing" },
    { label: "Offer", ok: Boolean(project?.businessProfile?.offerSummary || project?.primaryGoal), value: project?.businessProfile?.offerSummary || project?.primaryGoal || "Missing" },
    { label: "Lead task", ok: data.tasks.some((task) => task.moduleName.includes("lead") || task.title.toLowerCase().includes("lead magnet")), value: data.tasks.some((task) => task.moduleName.includes("lead") || task.title.toLowerCase().includes("lead magnet")) ? "Created" : "Not created" },
  ];
  return {
    score: Math.round((rows.filter((row) => row.ok).length / rows.length) * 100),
    rows,
  };
}

function backlinkRefreshState(fetchedAt: string | null | undefined) {
  if (!fetchedAt) {
    return {
      blocked: false,
      availableLabel: "now",
      helpText: "No cached backlink refresh found. You can refresh backlinks now.",
    };
  }
  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) {
    return {
      blocked: false,
      availableLabel: "now",
      helpText: "Cached backlink date could not be read. You can refresh backlinks now.",
    };
  }
  const availableAt = new Date(fetched.getTime() + BACKLINK_REFRESH_COOLDOWN_MS);
  const blocked = Date.now() < availableAt.getTime();
  const availableLabel = availableAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return {
    blocked,
    availableLabel,
    helpText: blocked
      ? `Backlinks were last refreshed on ${fetched.toLocaleDateString()}. Refresh will be available again on ${availableLabel}.`
      : `Last refreshed on ${fetched.toLocaleDateString()}. You can refresh backlinks now.`,
  };
}

function siteScanCooldownState(crawl: CrawlSummary | undefined, nowMs: number) {
  const completedAt = crawl?.completedAt ?? crawl?.createdAt;
  if (!completedAt) {
    return { blocked: false, remainingLabel: "now", availableAt: null as Date | null };
  }
  const completed = new Date(completedAt);
  if (Number.isNaN(completed.getTime())) {
    return { blocked: false, remainingLabel: "now", availableAt: null as Date | null };
  }
  const availableAt = new Date(completed.getTime() + SITE_ANALYSIS_SCAN_COOLDOWN_MS);
  const remainingMs = availableAt.getTime() - nowMs;
  return {
    blocked: remainingMs > 0,
    remainingLabel: remainingMs > 0 ? formatDuration(remainingMs) : "now",
    availableAt,
  };
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
