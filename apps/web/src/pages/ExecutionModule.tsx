import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { api } from "../api.js";
import { Card, StatusPill } from "../components/ui.js";
import { isExistingWebsiteFlow, nextProjectFlowStep } from "../project-flow.js";
import type { AiContentGeneration, DomainBacklinkLinks, DomainBacklinkSummary, GuidedExecutionTask, GuidedProject, HealthReport, KeywordResearchRun, Opportunity, Website, WorkspaceIntelligence, WorkspaceIntelligenceResponse } from "../types.js";

type ModuleKind = "opportunities" | "strategy" | "keywords" | "site-analysis" | "backlinks" | "ai-citations" | "site-architect" | "lead-magnets";
type CrawlSummary = NonNullable<Website["crawlJobs"]>[number];
type CrawlIssue = {
  id: string;
  issueType: string;
  category: string;
  severity: "high" | "medium" | "low" | string;
  message: string;
  recommendation?: string | null;
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
type StrategyTab = "score" | "core" | "audience" | "growth" | "funnel" | "roadmap";

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
    primary: "Add Keywords",
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

function moduleReadiness(kind: ModuleKind, data: ModuleData, project?: GuidedProject, website?: Website) {
  if (!project) return { canRun: false, items: [] as ReadinessItem[] };
  const intakeComplete = Boolean(project.businessProfile || (project.intakeAnswers?.length ?? 0) > 0);
  const opportunityExists = (project.opportunities?.length ?? 0) > 0;
  const opportunitySelected = project.opportunities?.some((opportunity) => opportunity.status === "selected") ?? false;
  const strategyExists = (project.strategyPlans?.length ?? 0) > 0;
  const strategyApproved = project.strategyPlans?.some((strategy) => typeof strategy === "object" && strategy !== null && "status" in strategy && strategy.status === "approved") ?? false;
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || website);
  const isExistingWebsite = isExistingWebsiteFlow(project, website);
  const siteAnalysisComplete = hasCompletedSiteAnalysis(data, project, website);
  const keywordAnalysisComplete = data.keywordRuns.some((run) => {
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
    backlinkSummary: null,
    backlinkLinks: null,
    intelligence: null,
    leadMagnetGenerations: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshingBacklinks, setRefreshingBacklinks] = useState(false);
  const [backlinkMessage, setBacklinkMessage] = useState("");
  const [siteAnalysisBusy, setSiteAnalysisBusy] = useState(false);
  const [siteAnalysisMessage, setSiteAnalysisMessage] = useState("");
  const [strategyBusy, setStrategyBusy] = useState<"generate" | "approve" | "execution" | null>(null);
  const [strategyMessage, setStrategyMessage] = useState("");
  const [leadMagnetBusy, setLeadMagnetBusy] = useState(false);
  const [leadMagnetMessage, setLeadMagnetMessage] = useState("");
  const [opportunityBusy, setOpportunityBusy] = useState<"generate" | string | null>(null);
  const [opportunityMessage, setOpportunityMessage] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get("projectId") ?? "");
  const [helpOpen, setHelpOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const workspace = await api.get<WorkspaceIntelligenceResponse>("/api/workspace/intelligence").catch(() => null);
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
        const requestedProjectId = searchParams.get("projectId");
        const defaultProjectId = requestedProjectId ?? workspace.intelligence.activeProjectId ?? workspace.projects[0]?.id ?? "";
        setData({
          projects: workspace.projects,
          websites: workspace.websites,
          keywordRuns: workspace.keywordRuns,
          tasks: workspace.tasks,
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
  const scopedData = selectedProject ? {
    ...data,
    projects: [selectedProject, ...data.projects.filter((project) => project.id !== selectedProject.id)],
    tasks: data.tasks.filter((task) => !task.projectId || task.projectId === selectedProject.id),
  } : data;
  const activeProject = scopedData.projects[0];
  const activeWebsite = activeProject?.websiteId
    ? data.websites.find((website) => website.id === activeProject.websiteId) ?? data.websites[0]
    : data.websites[0];
  const latestSiteCrawl = activeWebsite?.crawlJobs?.find((crawl) => crawl.status === "completed" && (crawl.pagesCrawled > 0 || crawl.siteScore != null));
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
    if (!activeWebsite || siteAnalysisBusy || siteScanCooldown.blocked) return;
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
  };

  const runStrategyAction = async (action: "generate" | "approve" | "execution") => {
    if (!activeProject) return { ok: false, message: "Create or select a project before using strategy actions." };
    if (strategyBusy) return { ok: false, message: "Another strategy action is already running." };
    const endpoint = action === "generate"
      ? `/api/projects-v2/${activeProject.id}/strategy/generate`
      : action === "approve"
        ? `/api/projects-v2/${activeProject.id}/strategy/approve`
        : `/api/projects-v2/${activeProject.id}/execution-plan/create`;
    setStrategyBusy(action);
    setStrategyMessage("");
    try {
      const result = await api.post<{ project: GuidedProject }>(endpoint, {});
      updateActiveProject(result.project);
      if (action === "execution") {
        navigate(`/guided-projects/${result.project.id}#execution-tasks`);
      }
      setStrategyMessage(action === "generate"
        ? "Strategy regenerated as a new draft. Review and approve this version before creating or updating the execution plan."
        : action === "approve"
          ? "Strategy approved. You can now create the execution plan."
          : "Execution plan created from the approved strategy. New execution tasks are now available in the roadmap and module pages.");
      return {
        ok: true,
        message: action === "generate"
          ? "Strategy regenerated as a new draft. Review and approve this version before creating or updating the execution plan."
          : action === "approve"
            ? "Strategy approved. You can now create the execution plan."
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
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/${opportunityId}/select`, {});
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
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${activeProject.id}/opportunities/clear-selection`, {});
      updateActiveProject(result.project);
      setOpportunityMessage("Selected opportunity removed. Choose another opportunity before generating the next strategy version.");
    } catch (error) {
      setOpportunityMessage(error instanceof Error ? error.message : "Could not remove selected opportunity.");
    } finally {
      setOpportunityBusy(null);
    }
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
      const result = await api.post<{ project: GuidedProject; generation: AiContentGeneration }>(`/api/projects-v2/${activeProject.id}/lead-magnet/generate`, {});
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
      ? (!activeWebsite || siteAnalysisBusy || siteScanCooldown.blocked || !canRunModule)
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
  }) : null;

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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-brand-600">{copy.title}</div>
          <h1 className="mt-1 text-[26px] font-bold leading-tight text-charcoal-950">{moduleTitle}</h1>
          <p className="mt-1 text-sm text-charcoal-500">{copy.subtitle}</p>
        </div>
        {hasActiveProject && (
          <div className="flex flex-wrap items-center gap-2">
            {data.projects.length > 1 && (
              <select
                value={activeProject?.id ?? ""}
                onChange={(event) => changeProject(event.target.value)}
                className="h-10 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-charcoal-800 shadow-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                aria-label="Select project"
              >
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.businessName || project.name}</option>
                ))}
              </select>
            )}
            {copy.secondary && (
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-800 shadow-sm hover:bg-slate-50"
              >
                {copy.secondary}
              </button>
            )}
            {kind === "ai-citations" ? (
              <span className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-charcoal-600">
                Live snapshot from latest crawl
              </span>
            ) : (
              <button
                type="button"
                onClick={runHeaderPrimaryAction}
                disabled={primaryDisabled}
                className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:hover:bg-slate-300"
              >
                {primaryLabel}
              </button>
            )}
          </div>
        )}
      </div>
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
      {hasActiveProject && kind === "site-analysis" && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${siteAnalysisMessage ? "border-brand-100 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-charcoal-500"}`}>
          {siteAnalysisMessage || (siteScanCooldown.blocked
            ? `The last scan completed ${formatDateTime(latestSiteCrawl?.completedAt ?? latestSiteCrawl?.createdAt)}. To avoid repeated crawl load, you can scan again after 72 hours. Time remaining: ${siteScanCooldown.remainingLabel}.`
            : latestSiteCrawl
              ? `${crawlSource(latestSiteCrawl)} completed ${formatDateTime(latestSiteCrawl.completedAt ?? latestSiteCrawl.createdAt)} with ${formatNumber(latestSiteCrawl.pagesCrawled)} page(s) crawled. You can run a new scan now.`
            : activeWebsite
              ? "Run a crawl to create site health, SEO issue, page, internal link, and readiness data for this project."
              : "Connect a website before analyzing site health.")}
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
      {hasActiveProject && hasWorkspaceRecords && canRunModule && kind !== "opportunities" && moduleNextStep && (
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
      {!loading && !hasActiveProject && <EmptyModuleState title="Create project first" detail="This module depends on a project. Create a project before using module actions." />}
      {!loading && hasActiveProject && !hasWorkspaceRecords && <EmptyModuleState title="No data available" detail="Project data will appear here after intake, crawls, tasks, or generation runs exist." />}
      {!loading && hasActiveProject && hasWorkspaceRecords && !canRunModule && <ModuleReadinessChecklist moduleTitle={copy.title} items={readiness.items} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "opportunities" && <OpportunityScreen data={scopedData} selectingId={opportunityBusy} onSelect={selectOpportunity} onClearSelection={clearOpportunitySelection} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "strategy" && <StrategyScreen data={scopedData} busy={strategyBusy} onAction={runStrategyAction} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "keywords" && <KeywordScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "site-analysis" && <SiteAnalysisScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "backlinks" && <BacklinkScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "ai-citations" && <CitationScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "site-architect" && <ArchitectScreen data={scopedData} />}
      {!loading && hasActiveProject && hasWorkspaceRecords && canRunModule && kind === "lead-magnets" && <LeadMagnetScreen data={scopedData} />}
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
}: {
  data: ModuleData;
  selectingId: string | null;
  onSelect: (opportunityId: string) => Promise<void>;
  onClearSelection: () => Promise<void>;
}) {
  const project = data.projects[0];
  const opportunities = [...(project?.opportunities ?? [])].sort((a, b) => {
    if (a.status === "selected" && b.status !== "selected") return -1;
    if (b.status === "selected" && a.status !== "selected") return 1;
    return (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
  });
  const actualSelectedOpportunity = opportunities.find((opportunity) => opportunity.status === "selected");
  const selectedOpportunity = actualSelectedOpportunity ?? opportunities[0];
  const [focusedId, setFocusedId] = useState(selectedOpportunity?.id ?? "");
  const [showAll, setShowAll] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [opportunityNotice, setOpportunityNotice] = useState<string | null>(null);

  const notifyOpportunity = (message: string) => {
    setOpportunityNotice(message);
  };

  useEffect(() => {
    if (selectedOpportunity?.id) setFocusedId(selectedOpportunity.id);
  }, [selectedOpportunity?.id]);

  const focusedOpportunity = opportunities.find((opportunity) => opportunity.id === focusedId) ?? selectedOpportunity;
  const opportunityCount = opportunities.length;
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
      <OpportunitySummaryStrip project={project} niche={niche} />
      {actualSelectedOpportunity && (
        <OpportunityNextStepCallout
          project={project}
          opportunity={actualSelectedOpportunity}
          onNotify={notifyOpportunity}
        />
      )}
      {opportunityNotice && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700">
          {opportunityNotice}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
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
                  notifyOpportunity("Opening opportunity comparison.");
                  setCompareOpen(true);
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-charcoal-800 hover:bg-slate-50"
              >
                Compare ({Math.min(opportunityCount, 3)}/{opportunityCount})
              </button>
              {opportunityCount > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-charcoal-800 hover:bg-slate-50"
                >
                  {showAll ? "Show Top 3" : "Show All"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  notifyOpportunity("Opening the full opportunity report.");
                  setReportOpen(true);
                }}
                className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50"
              >
                Full Report
              </button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {opportunities.slice(0, showAll ? opportunities.length : 3).map((opportunity, index) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                rank={index + 1}
                focused={focusedOpportunity?.id === opportunity.id}
                selected={opportunity.status === "selected"}
                busy={selectingId === opportunity.id}
                onFocus={() => setFocusedId(opportunity.id)}
                onDetails={() => {
                  notifyOpportunity(`Opening details for ${opportunity.name}.`);
                  setFocusedId(opportunity.id);
                  setDetailsOpen(true);
                }}
                onSelect={() => {
                  setOpportunityNotice(null);
                  void onSelect(opportunity.id);
                }}
                onClearSelection={() => {
                  setOpportunityNotice(null);
                  void onClearSelection();
                }}
                clearing={selectingId === "clear"}
              />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <IconBadge icon="✓" />
                <h2 className="font-bold text-brand-700">Why this fits</h2>
              </div>
              <p className="text-sm leading-6 text-charcoal-600">{focusedOpportunity?.summary || "This recommendation is based on the current intake, audience, offer, and project constraints."}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[focusedOpportunity?.targetAudience, focusedOpportunity?.problemSolved, focusedOpportunity?.recommendedOffer, focusedOpportunity?.businessModel]
                  .filter((item): item is string => Boolean(item))
                  .slice(0, 4)
                  .map((item, index) => <span key={`${focusedOpportunity?.id}-fit-${index}`} className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm font-semibold text-charcoal-700">✓ {item}</span>)}
              </div>
            </Card>
            <OpportunityExecutionPreview projectId={project.id} />
          </div>
        </div>
        <OpportunityInsights opportunity={focusedOpportunity} opportunityCount={opportunityCount} taskCount={taskCount} onReport={() => {
          notifyOpportunity("Opening the full opportunity report.");
          setReportOpen(true);
        }} />
      </div>
      <OpportunityDetailsDrawer opportunity={focusedOpportunity} open={detailsOpen} onClose={() => setDetailsOpen(false)} onSelect={focusedOpportunity ? () => { void onSelect(focusedOpportunity.id); } : undefined} selected={focusedOpportunity?.status === "selected"} />
      <OpportunityCompareDrawer opportunities={opportunities} open={compareOpen} onClose={() => setCompareOpen(false)} onFocus={(id) => { setFocusedId(id); setDetailsOpen(true); }} onSelect={(id) => { void onSelect(id); }} />
      <OpportunityReportDrawer opportunity={focusedOpportunity} open={reportOpen} onClose={() => setReportOpen(false)} projectId={project.id} />
    </>
  );
}

type StrategyActionResult = { ok: boolean; message: string };

function StrategyScreen({ data, busy, onAction }: { data: ModuleData; busy: "generate" | "approve" | "execution" | null; onAction: (action: "generate" | "approve" | "execution") => Promise<StrategyActionResult | undefined> }) {
  const [activeTab, setActiveTab] = useState<StrategyTab>("score");
  const [inlineNotice, setInlineNotice] = useState<{ tone: "info" | "success" | "error"; message: string } | null>(null);
  const project = data.projects[0];
  const strategyCount = project?._count?.strategyPlans ?? 0;
  const latestStrategy = project?.strategyPlans?.[0] as {
    status?: string;
    strategySummary?: string | null;
    positioningStatement?: string | null;
    audienceProfile?: string | null;
    offerRecommendation?: string | null;
    businessModel?: string | null;
    seoStrategy?: string | null;
    aiCitationStrategy?: string | null;
    contentStrategy?: string | null;
    authorityStrategy?: string | null;
    socialStrategy?: string | null;
    publishingStrategy?: string | null;
  } | undefined;
  const strategyApproved = latestStrategy?.status === "approved";
  const selectedOpportunity = project?.opportunities?.find((opportunity) => opportunity.status === "selected") ?? project?.opportunities?.[0];
  const score = selectedOpportunity?.opportunityScore ?? strategyScore(data);
  const scoreRows = [
    ["Business Fit", 92],
    ["SEO Potential", 89],
    ["Revenue Potential", 90],
    ["Ease of Execution", 76],
    ["Conversion Readiness", 86],
  ] as const;
  const audience = latestStrategy?.audienceProfile || project?.businessProfile?.targetAudience || "Not provided";
  const audienceSegments = splitAudience(audience);
  const audienceSummary = audienceSegments.length
    ? `${audienceSegments.length} target segments`
    : audience;
  const offer = latestStrategy?.offerRecommendation || project?.businessProfile?.offerSummary || "Offer recommendation pending.";
  const websiteType = label(project?.projectType);
  const businessModel = latestStrategy?.businessModel || project?.businessProfile?.businessModel || "Not provided";
  const roadmap = data.intelligence?.roadmap?.length ? data.intelligence.roadmap : strategyRoadmap(data, strategyApproved);
  const actionLabels = {
    generate: "Regenerate section",
    approve: "Approve strategy",
    execution: "Create execution plan",
  } as const;

  const runInlineAction = async (action: "generate" | "approve" | "execution") => {
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
      const result = await onAction(action);
      if (!result) {
        setInlineNotice({ tone: "error", message: `${actionLabels[action]} did not return a result. Please try again.` });
        return;
      }
      setInlineNotice({ tone: result.ok ? "success" : "error", message: result.message });
      if (result.ok && action === "generate") setActiveTab("core");
      if (result.ok && action === "execution") setActiveTab("roadmap");
    } catch (error) {
      setInlineNotice({ tone: "error", message: error instanceof Error ? error.message : `${actionLabels[action]} failed.` });
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
      <Card className="grid gap-0 overflow-hidden md:grid-cols-3 xl:grid-cols-6">
        <StrategyStripItem icon="☆" label="Selected Opportunity" value={selectedOpportunity?.name ?? project.niche ?? "Not selected"} />
        <StrategyStripItem icon="♙" label="Target Audience" value={audienceSummary} detail={audienceSegments.slice(0, 2).join(" · ")} />
        <StrategyStripItem icon="◎" label="Primary Goal" value={project.primaryGoal ?? "Not provided"} />
        <StrategyStripItem icon="▣" label="Business Model" value={businessModel} />
        <StrategyStripItem icon="▤" label="Website Type" value={websiteType} />
        <div className="border-t border-slate-100 p-4 md:border-l md:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-charcoal-500">Confidence Score</div>
              <div className="mt-1 text-lg font-bold text-charcoal-950">{score} <span className="text-sm font-semibold text-charcoal-400">/ 100</span></div>
            </div>
            <div className="grid h-14 w-14 place-items-center rounded-full border-[7px] border-emerald-500 text-sm font-bold text-charcoal-950">{score}</div>
          </div>
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

          {activeTab === "score" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card className="p-5">
                <h2 className="font-bold text-charcoal-950">Strategy Score & Next Actions</h2>
                <p className="mt-1 text-sm text-charcoal-500">Review the strategy readiness, approve the current version, or create the execution plan from the approved strategy.</p>
                <div className="mt-5 grid gap-4 lg:grid-cols-[280px_1fr]">
                  <div className="grid place-items-center rounded-xl border border-slate-200 bg-slate-50 p-5">
                    <div className="grid h-36 w-36 place-items-center rounded-full border-[12px] border-emerald-600 bg-white text-center shadow-sm">
                      <div><div className="text-4xl font-bold text-charcoal-950">{score}</div><div className="text-xs font-bold text-charcoal-500">Overall Score</div></div>
                    </div>
                    <div className="mt-4 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">{strategyApproved ? "Approved" : "Draft"}</div>
                  </div>
                  <div className="space-y-3">
                    {scoreRows.map(([labelText, value]) => (
                      <div key={labelText}>
                        <div className="mb-1 flex justify-between text-sm font-semibold text-charcoal-700"><span>{labelText}</span><span>{value}/100</span></div>
                        <div className="h-3 rounded-full bg-slate-100"><div className={`h-3 rounded-full ${value < 80 ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${value}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`mt-5 rounded-lg border px-4 py-3 text-sm leading-6 ${strategyApproved ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-100 bg-amber-50 text-amber-800"}`}>
                  {strategyApproved
                    ? "This strategy is approved. You can create or refresh the execution plan from this approved version."
                    : "This strategy is still a draft. Approve it first, then create the execution plan. Regenerating creates a new draft that also needs approval."}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <button type="button" onClick={() => { void runInlineAction("approve"); }} disabled={Boolean(busy)} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
                    {busy === "approve" ? "Approving..." : strategyApproved ? "Strategy Approved" : "Approve Strategy"}
                  </button>
                  <button type="button" onClick={() => { void runInlineAction("generate"); }} disabled={Boolean(busy)} className="rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">
                    {busy === "generate" ? "Regenerating..." : "Regenerate Section"}
                  </button>
                  <button type="button" onClick={() => { void runInlineAction("execution"); }} disabled={Boolean(busy)} className={`rounded-lg border bg-white px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 ${strategyApproved ? "border-brand-200 text-brand-700" : "border-amber-200 text-amber-700 hover:bg-amber-50"}`}>
                    {busy === "execution" ? "Creating..." : "Create Execution Plan"}
                  </button>
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
            <div className="grid gap-5 lg:grid-cols-2">
              <StrategyCard
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
            <div className="grid gap-5 lg:grid-cols-2">
              <StrategyCard
                icon="↗"
                title="Channel & Growth Plan"
                actionLabel="Open Funnel Plan"
                onAction={() => setActiveTab("funnel")}
                items={[
                  ["Content Strategy", latestStrategy.contentStrategy || "Content strategy pending."],
                  ["SEO Priority", latestStrategy.seoStrategy || "SEO priority pending."],
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
                  <Recommendation icon="◎" title="Smart Recommendation" text={`Focus on "${selectedOpportunity?.name ?? project.niche ?? project.name}" topics with the highest fit and traffic potential.`} />
                  <Recommendation icon="◌" title="Content Gap Opportunity" text="Unmapped topics and supporting pages should become keyword clusters after approval." />
                  <Recommendation icon="▣" title="Key Dependencies" text="Approved strategy, sitemap generated, domain selected, and lead magnet created." />
                </div>
              </Card>
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
        </div>
      )}
    </>
  );
}

function IconBadge({ icon }: { icon: string }) {
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">{icon}</span>;
}

function StrategyTabs({ activeTab, onChange }: { activeTab: StrategyTab; onChange: (tab: StrategyTab) => void }) {
  const tabs: Array<{ key: StrategyTab; label: string }> = [
    { key: "score", label: "Score & Actions" },
    { key: "core", label: "Core Strategy" },
    { key: "audience", label: "Audience" },
    { key: "growth", label: "Growth Plan" },
    { key: "funnel", label: "Funnel Plan" },
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

function StrategyStripItem({ icon, label, value, detail }: { icon: string; label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="min-w-0 border-t border-slate-100 p-4 first:border-l-0 md:border-l md:border-t-0">
      <div className="flex items-start gap-3">
        <IconBadge icon={icon} />
        <div className="min-w-0">
          <div className="text-xs font-semibold text-charcoal-500">{label}</div>
          <div className="mt-1 truncate text-sm font-bold leading-5 text-charcoal-950">{value}</div>
          {detail && <div className="mt-1 line-clamp-2 text-xs leading-5 text-charcoal-500">{detail}</div>}
        </div>
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
    { label: "Type", value: label(project.projectType) },
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
  const runs = data.keywordRuns;
  if (!runs.length) {
    const project = data.projects[0];
    const website = data.websites[0];
    return (
      <EmptyModuleState
        title="Add keywords first"
        detail={`${project?.businessName || project?.name || website?.domain || "This project"} is available, but no seed keywords have been researched yet. Add a primary keyword or select AI-suggested keywords first, then SEnuke AI can fetch search volume, difficulty, intent, CPC, opportunities, and page targets.`}
        actionTo={website?.id ? `/keyword-insights?project=${encodeURIComponent(website.id)}&add=1` : "/keyword-insights?add=1"}
        actionLabel="Add Keywords"
      />
    );
  }
  const topRun = runs[0];
  const rows = keywordRows(runs);
  const totalKeywords = runs.reduce((sum, run) => sum + (run.keywordCount || 0), 0);
  const avgDifficulty = avg(runs.map((run) => run.avgDifficulty ?? null)) ?? avg(runs.flatMap((run) => run.ideas?.map((idea) => idea.competitionIndex ?? null) ?? [])) ?? 0;
  return (
    <>
      <FilterBar labels={[`Search Keyword: ${topRun?.seedKeyword || "No run yet"}`, `Location: ${topRun?.locationName || "Not selected"}`, "Language: English", "Search Engine: Google"]} />
      <MetricGrid items={[["Total Keywords Found", formatNumber(totalKeywords), `${runs.length} run(s)`], ["Average Difficulty", formatNumber(Math.round(avgDifficulty)), difficultyLabel(avgDifficulty)], ["High-Opportunity Keywords", formatNumber(rows.filter((row) => Number(row[5]) >= 70).length), "from stored ideas"], ["Selected Page Targets", formatNumber(new Set(runs.map((run) => run.website?.id).filter(Boolean)).size), "websites mapped"]]} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <DataTable title="Keywords" columns={["Keyword", "Search Volume", "Difficulty", "Intent", "CPC", "Opportunity Score", "Cluster"]} rows={rows} />
        <SideStack title="Keyword Insights" data={data} />
      </div>
    </>
  );
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
  return (
    <>
      <FilterBar labels={[website?.rootUrl || website?.domain || "No website selected"]} />
      <MetricGrid items={[["Overall Health", `${latest?.siteScore ?? "—"} /100`, latest ? `${label(latest.status)} · ${crawlSource(latest)}` : "No crawl"], ["Issues Found", formatNumber(issueCount), issuesLoading ? "loading crawl issues" : "from latest crawl"], ["Pages Crawled", formatNumber(latest?.pagesCrawled), latest?.completedAt ? `completed ${formatDateTime(latest.completedAt)}` : "latest crawl"], ["Ranking Keywords", formatNumber(data.keywordRuns.reduce((sum, run) => sum + (run.keywordCount || 0), 0)), "from keyword runs"], ["Referring Domains", formatNumber(data.backlinkSummary?.referringDomains), "cached backlink data"], ["Citation Tasks", formatNumber(citationTaskCount), "task-backed"]]} />
      <ScanSummaryCards report={healthReport} loading={issuesLoading} onOpen={setActiveDetail} />
      <CrawledPagesTable pages={crawlPages} total={latest?.pagesCrawled ?? crawlPages.length} loading={issuesLoading} message={issueMessage} />
      <ScanDetailDrawer active={activeDetail} report={healthReport} onClose={() => setActiveDetail(null)} />
    </>
  );
}

function ScanSummaryCards({ report, loading, onOpen }: { report: HealthReport | null; loading: boolean; onOpen: (key: Exclude<ScanDetailKey, null>) => void }) {
  const cards = [
    { key: "highIssues" as const, label: "High issues", value: report?.severityCounts.high ?? 0, detail: `${report?.details?.technicalIssues.filter((issue) => issue.severity === "high").length ?? 0} detailed rows`, tone: "text-red-600" },
    { key: "brokenLinks" as const, label: "Broken links", value: report?.technical.brokenLinks ?? 0, detail: "Internal targets to repair", tone: "text-red-600" },
    { key: "orphanPages" as const, label: "Orphan pages", value: report?.internalLinking.orphanPages ?? 0, detail: "Pages needing internal links", tone: "text-amber-600" },
    { key: "weakAnchors" as const, label: "Weak anchors", value: report?.internalLinking.weakAnchorText ?? 0, detail: "Anchor text to improve", tone: "text-amber-600" },
  ];
  return (
    <Card className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onOpen(card.key)}
            disabled={!report}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-200 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-sm font-semibold text-charcoal-500">{card.label}</div>
            <div className={`mt-2 text-3xl font-bold ${card.tone}`}>{loading ? "..." : formatNumber(card.value)}</div>
            <div className="mt-1 text-xs font-medium text-charcoal-400">{card.detail}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function CrawledPagesTable({ pages, total, loading, message }: { pages: CrawlPageRow[]; total: number; loading: boolean; message: string }) {
  return (
    <Card className="overflow-hidden">
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
            {pages.length ? pages.map((page) => (
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
    </Card>
  );
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

function LeadMagnetScreen({ data }: { data: ModuleData }) {
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
  const selectedIdea = generatedPackage?.leadMagnet.title || ideas[0];
  const audience = project?.businessProfile?.targetAudience || "Target audience not provided";
  const offer = approvedStrategy?.offerRecommendation || project?.businessProfile?.offerSummary || project?.primaryGoal || "Offer not provided";
  const readiness = leadMagnetReadiness(data, approvedStrategy);
  if (!project && !ideas.length && !leadTasks.length) {
    return <EmptyModuleState title="No lead magnet data yet" detail="Create a project and strategy before generating lead magnet ideas." />;
  }
  return (
    <>
      <ContextBar
        items={[
          `Project: ${project?.businessName || project?.name || "Not selected"}`,
          `Audience: ${audience}`,
          `Offer: ${offer}`,
          `Strategy: ${approvedStrategy ? "Approved" : "Missing"}`,
          `Lead tasks: ${formatNumber(leadTasks.length)}`,
        ]}
      />
      <MetricGrid
        items={[
          ["Asset Ideas", formatNumber(ideas.length), ideas.length ? "from project data" : "needs strategy"],
          ["Keyword Inputs", formatNumber(keywordIdeaCount(data)), data.keywordRuns.length ? "available" : "optional"],
          ["Lead Tasks", formatNumber(leadTasks.length), leadTasks.length ? "ready to review" : "not created"],
          ["Approval Needed", "Yes", "before publish or send"],
          ["Delivery Flow", "4 steps", "landing, form, email, thank-you"],
          ["Automation Level", leadTasks[0]?.automationLevel ? label(leadTasks[0].automationLevel) : "Generate", "safe draft first"],
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        <Card className="p-5">
          <h2 className="font-bold text-charcoal-950">Recommended Lead Magnets</h2>
          <p className="mt-1 text-sm leading-6 text-charcoal-500">A lead magnet is a useful gated asset that gives visitors a reason to share contact details before booking or buying.</p>
          <div className="mt-4 space-y-3">
            {ideas.length ? ideas.map((item, index) => (
              <div key={`${item}-${index}`} className={`rounded-lg border p-3 ${index === 0 ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-charcoal-950">{item}</div>
                    <div className="mt-1 text-xs leading-5 text-charcoal-500">{leadMagnetIdeaReason(project, item, index)}</div>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-brand-700">{leadMagnetScore(data, index)}</span>
                </div>
              </div>
            )) : <EmptyModuleState title="No ideas yet" detail="Approve strategy first. SEnuke AI will use the offer, audience, and goal to create lead magnet ideas." compact />}
          </div>
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

          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
              <IconBadge icon="▣" />
              <h2 className="font-bold text-brand-700">What SEnuke AI Will Generate</h2>
            </div>
            <div className="grid gap-5 lg:grid-cols-4">
              <PlanList title="Lead Asset" items={leadMagnetAssetPlan(project, selectedIdea)} />
              <PlanList title="Landing Page" items={["Headline and promise", "Benefits and proof", "Form CTA copy", "FAQ / objection blocks"]} />
              <PlanList title="Delivery Flow" items={["Thank-you page copy", "Delivery email", "Follow-up email outline", "Next-step CTA"]} />
              <PlanList title="Tracking Tasks" items={["Capture form check", "Conversion event", "Traffic source note", "Review after launch"]} />
            </div>
          </Card>

          <div id="lead-magnet-tasks" className="scroll-mt-24">
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
          </div>
        </div>

        <div className="space-y-5">
          <ArchitectureReadinessPanel score={readiness.score} rows={readiness.rows} />
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">How It Works</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-charcoal-600">
              <p>1. SEnuke AI reads the approved strategy, audience, offer, and goal.</p>
              <p>2. It recommends the best gated asset for the current funnel stage.</p>
              <p>3. It prepares the asset outline, landing-page copy, delivery email, thank-you copy, and follow-up flow.</p>
              <p>4. You review and approve before anything is published or sent.</p>
            </div>
            <Link to={project ? `/strategy?projectId=${project.id}` : "/strategy"} className="mt-5 inline-flex w-full justify-center rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 hover:bg-brand-50">
              Review Strategy
            </Link>
          </Card>
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
}: {
  kind: ModuleKind;
  project: GuidedProject;
  website?: Website | null;
  latestCrawl?: CrawlSummary | null;
  siteScanBlocked: boolean;
  siteScanRemaining: string;
}): ModuleNextStep {
  const latestStrategy = project.strategyPlans?.[0];
  const selectedOpportunity = project.opportunities?.find((opportunity) => opportunity.status === "selected");
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
    <Card className={`flex min-h-[330px] flex-col p-4 transition ${focused ? "border-brand-500 ring-1 ring-brand-200" : "hover:border-brand-200"}`}>
      <button type="button" onClick={onFocus} className="flex flex-1 flex-col text-left">
        <div className="flex items-center justify-between gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${selected ? "bg-brand-600 text-white" : rank === 1 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-charcoal-600"}`}>
            {selected ? "Selected" : rank === 1 ? "Recommended" : `Option ${rank}`}
          </span>
          {focused ? <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">✓</span> : null}
        </div>
        <h2 className="mt-4 min-h-[52px] text-lg font-bold leading-6 text-charcoal-950">{opportunity.name}</h2>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-charcoal-500">{opportunity.summary || opportunity.problemSolved || "AI-generated opportunity from project intake."}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <OpportunityMetricChip label="SEO Potential" value={safeScore(opportunity.seoScore, score)} />
          <OpportunityMetricChip label="Monetization" value={safeScore(opportunity.monetizationScore, score)} />
          <OpportunityMetricChip label="Competition" value={safeScore(opportunity.competitionScore, 50)} tone="amber" />
          <OpportunityMetricChip label="Speed to Launch" value={safeScore(opportunity.executionScore, score)} />
          <OpportunityMetricChip label="User Fit" value={safeScore(opportunity.userFitScore, score)} />
        </div>
      </button>
      <div className="mt-5 flex items-end justify-between gap-3">
        <button type="button" onClick={onDetails} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-charcoal-800 hover:bg-slate-50">View Details</button>
        <div className="text-right"><div className="text-4xl font-bold text-emerald-600">{score}</div><div className="text-xs text-charcoal-500">Overall Score</div></div>
      </div>
      {selected ? (
        <div className="mt-4 space-y-2">
          <div className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-bold text-white shadow-sm">
            {shortOpportunityName} selected as strategy direction
          </div>
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
        <button
          type="button"
          onClick={onSelect}
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {busy ? `Selecting ${shortOpportunityName}...` : "Select as Strategy Direction"}
        </button>
      )}
    </Card>
  );
}

function OpportunityMetricChip({ label, value, tone = "emerald" }: { label: string; value: number; tone?: "emerald" | "amber" }) {
  const valueLabel = tone === "amber" ? competitionLabel(value) : scoreQuality(value);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-bold text-charcoal-500">{label}</div>
      <div className={`mt-1 text-sm font-bold ${tone === "amber" ? "text-amber-600" : "text-emerald-600"}`}>{value}</div>
      <div className="text-[11px] font-semibold text-charcoal-400">{valueLabel}</div>
    </div>
  );
}

function OpportunityNextStepCallout({ project, opportunity, onNotify }: { project: GuidedProject; opportunity: Opportunity; onNotify: (message: string) => void }) {
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
            onClick={() => onNotify(nextStep.notice)}
            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
          >
            {nextStep.actionLabel} <span className="ml-2">→</span>
          </Link>
          <Link
            to={`/guided-projects/${project.id}`}
            onClick={() => onNotify("Opening the guided project workflow.")}
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
            <DetailBlock title="Audience" value={opportunity.targetAudience} />
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
                <div key={opportunity.id} className={`flex min-h-[360px] flex-col rounded-lg border p-4 ${opportunity.status === "selected" ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-charcoal-600">{opportunity.status === "selected" ? "Selected" : `Option ${index + 1}`}</span>
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
                    <button type="button" onClick={() => onSelect(opportunity.id)} disabled={opportunity.status === "selected"} className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
                      {opportunity.status === "selected" ? "Selected" : "Choose This"}
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

function OpportunityExecutionPreview({ projectId }: { projectId: string }) {
  const steps = [
    ["Run Keyword Analysis", "Research buyer-intent keywords, topical clusters, competitor gaps, difficulty, and opportunity score.", `/keywords?projectId=${projectId}`],
    ["Run Site Analysis", "For existing websites, crawl pages, technical SEO, metadata, internal links, content gaps, speed, CTAs, and indexability.", `/site-analysis?projectId=${projectId}`],
    ["Generate Strategy", "Use opportunity, keyword, site, competitor, goal, and user-path data to create the strategy.", `/strategy?projectId=${projectId}`],
    ["Approve Strategy", "Review and approve the strategy version before downstream tasks are created.", `/strategy?projectId=${projectId}`],
    ["Create Execution Plan", "Create prioritized tasks with why, priority, effort, impact, automation, approvals, credits, status, and next action.", `/strategy?projectId=${projectId}`],
  ] as const;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <IconBadge icon="↗" />
        <h2 className="font-bold text-brand-700">Execution Preview</h2>
      </div>
      <div className="divide-y divide-slate-100">
        {steps.map(([title, detail, url], index) => (
          <Link key={title} to={url} className="flex items-center gap-3 py-3 hover:bg-slate-50">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{index + 1}</span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-charcoal-950">{title}</span>
              <span className="block truncate text-xs text-charcoal-500">{detail}</span>
            </span>
            <span className="ml-auto text-brand-600">›</span>
          </Link>
        ))}
      </div>
      <Link to={`/guided-projects/${projectId}`} className="mt-4 inline-flex text-sm font-bold text-brand-600 hover:text-brand-700">Open project workflow</Link>
    </Card>
  );
}

function OpportunityInsights({ opportunity, opportunityCount, taskCount, onReport }: { opportunity: Opportunity | undefined; opportunityCount: number; taskCount: number; onReport: () => void }) {
  const score = safeScore(opportunity?.opportunityScore, 72);
  const demand = safeScore(opportunity?.seoScore, score);
  const revenue = safeScore(opportunity?.monetizationScore, score);
  const complexity = Math.max(0, 100 - safeScore(opportunity?.executionScore, score));
  const confidence = Math.round(avg([opportunity?.seoScore, opportunity?.monetizationScore, opportunity?.userFitScore, opportunity?.executionScore]) ?? score);
  const factors = [
    opportunity?.targetAudience ? `Audience: ${opportunity.targetAudience}` : null,
    opportunity?.problemSolved ? `Problem: ${opportunity.problemSolved}` : null,
    opportunity?.recommendedOffer ? `Offer: ${opportunity.recommendedOffer}` : null,
    opportunity?.businessModel ? `Model: ${opportunity.businessModel}` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="font-bold text-charcoal-950">Opportunity Insights</h2>
        <div className="mt-4 space-y-3">
          <OpportunityScoreBar label="Demand" value={demand} />
          <OpportunityScoreBar label="SEO Potential" value={demand} />
          <OpportunityScoreBar label="Revenue Potential" value={revenue} />
          <OpportunityScoreBar label="Execution Complexity" value={complexity} tone="amber" />
          <OpportunityScoreBar label="Confidence" value={confidence} />
        </div>
        <div className="my-5 flex justify-center">
          <div className="grid h-32 w-32 place-items-center rounded-full border-[10px] border-emerald-600 text-center">
            <div><div className="text-3xl font-bold text-charcoal-950">{score}</div><div className="text-xs text-charcoal-500">Overall Score</div></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
          <div><div className="font-bold text-charcoal-950">{opportunityCount}</div><div className="text-xs text-charcoal-500">Generated options</div></div>
          <div><div className="font-bold text-charcoal-950">{taskCount}</div><div className="text-xs text-charcoal-500">Related tasks</div></div>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="font-bold text-charcoal-950">Top Opportunity Factors</h2>
        <div className="mt-4 space-y-3">
          {(factors.length ? factors : ["Complete project intake and create opportunities to populate scored recommendation factors."]).map((factor, index) => (
            <div key={`${opportunity?.id ?? "empty"}-factor-${index}`} className="flex gap-2 text-sm leading-6 text-charcoal-600">
              <span className="font-bold text-emerald-600">✓</span>
              <span>{factor}</span>
            </div>
          ))}
        </div>
        <button type="button" onClick={onReport} className="mt-5 flex w-full items-center justify-between rounded-lg border border-brand-100 px-4 py-3 text-sm font-bold text-brand-600 hover:bg-brand-50">
          View Full Opportunity Report <span>→</span>
        </button>
      </Card>
    </div>
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
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {metrics.map((metric) => (
                    <div key={metric.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-bold text-charcoal-500">{metric.label}</div>
                      <div className={`mt-1 text-lg font-bold ${metric.tone === "amber" ? "text-amber-600" : "text-emerald-600"}`}>{metric.value}/100</div>
                    </div>
                  ))}
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
          <OpportunityExecutionPreview projectId={projectId} />
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

function DataTable({ title, columns, rows, footerAction }: { title: string; columns: string[]; rows: string[][]; footerAction?: React.ReactNode }) {
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
      <div className="border-t border-slate-100 p-4">
        {footerAction ?? <Link to="/keyword-insights" className="text-sm font-bold text-brand-600">View keyword reports</Link>}
      </div>
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
    project?.targetLocation ? `Location: ${project.targetLocation}` : "Location pending",
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

function keywordRows(runs: KeywordRun[]) {
  const rows = runs.flatMap((run) => {
    const ideas = run.ideas?.length ? run.ideas : [{ keyword: run.seedKeyword, avgMonthlySearches: run.avgSearchVolume ?? null, competitionIndex: run.avgDifficulty ?? null, competitionLevel: null, cpc: run.avgCpc ?? null, currency: "USD" }];
    return ideas.map((idea) => {
      const difficulty = idea.competitionIndex ?? run.avgDifficulty ?? 0;
      const score = Math.max(0, Math.min(100, Math.round(run.opportunityScore ?? 100 - difficulty / 1.4)));
      return [
        idea.keyword,
        formatNumber(idea.avgMonthlySearches),
        `${Math.round(difficulty)} ${idea.competitionLevel || difficultyLabel(difficulty)}`,
        run.intent || "Mixed",
        `$${money(idea.cpc)}`,
        String(score),
        run.seedKeyword,
      ];
    });
  });
  return rows.slice(0, 10);
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
  const fromTasks = data.tasks.filter((task) => task.moduleName.includes("lead") || task.title.toLowerCase().includes("lead")).map((task) => task.title);
  const fromKeywords = data.keywordRuns.slice(0, 3).map((run) => `${label(run.seedKeyword)} Guide`);
  const fromProject = data.projects[0]?.niche ? [`${data.projects[0].niche} Checklist`] : [];
  const merged = [...fromTasks, ...fromKeywords, ...fromProject];
  return merged.slice(0, 5);
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
  const audience = project?.businessProfile?.targetAudience || "the selected audience";
  const goal = project?.primaryGoal || "the primary conversion goal";
  if (index === 0) return `Best first option because it can connect ${audience} to ${goal}.`;
  if (/checklist/i.test(idea)) return "Useful for quick lead capture because it promises a practical, low-friction takeaway.";
  if (/guide|report/i.test(idea)) return "Useful for higher-intent visitors who need education before they convert.";
  return "Recommended from current project context and available task signals.";
}

function leadMagnetSummary(project: GuidedProject | undefined, strategy: { strategySummary?: string | null; offerRecommendation?: string | null } | undefined) {
  if (strategy?.strategySummary) return strategy.strategySummary;
  const business = project?.businessName || project?.name || "this project";
  const audience = project?.businessProfile?.targetAudience || "the target audience";
  const offer = strategy?.offerRecommendation || project?.businessProfile?.offerSummary || project?.primaryGoal || "the primary offer";
  return `Create a focused conversion asset for ${business} that helps ${audience} understand ${offer} and move to the next step.`;
}

function leadMagnetPromise(project: GuidedProject | undefined, strategy: { offerRecommendation?: string | null } | undefined) {
  const audience = project?.businessProfile?.targetAudience || "your audience";
  const offer = strategy?.offerRecommendation || project?.businessProfile?.offerSummary || project?.primaryGoal || "your offer";
  return `Help ${audience} make progress toward ${offer} with a useful resource before asking for a consultation or conversion.`;
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
