import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { ActionIconButton, ActionIconLink, Button, Card, StatusPill } from "../components/ui.js";
import ProjectMilestoneLine from "../components/ProjectMilestoneLine.js";
import ProjectModuleHeader, { type ProjectHeaderAction } from "../components/ProjectModuleHeader.js";
import { ExecutionTaskDrawer } from "./CrawlDetail.js";
import { isExistingWebsiteFlow, nextProjectFlowStep } from "../project-flow.js";
import { registerBackgroundJob } from "../background-jobs.js";
import { keywordMarketKey, keywordMarketOptions, latestSuccessfulKeywordRuns, uniqueSerpDomains } from "../keyword-runs.js";
import type { AiContentGeneration, DomainBacklinkLinks, DomainBacklinkSummary, ExecutionTask, GuidedExecutionTask, GuidedProject, HealthReport, IssueRow, KeywordResearchRun, Opportunity, ProjectNotification, Website, WorkspaceIntelligence, WorkspaceIntelligenceResponse } from "../types.js";

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
};
type ScanDetailKey = "highIssues" | "brokenLinks" | "orphanPages" | "weakAnchors" | null;
type StrategyTab = "score" | "core" | "audience" | "growth" | "funnel" | "advanced" | "roadmap";

const moduleCopy: Record<ModuleKind, { title: string; subtitle: string; primary: string; secondary?: string }> = {
  opportunities: {
    title: "Opportunity Finder",
    subtitle: "Discover and evaluate high-value opportunities for this project.",
    primary: "Refresh Opportunities",
    secondary: "How it works",
  },
  strategy: {
    title: "AI Strategy Engine",
    subtitle: "Turn opportunity insights into a structured execution strategy.",
    primary: "Refresh Strategy",
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
    subtitle: "Generate intelligent site structure and pages that rank and convert.",
    primary: "Generate Pages",
    secondary: "How it works",
  },
  "lead-magnets": {
    title: "Lead Magnet Builder",
    subtitle: "Create high-converting lead capture assets that grow your audience and fuel your funnel.",
    primary: "Generate Lead Magnet",
    secondary: "How it works",
  },
};

interface ModuleData {
  projects: GuidedProject[];
  websites: Website[];
  keywordRuns: KeywordResearchRun[];
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
  status: "complete" | "missing";
  actions: { label: string; url: string }[];
};

function hasCompletedSiteAnalysis(data: ModuleData, project?: GuidedProject, website?: Website) {
  const projectWebsite = project?.website as ({ crawlJobs?: Website["crawlJobs"] } | undefined);
  const crawlJobs = projectWebsite?.crawlJobs ?? website?.crawlJobs ?? [];
  return crawlJobs.some((crawl) => crawl.status === "completed");
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
    "SEnuke AI needs the business profile, audience, offer, goal, and project context before this module can create useful output.",
    intakeComplete,
    [{ label: "Complete Intake", url: `/guided-projects/${project.id}/intake` }],
  );
  const opportunity = item(
    "opportunity",
    "Opportunity required",
    "SEnuke AI needs to know what direction this project is targeting before it can create downstream recommendations.",
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
    "SEnuke AI needs an approved strategy before this module can generate reliable execution tasks.",
    strategyApproved,
    [{ label: strategyExists ? "Approve Strategy" : "Generate Strategy", url: `/strategy?projectId=${project.id}` }],
  );
  const keywordAnalysis = item(
    "keyword_analysis",
    "Keyword analysis required",
    "SEnuke AI needs target keywords, buyer intent, topical clusters, competitor gaps, difficulty, opportunity score, and revenue potential before strategy and full execution planning.",
    keywordAnalysisComplete,
    [{ label: "Run Keyword Analysis", url: `/keywords?projectId=${project.id}` }],
  );
  const websiteItem = item(
    "website",
    "No website found",
    "Create or connect a website first so SEnuke AI can analyze and optimize it.",
    hasWebsite,
    [
      { label: "Create Website", url: `/site-architect?projectId=${project.id}` },
      { label: "Add Website URL", url: `/guided-projects/${project.id}/intake` },
    ],
  );
  const siteAnalysis = item(
    "site_analysis",
    "Site analysis required",
    "SEnuke AI needs to analyze your website before it can evaluate funnel gaps, SEO issues, internal links, AI citations, backlinks, or page improvements.",
    siteAnalysisComplete,
    [{ label: "Analyze Site", url: `/site-analysis?projectId=${project.id}` }],
  );

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
  const [strategyMessage, setStrategyMessage] = useState("");
  const [leadMagnetBusy, setLeadMagnetBusy] = useState(false);
  const [leadMagnetMessage, setLeadMagnetMessage] = useState("");
  const [leadMagnetIdea, setLeadMagnetIdea] = useState("");
  const [leadMagnetInstructions, setLeadMagnetInstructions] = useState("");
  const [opportunityBusy, setOpportunityBusy] = useState<"generate" | string | null>(null);
  const [opportunityMessage, setOpportunityMessage] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get("projectId") ?? "");
  const [workspaceLoadError, setWorkspaceLoadError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setWorkspaceLoadError("");
      const requestedProjectId = searchParams.get("projectId");
      const workspaceUrl = requestedProjectId ? `/api/workspace/intelligence?projectId=${encodeURIComponent(requestedProjectId)}` : "/api/workspace/intelligence";
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
            api.get<{ backlinks: DomainBacklinkLinks }>(`/api/keyword-research/domain-backlink-links?websiteId=${encodeURIComponent(activeWebsiteId)}&limit=10&cacheOnly=true`).catch(() => ({ backlinks: null })),
          ])
        : [{ summary: null }, { backlinks: null }];
      if (!cancelled) {
        const defaultProjectId = requestedProjectId ?? workspace.intelligence.activeProjectId ?? workspace.projects[0]?.id ?? "";
        setData({
          projects: workspace.projects,
          websites: workspace.websites,
          keywordRuns: workspace.keywordRuns,
          tasks: workspace.tasks,
          notifications: workspace.notifications ?? [],
          backlinkSummary: backlinkSummaryResult.summary,
          backlinkLinks: backlinkLinksResult.backlinks,
          intelligence: workspace.intelligence,
          leadMagnetGenerations: workspace.leadMagnetGenerations ?? [],
        });
        setSelectedProjectId(defaultProjectId);
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
    if (kind !== "site-analysis" || !activeWebsite?.id || !activeSiteCrawl?.id) return;
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
      const [summaryResult, linksResult] = await Promise.all([
        api.get<{ summary: DomainBacklinkSummary }>(`/api/keyword-research/domain-backlinks?websiteId=${encodeURIComponent(activeWebsite.id)}&refresh=true`),
        api.get<{ backlinks: DomainBacklinkLinks }>(`/api/keyword-research/domain-backlink-links?websiteId=${encodeURIComponent(activeWebsite.id)}&limit=10&refresh=true`),
      ]);
      setData((current) => ({
        ...current,
        backlinkSummary: summaryResult.summary,
        backlinkLinks: linksResult.backlinks,
      }));
      setBacklinkMessage(summaryResult.summary?.cached ? "Backlinks were already refreshed recently. Showing cached data." : "Backlink data refreshed.");
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
  };

  const changeProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    const next = new URLSearchParams(searchParams);
    if (projectId) next.set("projectId", projectId);
    else next.delete("projectId");
    setSearchParams(next, { replace: true });
    setOpportunityMessage("");
    setStrategyMessage("");
    setSiteAnalysisMessage("");
    setLeadMagnetMessage("");
    setLeadMagnetIdea("");
    setLeadMagnetInstructions("");
  };

  const runStrategyAction = async (action: "generate" | "analyze" | "approve" | "execution", options?: { revisionComment?: string }) => {
    if (!activeProject) return { ok: false, message: "Create or select a project before using strategy actions." };
    if (strategyBusy) return { ok: false, message: "Another strategy action is already running." };
    const endpoint = action === "generate"
      ? `/api/projects-v2/${activeProject.id}/strategy/generate`
      : action === "analyze"
        ? `/api/projects-v2/${activeProject.id}/strategy/analyze`
      : action === "approve"
        ? `/api/projects-v2/${activeProject.id}/strategy/approve`
        : `/api/projects-v2/${activeProject.id}/execution-plan/create`;
    setStrategyBusy(action);
    setStrategyMessage("");
    try {
      const request = api.post<{ project: GuidedProject }>(endpoint, action === "generate" ? options ?? {} : {});
      const [result] = await Promise.all([
        request,
        action === "generate" && options?.revisionComment ? new Promise((resolve) => window.setTimeout(resolve, 3200)) : Promise.resolve(),
      ]);
      updateActiveProject(result.project);
      if (action === "execution") {
        navigate(`/guided-projects/${result.project.id}#execution-tasks`);
      }
      setStrategyMessage(action === "generate"
        ? "Strategy regenerated as a new draft. Review and approve this version before creating or updating the execution plan."
        : action === "analyze"
          ? "Strategy Intelligence completed for the current version. Applicable opportunities and Execution Plan tasks are now updated."
        : action === "approve"
          ? "Strategy approved. Its recommendations were added to the Execution Plan without duplicating existing tasks."
          : "Execution plan created from the approved strategy. New execution tasks are now available in the roadmap and module pages.");
      return {
        ok: true,
        message: action === "generate"
          ? "Strategy regenerated as a new draft. Review and approve this version before creating or updating the execution plan."
          : action === "analyze"
            ? "Strategy Intelligence completed for the current version without changing its approval status."
          : action === "approve"
            ? "Strategy approved. Its recommendations were added to the Execution Plan without duplicating existing tasks."
            : "Execution plan created from the approved strategy. New execution tasks are now available.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Strategy action failed.";
      setStrategyMessage(message);
      return { ok: false, message };
    } finally {
      setStrategyBusy(null);
    }
  };

  const generateOpportunities = async () => {
    if (!activeProject || opportunityBusy) return;
    const creatingFirstOpportunity = !hasOpportunities;
    setOpportunityBusy("generate");
    setOpportunityMessage("");
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/generate`, {});
      updateActiveProject(result.project);
      setOpportunityMessage(creatingFirstOpportunity
        ? "Opportunities created from the current project intake. Review and select the best direction."
        : "Opportunities refreshed from the current project intake.");
    } catch (error) {
      setOpportunityMessage(error instanceof Error ? error.message : creatingFirstOpportunity ? "Opportunity creation failed." : "Opportunity refresh failed.");
    } finally {
      setOpportunityBusy(null);
    }
  };

  const selectOpportunity = async (opportunityId: string) => {
    if (!activeProject || opportunityBusy) return;
    setOpportunityBusy(opportunityId);
    setOpportunityMessage("");
    try {
      let result: { project: GuidedProject };
      try {
        result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/${opportunityId}/select`, {});
      } catch (error) {
        if (!(error instanceof Error) || !/confirm changing/i.test(error.message)) throw error;
        if (!window.confirm("Strategy is already approved. Change the active opportunity and refresh downstream work?")) return;
        result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/${opportunityId}/select`, { confirmation: true, reason: "Confirmed from Opportunity Finder" });
      }
      updateActiveProject(result.project);
      setOpportunityMessage("");
    } catch (error) {
      setOpportunityMessage(error instanceof Error ? error.message : "Opportunity selection failed.");
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

  const refineOpportunities = async (instructions: string) => {
    if (!activeProject || opportunityBusy) return;
    if (!instructions?.trim()) return;
    setOpportunityBusy("refine"); setOpportunityMessage("");
    try { const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/refine`, { instructions }); updateActiveProject(result.project); setOpportunityMessage("Recommendations updated from the current project intake and your instructions."); }
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

  const generateLeadMagnet = async () => {
    if (!activeProject || leadMagnetBusy || !canRunModule) return;
    setLeadMagnetBusy(true);
    setLeadMagnetMessage("");
    try {
      const effectiveIdea = leadMagnetIdea.trim() || leadMagnetIdeas(scopedData)[0] || null;
      const result = await api.post<{ project: GuidedProject; generation: AiContentGeneration }>(`/api/projects-v2/${activeProject.id}/lead-magnet/generate`, {
        selectedIdea: effectiveIdea,
        instructions: leadMagnetInstructions.trim() || null,
      });
      updateActiveProject(result.project);
      setData((current) => ({
        ...current,
        leadMagnetGenerations: [result.generation, ...current.leadMagnetGenerations.filter((item) => item.id !== result.generation.id)],
      }));
      setLeadMagnetMessage("AI lead magnet package generated from the approved strategy. Review the asset, landing page, email, thank-you page, and CTA flow below.");
      window.setTimeout(() => document.getElementById("lead-magnet-tasks")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (error) {
      setLeadMagnetMessage(error instanceof Error ? error.message : "Could not create the lead magnet task.");
    } finally {
      setLeadMagnetBusy(false);
    }
  };

  const primaryDisabled = kind === "backlinks"
    ? (!activeWebsite || refreshingBacklinks || backlinkCooldown.blocked || !canRunModule)
    : kind === "site-analysis"
      ? (!activeWebsite || Boolean(activeSiteCrawl) || siteAnalysisBusy || siteScanCooldown.blocked || !canRunModule)
    : kind === "ai-citations"
      ? true
    : kind === "strategy"
      ? (!activeProject || strategyBusy === "generate" || !canRunModule)
      : kind === "opportunities"
        ? (!activeProject || Boolean(opportunityBusy) || !canRunModule)
      : kind === "lead-magnets"
        ? (!activeProject || leadMagnetBusy || !canRunModule)
      : !canRunModule;
  const primaryLabel = kind === "backlinks"
    ? refreshingBacklinks
      ? "Refreshing..."
      : backlinkCooldown.blocked
        ? `Available ${backlinkCooldown.availableLabel}`
        : copy.primary
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
    : kind === "opportunities" && opportunityBusy === "generate"
      ? hasOpportunities ? "Refreshing..." : "Creating..."
    : kind === "opportunities"
      ? hasOpportunities ? "Refresh Opportunities" : "Create Opportunity"
    : kind === "lead-magnets" && leadMagnetBusy
      ? "Preparing..."
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
  const milestoneNextAction = activeProject && kind === "opportunities"
    ? (() => { const flow = nextProjectFlowStep(activeProject); const selected = activeProject.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status)); return { title: flow.title, detail: selected ? `Selected opportunity: ${selected.name}` : flow.description, label: flow.actionLabel, to: flow.to }; })()
    : activeProject && kind === "strategy" && moduleNextStep
      ? { title: moduleNextStep.title, detail: moduleNextStep.helper || moduleNextStep.detail, label: moduleNextStep.actionLabel, to: moduleNextStep.actionTo, onAction: moduleNextStep.action === "generate-strategy" ? () => { setStrategyMessage("Generating strategy from the latest project data..."); void runStrategyAction("generate"); } : undefined }
      : activeProject && kind === "keywords" && scopedKeywordRuns.some((run) => run.status === "completed" || run.keywordCount > 0 || (run.ideas?.length ?? 0) > 0)
        ? isExistingWebsiteFlow(activeProject, activeWebsite) && !latestSiteCrawl
          ? { title: "Continue to Site Analysis", detail: "Compare the approved keyword direction with the existing website before generating Strategy.", label: "Open Site Analysis", to: `/site-analysis?projectId=${activeProject.id}` }
          : { title: "Continue to Strategy", detail: "Keyword analysis is available and ready to guide the project strategy.", label: "Generate Strategy", to: `/strategy?projectId=${activeProject.id}` }
      : activeProject && kind === "site-analysis" && latestSiteCrawl
        ? { title: "Continue to Strategy", detail: `Site Analysis is complete with ${formatNumber(latestSiteCrawl.pagesCrawled)} page(s) reviewed. Use the crawl findings, approved keywords, goals, and project intake to create the strategy.`, label: "Create Strategy", to: `/strategy?projectId=${activeProject.id}` }
      : null;

  const runHeaderPrimaryAction = () => {
    if (kind === "backlinks") {
      void refreshBacklinks();
      return;
    }
    if (kind === "site-analysis") {
      void analyzeSite();
      return;
    }
    if (kind === "strategy") {
      setStrategyMessage("Regenerating strategy from the latest project data...");
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
      void generateLeadMagnet();
    }
  };

  const headerActions: ProjectHeaderAction[] = [];
  if (kind === "keywords" && scopedKeywordRuns.length > 0) headerActions.push({ key: "manage-keywords", label: "Manage keyword groups", variant: "secondary", onClick: () => { const next = new URLSearchParams(searchParams); next.set("manageKeywords", "1"); setSearchParams(next, { replace: true }); } });
  if (kind === "ai-citations") headerActions.push({ key: "live-snapshot", label: "Live snapshot from latest crawl", variant: "status" });
  else if (!(kind === "keywords" && scopedKeywordRuns.length === 0) && !(kind === "site-analysis" && !latestSiteCrawl)) headerActions.push({ key: "primary", label: primaryLabel, disabled: primaryDisabled, onClick: runHeaderPrimaryAction });

  return (
    <div className="space-y-5">
      <ProjectModuleHeader eyebrow={copy.title} title={moduleTitle} subtitle={copy.subtitle} project={hasActiveProject ? activeProject : null} projects={data.projects} tasks={scopedData.tasks} notifications={scopedData.notifications} onProjectChange={changeProject} actions={headerActions} showExecution />
      {hasActiveProject && activeProject && (kind === "opportunities" || kind === "strategy" || kind === "keywords" || kind === "site-analysis") && <ProjectMilestoneLine project={activeProject} showDependency nextAction={milestoneNextAction} />}
      {hasActiveProject && kind === "backlinks" && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${backlinkMessage ? "border-brand-100 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-charcoal-500"}`}>
          {backlinkMessage || (activeWebsite ? backlinkCooldown.helpText : "Connect a website before refreshing backlinks.")}
        </div>
      )}
      {hasActiveProject && kind === "strategy" && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${strategyMessage ? "border-brand-100 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-charcoal-500"}`}>
          {strategyMessage || (activeProject ? "Approve the generated strategy before creating the execution plan." : "Create a guided project before approving a strategy.")}
        </div>
      )}
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
      {hasActiveProject && kind === "lead-magnets" && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${leadMagnetMessage ? "border-brand-100 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-charcoal-500"}`}>
          {leadMagnetMessage || "Lead magnets are generated from the approved strategy, audience, offer, and project goal. They create a downloadable asset plus landing page, thank-you copy, delivery email, and CTA flow tasks."}
        </div>
      )}
      {hasActiveProject && hasWorkspaceRecords && canRunModule && kind !== "opportunities" && kind !== "strategy" && kind !== "site-analysis" && !(kind === "keywords" && scopedKeywordRuns.length === 0) && moduleNextStep && (
        <ModuleNextStepCallout
          step={moduleNextStep}
          onAction={moduleNextStep.action === "generate-strategy"
            ? () => { setStrategyMessage("Regenerating strategy from the latest project data..."); void runStrategyAction("generate"); }
            : moduleNextStep.action === "analyze-site"
              ? () => { void analyzeSite(); }
              : moduleNextStep.action === "generate-lead-magnet"
                ? () => { void generateLeadMagnet(); }
                : undefined}
        />
      )}

      {loading && <Card className="p-5 text-sm text-charcoal-500">Loading live project data...</Card>}
      {!loading && workspaceLoadError && <Card className="border-red-200 bg-red-50 p-5"><h2 className="font-bold text-red-900">Project data could not be loaded</h2><p className="mt-2 text-sm text-red-800">{workspaceLoadError}</p><Link to="/projects" className="mt-4 inline-flex rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800">Back to projects</Link></Card>}
      {!loading && !workspaceLoadError && !hasActiveProject && searchParams.get("projectId") && <Card className="border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-900">Project unavailable</h2><p className="mt-2 text-sm text-amber-800">This project was not found or is not assigned to your workspace account.</p><Link to="/projects" className="mt-4 inline-flex rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-900">Back to projects</Link></Card>}
      {!loading && !workspaceLoadError && !hasActiveProject && !searchParams.get("projectId") && <EmptyModuleState title="Create project first" detail="This module depends on a project. Create a project before using module actions." />}
      {!loading && hasActiveProject && !hasWorkspaceRecords && <EmptyModuleState title="No data available" detail="Project data will appear here after intake, crawls, tasks, or generation runs exist." />}
      {!loading && hasActiveProject && hasWorkspaceRecords && !canRunModule && <ModuleReadinessChecklist moduleTitle={copy.title} items={readiness.items} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "opportunities" && <OpportunityScreen data={scopedData} selectingId={opportunityBusy} onSelect={selectOpportunity} onClearSelection={clearOpportunitySelection} onRefine={refineOpportunities} onSkip={skipOpportunityFinder} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "strategy" && <StrategyScreen data={scopedData} busy={strategyBusy} onAction={runStrategyAction} />}
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
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "backlinks" && <BacklinkScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "ai-citations" && <CitationScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "site-architect" && <ArchitectScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "lead-magnets" && (
        <LeadMagnetScreen
          data={scopedData}
          selectedIdea={leadMagnetIdea}
          instructions={leadMagnetInstructions}
          onSelectIdea={setLeadMagnetIdea}
          onChangeInstructions={setLeadMagnetInstructions}
        />
      )}
      <ModuleHelpDrawer kind={kind} project={activeProject} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

type HelpSection = { title: string; body?: string; bullets?: string[] };

function moduleHelpSections(kind: ModuleKind, projectName: string): HelpSection[] {
  const sharedSafety = {
    title: "Approval and safety",
    bullets: [
      "SEnuke AI can recommend, generate, and prepare assets automatically.",
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
          "Use Refresh Opportunities only after recommendations already exist and the project profile or analysis data has changed.",
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
  const missing = items.filter((item) => item.status === "missing");
  const complete = items.filter((item) => item.status === "complete");
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Readiness Checklist</div>
        <h2 className="mt-2 text-xl font-bold text-charcoal-950">{moduleTitle} is not ready yet.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Before SEnuke AI can run this, we need to complete these missing steps. Missing data becomes the next recommended action instead of a dead-end error.
        </p>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {missing.map((item) => (
          <div key={item.key} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-amber-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-amber-900">{item.description}</p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-700">Missing</span>
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
        ))}
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
  onSelect,
  onClearSelection,
  onRefine,
  onSkip,
}: {
  data: ModuleData;
  selectingId: string | null;
  onSelect: (opportunityId: string) => Promise<void>;
  onClearSelection: () => Promise<void>;
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
  useEffect(() => {
    if (selectedOpportunity?.id) setFocusedId(selectedOpportunity.id);
  }, [selectedOpportunity?.id]);

  const focusedOpportunity = visibleOpportunities.find((opportunity) => opportunity.id === focusedId) ?? selectedOpportunity;
  const opportunityCount = visibleOpportunities.length;
  const taskCount = data.tasks.filter((task) => task.moduleName.includes("opportun")).length;
  const niche = project?.niche || project?.businessProfile?.businessModel || "Not provided";
  const intakeComplete = Boolean(project?.businessProfile || project?._count?.intakeAnswers);
  if (!project) {
    return <EmptyModuleState title="No project available" detail="Create a project before generating opportunity recommendations." />;
  }
  if (!opportunities.length) {
    return (
      <>
        <OpportunitySummaryStrip project={project} niche={niche} />
        <EmptyModuleState
          title={intakeComplete ? "No opportunity recommendations yet" : "Complete intake first"}
          detail={intakeComplete
            ? "The project profile is ready. Use Create Opportunity to generate scored options from this project's intake, audience, offer, and constraints."
            : "Opportunity generation needs the intake profile first, including business context, audience, offer, goals, budget, and publishing method."}
          actionTo={intakeComplete ? null : `/guided-projects/${project.id}/intake`}
          actionLabel={intakeComplete ? null : "Open Intake"}
        />
      </>
    );
  }
  return (
    <>
      <OpportunityInsights project={project} niche={niche} opportunity={focusedOpportunity} opportunityCount={opportunityCount} taskCount={taskCount} onReport={() => {
        setReportOpen(true);
      }} />
      <div>
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-charcoal-950">Recommended Opportunities</h2>
              <p className="text-sm text-charcoal-500">Select one opportunity to become the context for strategy and execution.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCompareOpen(true);
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-charcoal-800 hover:bg-slate-50"
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
              <button type="button" onClick={() => setRefineOpen(true)} disabled={selectingId === "refine"} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">{selectingId === "refine" ? "Refining…" : "Ask AI to Refine"}</button>
              <button type="button" onClick={() => void onSkip()} disabled={selectingId === "skip"} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-charcoal-700 hover:bg-slate-50 disabled:opacity-50">Confirm Existing Direction / Skip</button>
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
                  void onSelect(opportunity.id);
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
      <OpportunityDetailsDrawer opportunity={focusedOpportunity} open={detailsOpen} onClose={() => setDetailsOpen(false)} onSelect={focusedOpportunity ? () => { void onSelect(focusedOpportunity.id); } : undefined} selected={Boolean(focusedOpportunity && ["selected", "confirmed"].includes(focusedOpportunity.status))} />
      <OpportunityCompareDrawer opportunities={visibleOpportunities} open={compareOpen} onClose={() => setCompareOpen(false)} onFocus={(id) => { setFocusedId(id); setDetailsOpen(true); }} onSelect={(id) => { void onSelect(id); }} />
      <OpportunityReportDrawer opportunity={focusedOpportunity} open={reportOpen} onClose={() => setReportOpen(false)} projectId={project.id} />
      <OpportunityRefineModal open={refineOpen} busy={selectingId === "refine"} onClose={() => setRefineOpen(false)} onSubmit={async (instructions) => { await onRefine(instructions); setRefineOpen(false); }} />
    </>
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
          <textarea id="opportunity-refine-custom" value={custom} onChange={(event) => setCustom(event.target.value)} rows={4} maxLength={2000} placeholder="Example: Target Toronto dental clinics, keep the launch under 30 days, and prioritize appointment bookings." className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
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
  onSubmit: (instruction: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  useEffect(() => { if (!open) { setSelected([]); setCustom(""); } }, [open]);
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
  const toggle = (instruction: string) => setSelected((current) => current.includes(instruction) ? current.filter((item) => item !== instruction) : [...current, instruction]);
  const instruction = [...selected, custom.trim()].filter(Boolean).join("\n");
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-charcoal-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="strategy-revision-title">
      <button type="button" className="absolute inset-0" aria-label="Close Strategy revision" onClick={busy ? undefined : onClose} />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {busy && <div className="absolute inset-0 z-20 grid place-items-center bg-white/95 p-6 backdrop-blur-sm" role="status" aria-live="polite"><div className="max-w-md text-center"><div className="relative mx-auto h-20 w-20"><div className="absolute inset-0 rounded-full border-4 border-brand-100" /><div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-brand-600 border-r-brand-400" /><div className="absolute inset-[18px] grid place-items-center rounded-full bg-brand-50 text-2xl">✦</div></div><h3 className="mt-6 text-xl font-bold text-charcoal-950">Hang on — we’re cooking for you!</h3><p className="mt-2 text-sm leading-6 text-charcoal-600">AI is re-aligning the Strategy with your selected priorities, checking the project goals, markets, keywords, opportunity, and site findings.</p><div className="mx-auto mt-5 h-2 max-w-xs overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-brand-400 to-brand-600" /></div><p className="mt-3 text-xs font-bold uppercase tracking-wide text-brand-700">Creating a new Strategy draft…</p></div></div>}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Strategy Engine · Version {strategy.version ?? 1}</div><h2 id="strategy-revision-title" className="mt-1 text-xl font-bold text-charcoal-950">What should AI revise?</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-charcoal-600">AI suggested these improvements from the current project intake, goals, markets, opportunity, keywords and site context. Select one or more changes.</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg text-charcoal-500 disabled:opacity-50" aria-label="Close">×</button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Current strategy direction</div><p className="mt-2 line-clamp-3 text-sm leading-6 text-charcoal-700">{strategy.strategySummary || "Current Strategy draft"}</p></div>
          <div className="mt-5 flex items-center justify-between gap-3"><div className="text-sm font-bold text-charcoal-900">AI-suggested revisions</div><div className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">Select multiple</div></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{suggestions.map((suggestion) => { const active = selected.includes(suggestion.instruction); return <button key={suggestion.title} type="button" role="checkbox" aria-checked={active} onClick={() => toggle(suggestion.instruction)} className={`rounded-xl border p-4 text-left transition ${active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 hover:border-brand-300"}`}><div className="flex items-start justify-between gap-3"><div><div className="font-bold text-charcoal-950">{suggestion.title}</div><div className="mt-1 text-xs leading-5 text-charcoal-500">{suggestion.detail}</div></div><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-xs font-bold ${active ? "bg-brand-600 text-white" : "border-2 border-slate-300 bg-white text-transparent"}`}>✓</span></div></button>; })}</div>
          <label htmlFor="strategy-revision-custom" className="mt-5 block text-sm font-bold text-charcoal-800">Anything else you want changed?</label>
          <textarea id="strategy-revision-custom" value={custom} onChange={(event) => setCustom(event.target.value)} rows={4} maxLength={2000} placeholder="Example: Keep the plan within a 90-day timeline, focus on qualified B2B leads, and reduce lower-priority social work." className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          <div className="mt-2 flex items-center justify-between text-xs text-charcoal-500"><span>{selected.length ? `${selected.length} AI suggestion${selected.length === 1 ? "" : "s"} selected` : "Select a suggestion or add your own instruction."}</span><span>{custom.length}/2000</span></div>
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><b>A new draft version will be created.</b> The current and previously approved versions remain available for comparison and history.</div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 disabled:opacity-50">Cancel</button><button type="button" onClick={() => void onSubmit(instruction)} disabled={busy || instruction.length < 3} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? "Creating revised version…" : `Create Revised Draft${selected.length ? ` (${selected.length})` : ""}`}</button></div>
      </div>
    </div>
  );
}

function StrategyScreen({ data, busy, onAction }: { data: ModuleData; busy: "generate" | "analyze" | "approve" | "execution" | null; onAction: (action: "generate" | "analyze" | "approve" | "execution", options?: { revisionComment?: string }) => Promise<StrategyActionResult | undefined> }) {
  const [activeTab, setActiveTab] = useState<StrategyTab>("score");
  const [inlineNotice, setInlineNotice] = useState<{ tone: "info" | "success" | "error"; message: string } | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
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
  const advancedAnalyses = (Array.isArray(latestStrategy?.advancedAnalysis) ? latestStrategy.advancedAnalysis : []) as Array<{ key: string; title: string; applicable: boolean; priority: string; impact: number; confidence: number; why: string; evidence: string[]; actions: string[] }>;
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
  const approvedGroups = project?.keywordGroups?.filter((group) => group.status === "approved") ?? [];
  const approvedKeywordCount = approvedGroups.reduce((total, group) => total + (Array.isArray(group.keywords) ? group.keywords.length : 0), 0);
  const targetMarketCount = Array.isArray(project?.targetLocations) ? project.targetLocations.length : 0;
  const completedCrawl = data.websites.flatMap((website) => website.crawlJobs ?? []).find((crawl) => crawl.status === "completed");
  const audienceSegments = splitAudience(audience);
  const audienceSummary = audienceSegments.length
    ? `${audienceSegments.length} target segments`
    : audience;
  const offer = latestStrategy?.offerRecommendation || project?.businessProfile?.offerSummary || "Offer recommendation pending.";
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
        setActiveTab("core");
      }
      if (result.ok && action === "execution") setActiveTab("roadmap");
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
      <Card className="overflow-hidden">
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
        <div className="grid gap-0 sm:grid-cols-2 xl:grid-cols-4">
          <StrategySummaryFact icon="♙" label="Target Audience" value={audienceSummary} detail={audienceSegments.slice(0, 2).join(" · ")} />
          <StrategySummaryFact icon="◎" label="Primary Goal" value={project.primaryGoal ?? "Not provided"} />
          <StrategySummaryFact icon="▣" label="Business Model" value={businessModel} />
          <StrategySummaryFact icon="▤" label="Website Type" value={websiteType} />
        </div>
      </Card>

      {!latestStrategy ? (
        <Card className="border-brand-100 bg-brand-50/60 p-6">
          <h2 className="text-xl font-bold text-charcoal-950">AI strategy has not been generated yet</h2>
          <p className="mt-2 text-sm leading-6 text-charcoal-600">Generate the strategy from the guided project intake, opportunity, audience, offer, and publishing preferences.</p>
          <button type="button" onClick={() => { void runInlineAction("generate"); }} disabled={Boolean(busy)} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">
            {busy === "generate" ? "Generating..." : "Generate AI Strategy"}
          </button>
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
      ) : (
        <div className="space-y-5">
          <StrategyTabs activeTab={activeTab} onChange={setActiveTab} />

          <Card className="px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Strategy versions</div><div className="mt-1 text-sm font-semibold text-charcoal-700">Version {latestStrategy.version ?? strategyVersions.length} · {label(latestStrategy.status ?? "draft")} {latestStrategy.createdAt ? `· ${formatDateTime(latestStrategy.createdAt)}` : ""}</div></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void generateStrategyReport()} disabled={reportBusy} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white shadow-sm disabled:bg-slate-300">{reportBusy ? "Generating PDF…" : "Generate Strategy Report ↓"}</button>{strategyVersions.map((version, index) => <button type="button" key={version?.id ?? index} onClick={() => setCompareVersionId(index === 0 || compareVersionId === version?.id ? null : version?.id ?? null)} className={`rounded-full border px-3 py-1 text-xs font-bold ${index === 0 ? "border-brand-300 bg-brand-50 text-brand-700" : compareVersionId === version?.id ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-charcoal-500"}`}>v{version?.version ?? strategyVersions.length - index} · {index === 0 ? label(version?.status ?? "draft") : compareVersionId === version?.id ? "Comparing" : "Compare"}</button>)}</div></div>
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
                  <button type="button" onClick={() => setRevisionOpen(true)} disabled={Boolean(busy)} className="rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">
                    {busy === "generate" ? "Revising..." : "Revise with AI"}
                  </button>
                  <button type="button" onClick={() => { if (window.confirm("Regenerate Strategy from the latest approved project information? The current version will remain in history.")) void runInlineAction("generate", { revisionComment: "Regenerated from the latest approved project information." }); }} disabled={Boolean(busy)} className="rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">
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
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                <IconBadge icon="◎" />
                <h2 className="font-bold text-brand-700">Website & Funnel Plan</h2>
              </div>
              <div className="grid gap-5 lg:grid-cols-4">
                <PlanList title="Recommended Pages" items={websitePlanItems(data).slice(0, 6)} />
                <PlanList title="Lead Magnet Recommendation" items={[offer, "Email capture via dedicated landing page", "Deliver via automated email sequence"]} />
                <PlanList title="CTA Flow" items={["Blog content to lead magnet", "Product/service page to consultation", "Comparison page to primary offer", "Exit intent to email opt-in"]} />
                <PlanList title="Publishing Recommendation" items={[latestStrategy.publishingStrategy || project.preferredPublishingMethod || "Publishing method pending", latestStrategy.aiCitationStrategy || "Add answer-first sections and schema", "Refresh approved content monthly"]} />
              </div>
            </Card>
          )}

          {activeTab === "roadmap" && (
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <IconBadge icon="◇" />
                <h2 className="font-bold text-brand-700">Execution Roadmap</h2>
              </div>
              <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
                {roadmap.map((item, index) => (
                  <div key={item.title} className="rounded-lg border border-slate-200 bg-white p-3 text-center shadow-sm" title={item.reason}>
                    <div className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{index + 1}</div>
                    <div className="mt-3 min-h-[34px] text-xs font-bold text-charcoal-950">{item.title}</div>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${item.status === "Completed" ? "bg-emerald-100 text-emerald-700" : item.status === "Ready" ? "bg-blue-100 text-brand-700" : item.status === "In Progress" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-charcoal-500"}`}>{item.status}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {activeTab === "advanced" && <StrategyIntelligencePanel analyses={advancedAnalyses} applicable={applicableAdvancedAnalyses} busy={busy === "analyze"} onAnalyze={() => void runInlineAction("analyze")} />}
        </div>
      )}
      {latestStrategy && <StrategyRevisionModal open={revisionOpen} busy={busy === "generate"} project={project} strategy={latestStrategy} opportunityName={selectedOpportunity?.name} onClose={() => setRevisionOpen(false)} onSubmit={async (revisionComment) => { const result = await runInlineAction("generate", { revisionComment }); if (result?.ok !== false) setRevisionOpen(false); }} />}
    </>
  );
}

type StrategyAnalysisItem = { key: string; title: string; applicable: boolean; priority: string; impact: number; confidence: number; why: string; evidence: string[]; actions: string[] };

function StrategyIntelligencePanel({ analyses, applicable, busy, onAnalyze }: { analyses: StrategyAnalysisItem[]; applicable: StrategyAnalysisItem[]; busy: boolean; onAnalyze: () => void }) {
  const hasAnalysis = analyses.length > 0;
  return <Card className="p-5">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="text-xs font-bold uppercase tracking-wide text-violet-700">Strategy Intelligence</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">Optimization opportunities backed by project evidence</h2><p className="mt-1 text-sm leading-6 text-charcoal-500">Reviews search intent, entities, topical gaps, trust, freshness, crawl efficiency, cannibalization, internal links, SERP features and competitor changes.</p></div>
      {hasAnalysis && <span className="self-start rounded-full bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-700">{applicable.length} priorit{applicable.length === 1 ? "y" : "ies"}</span>}
    </div>
    {hasAnalysis && applicable.length > 0 && <div className="mt-5 grid gap-4 lg:grid-cols-2">{applicable.map((analysis, index) => <div key={analysis.key} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-xs font-bold text-violet-700">{index + 1}</span><div><h3 className="font-bold text-charcoal-950">{analysis.title}</h3><p className="mt-1 text-xs leading-5 text-charcoal-500">{analysis.why}</p></div></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${analysis.priority === "critical" || analysis.priority === "high" ? "bg-red-100 text-red-700" : analysis.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-charcoal-600"}`}>{analysis.priority}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg bg-emerald-50 p-3"><div className="text-[10px] font-bold uppercase text-emerald-700">Impact</div><div className="mt-1 text-lg font-bold text-emerald-800">{analysis.impact}/100</div></div><div className="rounded-lg bg-brand-50 p-3"><div className="text-[10px] font-bold uppercase text-brand-700">Confidence</div><div className="mt-1 text-lg font-bold text-brand-800">{analysis.confidence}%</div></div></div><div className="mt-3"><div className="text-[11px] font-bold uppercase text-charcoal-400">Evidence</div><div className="mt-2 flex flex-wrap gap-1.5">{analysis.evidence.slice(0, 6).map((item) => <span key={item} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-charcoal-600">{item}</span>)}</div></div><div className="mt-3"><div className="text-[11px] font-bold uppercase text-charcoal-400">Recommended actions</div><ul className="mt-2 space-y-1.5">{analysis.actions.map((action) => <li key={action} className="flex gap-2 text-xs leading-5 text-charcoal-700"><span className="font-bold text-brand-600">→</span><span>{action}</span></li>)}</ul></div></div>)}</div>}
    {hasAnalysis && applicable.length === 0 && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800"><b>No additional optimization priorities were detected.</b><span className="mt-1 block">The current project evidence was reviewed successfully. Run the analysis again after keywords, crawl findings, competitors, goals or target markets change.</span></div>}
    {!hasAnalysis && <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-5"><h3 className="font-bold text-charcoal-950">Analyze this Strategy version</h3><p className="mt-1 text-sm leading-6 text-charcoal-600">This version was created before Strategy Intelligence was available. Analyze it in place without changing its content, version or approval status.</p><button type="button" onClick={onAnalyze} disabled={busy} className="mt-4 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{busy ? "Analyzing project evidence…" : "Run Strategy Intelligence"}</button></div>}
  </Card>;
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
    { key: "score", label: "Score & Actions" },
    { key: "core", label: "Core Strategy" },
    { key: "audience", label: "Audience" },
    { key: "growth", label: "Growth Plan" },
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
  const successfulRuns = latestSuccessfulKeywordRuns(data.keywordRuns);
  const [groups, setGroups] = useState(project?.keywordGroups ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [manualSeed, setManualSeed] = useState("");
  const [showGroupManagement, setShowGroupManagement] = useState(false);
  const [resultsTab, setResultsTab] = useState<"keywords" | "competitors">("keywords");
  const [marketFilter, setMarketFilter] = useState("");
  const [aiIdeasOpen, setAiIdeasOpen] = useState(false);
  const [aiIdeaPrompt, setAiIdeaPrompt] = useState("");
  const [aiKeywordPreview, setAiKeywordPreview] = useState<{ category: string; title: string; keywords: string[] }[]>([]);
  const [selectedAiKeywords, setSelectedAiKeywords] = useState<string[]>([]);
  const [aiPreviewBusy, setAiPreviewBusy] = useState(false);
  const automaticGenerationProjectId = useRef<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const marketOptions = keywordMarketOptions(successfulRuns);
  const runs = marketFilter ? successfulRuns.filter((run) => keywordMarketKey(run.locationName) === marketFilter) : successfulRuns;
  const groupKeywords = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string").flatMap((item) => item.split(/[,;\n]/).map((part) => part.trim()).filter((part) => part && !(/^(find|explore|create|suggest|expand|generate)\b/i.test(part) && /\b(keywords?|topics?|ideas?)\b/i.test(part) && part.split(/\s+/).length > 6))))] : [];
  const updateFromProject = (next: GuidedProject) => setGroups(next.keywordGroups ?? []);
  const generate = async (regenerate = false, seed?: string, append = false, expansion = false) => {
    if (!project || busy) return;
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
    if (project && incomingGroups.length === 0 && automaticGenerationProjectId.current !== project.id) {
      automaticGenerationProjectId.current = project.id;
      void generate(false);
    }
  }, [project?.id]);
  useEffect(() => {
    if (searchParams.get("manageKeywords") === "1") {
      setShowGroupManagement(true);
      window.setTimeout(() => document.getElementById("keyword-group-management")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }, [searchParams]);
  useEffect(() => {
    if (marketFilter && !marketOptions.some((option) => option.value === marketFilter)) setMarketFilter("");
  }, [marketFilter, marketOptions]);
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
  const editGroup = async (group: NonNullable<GuidedProject["keywordGroups"]>[number]) => {
    if (!project) return;
    const value = window.prompt(`Edit ${group.title}. Enter comma-separated keywords:`, groupKeywords(group.keywords).join(", "));
    if (value === null) return;
    const keywords = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (!keywords.length) return setMessage("Keep at least one keyword in the group.");
    setBusy(group.id);
    try {
      const result = await api.patch<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/${group.id}`, { keywords });
      updateFromProject(result.project);
      setMessage("Keyword edits saved and recorded in Activity History.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Changes could not be saved."); } finally { setBusy(null); }
  };
  const addManual = async (category = "supporting", groupTitle = "Supporting Topics") => {
    if (!project) return;
    const value = window.prompt(`Add manual keywords to ${groupTitle}, separated by commas:`);
    if (!value) return;
    setBusy("manual");
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/manual`, { keywords: value.split(",").map((item) => item.trim()).filter(Boolean), category });
      updateFromProject(result.project);
      setMessage(`Manual keywords added to ${groupTitle}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Manual keywords could not be added."); } finally { setBusy(null); }
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
        <p className="mt-2 text-sm leading-6 text-charcoal-600">SEnuke AI starts with project intake, goals, markets, competitors, and the selected opportunity. A manual seed is only needed when that information is insufficient.</p>
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
  const rows = keywordRows(runs, (run, keyword) => (
    <div className="flex justify-end gap-3">
      <ActionIconLink icon="view" label={`View analysis for ${keyword}`} to={keywordDetailTo(run, keyword)} />
      <ActionIconButton
        icon="refresh"
        label={refreshingId === run.id ? "Refreshing keyword" : canRefreshKeyword(run) ? "Refresh keyword" : refreshBlockedLabel(run)}
        onClick={() => void refreshRun(run)}
        disabled={refreshingId === run.id || !canRefreshKeyword(run)}
      />
    </div>
  ));
  const topRun = runs[0];
  const analyzedKeywords = [...new Set(runs.map((run) => run.seedKeyword).filter(Boolean))];
  const analyzedLocations = [...new Set(runs.map((run) => run.locationName).filter(Boolean))];
  const approvedCount = groups.filter((group) => group.status === "approved").length;
  const focusedGroupId = searchParams.get("groupId");
  const analysisGroupId = focusedGroupId ?? groups.find((group) => group.status === "approved")?.id ?? null;
  const analysisGroupIds = groups.filter((group) => group.status === "approved").map((group) => group.id);
  const totalRecommendations = groups.reduce((sum, group) => sum + groupKeywords(group.keywords).length, 0);
  const analysisWebsiteId = website?.id ?? project?.websiteId ?? project?.website?.id ?? null;
  const keywordAnalysisTo = analysisWebsiteId
    ? `/keyword-insights?project=${encodeURIComponent(analysisWebsiteId)}&projectId=${encodeURIComponent(project?.id ?? "")}${analysisGroupIds.length ? `&groupIds=${encodeURIComponent(analysisGroupIds.join(","))}` : analysisGroupId ? `&groupId=${encodeURIComponent(analysisGroupId)}` : ""}&add=1`
    : `/keyword-insights?projectId=${encodeURIComponent(project?.id ?? "")}${analysisGroupIds.length ? `&groupIds=${encodeURIComponent(analysisGroupIds.join(","))}` : analysisGroupId ? `&groupId=${encodeURIComponent(analysisGroupId)}` : ""}&add=1`;
  const audience = project?.businessProfile?.targetAudience || "the project audience";
  const offer = project?.businessProfile?.offerSummary || project?.niche || project?.businessName || project?.name || "the project offer";
  const markets = Array.isArray(project?.targetLocations) ? project.targetLocations.map(String).filter(Boolean) : [];
  const selectedOpportunity = project?.opportunities?.find((item) => ["selected", "confirmed"].includes(item.status))?.name;
  const aiPromptIdeas = [
    `Find high-intent service and purchase keywords for ${offer}.`,
    `Explore long-tail questions and problems searched by ${audience}.`,
    markets.length ? `Create local keyword opportunities for ${markets.slice(0, 4).join(", ")}.` : "Find location-based keyword opportunities for this project.",
    selectedOpportunity ? `Expand keyword themes supporting the selected opportunity: ${selectedOpportunity}.` : `Find keyword gaps that support the primary goal: ${project?.primaryGoal || "business growth"}.`,
    `Suggest related topics that are not already covered by the existing keyword groups.`,
  ];
  const openAiIdeas = () => { setAiIdeaPrompt(aiPromptIdeas[0]); setAiKeywordPreview([]); setSelectedAiKeywords([]); setAiIdeasOpen(true); };
  const aiSelectionKey = (category: string, keyword: string) => `${category}::${keyword}`;
  const previewAiKeywords = async () => {
    if (!project || aiIdeaPrompt.trim().length < 3) return;
    setAiPreviewBusy(true);
    try {
      const result = await api.post<{ groups: { category: string; title: string; keywords: string[] }[] }>(`/api/projects-v2/${project.id}/keyword-groups/preview`, { instruction: aiIdeaPrompt.trim() });
      const existing = new Set(groups.flatMap((group) => groupKeywords(group.keywords)).map((keyword) => keyword.toLowerCase()));
      const preview = result.groups.map((group) => ({ ...group, keywords: group.keywords.filter((keyword) => !existing.has(keyword.toLowerCase())) })).filter((group) => group.keywords.length);
      setAiKeywordPreview(preview);
      setSelectedAiKeywords(preview.flatMap((group) => group.keywords.map((keyword) => aiSelectionKey(group.category, keyword))));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Keyword preview could not be generated."); }
    finally { setAiPreviewBusy(false); }
  };
  const addSelectedAiKeywords = async () => {
    if (!project || !selectedAiKeywords.length) return;
    setAiPreviewBusy(true);
    try {
      let latest: GuidedProject | null = null;
      for (const group of aiKeywordPreview) {
        const keywords = group.keywords.filter((keyword) => selectedAiKeywords.includes(aiSelectionKey(group.category, keyword)));
        if (!keywords.length) continue;
        const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/keyword-groups/manual`, { category: group.category, keywords });
        latest = result.project;
      }
      if (latest) updateFromProject(latest);
      setAiIdeasOpen(false);
      setMessage(`${selectedAiKeywords.length} selected AI keyword idea${selectedAiKeywords.length === 1 ? " was" : "s were"} added to the relevant groups.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Selected keywords could not be added."); }
    finally { setAiPreviewBusy(false); }
  };
  return (
    <>
      {runs.length > 0 && <>
        <Card className="overflow-x-auto"><div className="grid min-w-[860px] grid-cols-[180px_repeat(5,minmax(130px,1fr))] divide-x divide-slate-200"><div className="flex items-center px-5 py-4"><div><div className="font-bold text-charcoal-950">Research Coverage</div><div className="mt-1 text-xs text-charcoal-500">Current campaign scope</div></div></div>{[["Keywords analyzed", analyzedKeywords.length], ["Analysis runs", runs.length], ["Locations", analyzedLocations.length <= 3 ? analyzedLocations.join(", ") : `${analyzedLocations.length} markets`], ["Language", topRun?.languageCode?.toUpperCase() || "EN"], ["Search engine", "Google"]].map(([labelText, value]) => <div key={labelText} className="px-5 py-4"><div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{labelText}</div><div className="mt-1 text-base font-bold text-charcoal-950">{value}</div></div>)}</div></Card>
        <KeywordInsightsBanner data={data} />
        <Card className="p-2"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><button type="button" onClick={() => setResultsTab("keywords")} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${resultsTab === "keywords" ? "bg-brand-600 text-white shadow-sm" : "text-charcoal-600 hover:bg-slate-50"}`}>Analyzed Keywords <span className={resultsTab === "keywords" ? "text-brand-100" : "text-charcoal-400"}>{analyzedKeywords.length}</span></button><button type="button" onClick={() => setResultsTab("competitors")} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${resultsTab === "competitors" ? "bg-brand-600 text-white shadow-sm" : "text-charcoal-600 hover:bg-slate-50"}`}>SERP Domains <span className={resultsTab === "competitors" ? "text-brand-100" : "text-charcoal-400"}>{uniqueSerpDomains(runs, website?.domain ?? project?.website?.domain).size}</span></button></div><label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5"><span className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Market</span><select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} className="min-w-[150px] bg-transparent text-sm font-bold text-charcoal-700 outline-none"><option value="">All markets</option>{marketOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div></Card>
        {resultsTab === "keywords" ? <DataTable title="Keywords" columns={["Keyword", "Location", "Search Volume", "Difficulty", "CPC", "Opportunity Score", "Rank", "Change", "Avg volume", "Ideas", "Competitors", "Actions"]} rows={rows} /> : <KeywordCompetitorAnalysis runs={runs} projectCompetitors={Array.isArray(project?.competitors) ? project.competitors.map(String).filter((item) => item && item !== "[object Object]") : []} ownDomain={website?.domain ?? project?.website?.domain ?? null} />}
      </>}
      {message && <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700">{message}</div>}
      {runs.length === 0 && <Card className={`${approvedCount > 0 ? "border-brand-200 bg-gradient-to-r from-brand-50 via-white to-emerald-50" : ""} p-5`}><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Keyword Intelligence Groups</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">{approvedCount > 0 ? "Approved direction ready for analysis" : "Approve and manage keyword direction"}</h2><p className="mt-1 text-sm leading-6 text-charcoal-600">{approvedCount > 0 ? "Use the approved groups to collect demand, competition, CPC, intent, rankings, and page-target data." : "Review, approve, edit, or add keywords before continuing."}</p><p className="mt-1 text-xs font-semibold text-charcoal-500">{groups.length} groups · {approvedCount} approved · {totalRecommendations} recommendations · {isExistingWebsiteFlow(project, website) ? "existing website context" : "crawl not required"}</p></div>{approvedCount > 0 && <Link to={keywordAnalysisTo} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">Start Keyword Analysis →</Link>}</div></Card>}
      {runs.length > 0 && showGroupManagement && <div id="keyword-group-management" className="flex scroll-mt-4 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4"><div><div className="text-sm font-bold text-charcoal-900">Keyword group management</div><div className="mt-1 text-xs text-charcoal-500">Add keywords, request more ideas, edit approvals, or regenerate recommendations.</div></div><button type="button" onClick={() => { setShowGroupManagement(false); const next = new URLSearchParams(searchParams); next.delete("manageKeywords"); navigate({ search: next.toString() }, { replace: true }); }} className="ml-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-charcoal-600">Close</button></div>}
      {(runs.length === 0 || showGroupManagement) && <>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void addManual()} disabled={busy !== null} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold">Add Manual Keywords</button><button type="button" onClick={openAiIdeas} disabled={busy !== null} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700">Ask AI for More Ideas</button><button type="button" onClick={() => { if (window.confirm("Regenerate recommendations from the latest intake? Existing approvals will be reset.")) void generate(true); }} disabled={busy !== null} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">{busy === "regenerate" ? "Regenerating…" : "Regenerate"}</button></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.map((group) => { const keywords = groupKeywords(group.keywords); const gaps = groupKeywords(group.gapKeywords); const focused = focusedGroupId === group.id; return <Card id={`keyword-group-${group.id}`} key={group.id} className={`flex flex-col p-5 transition ${focused ? "border-brand-500 ring-2 ring-brand-200" : group.status === "approved" ? "border-emerald-300 bg-emerald-50/30" : ""}`}><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">{group.status === "approved" ? "Approved · Manage group" : "Recommended"}</div><h3 className="mt-1 text-lg font-bold text-charcoal-950">{group.title}</h3></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-charcoal-600">{keywords.length}</span></div><p className="mt-3 text-sm leading-6 text-charcoal-600">{group.explanation}</p><div className="mt-3 rounded-lg bg-white p-3 text-xs leading-5 text-charcoal-600"><b>Expected value:</b> {group.expectedValue}<br/><b>Goal:</b> {group.goalSupport}</div><div className="mt-4 flex flex-wrap gap-2">{keywords.map((keyword) => <span key={keyword} className={`rounded-full px-3 py-1 text-xs font-semibold ${gaps.includes(keyword) ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-charcoal-700"}`}>{keyword}{gaps.includes(keyword) ? " · gap" : ""}</span>)}</div><div className="mt-auto grid grid-cols-2 gap-2 pt-5"><button type="button" onClick={() => void editGroup(group)} disabled={busy !== null} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">Edit Group</button><button type="button" onClick={() => void addManual(group.category, group.title)} disabled={busy !== null} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700">Add Keyword</button><button type="button" onClick={() => void approve(group.id)} disabled={busy !== null || group.status === "approved"} className="col-span-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300">{group.status === "approved" ? "Approved — Continue Managing" : busy === group.id ? "Approving…" : "Approve & Manage Group"}</button></div></Card>; })}</div>
      </>}
      {aiIdeasOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="keyword-ai-ideas-title"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-5"><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Project-aware keyword expansion</div><h2 id="keyword-ai-ideas-title" className="mt-1 text-xl font-bold text-charcoal-950">Ask AI for more keyword ideas</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">Preview actual keywords, select the useful phrases, and add only those selections to their relevant groups.</p></div>
        <div className="space-y-5 px-6 py-5">
          <div><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Context AI will use</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{[["Audience", audience], ["Offer", offer], ["Goals", [project?.primaryGoal, ...(Array.isArray(project?.secondaryGoals) ? project.secondaryGoals.map(String) : [])].filter(Boolean).join(", ") || "Not set"], ["Markets", markets.join(", ") || project?.businessLocation || "Not set"], ["Opportunity", selectedOpportunity || "Existing project direction"], ["Existing groups", `${groups.length} groups · ${totalRecommendations} keywords`]].map(([labelText, value]) => <div key={labelText} className="rounded-lg border border-slate-100 bg-slate-50 p-3"><div className="text-[11px] font-bold uppercase text-charcoal-400">{labelText}</div><div className="mt-1 line-clamp-2 text-sm font-semibold text-charcoal-800">{value}</div></div>)}</div></div>
          {!aiKeywordPreview.length && <><div><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Suggested AI instructions</div><div className="mt-3 grid gap-2">{aiPromptIdeas.map((idea) => <button key={idea} type="button" onClick={() => { setAiIdeaPrompt(idea); setAiKeywordPreview([]); setSelectedAiKeywords([]); }} className={`rounded-lg border px-4 py-3 text-left text-sm leading-5 ${aiIdeaPrompt === idea ? "border-brand-500 bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-200" : "border-slate-200 text-charcoal-700 hover:border-brand-200 hover:bg-brand-50/40"}`}>{idea}</button>)}</div></div><label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wide text-charcoal-400">AI instruction—not a keyword</span><textarea value={aiIdeaPrompt} onChange={(event) => { setAiIdeaPrompt(event.target.value); setAiKeywordPreview([]); setSelectedAiKeywords([]); }} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" placeholder="Describe the keyword direction to explore…" /><span className="mt-1 block text-xs text-charcoal-500">Previewing does not save anything.</span></label></>}
          {aiKeywordPreview.length > 0 && <div><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">Select keywords to add</div><div className="mt-1 text-sm text-charcoal-600">{selectedAiKeywords.length} selected · grouped automatically by search intent</div></div><button type="button" onClick={() => { setAiKeywordPreview([]); setSelectedAiKeywords([]); }} className="text-sm font-bold text-brand-700">Change instruction</button></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{aiKeywordPreview.map((group) => <div key={group.category} className="rounded-xl border border-slate-200 p-4"><div className="font-bold text-charcoal-900">{group.title}</div><div className="mt-3 space-y-2">{group.keywords.map((keyword) => { const key = aiSelectionKey(group.category, keyword); const selected = selectedAiKeywords.includes(key); return <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${selected ? "border-brand-300 bg-brand-50" : "border-slate-100 bg-white"}`}><input type="checkbox" checked={selected} onChange={() => setSelectedAiKeywords((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} className="mt-0.5"/><span className="font-semibold text-charcoal-800">{keyword}</span></label>; })}</div></div>)}</div></div>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setAiIdeasOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">Cancel</button>{aiKeywordPreview.length ? <button type="button" disabled={!selectedAiKeywords.length || aiPreviewBusy} onClick={() => void addSelectedAiKeywords()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{aiPreviewBusy ? "Adding…" : `Add Selected Keywords (${selectedAiKeywords.length})`}</button> : <button type="button" disabled={aiIdeaPrompt.trim().length < 3 || aiPreviewBusy} onClick={() => void previewAiKeywords()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{aiPreviewBusy ? "Generating preview…" : "Preview Actual Keywords"}</button>}</div>
      </div></div>}
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
          api.get<{ total: number; pages: CrawlPageRow[] }>(`/api/crawls/${crawlId}/pages?take=100`),
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
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(pages.length / pageSize));
  const visiblePages = pages.slice((page - 1) * pageSize, page * pageSize);
  return (
    <Card className={`overflow-hidden ${embedded ? "rounded-none border-0 shadow-none" : ""}`}>
      <div className="border-b border-slate-100 p-4">
        <h2 className="font-bold text-charcoal-950">Crawled Pages</h2>
        <p className="mt-1 text-sm text-charcoal-500">
          {loading ? "Loading pages from the latest completed crawl." : message || `Showing ${formatNumber(pages.length)} of ${formatNumber(total || pages.length)} pages from the latest completed crawl.`}
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

function BacklinkScreen({ data }: { data: ModuleData }) {
  const summary = data.backlinkSummary;
  const [showAllLinks, setShowAllLinks] = useState(false);
  if (!data.websites.length && !summary && !data.backlinkLinks?.links?.length) {
    return <EmptyModuleState title="No backlink data yet" detail="Connect a website before refreshing backlink intelligence." />;
  }
  const rows = backlinkRows(data, showAllLinks ? 100 : 10);
  const totalLinks = data.backlinkLinks?.links?.length ?? rows.length;
  return (
    <>
      <MetricGrid items={[["Referring Domains", formatNumber(summary?.referringDomains), `${formatNumber(summary?.referringDomainsNew)} new`], ["Active Backlinks", formatNumber(summary?.backlinks), "cached snapshot"], ["New Links", formatNumber(summary?.backlinksNew), "latest data"], ["Lost Links", formatNumber(summary?.backlinksLost), "latest data"], ["Dofollow Links", formatNumber(summary?.dofollow), "link type"], ["Outreach Opportunities", formatNumber(data.tasks.filter((task) => task.moduleName.includes("backlink")).length), "task queue"]]} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <DataTable
          title={showAllLinks ? `All Links (${formatNumber(totalLinks)})` : "Recent Links"}
          columns={["Source Domain", "Target Page", "Anchor Text", "Authority Score", "Status", "Link Type"]}
          rows={rows}
          footerAction={
            totalLinks > 10 ? (
              <button type="button" onClick={() => setShowAllLinks((value) => !value)} className="text-sm font-bold text-brand-600 hover:text-brand-700">
                {showAllLinks ? "Show fewer" : `View all ${formatNumber(totalLinks)} links`}
              </button>
            ) : (
              <span className="text-sm text-charcoal-500">Showing all available backlink links</span>
            )
          }
        />
        <AuthorityInsights data={data} />
      </div>
    </>
  );
}

function CitationScreen({ data }: { data: ModuleData }) {
  const project = data.projects[0];
  const website = data.websites[0];
  const citationTasks = data.tasks.filter((task) => {
    const haystack = `${task.moduleName} ${task.title} ${task.description}`.toLowerCase();
    return haystack.includes("citation") || haystack.includes("schema") || haystack.includes("structured data") || haystack.includes("faqpage");
  });
  const openTasks = citationTasks.filter((task) => !["completed", "skipped"].includes(task.status));
  const latestCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "completed") ?? null;
  const latestStrategy = project?.strategyPlans?.[0];
  const strategyStatus = latestStrategy?.status ? label(latestStrategy.status) : "Not generated";
  const localProfile = website?.localBusinessProfiles?.[0] ?? null;
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadHealth(crawlId: string) {
      setHealthLoading(true);
      try {
        const report = await api.get<HealthReport>(`/api/crawls/${crawlId}/health-report`);
        if (!cancelled) setHealthReport(report);
      } catch {
        if (!cancelled) setHealthReport(null);
      } finally {
        if (!cancelled) setHealthLoading(false);
      }
    }
    if (latestCrawl?.id) void loadHealth(latestCrawl.id);
    else setHealthReport(null);
    return () => { cancelled = true; };
  }, [latestCrawl?.id]);

  return (
    <>
      <MetricGrid items={[
        ["AI Readiness", healthReport ? `${healthReport.aiSearch.score} /100` : healthLoading ? "Loading" : "Not checked", healthReport ? "latest crawl" : "run site analysis"],
        ["Entity Schema", healthReport?.schema.hasOrganization ? "Found" : "Missing", `${schemaTypeCount(healthReport, "Organization", true)} org items`],
        ["NAP Profile", localProfile ? "Found" : "Missing", localProfile?.businessName ?? "local profile missing"],
        ["AI Access Files", healthReport?.aiSearch.llmsTxtPresent ? "Ready" : "Needs work", `llms.txt ${healthReport?.aiSearch.llmsTxtPresent ? "found" : "missing"}`],
        ["Answer Schema", healthReport?.faq.hasFAQSchema ? "Found" : "Missing", `FAQ ${schemaTypeCount(healthReport, "FAQPage")}`],
        ["Open Tasks", formatNumber(openTasks.length), `${citationTasks.length} total citation tasks`],
      ]} />

      {!citationTasks.length && (
        <Card className="border-amber-100 bg-amber-50 p-4">
          <div className="text-sm font-bold text-amber-950">No saved AI citation tasks yet.</div>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            This dashboard is using the latest crawl, local profile, and project context to show recommended citation tasks until saved execution tasks are created.
          </p>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-5 lg:grid-cols-2">
          <CitationPanel
            title="Entity & NAP"
            subtitle="Brand identity signals AI systems need before citing the business."
            rows={[
              { label: "Business name", value: localProfile?.businessName || project?.businessName || "Not configured", ok: Boolean(localProfile?.businessName || project?.businessName), action: "Edit profile" },
              { label: "Phone", value: localProfile?.phone || "Not configured", ok: Boolean(localProfile?.phone), action: "Add phone" },
              { label: "Address", value: [localProfile?.address, localProfile?.city, localProfile?.region].filter(Boolean).join(", ") || "Not configured", ok: Boolean(localProfile?.address), action: "Add address" },
              { label: "Organization schema", value: `${schemaTypeCount(healthReport, "Organization", true)} detected`, ok: Boolean(healthReport?.schema.hasOrganization), action: "Generate schema" },
            ]}
          />
          <CitationPanel
            title="AI Discoverability"
            subtitle="Files and crawl signals that help search and AI systems discover authoritative pages."
            rows={[
              { label: "llms.txt", value: healthReport?.aiSearch.llmsTxtPresent ? `Found · score ${healthReport.aiSearch.llmsTxtScore ?? 0}` : "Not found", ok: Boolean(healthReport?.aiSearch.llmsTxtPresent), action: "Generate" },
              { label: "Sitemap", value: `${formatNumber(healthReport?.siteFiles.sitemapUrls)} URLs`, ok: (healthReport?.siteFiles.sitemapUrls ?? 0) > 0, action: "Review" },
              { label: "Robots", value: healthReport?.siteFiles.robotsStatus ? `Status ${healthReport.siteFiles.robotsStatus}` : "Not checked", ok: healthReport?.siteFiles.robotsStatus === 200, action: "Review" },
            ]}
          />
          <CitationPanel
            title="Answer & Schema Coverage"
            subtitle="Structured data and answer blocks that improve citation eligibility."
            rows={[
              { label: "WebSite schema", value: `${schemaTypeCount(healthReport, "WebSite")} detected`, ok: Boolean(healthReport?.schema.hasWebsite), action: "Generate" },
              { label: "FAQPage schema", value: `${schemaTypeCount(healthReport, "FAQPage")} detected`, ok: Boolean(healthReport?.faq.hasFAQSchema), action: "Generate" },
              { label: "BreadcrumbList schema", value: `${schemaTypeCount(healthReport, "BreadcrumbList")} detected`, ok: Boolean(healthReport?.breadcrumb.hasBreadcrumbSchema), action: "Generate" },
              { label: "Invalid schema", value: `${formatNumber(healthReport?.schema.invalid)} issues`, ok: (healthReport?.schema.invalid ?? 0) === 0, action: "Fix" },
            ]}
          />
          <CitationPanel
            title="Citation Task Focus"
            subtitle="What SEnuke AI should work on next from the current project state."
            rows={smartCitationNextRows(data, healthReport, localProfile)}
          />
        </div>
        <div className="space-y-5">
          <CitationStatusPanel
            score={healthReport?.aiSearch.score ?? latestCrawl?.siteScore ?? 0}
            rows={[
              { label: "Website", value: website?.domain ?? project?.websiteUrl ?? "Not connected", ok: Boolean(website?.domain || project?.websiteUrl) },
              { label: "Strategy context", value: strategyStatus, ok: latestStrategy?.status === "approved" },
              { label: "Entity schema", value: healthReport?.schema.hasOrganization ? "Found" : "Missing", ok: Boolean(healthReport?.schema.hasOrganization) },
              { label: "NAP profile", value: localProfile ? "Configured" : "Missing", ok: Boolean(localProfile) },
              { label: "Open citation tasks", value: formatNumber(openTasks.length), ok: openTasks.length === 0 },
            ]}
          />
          <DataTable
            title="Citation Tasks"
            columns={["Task", "Impact", "Current Status", "Priority", "Action"]}
            rows={citationTableRows(citationTasks, healthReport, localProfile)}
            footerAction={<span className="text-sm font-semibold text-charcoal-500">Saved tasks appear first. If none exist, this table shows recommended tasks from the latest crawl and profile data.</span>}
          />
        </div>
      </div>
    </>
  );
}

function CitationStatusPanel({ score, rows }: { score: number; rows: { label: string; value: string; ok: boolean }[] }) {
  const safeScore = Math.max(0, Math.min(100, score));
  const chart = [{ name: "score", value: safeScore, color: "#0f9f87" }, { name: "rest", value: 100 - safeScore, color: "#e8eef8" }];
  return (
    <Card className="p-5">
      <h2 className="font-bold text-charcoal-950">AI Citation Dashboard</h2>
      <div className="my-5 flex justify-center">
        <div className="relative h-36 w-36">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={chart} dataKey="value" innerRadius={48} outerRadius={64} startAngle={90} endAngle={-270}>{chart.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-bold text-charcoal-950">{safeScore}</div><div className="text-xs text-charcoal-500">Readiness Score</div></div></div>
        </div>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-bold text-charcoal-800">{row.label}</div>
              <div className="truncate text-xs text-charcoal-500">{row.value}</div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${row.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {row.ok ? "Ready" : "Needs work"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CitationPanel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: { label: string; value: string; ok: boolean; action: string }[];
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
              <span className="text-xs font-bold text-brand-600">{row.action}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ArchitectScreen({ data }: { data: ModuleData }) {
  const project = data.projects[0];
  const website = data.websites[0];
  const latestCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "completed");
  const latestStrategy = (project?.strategyPlans?.[0] ?? null) as {
    status?: string;
    strategySummary?: string | null;
    seoStrategy?: string | null;
    contentStrategy?: string | null;
    publishingStrategy?: string | null;
    aiCitationStrategy?: string | null;
  } | null;
  const strategyApproved = latestStrategy?.status === "approved";
  const architectureTasks = data.tasks.filter((task) => /site|architect|sitemap|page|homepage|internal link|publish/i.test(`${task.moduleName} ${task.title} ${task.description}`));
  const pages = architecturePageBlueprint(data);
  const selectedPage = pages[0];
  const readinessSignals = [
    Boolean(project?.businessProfile || project?.intakeAnswers?.length),
    strategyApproved,
    Boolean(website || project?.websiteUrl),
    Boolean(latestCrawl),
    data.keywordRuns.length > 0,
  ];
  const readinessScore = Math.round((readinessSignals.filter(Boolean).length / readinessSignals.length) * 100);
  if (!project && !website && !data.tasks.length) {
    return <EmptyModuleState title="No site architecture yet" detail="Create a project before generating site structure." />;
  }
  return (
    <>
      <ContextBar
        items={[
          `Project: ${project?.businessName || project?.name || "Not selected"}`,
          `Website: ${website?.domain || project?.websiteUrl || "Not connected"}`,
          `Strategy: ${strategyApproved ? "Approved" : latestStrategy ? "Draft" : "Missing"}`,
          `Latest crawl: ${latestCrawl ? `${formatNumber(latestCrawl.pagesCrawled)} pages` : "Not run"}`,
          `Keywords: ${formatNumber(data.keywordRuns.length)} runs`,
        ]}
      />

      <MetricGrid
        items={[
          ["Architecture Readiness", `${readinessScore} /100`, strategyApproved ? "strategy approved" : "strategy needed"],
          ["Recommended Pages", formatNumber(pages.length), pages.length ? "from project context" : "no blueprint yet"],
          ["Crawled Pages", formatNumber(latestCrawl?.pagesCrawled), latestCrawl ? "latest scan" : "run site analysis"],
          ["Keyword Inputs", formatNumber(data.keywordRuns.length), data.keywordRuns.length ? "available for mapping" : "add keywords"],
          ["Architecture Tasks", formatNumber(architectureTasks.length), "saved task records"],
          ["Publishing Target", project?.preferredPublishingMethod || "Not selected", "from intake"],
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-4">
            <h2 className="font-bold text-charcoal-950">Site Structure Blueprint</h2>
            <p className="mt-1 text-sm text-charcoal-500">Recommended pages from intake, strategy, crawl, and keyword signals.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {pages.length ? pages.map((page, index) => (
              <div key={`${page.title}-${index}`} className={`p-4 ${index === 0 ? "bg-brand-50/60" : "bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-charcoal-950">{page.title}</div>
                    <div className="mt-1 text-xs leading-5 text-charcoal-500">{page.purpose}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${page.status === "Existing" ? "bg-emerald-50 text-emerald-700" : page.status === "Ready" ? "bg-blue-50 text-brand-700" : "bg-slate-100 text-charcoal-600"}`}>
                    {page.status}
                  </span>
                </div>
                <div className="mt-2 text-xs font-semibold text-charcoal-400">{page.source}</div>
              </div>
            )) : <EmptyModuleState title="No blueprint yet" detail="Complete intake and approve a strategy to generate page recommendations." compact />}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Selected Page Blueprint</div>
                <h2 className="mt-1 text-xl font-bold text-charcoal-950">{selectedPage?.title || "Page blueprint pending"}</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">{selectedPage?.purpose || "SEnuke AI needs approved strategy and project context before it can recommend page details."}</p>
              </div>
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{selectedPage?.status || "Pending"}</span>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ArchitectureDetail title="Suggested URL" value={selectedPage?.slug || "/"} />
              <ArchitectureDetail title="Primary CTA" value={architecturePrimaryCta(project, latestStrategy)} />
              <ArchitectureDetail title="SEO Focus" value={architectureSeoFocus(project, data)} />
              <ArchitectureDetail title="Internal Links" value={latestCrawl ? "Use crawl data to connect service, blog, and conversion pages." : "Run site analysis to calculate internal link opportunities."} />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
              <IconBadge icon="▤" />
              <h2 className="font-bold text-brand-700">Website & Funnel Sections</h2>
            </div>
            <div className="grid gap-5 lg:grid-cols-4">
              <PlanList title="Core Pages" items={pages.slice(0, 5).map((page) => page.title)} />
              <PlanList title="SEO Inputs" items={architectureSeoInputs(project, data)} />
              <PlanList title="Conversion Flow" items={architectureConversionFlow(project, latestStrategy)} />
              <PlanList title="Publishing Checks" items={architecturePublishingChecks(project, latestCrawl)} />
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <ArchitectureReadinessPanel
            score={readinessScore}
            rows={[
              { label: "Project profile", ok: Boolean(project?.businessProfile || project?.intakeAnswers?.length), value: project?.businessProfile ? "Complete" : "Needs intake" },
              { label: "Approved strategy", ok: strategyApproved, value: strategyApproved ? "Approved" : latestStrategy ? "Draft" : "Missing" },
              { label: "Connected website", ok: Boolean(website || project?.websiteUrl), value: website?.domain || project?.websiteUrl || "Missing" },
              { label: "Site crawl", ok: Boolean(latestCrawl), value: latestCrawl ? `${formatNumber(latestCrawl.pagesCrawled)} pages` : "Not run" },
              { label: "Keyword data", ok: data.keywordRuns.length > 0, value: `${formatNumber(data.keywordRuns.length)} runs` },
            ]}
          />
          <DataTable
            title="Next Architecture Actions"
            columns={["Task", "Impact", "Current Status", "Priority", "Action"]}
            rows={architectureActionRows(project, latestStrategy, latestCrawl, data, architectureTasks)}
            footerAction={<span className="text-sm font-semibold text-charcoal-500">Actions are derived from project profile, strategy, crawl, keyword runs, and saved architecture tasks.</span>}
          />
        </div>
      </div>
    </>
  );
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
            )) : <EmptyModuleState title="No ideas yet" detail="Approve strategy first. SEnuke AI will use the offer, audience, and goal to create lead magnet ideas." compact />}
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
              <ArchitectureDetail title="Safety Rule" value="SEnuke AI can generate drafts, but publishing pages or sending emails requires approval." />
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
              <p>1. SEnuke AI reads the approved strategy, audience, offer, and goal.</p>
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
}: {
  title: string;
  detail: string;
  compact?: boolean;
  actionTo?: string | null;
  actionLabel?: string | null;
}) {
  return (
    <Card className={`border-dashed border-slate-200 bg-white ${compact ? "p-4" : "p-6"}`}>
      <h2 className="text-base font-bold text-charcoal-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-charcoal-500">{detail}</p>
      {!compact && actionTo && actionLabel ? <Link to={actionTo} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">{actionLabel}</Link> : null}
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
        detail: "Approve the strategy before SEnuke AI creates downstream execution tasks for sitemap, content, lead magnets, SEO, domains, publishing, and social.",
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
        detail: "Site Analysis needs a website URL before SEnuke AI can crawl pages, issues, internal links, schema, AI readiness, and conversion opportunities.",
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
      detail: "Start with keywords the project actually wants to rank for. SEnuke AI will fetch demand, SERP competitors, visibility, and page mapping signals.",
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
  const score = safeScore(opportunity.opportunityScore, 72);
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
          <div className="min-w-0 flex-1 space-y-1 text-xs leading-5 text-charcoal-600"><p><b>Expected outcome:</b> {opportunity.recommendedOffer || opportunity.problemSolved || "A focused, measurable project direction."}</p><p><b>Estimated effort:</b> {(opportunity.executionScore ?? 50) >= 82 ? "Low" : (opportunity.executionScore ?? 50) >= 68 ? "Medium" : "High"} · <b>Confidence:</b> {Math.round(((opportunity.opportunityScore ?? 60) * 0.6) + ((opportunity.userFitScore ?? 60) * 0.4))}%</p></div>
          <div className="shrink-0 border-l border-slate-200 pl-3 text-center"><div className="text-3xl font-black leading-none text-emerald-600">{score}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-charcoal-400">Overall Score</div></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
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

function OpportunityInsights({ project, niche, opportunity, opportunityCount, taskCount, onReport }: { project: GuidedProject; niche: string; opportunity: Opportunity | undefined; opportunityCount: number; taskCount: number; onReport: () => void }) {
  const score = safeScore(opportunity?.opportunityScore, 72);
  const scoreRows = opportunityInsightScoreRows(opportunity);
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
          {scoreRows.map((row) => <OpportunityScoreBar key={row.label} label={row.label} value={row.value} tone={row.tone} />)}
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-charcoal-600 sm:col-span-2">Complexity is inverted from speed to launch. Lower complexity means easier to execute.</div>
        </div>
        <div className="grid grid-cols-3 gap-2 xl:grid-cols-1">
          <div className="grid place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 p-3 text-center text-white shadow-sm"><div className="text-3xl font-black">{score}</div><div className="text-[11px] font-bold uppercase tracking-wide text-brand-50">Overall Score</div></div>
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
            <h3 className="font-bold text-charcoal-950">Why SEnuke AI Recommends This</h3>
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
  const authorityScore = backlinkAuthorityScore(data);
  const followRate = percentage(summary?.dofollow, summary?.backlinks);
  const lostRate = percentage(summary?.backlinksLost, summary?.backlinks);
  const newRate = percentage(summary?.backlinksNew, summary?.backlinks);
  const lines = [
    `Referring Domains ${formatNumber(summary?.referringDomains)}`,
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

function KeywordInsightsBanner({ data }: { data: ModuleData }) {
  const score = averageOpportunityScore(data);
  const chart = [{ name: "score", value: score, color: "#0f9f87" }, { name: "rest", value: 100 - score, color: "#e8eef8" }];
  const metrics = [
    ["Average Search Volume", formatNumber(avg(data.keywordRuns.map((run) => run.avgSearchVolume ?? null)))],
    ["Average CPC", "$" + money(avg(data.keywordRuns.map((run) => run.avgCpc ?? null)))],
    ["Keyword runs", formatNumber(data.keywordRuns.length)],
    ["Open tasks", formatNumber(data.tasks.length)],
  ];
  return (
    <Card className="overflow-x-auto"><div className="grid min-w-[1040px] grid-cols-[260px_minmax(250px,1fr)_repeat(4,145px)] divide-x divide-slate-200"><div className="flex items-center gap-4 px-5 py-4"><div><div className="font-bold text-charcoal-950">Keyword Insights</div><div className="mt-1 text-xs text-charcoal-500">Research health</div></div><div className="relative h-20 w-20 shrink-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chart} dataKey="value" innerRadius={26} outerRadius={36} startAngle={90} endAngle={-270} stroke="none">{chart.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer><div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-lg font-bold leading-none text-charcoal-950">{score}</div><div className="mt-0.5 text-[9px] font-semibold uppercase text-charcoal-400">Score</div></div></div></div></div><div className="flex flex-col justify-center px-5 py-4"><div className="text-sm font-bold text-charcoal-900">Overall keyword health</div><div className="mt-1 text-xs leading-5 text-charcoal-500">Demand, cost, and workflow signals for this keyword set.</div></div>{metrics.map(([labelText, value]) => <div key={labelText} className="flex flex-col justify-center px-5 py-4"><div className="text-xs font-semibold text-charcoal-500">{labelText}</div><div className="mt-1 text-lg font-bold text-charcoal-950">{value}</div></div>)}</div>
    </Card>
  );
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

function strategyRoadmap(data: ModuleData, strategyApproved: boolean): { title: string; status: RoadmapStatus; reason: string }[] {
  const project = data.projects[0];
  const website = data.websites[0];
  const crawls = data.websites.flatMap((site) => site.crawlJobs ?? []);
  const completedCrawl = crawls.find((crawl) => crawl.status === "completed");
  const activeCrawl = crawls.find((crawl) => crawl.status === "queued" || crawl.status === "running");
  const hasWebsite = Boolean(website?.rootUrl || website?.domain || project?.websiteUrl);
  const hasScannedPages = Boolean(completedCrawl && completedCrawl.pagesCrawled > 0);
  const hasKeywordPlan = data.keywordRuns.some((run) => run.status === "completed" || run.keywordCount > 0 || (run.ideas?.length ?? 0) > 0);
  const hasBacklinkOrDomainData = Boolean(data.backlinkSummary?.target || website?.domain || project?.websiteUrl);

  const sitemapTask = milestoneTask(data.tasks, ["site_architect", "sitemap"]);
  const homepageTask = milestoneTask(data.tasks, ["content", "homepage"]);
  const leadTask = milestoneTask(data.tasks, ["lead_magnet", "lead magnet"]);
  const seoTask = milestoneTask(data.tasks, ["keyword_research", "seo plan"]);
  const domainTask = milestoneTask(data.tasks, ["domain", "find domains"]);
  const publishTask = milestoneTask(data.tasks, ["publishing", "publish"]);

  return [
    {
      title: "Approve Strategy",
      status: strategyApproved ? "Completed" : "Pending",
      reason: strategyApproved ? "The current strategy plan is approved." : "Approve the strategy before downstream execution.",
    },
    inferMilestone("Generate Sitemap", sitemapTask, {
      completed: hasScannedPages,
      inProgress: Boolean(activeCrawl),
      ready: strategyApproved,
      completedReason: `A completed crawl already found ${completedCrawl?.pagesCrawled ?? 0} page(s), so sitemap/site structure evidence exists.`,
      inProgressReason: "A website crawl is currently running.",
      readyReason: "Strategy is approved and sitemap generation can start.",
    }),
    inferMilestone("Create Homepage", homepageTask, {
      completed: hasWebsite && hasScannedPages,
      inProgress: Boolean(activeCrawl),
      ready: strategyApproved,
      completedReason: "The connected website has a completed crawl, so the homepage/site entry point already exists.",
      inProgressReason: "A crawl is checking the current website pages.",
      readyReason: "Strategy is approved and homepage content can be created.",
    }),
    inferMilestone("Build Lead Magnet", leadTask, {
      completed: false,
      ready: strategyApproved,
      readyReason: "Strategy is approved and the lead magnet can be generated from the offer and audience.",
    }),
    inferMilestone("Create SEO Plan", seoTask, {
      completed: hasKeywordPlan,
      ready: strategyApproved,
      completedReason: "Keyword research data already exists for this project.",
      readyReason: "Strategy is approved and keyword mapping can start.",
    }),
    inferMilestone("Find Domains", domainTask, {
      completed: hasBacklinkOrDomainData,
      ready: strategyApproved,
      completedReason: "A domain or backlink target is already connected to this project.",
      readyReason: "Strategy is approved and domain discovery can start.",
    }),
    inferMilestone("Publish Site", publishTask, {
      completed: website?.status === "active" && hasScannedPages,
      ready: strategyApproved,
      completedReason: "The website is active and has been crawled successfully.",
      readyReason: "Strategy is approved. Complete upstream execution tasks before publishing.",
    }),
  ];
}

function milestoneTask(tasks: GuidedExecutionTask[], terms: string[]) {
  const lowerTerms = terms.map((term) => term.toLowerCase());
  return tasks.find((task) => lowerTerms.some((term) => `${task.moduleName} ${task.title}`.toLowerCase().includes(term)));
}

function inferMilestone(
  title: string,
  task: GuidedExecutionTask | undefined,
  signals: { completed?: boolean; inProgress?: boolean; ready?: boolean; completedReason?: string; inProgressReason?: string; readyReason?: string },
) {
  if (task && ["completed", "skipped"].includes(task.status)) {
    return { title, status: "Completed" as const, reason: `${task.title} is marked ${task.status}.` };
  }
  if (signals.completed) {
    return { title, status: "Completed" as const, reason: signals.completedReason ?? "Existing project data confirms this step is already done." };
  }
  if (task && ["running", "queued", "in_progress", "needs_review"].includes(task.status)) {
    return { title, status: "In Progress" as const, reason: `${task.title} is ${label(task.status)}.` };
  }
  if (signals.inProgress) {
    return { title, status: "In Progress" as const, reason: signals.inProgressReason ?? "Related validation is currently running." };
  }
  if (task || signals.ready) {
    return { title, status: "Ready" as const, reason: signals.readyReason ?? "This step is available from the current project data." };
  }
  return { title, status: "Pending" as const, reason: "Waiting for earlier project data or execution tasks." };
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

function smartCitationNextRows(data: ModuleData, report: HealthReport | null, localProfile: NonNullable<Website["localBusinessProfiles"]>[number] | null) {
  const rows: { label: string; value: string; ok: boolean; action: string }[] = [];
  if (!localProfile) {
    rows.push({ label: "Set up NAP profile", value: "Business name, phone, and address are needed for entity confidence.", ok: false, action: "Create profile" });
  }
  if (!report?.schema.hasOrganization) {
    rows.push({ label: "Add Organization schema", value: "Entity schema is the highest-impact AI citation foundation.", ok: false, action: "Generate" });
  }
  if (!report?.aiSearch.llmsTxtPresent) {
    rows.push({ label: "Create llms.txt", value: "Guide AI crawlers to priority pages and brand facts.", ok: false, action: "Generate" });
  }
  if (!report?.faq.hasFAQSchema) {
    rows.push({ label: "Add FAQ schema", value: "Answer-first FAQ sections improve extractability.", ok: false, action: "Generate" });
  }
  if ((report?.schema.invalid ?? 0) > 0) {
    rows.push({ label: "Fix invalid schema", value: `${report?.schema.invalid ?? 0} structured-data issue(s) need cleanup.`, ok: false, action: "Fix" });
  }
  const openCitationTasks = data.tasks.filter((task) => {
    const text = `${task.moduleName} ${task.title} ${task.description}`.toLowerCase();
    return !["completed", "skipped"].includes(task.status) && /citation|schema|structured data|faqpage/.test(text);
  }).length;
  if (openCitationTasks > 0) {
    rows.push({ label: "Review open citation tasks", value: `${openCitationTasks} task(s) are waiting for action.`, ok: false, action: "Review" });
  }
  if (!rows.length) {
    rows.push({ label: "Citation foundation", value: "Core AI citation signals are present from the latest crawl.", ok: true, action: "Monitor" });
  }
  return rows.slice(0, 5);
}

function citationTableRows(tasks: GuidedExecutionTask[], report: HealthReport | null, localProfile: NonNullable<Website["localBusinessProfiles"]>[number] | null) {
  if (tasks.length) return taskRows(tasks);
  const rows: string[][] = [];
  if (!localProfile) {
    rows.push(["Set up NAP profile", "High", "Recommended from profile", "High", "Create profile"]);
  }
  if (!report) {
    rows.push(["Run site analysis for AI citation data", "High", "Missing crawl data", "High", "Analyze Site"]);
    return rows;
  }
  if (!report.schema.hasOrganization) {
    rows.push(["Add Organization schema", "High", "Missing from latest scan", "High", "Generate"]);
  }
  if (!report.aiSearch.llmsTxtPresent) {
    rows.push(["Create llms.txt", "Medium", "Missing from latest scan", "Medium", "Generate"]);
  }
  if (!report.faq.hasFAQSchema) {
    rows.push(["Add FAQPage schema", "Medium", "Missing from latest scan", "Medium", "Generate"]);
  }
  if (!report.breadcrumb.hasBreadcrumbSchema) {
    rows.push(["Add BreadcrumbList schema", "Medium", "Missing from latest scan", "Medium", "Generate"]);
  }
  if ((report.schema.invalid ?? 0) > 0) {
    rows.push(["Fix invalid structured data", "High", `${formatNumber(report.schema.invalid)} issue(s) found`, "High", "Fix"]);
  }
  if ((report.siteFiles.sitemapUrls ?? 0) === 0) {
    rows.push(["Review sitemap availability", "Medium", "No sitemap URLs found", "Medium", "Review"]);
  }
  if (report.siteFiles.robotsStatus !== 200) {
    rows.push(["Review robots.txt access", "Medium", report.siteFiles.robotsStatus ? `Status ${report.siteFiles.robotsStatus}` : "Not checked", "Medium", "Review"]);
  }
  return rows.length ? rows.slice(0, 8) : [["Monitor AI citation readiness", "Low", "Core scan signals look ready", "Low", "Monitor"]];
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

function websitePlanItems(data: ModuleData) {
  const website = data.websites[0];
  const project = data.projects[0];
  const ideas = data.keywordRuns.flatMap((run) => run.ideas?.map((idea) => idea.keyword) ?? []).slice(0, 5);
  if (!project && !website && !ideas.length) return [];
  return [
    ...(project || website ? ["Home"] : []),
    ...(project?.businessName ? [`About ${project.businessName}`] : []),
    ...(project?.niche ? [project.niche] : []),
    ...ideas,
    ...(website?.domain ? [`Contact ${website.domain}`] : []),
  ].slice(0, 10);
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

function keywordRows(runs: KeywordResearchRun[], renderActions?: (run: KeywordResearchRun, keyword: string) => ReactNode) {
  const rows: ReactNode[][] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const ideas = run.ideas?.length ? run.ideas : [{ keyword: run.seedKeyword, avgMonthlySearches: run.avgSearchVolume ?? null, competitionIndex: run.avgDifficulty ?? null, competitionLevel: null, cpc: run.avgCpc ?? null, currency: "USD" }];
    for (const idea of ideas) {
      const key = `${idea.keyword.trim().toLowerCase()}|${run.locationName.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const difficulty = idea.competitionIndex ?? run.avgDifficulty ?? 0;
      const score = Math.max(0, Math.min(100, Math.round(run.opportunityScore ?? 100 - difficulty / 1.4)));
      rows.push([
        idea.keyword,
        run.locationName,
        formatNumber(idea.avgMonthlySearches),
        `${Math.round(difficulty)} ${idea.competitionLevel || difficultyLabel(difficulty)}`,
        `$${money(idea.cpc)}`,
        String(score),
        keywordRankLabel(run),
        <RankMovement key={run.id + "-movement"} change={run.rankChange} />,
        formatNumber(run.averageVolume),
        formatNumber(run.keywordCount),
        formatNumber(run.competitorCount),
        ...(renderActions ? [renderActions(run, idea.keyword)] : []),
      ]);
      if (rows.length === 10) return rows;
    }
  }
  return rows;
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
