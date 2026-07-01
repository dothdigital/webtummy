import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { AiContentGeneration, ExecutionTask, HealthReport, KeywordResearchRun, LocalBusinessProfile, SocialStrategyResponse, Website } from "../types.js";
import { ActionIconLink, Button, Card, StatusPill } from "../components/ui.js";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function scoreClass(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 85) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function taskPriorityClass(priority: string): string {
  if (priority === "high") return "bg-red-50 text-red-700 border-red-100";
  if (priority === "low") return "bg-slate-50 text-slate-600 border-slate-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

function taskStatusClass(status: string): string {
  if (status === "completed") return "bg-green-50 text-green-700 border-green-100";
  if (status === "skipped") return "bg-slate-50 text-slate-500 border-slate-100";
  if (status === "needs_review") return "bg-blue-50 text-blue-700 border-blue-100";
  if (status === "failed") return "bg-red-50 text-red-700 border-red-100";
  return "bg-brand-50 text-brand-700 border-brand-100";
}

function taskLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function HealthStat({
  label,
  value,
  detail,
  tone = "text-charcoal-700",
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className="h-full rounded-lg border border-charcoal-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-xs font-medium text-charcoal-500">{detail}</div>}
    </div>
  );
}

type ProjectPanel = "crawl" | "execution" | "local" | "keywords" | "ai" | "social";
type OverviewTone = "brand" | "green" | "amber" | "blue" | "red" | "slate";
type OverviewStat = { label: string; value: React.ReactNode; detail: string; tone?: string; valueClassName?: string };
type OverviewTabItem = {
  id: ProjectPanel;
  title: string;
  headline: string;
  description: string;
  stats: OverviewStat[];
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  tone?: OverviewTone;
};

function ProjectOverviewTabs({
  items,
  activePanel,
  onSelect,
}: {
  items: OverviewTabItem[];
  activePanel: ProjectPanel;
  onSelect: (panel: ProjectPanel) => void;
}) {
  const activeItem = items.find((item) => item.id === activePanel) ?? items[0];
  const toneClasses: Record<OverviewTone, { tab: string; accent: string; panel: string }> = {
    brand: { tab: "border-brand-200 bg-brand-50 text-brand-700", accent: "bg-brand-600", panel: "border-brand-100 bg-brand-50/40" },
    green: { tab: "border-green-200 bg-green-50 text-green-700", accent: "bg-green-600", panel: "border-green-100 bg-green-50/40" },
    amber: { tab: "border-amber-200 bg-amber-50 text-amber-700", accent: "bg-amber-500", panel: "border-amber-100 bg-amber-50/40" },
    blue: { tab: "border-blue-200 bg-blue-50 text-blue-700", accent: "bg-blue-600", panel: "border-blue-100 bg-blue-50/40" },
    red: { tab: "border-red-200 bg-red-50 text-red-700", accent: "bg-red-600", panel: "border-red-100 bg-red-50/40" },
    slate: { tab: "border-slate-200 bg-slate-50 text-slate-700", accent: "bg-slate-600", panel: "border-slate-100 bg-slate-50" },
  };
  const activeTone = toneClasses[activeItem.tone ?? "brand"];

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-charcoal-100 bg-charcoal-50/70 p-2">
        <div role="tablist" aria-label="Project overview" className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {items.map((item) => {
            const isActive = item.id === activePanel;
            const tone = toneClasses[item.tone ?? "brand"];
            const leadingStat = item.stats[0];
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(item.id)}
                className={`relative min-h-[96px] rounded-lg border px-3 py-3 text-left transition ${isActive ? tone.tab : "border-transparent bg-white text-charcoal-600 hover:border-charcoal-200 hover:bg-charcoal-50"}`}
              >
                <span className={`absolute inset-x-3 top-0 h-1 rounded-b-full ${isActive ? tone.accent : "bg-transparent"}`} />
                <span className="block text-[11px] font-semibold uppercase tracking-wide">{item.title}</span>
                <span className="mt-1 block truncate text-sm font-bold text-charcoal-850">{item.headline}</span>
                {leadingStat && (
                  <span className="mt-2 flex items-baseline gap-1.5 text-xs text-charcoal-500">
                    <span className="font-bold text-charcoal-800">{leadingStat.value}</span>
                    <span>{leadingStat.label.toLowerCase()}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`border-t p-5 ${activeTone.panel}`}>
        <div className="grid gap-5 xl:grid-cols-[minmax(260px,1fr)_420px_180px] xl:items-center">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">{activeItem.title}</div>
            <h2 className="mt-1 text-2xl font-bold text-charcoal-850">{activeItem.headline}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-600">{activeItem.description}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {activeItem.stats.map((stat) => (
              <div key={stat.label} className="min-h-[82px] rounded-lg border border-charcoal-100 bg-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-400">{stat.label}</div>
                <div className={`mt-1 truncate font-bold leading-none ${stat.valueClassName ?? "text-2xl"} ${stat.tone ?? "text-charcoal-800"}`}>{stat.value}</div>
                <div className="mt-1 text-[11px] font-medium text-charcoal-400">{stat.detail}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 xl:flex-col">
            <div className="rounded-lg border border-charcoal-100 bg-white px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-charcoal-500">
              Details shown below
            </div>
            {activeItem.primaryAction && (
              <Button variant="ghost" onClick={activeItem.primaryAction.onClick} disabled={activeItem.primaryAction.disabled} className="w-full">
                {activeItem.primaryAction.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function WebsiteHealth() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [website, setWebsite] = useState<Website | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [localBusiness, setLocalBusiness] = useState<LocalBusinessProfile | null>(null);
  const [socialSummary, setSocialSummary] = useState<SocialStrategyResponse | null>(null);
  const [keywordRuns, setKeywordRuns] = useState<KeywordResearchRun[]>([]);
  const [aiContent, setAiContent] = useState<AiContentGeneration[]>([]);
  const [executionTasks, setExecutionTasks] = useState<ExecutionTask[]>([]);
  const [taskFilter, setTaskFilter] = useState("open");
  const [activePanel, setActivePanel] = useState<ProjectPanel>("execution");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const openPanel = (panel: ProjectPanel) => {
    setActivePanel(panel);
    window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const latest = website?.crawlJobs?.[0] ?? null;
  const latestCompleted = website?.crawlJobs?.find((crawl) => crawl.status === "completed") ?? null;
  const activeCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "queued" || crawl.status === "running") ?? null;
  const rankedKeywordRuns = keywordRuns.filter((run) => run.targetRank || run.manualRank);
  const latestKeywordRun = keywordRuns[0] ?? null;
  const latestAiContent = aiContent[0] ?? null;
  const completedAiContent = aiContent.filter((item) => item.status === "completed");
  const aiReviewTasks = executionTasks.filter((task) => task.moduleName === "ai_content" && task.status === "needs_review");
  const openTasks = executionTasks.filter((task) => task.status !== "completed" && task.status !== "skipped");
  const highPriorityTasks = openTasks.filter((task) => task.priority === "high");
  const reviewTasks = openTasks.filter((task) => task.status === "needs_review");
  const completedTasks = executionTasks.filter((task) => task.status === "completed");
  const visibleTasks = executionTasks.filter((task) => {
    if (taskFilter === "all") return true;
    if (taskFilter === "open") return task.status !== "completed" && task.status !== "skipped";
    return task.moduleName === taskFilter || task.status === taskFilter || task.priority === taskFilter;
  });
  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ website: Website }>(`/api/websites/${id}`);
      setWebsite(result.website);
      const completed = result.website.crawlJobs?.find((crawl) => crawl.status === "completed");
      const [healthResult, socialResult, keywordResult, aiResult] = await Promise.all([
        completed ? api.get<HealthReport>(`/api/crawls/${completed.id}/health-report`).catch(() => null) : Promise.resolve(null),
        api.get<SocialStrategyResponse>(`/api/social-strategy?websiteId=${encodeURIComponent(id)}`).catch(() => null),
        api.get<{ runs: KeywordResearchRun[] }>("/api/keyword-research").catch(() => ({ runs: [] })),
        api.get<{ generations: AiContentGeneration[] }>("/api/ai-content/history").catch(() => ({ generations: [] })),
      ]);
      setHealth(healthResult);
      setLocalBusiness(result.website.localBusinessProfiles?.[0] ?? null);
      setSocialSummary(socialResult);
      setKeywordRuns(keywordResult.runs.filter((run) => run.websiteId === id));
      setAiContent(aiResult.generations.filter((item) => item.websiteId === id));
      const taskResult = await api.post<{ tasks: ExecutionTask[] }>(`/api/websites/${id}/execution-tasks/sync`, {}).catch(() => ({ tasks: [] }));
      setExecutionTasks(taskResult.tasks);
    } catch (e) {
      setWebsite(null);
      setHealth(null);
      setLocalBusiness(null);
      setSocialSummary(null);
      setKeywordRuns([]);
      setAiContent([]);
      setExecutionTasks([]);
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("website belongs to another client")) {
        setError("This project exists, but your current login is not assigned to the client that owns it.");
      } else if (message.includes("404")) {
        setError("This website ID was not found in the local database.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!activeCrawl) return;
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCrawl?.id]);

  const runCrawl = async () => {
    if (!id) return;
    setStarting(true);
    try {
      await api.post(`/api/websites/${id}/crawls`, { pageLimit: 150 });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("409")) {
        alert(message.includes("recent crawl already completed") ? "This project already has a completed crawl from the last 24 hours. Open the latest report instead of running the same 150-page check again." : "A crawl is already queued or running for this project. Wait for it to finish before starting another run.");
        await load();
      } else {
        alert(String(e));
      }
    } finally {
      setStarting(false);
    }
  };

  const refreshExecutionTasks = async () => {
    if (!id) return;
    const result = await api.post<{ tasks: ExecutionTask[] }>(`/api/websites/${id}/execution-tasks/sync`, {});
    setExecutionTasks(result.tasks);
  };

  const updateTaskStatus = async (taskId: string, status: "completed" | "skipped" | "ready") => {
    const endpoint = status === "completed" ? "complete" : status === "skipped" ? "skip" : null;
    const result = endpoint
      ? await api.post<{ task: ExecutionTask }>(`/api/execution-tasks/${taskId}/${endpoint}`, {})
      : await api.patch<{ task: ExecutionTask }>(`/api/execution-tasks/${taskId}`, { status });
    setExecutionTasks((tasks) => tasks.map((task) => task.id === result.task.id ? result.task : task));
  };

  if (loading) return <div className="text-charcoal-400">Loading project health...</div>;
  if (!website) {
    return (
      <Card className="max-w-2xl p-6">
        <div className="text-sm font-semibold uppercase tracking-wide text-red-600">Project unavailable</div>
        <h1 className="mt-2 text-xl font-bold text-charcoal-800">Cannot open this project health report</h1>
        <p className="mt-2 text-sm leading-6 text-charcoal-500">
          {error || "Project not found."}
        </p>
        <div className="mt-4 rounded-lg border border-charcoal-100 bg-charcoal-50 p-3 text-sm text-charcoal-600">
          Requested project ID: <span className="font-mono text-charcoal-800">{id}</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => navigate("/website-projects")}>Back to projects</Button>
          <Button variant="ghost" onClick={load}>Try again</Button>
        </div>
      </Card>
    );
  }

  const overviewTabs: OverviewTabItem[] = [
    {
      id: "crawl",
      title: "Crawl Status",
      headline: latestCompleted ? `Score ${health?.overallScore ?? latestCompleted.siteScore ?? "—"}` : "No completed crawl yet",
      description: latestCompleted ? `Latest crawl checked ${latestCompleted.pagesCrawled}/150 pages. Open details for technical, linking, AI search, and schema health.` : "Run the 150-page check to create the project health report and execution tasks.",
      tone: latest?.status === "failed" ? "red" : latestCompleted ? "green" : "slate",
      stats: [
        { label: "Pages", value: latestCompleted?.pagesCrawled ?? latest?.pagesCrawled ?? 0, detail: "checked" },
        { label: "Issues", value: health?.technical.issueCount ?? latestCompleted?.errorCount ?? 0, detail: "found", tone: (health?.technical.issueCount ?? latestCompleted?.errorCount ?? 0) ? "text-amber-700" : "text-green-700" },
        { label: "Status", value: latest?.status ? taskLabel(latest.status) : "—", detail: "latest", valueClassName: "text-base" },
      ],
      primaryAction: latestCompleted
        ? { label: "Open crawl report", onClick: () => navigate("/crawls/" + latestCompleted.id) }
        : { label: activeCrawl ? "Crawl running" : starting ? "Starting..." : "Run crawl", onClick: () => { void runCrawl(); }, disabled: starting || Boolean(activeCrawl) },
    },
    {
      id: "execution",
      title: "Execution Tasks",
      headline: openTasks.length ? `${openTasks.length} open tasks` : "No open tasks",
      description: "Tasks generated from crawl, keyword research, local SEO, AI content, and social strategy. Use View details to review and complete work.",
      tone: highPriorityTasks.length ? "amber" : "brand",
      stats: [
        { label: "Open", value: openTasks.length, detail: "active" },
        { label: "Priority", value: highPriorityTasks.length, detail: "high", tone: highPriorityTasks.length ? "text-red-600" : "text-charcoal-500" },
        { label: "Review", value: reviewTasks.length, detail: "approval", tone: reviewTasks.length ? "text-blue-600" : "text-charcoal-500" },
      ],
      primaryAction: { label: "Sync tasks", onClick: () => { void refreshExecutionTasks(); } },
    },
    {
      id: "local",
      title: "Local SEO",
      headline: localBusiness?.businessName ?? "No local profile yet",
      description: localBusiness ? `${localBusiness.mainCategory} in ${localBusiness.city}, ${localBusiness.country}` : "Create a local profile to track local visibility, business details, and local recommendations.",
      tone: "green",
      stats: [
        { label: "Keywords", value: localBusiness?._count?.keywords ?? 0, detail: "tracked" },
        { label: "Actions", value: localBusiness?._count?.recommendations ?? 0, detail: "ideas" },
        { label: "Score", value: localBusiness?.scores?.[0]?.totalScore ?? "—", detail: "latest", tone: scoreClass(localBusiness?.scores?.[0]?.totalScore) },
      ],
      primaryAction: { label: localBusiness ? "Open Local SEO" : "Create profile", onClick: () => navigate(`/local-seo?project=${website.id}`) },
    },
    {
      id: "keywords",
      title: "Keywords",
      headline: latestKeywordRun?.seedKeyword ?? "No keyword data yet",
      description: "Track search demand, SERP competitors, rank position, and keyword ideas for this project.",
      tone: "blue",
      stats: [
        { label: "Runs", value: keywordRuns.length, detail: "saved" },
        { label: "Ranked", value: rankedKeywordRuns.length, detail: "position" },
        { label: "Ideas", value: latestKeywordRun?.keywordCount ?? 0, detail: "latest" },
      ],
      primaryAction: { label: keywordRuns.length ? "Open keywords" : "Create keyword", onClick: () => navigate(`/keyword-research?project=${website.id}`) },
    },
    {
      id: "ai",
      title: "AI Content",
      headline: latestAiContent?.topic ?? "No AI content yet",
      description: "Generated drafts, page recommendations, schema support, and review-required content tasks for this project.",
      tone: "blue",
      stats: [
        { label: "Drafts", value: aiContent.length, detail: "saved" },
        { label: "Ready", value: completedAiContent.length, detail: "outputs" },
        { label: "Review", value: aiReviewTasks.length, detail: "tasks", tone: aiReviewTasks.length ? "text-blue-600" : "text-charcoal-500" },
      ],
      primaryAction: { label: aiContent.length ? "Open AI Content" : "Create content", onClick: () => navigate("/ai-content") },
    },
    {
      id: "social",
      title: "Social Strategy",
      headline: socialSummary?.strategies?.[0]?.monthlyTheme ?? "No strategy yet",
      description: "Profiles, competitor examples, content pillars, and the 30-day social calendar for this project.",
      tone: "amber",
      stats: [
        { label: "Profiles", value: socialSummary?.profiles?.length ?? 0, detail: "connected" },
        { label: "Competitors", value: socialSummary?.competitors?.length ?? 0, detail: "examples" },
        { label: "Calendar", value: socialSummary?.strategies?.[0]?.posts?.length ?? 0, detail: "posts" },
      ],
      primaryAction: { label: socialSummary?.strategies?.[0] ? "Open strategy" : "Create strategy", onClick: () => navigate(`/social-strategy?project=${website.id}`) },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link to="/website-projects" className="text-sm font-medium text-brand-600 hover:underline">Back to projects</Link>
          <h1 className="mt-2 text-2xl font-bold text-charcoal-800">{website.domain}</h1>
          <p className="text-sm text-charcoal-400">{website.rootUrl}</p>
          <p className="mt-1 text-xs font-medium text-charcoal-500">System checks up to 150 pages per crawl. If the site has more pages, the crawl stops at 150 and completes the project report.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runCrawl} disabled={starting || Boolean(activeCrawl)}>
            {activeCrawl ? "Crawl running" : starting ? "Starting..." : "Run 150-page check"}
          </Button>
          {latestCompleted && (
            <Button variant="ghost" onClick={() => navigate("/crawls/" + latestCompleted.id)}>
              View crawl status
            </Button>
          )}
        </div>
      </div>

      {activeCrawl && (
        <Card className="overflow-hidden border-blue-200 bg-white">
          <div className="border-b border-blue-100 bg-blue-50 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Crawl in progress</div>
                <h2 className="mt-1 text-lg font-bold text-blue-950">We are scanning this project now</h2>
                <p className="mt-1 text-sm text-blue-800">New crawls are locked until this run finishes. The system checks up to 150 pages, then completes the project report even when more URLs exist.</p>
              </div>
              <StatusPill status={activeCrawl.status} />
            </div>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-[160px_1fr] md:items-center">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-blue-700">Pages checked</div>
              <div className="mt-1 text-3xl font-bold leading-none text-blue-950">{activeCrawl.pagesCrawled}<span className="text-base font-semibold text-blue-700">/150</span></div>
            </div>
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                <div className="h-full w-2/3 rounded-full bg-blue-600" />
              </div>
              <p className="mt-2 text-sm text-charcoal-600">The crawler is collecting pages, checking technical SEO signals, and preparing the health report. This panel refreshes automatically and the crawl completes at the 150-page cap.</p>
            </div>
          </div>
        </Card>
      )}

      <ProjectOverviewTabs
        items={overviewTabs}
        activePanel={activePanel}
        onSelect={setActivePanel}
      />

      <div ref={detailRef} className="scroll-mt-4" />

      {activePanel === "crawl" && <Card className="p-5">
        {latest?.status === "running" || latest?.status === "queued" ? (
          <div className="mb-5 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            A crawl is currently {latest.status}. Open crawl status to follow progress.
          </div>
        ) : latest?.status === "failed" ? (
          <div className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-800">
            Last crawl failed: {latest.error || "Unknown error"}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <HealthStat label="Overall ranking" value={health?.overallScore ?? latestCompleted?.siteScore ?? "—"} detail={`${health?.pageCount ?? latestCompleted?.pagesCrawled ?? latest?.pagesCrawled ?? 0}/150 pages checked`} tone={scoreClass(health?.overallScore ?? latestCompleted?.siteScore)} />
          <HealthStat label="Technical health" value={health?.technical.score ?? "—"} detail={`${health?.technical.issueCount ?? latestCompleted?.errorCount ?? 0} issues`} tone={scoreClass(health?.technical.score)} />
          <HealthStat label="Internal linking" value={health?.internalLinking.score ?? "—"} detail={`${health?.internalLinking.orphanPages ?? 0} orphan pages`} tone={scoreClass(health?.internalLinking.score)} />
          <HealthStat label="AI search" value={health?.aiSearch.score ?? "—"} detail={health?.aiSearch.llmsTxtPresent ? "llms.txt found" : "llms.txt missing"} tone={scoreClass(health?.aiSearch.score)} />
          <HealthStat label="Schema" value={health?.schema.score ?? "—"} detail={`${health?.schema.total ?? 0} schema items`} tone={scoreClass(health?.schema.score)} />
        </div>
      </Card>}

      {activePanel === "execution" && <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <HealthStat label="Open" value={openTasks.length} detail="active tasks" />
            <HealthStat label="High priority" value={highPriorityTasks.length} detail="do first" tone={highPriorityTasks.length ? "text-red-600" : "text-charcoal-500"} />
            <HealthStat label="Needs review" value={reviewTasks.length} detail="approval tasks" tone={reviewTasks.length ? "text-blue-600" : "text-charcoal-500"} />
            <HealthStat label="Completed" value={completedTasks.length} detail="finished" tone="text-green-600" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {["open", "all", "high", "needs_review", "crawl", "keyword_research", "local_seo", "ai_content", "social_strategy"].map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setTaskFilter(filter)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${taskFilter === filter ? "border-brand-200 bg-brand-50 text-brand-700" : "border-charcoal-200 bg-white text-charcoal-500 hover:bg-charcoal-50"}`}
              >
                {taskLabel(filter)}
              </button>
            ))}
          </div>
        </div>
        {visibleTasks.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No execution tasks yet. Run a crawl, keyword report, local audit, AI generation, or social strategy, then sync tasks.</div>
        ) : (
          <div className="divide-y divide-charcoal-100">
            {visibleTasks.slice(0, 12).map((task) => (
              <div key={task.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${taskPriorityClass(task.priority)}`}>{taskLabel(task.priority)}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${taskStatusClass(task.status)}`}>{taskLabel(task.status)}</span>
                    <span className="rounded-full border border-charcoal-100 bg-charcoal-50 px-2.5 py-1 text-xs font-semibold text-charcoal-500">{taskLabel(task.moduleName)}</span>
                    <span className="rounded-full border border-charcoal-100 bg-white px-2.5 py-1 text-xs font-semibold text-charcoal-500">{taskLabel(task.automationLevel)}</span>
                  </div>
                  <h3 className="mt-2 font-semibold text-charcoal-800">{task.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-charcoal-500">{task.description}</p>
                  {task.impact && <p className="mt-1 text-xs font-medium text-charcoal-500">Impact: {task.impact}</p>}
                  {task.manualInstructions && <p className="mt-1 text-xs leading-5 text-charcoal-400">{task.manualInstructions}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {task.relatedUrl && <Button variant="ghost" onClick={() => navigate(task.relatedUrl!)}>{task.actionButtonLabel ?? "Open"}</Button>}
                  {task.status !== "completed" && <Button onClick={() => void updateTaskStatus(task.id, "completed")}>Complete</Button>}
                  {task.status !== "skipped" && task.status !== "completed" && <Button variant="ghost" onClick={() => void updateTaskStatus(task.id, "skipped")}>Skip</Button>}
                </div>
              </div>
            ))}
            {visibleTasks.length > 12 && <div className="px-5 py-3 text-sm text-charcoal-400">Showing 12 of {visibleTasks.length} tasks. Use filters to narrow the execution plan.</div>}
          </div>
        )}
      </Card>}

      {(activePanel === "local" || activePanel === "keywords" || activePanel === "ai" || activePanel === "social") && <div className="grid gap-6 xl:grid-cols-1">
        {activePanel === "local" && (
        <Card className="p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthStat label="Keywords" value={localBusiness?._count?.keywords ?? 0} detail="tracked targets" />
              <HealthStat label="Actions" value={localBusiness?._count?.recommendations ?? 0} detail="open ideas" />
              <HealthStat label="Status" value={localBusiness?.scores?.[0]?.statusLabel ?? "—"} detail="latest local score" tone={scoreClass(localBusiness?.scores?.[0]?.totalScore)} />
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={() => navigate(`/local-seo?project=${website.id}`)}>{localBusiness ? "Open Local SEO" : "Create Local SEO profile"}</Button>
            </div>
          </div>
        </Card>
        )}

        {activePanel === "keywords" && (
        <Card className="p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthStat label="Runs" value={keywordRuns.length} detail="saved checks" />
              <HealthStat label="Ranked" value={rankedKeywordRuns.length} detail="with position" />
              <HealthStat label="Ideas" value={latestKeywordRun?.keywordCount ?? 0} detail="latest run" />
            </div>
            {keywordRuns.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-charcoal-500">
                {keywordRuns.slice(0, 4).map((run) => <span key={run.id} className="rounded-full bg-charcoal-50 px-2.5 py-1">{run.seedKeyword} · {run.locationName}</span>)}
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={() => navigate(`/keyword-research?project=${website.id}`)}>{keywordRuns.length ? "Open keywords" : "Create keyword"}</Button>
            </div>
          </div>
        </Card>
        )}

        {activePanel === "ai" && (
        <Card className="p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthStat label="Drafts" value={aiContent.length} detail="saved outputs" />
              <HealthStat label="Completed" value={completedAiContent.length} detail="ready to review" tone="text-green-600" />
              <HealthStat label="Review tasks" value={aiReviewTasks.length} detail="approval needed" tone={aiReviewTasks.length ? "text-blue-600" : "text-charcoal-500"} />
            </div>
            {aiContent.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-charcoal-500">
                {aiContent.slice(0, 5).map((item) => <span key={item.id} className="rounded-full bg-charcoal-50 px-2.5 py-1">{taskLabel(item.type)} · {item.topic}</span>)}
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={() => navigate("/ai-content")}>{aiContent.length ? "Open AI Content" : "Create AI content"}</Button>
              <Button variant="ghost" onClick={() => openPanel("execution")}>Review AI tasks</Button>
            </div>
          </div>
        </Card>
        )}

        {activePanel === "social" && (
        <Card className="p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthStat label="Profiles" value={socialSummary?.profiles?.length ?? 0} detail="connected" />
              <HealthStat label="Competitors" value={socialSummary?.competitors?.length ?? 0} detail="examples" />
              <HealthStat label="Calendar" value={socialSummary?.strategies?.[0]?.posts?.length ?? 0} detail="planned posts" />
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={() => navigate(`/social-strategy?project=${website.id}`)}>{socialSummary?.strategies?.[0] ? "Open Social Strategy" : "Create Social Strategy"}</Button>
            </div>
          </div>
        </Card>
        )}
      </div>}

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Crawl history
        </div>
        {!website.crawlJobs || website.crawlJobs.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No crawls yet. Run a crawl to build the project health report.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Score</th>
                  <th className="px-5 py-2">Pages checked</th>
                  <th className="px-5 py-2">Completed</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {website.crawlJobs.map((crawl) => (
                  <tr key={crawl.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3"><StatusPill status={crawl.status} /></td>
                    <td className={`px-5 py-3 font-semibold ${scoreClass(crawl.siteScore)}`}>{crawl.siteScore ?? "—"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{crawl.pagesCrawled}/150</td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(crawl.completedAt ?? crawl.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <ActionIconLink icon="view" label="Open crawl" to={`/crawls/${crawl.id}`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
