import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.js";
import { Card } from "../components/ui.js";
import { useAuth } from "../auth.js";
import type { DomainBacklinkSummary, GuidedExecutionTask, GuidedProject, KeywordResearchRun, ProjectWorkflowStep, Website, WorkspaceIntelligenceResponse } from "../types.js";

interface Overview {
  role: string;
  counts: { clients: number; websites: number; crawls: number; avgScore: number | null };
  recentCrawls: { id: string; domain: string; status: string; siteScore: number | null; pagesCrawled: number; createdAt: string }[];
  issuesBySeverity: { severity: string; count: number }[];
  issuesByCategory: { category: string; count: number }[];
  scoreTrend: { label: string; score: number }[];
}

type DashboardAction = {
  title: string;
  detail: string;
  priority: string;
  tone: string;
  to: string;
};

type QueueRow = {
  task: string;
  project: string;
  status: string;
  to: string;
};

type WorkflowState = {
  intakeComplete: boolean;
  opportunityComplete: boolean;
  strategyGenerated: boolean;
  strategyApproved: boolean;
  projectSteps: ProjectWorkflowStep[];
  validOpenTasks: GuidedExecutionTask[];
  milestones: { title: string; detail: string; done: boolean; active: boolean; badge?: string }[];
  progress: number;
};

const trendData = [
  { label: "May 1", sessions: 4200 },
  { label: "May 4", sessions: 3800 },
  { label: "May 7", sessions: 6400 },
  { label: "May 10", sessions: 7600 },
  { label: "May 13", sessions: 7100 },
  { label: "May 16", sessions: 9300 },
  { label: "May 19", sessions: 8800 },
  { label: "May 22", sessions: 10500 },
  { label: "May 25", sessions: 11200 },
  { label: "May 29", sessions: 12746 },
];

const aiHealth = [
  { name: "Healthy", value: 82, color: "#10b981" },
  { name: "Needs work", value: 18, color: "#e5e7eb" },
];

export default function Overview() {
  const { user } = useAuth();
  const canManageProjects = user?.role === "super_admin" || Boolean(user?.workspace?.capabilities.manageProjects);
  const [data, setData] = useState<Overview | null>(null);
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [keywordRuns, setKeywordRuns] = useState<KeywordResearchRun[]>([]);
  const [tasks, setTasks] = useState<GuidedExecutionTask[]>([]);
  const [backlinks, setBacklinks] = useState<DomainBacklinkSummary | null>(null);
  const [agencyHasActiveClient, setAgencyHasActiveClient] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [overviewResult, workspace, agencyWorkspace] = await Promise.all([
          api.get<Overview>("/api/overview"),
          api.get<WorkspaceIntelligenceResponse>("/api/workspace/intelligence"),
          user?.workspace?.type === "agency"
            ? api.get<{ clients: { status: string }[] }>("/api/agency/workspace")
            : Promise.resolve(null),
        ]);
        const websiteId = workspace.intelligence.activeWebsiteId ?? workspace.projects[0]?.websiteId ?? workspace.websites[0]?.id;
        const backlinkResult = websiteId
          ? await api.get<{ summary: DomainBacklinkSummary }>(`/api/keyword-research/domain-backlinks?websiteId=${encodeURIComponent(websiteId)}&cacheOnly=true`).catch(() => ({ summary: null }))
          : { summary: null };
        if (!cancelled) {
          setData(overviewResult);
          setProjects(workspace.projects);
          setWebsites(workspace.websites);
          setKeywordRuns(workspace.keywordRuns);
          setTasks(workspace.tasks);
          setAgencyHasActiveClient(agencyWorkspace ? agencyWorkspace.clients.some((client) => client.status === "active") : true);
          setBacklinks(backlinkResult.summary);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [user?.workspace?.type]);

  const primaryProject = useMemo(() => {
    const crawl = data?.recentCrawls?.[0];
    const project = projects[0];
    const website = websites[0];
    return {
      domain: crawl?.domain ?? website?.domain ?? project?.websiteUrl ?? "No website yet",
      name: project?.businessName || project?.name || (crawl?.domain ? prettifyDomain(crawl.domain) : website?.domain ? prettifyDomain(website.domain) : "Create a project"),
      score: crawl?.siteScore ?? data?.counts.avgScore ?? 68,
    };
  }, [data, projects, websites]);

  if (err) return <div className="rounded-lg bg-red-50 p-4 text-red-700">{err}</div>;
  if (!data) return <div className="text-charcoal-400">Loading dashboard...</div>;

  const activeProjects = Math.max(projects.length, data.counts.websites, data.recentCrawls.length, 0);
  const publishedAssets = data.recentCrawls.reduce((sum, c) => sum + c.pagesCrawled, 0);
  const technicalIssues = data.issuesBySeverity.reduce((sum, issue) => sum + issue.count, 0);
  const rankingKeywords = keywordRuns.reduce((sum, run) => sum + (run.keywordCount || 0), 0);
  const workflow = deriveWorkflowState(projects[0], tasks, data.counts.avgScore);
  const openTasks = workflow.validOpenTasks;
  const readyTasks = openTasks.filter((task) => ["ready", "queued", "not_started", "pending"].includes(task.status)).length;
  const backlinkOpportunities = openTasks.filter((task) => task.moduleName.includes("backlink")).length || backlinks?.referringDomainsNew || 0;
  const projectProgress = workflow.progress;
  const milestones = workflow.milestones;
  const hasWorkspaceData = projects.length > 0 || websites.length > 0 || keywordRuns.length > 0 || tasks.length > 0 || data.recentCrawls.length > 0;
  const recommendedActions = dashboardActions(workflow, projects, websites).slice(0, 4);
  const fallbackAction = recommendedActions.length ? null : fallbackDashboardAction(workflow, projects[0]);
  const visibleRecommendedActions = recommendedActions.length ? recommendedActions : fallbackAction ? [fallbackAction] : [];
  const recentActivity = dashboardActivity(projects, websites, keywordRuns, tasks);
  const queueRows = dashboardQueue(openTasks, primaryProject.name, websites[0]?.id);
  const socialRows = dashboardSocial(tasks);
  const agencyNeedsClient = user?.workspace?.type === "agency" && !agencyHasActiveClient;

  if (!projects.length) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Dashboard</h1>
          <p className="text-sm text-charcoal-500">{agencyNeedsClient ? "Create a client before starting an Agency project." : "Create a project to start the SEnuke AI - AI Growth Operating System workflow."}</p>
        </div>
        <Card className="border-brand-100 bg-brand-50/40 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-base font-bold text-charcoal-950">{agencyNeedsClient ? "No Agency client available" : "No project available"}</div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-charcoal-500">
                {agencyNeedsClient ? "Add your first client with their business details and target markets. You can then create a project assigned to that client." : "Create your first project to unlock intake, opportunity finding, strategy, site analysis, keywords, backlinks, AI citations, publishing, and growth actions."}
              </p>
            </div>
            {canManageProjects && <Link to={agencyNeedsClient ? "/workspace?tab=clients" : "/projects/new"} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
              {agencyNeedsClient ? "Create Client" : "Create Project"}
            </Link>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Dashboard</h1>
        <p className="text-sm text-charcoal-500">Your AI growth execution overview</p>
      </div>

      {!hasWorkspaceData && (
        <Card className="border-brand-100 bg-brand-50/40 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-bold text-charcoal-950">Create your first project</div>
              <p className="mt-1 text-sm text-charcoal-500">Add a website or business goal to unlock the dashboard workflow.</p>
            </div>
            {canManageProjects && <Link to="/projects/new" className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
              New Project
            </Link>}
          </div>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard to="/projects" icon="briefcase" label="Active Projects" value={activeProjects} change={`${projects.length} guided`} />
        <MetricCard to="/opportunities" icon="tasks" label="Ready Tasks" value={readyTasks} change={`${openTasks.length} open`} />
        <MetricCard to="/ai-content" icon="file" label="Published Assets" value={publishedAssets} change={`${data.counts.crawls} crawls`} />
        <MetricCard to="/keywords" icon="trend" label="Ranking Keywords" value={rankingKeywords} change={`${keywordRuns.length} runs`} />
        <MetricCard to="/backlinks" icon="link" label="Backlink Opportunities" value={backlinkOpportunities} change={`${backlinks?.backlinksNew ?? 0} new links`} />
        <MetricCard to="/social-strategy" icon="calendar" label="Social Posts Scheduled" value={openTasks.filter((task) => task.moduleName.includes("social")).length} change="social tasks" />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <DashboardCard title="Recommended Next Actions" action="...">
          {visibleRecommendedActions.length ? (
            <>
              <div className="divide-y divide-charcoal-100">
                {visibleRecommendedActions.map((action, index) => (
                  <Link key={`${action.to}-${action.title}-${index}`} to={action.to} className="flex items-center gap-2.5 py-2 hover:bg-slate-50">
                    <IconBox tone={action.tone} icon={action.title[0]} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-charcoal-950">{action.title}</div>
                      <div className="truncate text-xs text-charcoal-500">{action.detail}</div>
                    </div>
                    <PriorityPill priority={action.priority} />
                    <span className="text-lg text-charcoal-300">›</span>
                  </Link>
                ))}
              </div>
              <Link to="/opportunities" className="mt-2 inline-flex text-sm font-bold text-brand-600 hover:text-brand-700">View all actions</Link>
            </>
          ) : (
            <EmptyPanel
              title={projects.length ? "No workflow action is waiting" : "No project available"}
              detail={projects.length ? "The current project has no valid next workflow action right now. New recommendations will appear when analysis, strategy, or execution data changes." : "Create your first project to generate intake, strategy, site, keyword, backlink, and publishing actions."}
              to={projects.length ? "/projects" : "/projects/new"}
              action={projects.length ? "View Projects" : "Create Project"}
            />
          )}
        </DashboardCard>

        <DashboardCard title="Project Progress" action={<Link to="/projects" className="text-sm font-bold text-brand-600">View Project</Link>}>
          <div className="flex items-center gap-3 border-b border-charcoal-100 pb-3">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-sky-200 to-slate-700" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-charcoal-950">{primaryProject.name}</div>
              <div className="truncate text-sm text-charcoal-500">{primaryProject.domain}</div>
            </div>
            <ProgressRing value={projectProgress} />
          </div>
          <div className="mt-3 space-y-2">
            {milestones.length ? milestones.map((item) => (
              <TimelineItem key={item.title} done={item.done} active={item.active} title={item.title} detail={item.detail} badge={item.badge} />
            )) : <EmptyPanel title="No project progress yet" detail="Progress appears after you create a project and start the guided workflow." to="/projects/new" action="New Project" compact />}
          </div>
        </DashboardCard>

        <div className="min-w-0">
          <DashboardCard title="Traffic Trend" action={<span className="text-xs text-charcoal-500">This Month ⌄</span>}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-2xl font-bold text-charcoal-950">{rankingKeywords.toLocaleString()}</div>
                <div className="text-xs text-charcoal-500">Keyword ideas</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-bold text-emerald-600">↑ {keywordRuns.length}</div>
                <div className="text-xs text-charcoal-500">stored runs</div>
              </div>
            </div>
            <div className="mt-2 h-40 xl:h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} interval={3} axisLine={false} tickLine={false} />
                  <YAxis hide domain={[0, 15000]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="sessions" stroke="#2563eb" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </DashboardCard>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-start-3">
          <DashboardCard title="Keyword Movement" action={<Link to="/keywords" className="text-sm font-bold text-brand-600">View report</Link>}>
            <div className="grid grid-cols-3 divide-x divide-charcoal-100 text-center">
              <MiniMovement label="High Score" value={keywordRuns.filter((run) => (run.opportunityScore ?? 0) >= 70).length} change="stored" tone="green" />
              <MiniMovement label="Keyword Runs" value={keywordRuns.length} change="total" tone="amber" />
              <MiniMovement label="Needs Data" value={keywordRuns.filter((run) => !run.keywordCount).length} change="check" tone="red" />
            </div>
          </DashboardCard>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr_380px]">
        <DashboardCard title="Recent Activity" action={<Link to="/keyword-insights" className="text-sm font-bold text-brand-600">View all</Link>}>
          <div className="space-y-3">
            {recentActivity.length ? recentActivity.map(([title, time, tone], index) => (
              <div key={`${title}-${time}-${index}`} className="flex items-center gap-3">
                <span className={`h-5 w-5 rounded-full ${dotBg(tone)} text-center text-xs font-bold leading-5 text-white`}>✓</span>
                <span className="min-w-0 flex-1 truncate text-sm text-charcoal-700">{title}</span>
                <span className="text-xs text-charcoal-500">{time}</span>
              </div>
            )) : <EmptyPanel title="No recent activity" detail="Activity appears after project setup, crawls, keyword runs, and generated assets." compact />}
          </div>
        </DashboardCard>

        <DashboardCard title="Execution Queue" action={<Link to="/opportunities" className="text-sm font-bold text-brand-600">View all</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs text-charcoal-500">
                <tr>
                  <th className="pb-3 font-bold">Task</th>
                  <th className="pb-3 font-bold">Project</th>
                  <th className="pb-3 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-100">
                {queueRows.map((row, index) => (
                  <tr key={`${row.to}-${row.task}-${index}`} className="hover:bg-slate-50">
                    <td className="py-2.5 text-charcoal-800"><Link to={row.to} className="font-semibold hover:text-brand-700">{row.task}</Link></td>
                    <td className="py-2.5 text-charcoal-700">{row.project}</td>
                    <td className="py-2.5"><StatusPill status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!queueRows.length && <EmptyPanel title="No queued tasks" detail="Execution tasks will appear after a project workflow creates them." compact />}
          </div>
        </DashboardCard>

        <DashboardCard title="Upcoming Social Posts" action={<Link to="/social-strategy" className="text-sm font-bold text-brand-600">View calendar</Link>}>
          <div className="space-y-3">
            {socialRows.length ? socialRows.map((post, index) => <SocialPost key={`${post.network}-${post.title}-${index}`} {...post} />) : <EmptyPanel title="No social posts scheduled" detail="Social posts appear after a social strategy is generated." compact />}
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}

function DashboardCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="min-w-0 p-3 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="font-bold text-charcoal-950">{title}</h2>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </Card>
  );
}

function EmptyPanel({ title, detail, to, action, compact = false }: { title: string; detail: string; to?: string; action?: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-dashed border-charcoal-200 bg-charcoal-50/60 text-sm ${compact ? "p-3" : "p-4"}`}>
      <div className="font-bold text-charcoal-900">{title}</div>
      <p className="mt-1 leading-6 text-charcoal-500">{detail}</p>
      {to && action ? <Link to={to} className="mt-3 inline-flex rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">{action}</Link> : null}
    </div>
  );
}

function MetricCard({ to, label, value, change }: { to: string; icon: string; label: string; value: number; change: string }) {
  return (
    <Link to={to} className="block min-w-0 h-full">
      <Card className="flex min-h-[104px] min-w-0 flex-col justify-between p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md">
        <div className="text-xs font-semibold leading-5 text-charcoal-500">{label}</div>
        <div>
          <div className="text-2xl font-bold leading-none text-charcoal-950">{value.toLocaleString()}</div>
          <div className="mt-2 text-xs font-semibold leading-4 text-emerald-600">↑ {change}</div>
        </div>
      </Card>
    </Link>
  );
}

function IconBox({ tone, icon }: { tone: string; icon: string }) {
  const classes: Record<string, string> = {
    blue: "bg-blue-100 text-brand-600",
    violet: "bg-violet-100 text-violet-600",
    green: "bg-emerald-100 text-emerald-600",
    amber: "bg-amber-100 text-amber-600",
    cyan: "bg-cyan-100 text-cyan-600",
    purple: "bg-purple-100 text-purple-600",
  };
  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${classes[tone] ?? classes.blue}`}>
      {icon.slice(0, 1).toUpperCase()}
    </span>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const cls = priority === "High"
    ? "bg-red-50 text-red-600"
    : priority === "Medium"
      ? "bg-amber-50 text-amber-600"
      : "bg-emerald-50 text-emerald-600";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{priority}</span>;
}

function ProgressRing({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(#2563eb ${safeValue * 3.6}deg, #e8eef8 0deg)` }}
    >
      <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-sm font-bold text-charcoal-950">{safeValue}%</div>
    </div>
  );
}

function TimelineItem({ title, detail, done = false, active = false, badge }: { title: string; detail: string; done?: boolean; active?: boolean; badge?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 grid h-5 w-5 place-items-center rounded-full border-2 text-[11px] font-black leading-none ${done ? "border-emerald-800 bg-emerald-700 text-white shadow-sm" : active ? "border-brand-600 bg-white text-brand-600" : "border-charcoal-200 bg-white text-charcoal-300"}`}>
        {done ? "✓" : ""}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-bold ${done ? "text-emerald-800" : "text-charcoal-900"}`}>{title}</div>
        <div className={`text-[11px] ${done ? "font-semibold text-emerald-700" : "text-charcoal-500"}`}>{detail}</div>
      </div>
      {badge ? <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-brand-600">{badge}</span> : null}
    </div>
  );
}

function MiniMovement({ label, value, change, tone }: { label: string; value: number; change: string; tone: "green" | "amber" | "red" }) {
  const cls = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-500" : "text-amber-500";
  return (
    <div className="px-2">
      <div className={`text-lg font-bold ${cls}`}>{value}</div>
      <div className="text-xs text-charcoal-500">{label}</div>
      <div className={`mt-1 text-xs font-bold ${cls}`}>{change}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "Completed"
    ? "bg-emerald-100 text-emerald-700"
    : status === "In Progress"
      ? "bg-blue-100 text-brand-700"
      : status === "Needs Review"
        ? "bg-amber-100 text-amber-700"
        : "bg-emerald-50 text-emerald-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{status}</span>;
}

function SocialPost({ icon, title, date, network, tone }: { icon: string; title: string; date: string; network: string; tone: string }) {
  const cls: Record<string, string> = {
    pink: "bg-pink-100 text-pink-600",
    blue: "bg-blue-100 text-blue-600",
    sky: "bg-sky-100 text-sky-600",
  };
  return (
    <div className="flex items-center gap-3 border-b border-charcoal-100 pb-3 last:border-b-0 last:pb-0">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${cls[tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-charcoal-900">{title}</div>
        <div className="text-xs text-charcoal-500">{date}</div>
      </div>
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600">{network}</span>
    </div>
  );
}

function dotBg(tone: string) {
  if (tone === "blue") return "bg-brand-600";
  if (tone === "purple") return "bg-violet-600";
  if (tone === "amber") return "bg-amber-500";
  return "bg-emerald-500";
}

function dashboardActions(workflow: WorkflowState, projects: GuidedProject[], websites: Website[]): DashboardAction[] {
  const project = projects[0];
  const website = websites[0];
  const readyProjectStep = workflow.projectSteps.find((step) => step.status === "ready" || step.status === "in_progress" || step.status === "blocked");
  if (readyProjectStep) {
    return [{
      title: readyProjectStep.title,
      detail: readyProjectStep.readyReason || readyProjectStep.blockedReason || readyProjectStep.description,
      priority: priorityLabel(readyProjectStep.priority),
      tone: toneForProjectStep(readyProjectStep.stepKey),
      to: readyProjectStep.actionUrl || (project ? `/guided-projects/${project.id}` : "/projects"),
    }];
  }
  const actions: DashboardAction[] = [];
  const intakeTask = workflow.validOpenTasks.find((task) => task.moduleName === "core_intake" || taskText(task).includes("complete intake"));
  const opportunityTask = workflow.validOpenTasks.find((task) => task.moduleName === "opportunity");
  const strategyTask = workflow.validOpenTasks.find((task) => task.moduleName === "strategy");
  const strategyApprovalTask = workflow.validOpenTasks.find((task) => task.moduleName === "strategy_approval");

  if (!workflow.intakeComplete) {
    actions.push({
      title: "Complete project intake",
      detail: "Answer the core business, audience, offer, SEO, publishing, and automation questions.",
      priority: priorityLabel(intakeTask?.priority ?? "high"),
      tone: "blue",
      to: project ? `/guided-projects/${project.id}/intake` : "/projects/new",
    });
    return actions;
  }

  if (!workflow.opportunityComplete) {
    actions.push({
      title: "Generate opportunities",
      detail: "Create scored growth opportunities using the completed intake and business profile.",
      priority: priorityLabel(opportunityTask?.priority ?? "medium"),
      tone: "green",
      to: project ? `/opportunities?projectId=${project.id}` : "/opportunities",
    });
    return actions;
  }

  if (!workflow.strategyGenerated) {
    actions.push({
      title: "Generate execution strategy",
      detail: "Create the SEO, AI citation, content, authority, social, and publishing strategy from the selected opportunity.",
      priority: priorityLabel(strategyTask?.priority ?? "medium"),
      tone: "violet",
      to: "/strategy",
    });
    return actions;
  }

  if (!workflow.strategyApproved) {
    actions.push({
      title: "Review and approve strategy",
      detail: "Approve the generated strategy before downstream keyword, site, content, domain, publishing, and social tasks are created.",
      priority: priorityLabel(strategyApprovalTask?.priority ?? "high"),
      tone: "violet",
      to: "/strategy",
    });
    return actions;
  }

  const grouped = new Map<string, DashboardAction & { count: number }>();

  for (const task of workflow.validOpenTasks) {
    const group = actionGroupForTask(task, project, website);
    const existing = grouped.get(group.key);
    if (existing) {
      existing.count += 1;
      existing.priority = priorityRank(group.priority) < priorityRank(existing.priority) ? group.priority : existing.priority;
      if (group.key === "sitemap_unreachable") {
        existing.detail = `${existing.count} sitemap URLs are not reachable. Remove broken URLs from the sitemap or restore/redirect them to live canonical pages.`;
      }
      continue;
    }
    grouped.set(group.key, { ...group.action, count: 1 });
  }

  const actionsList = Array.from(grouped.values())
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 6)
    .map(({ count: _count, ...action }) => action);

  return actionsList;
}

function fallbackDashboardAction(workflow: WorkflowState, project: GuidedProject | undefined): DashboardAction | null {
  if (!project) return null;
  if (!workflow.intakeComplete) {
    return {
      title: "Complete project intake",
      detail: "Answer the required project questions before recommendations can be generated.",
      priority: "High",
      tone: "blue",
      to: `/guided-projects/${project.id}/intake`,
    };
  }
  if (!workflow.opportunityComplete) {
    return {
      title: "Generate opportunities",
      detail: "Create scored opportunities from the completed project intake.",
      priority: "Medium",
      tone: "green",
      to: `/guided-projects/${project.id}`,
    };
  }
  if (!workflow.strategyGenerated) {
    return {
      title: "Generate execution strategy",
      detail: "Build the strategy from the project brief and generated opportunities.",
      priority: "Medium",
      tone: "violet",
      to: "/strategy",
    };
  }
  if (!workflow.strategyApproved) {
    return {
      title: "Review and approve strategy",
      detail: "Approve the generated strategy before downstream execution starts.",
      priority: "High",
      tone: "violet",
      to: "/strategy",
    };
  }
  return null;
}

function deriveWorkflowState(project: GuidedProject | undefined, tasks: GuidedExecutionTask[], fallbackScore: number | null): WorkflowState {
  const openTasks = tasks.filter(isOpenTask);
  const projectSteps = [...(project?.workflowSteps ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  if (projectSteps.length) {
    const stepByKey = new Map(projectSteps.map((step) => [step.stepKey, step]));
    const isComplete = (key: string) => stepByKey.get(key)?.status === "completed";
    const isActive = (step: ProjectWorkflowStep) => ["ready", "in_progress", "blocked"].includes(step.status);
    const intakeComplete = isComplete("intake");
    const opportunityComplete = isComplete("opportunities");
    const strategyGenerated = isComplete("strategy");
    const strategyApproved = isComplete("strategy_approval");
    const validOpenTasks = openTasks.filter((task) => {
      if (!strategyApproved) return false;
      return !["core_intake", "opportunity", "strategy", "strategy_approval"].includes(task.moduleName);
    });
    const milestones = projectSteps.map((step) => ({
      title: step.title,
      detail: statusLabel(step.status),
      done: step.status === "completed",
      active: isActive(step),
      badge: isActive(step) ? statusLabel(step.status) : undefined,
    }));
    const completedMilestones = milestones.filter((milestone) => milestone.done).length;
    return {
      intakeComplete,
      opportunityComplete,
      strategyGenerated,
      strategyApproved,
      projectSteps,
      validOpenTasks,
      milestones,
      progress: milestones.length ? Math.round((completedMilestones / milestones.length) * 100) : (fallbackScore ?? 0),
    };
  }

  const intakeComplete = isProjectIntakeComplete(project) || tasks.some((task) => isTaskDone(task) && (task.moduleName === "core_intake" || taskText(task).includes("complete intake")));
  const opportunityCount = project?._count?.opportunities ?? project?.opportunities?.length ?? 0;
  const strategyCount = project?._count?.strategyPlans ?? project?.strategyPlans?.length ?? 0;
  const latestStrategy = Array.isArray(project?.strategyPlans) ? (project?.strategyPlans[0] as { status?: string } | undefined) : undefined;
  const opportunityComplete = opportunityCount > 0;
  const strategyGenerated = strategyCount > 0 || Boolean(latestStrategy);
  const strategyApproved = latestStrategy?.status === "approved" || project?.currentStep === "execution" || tasks.some((task) => isTaskDone(task) && task.moduleName === "strategy_approval");

  const validOpenTasks = openTasks.filter((task) => {
    const text = taskText(task);
    if (intakeComplete && (task.moduleName === "core_intake" || (text.includes("complete") && text.includes("intake")))) return false;
    if (task.moduleName === "opportunity") return intakeComplete && !opportunityComplete;
    if (task.moduleName === "strategy") return intakeComplete && opportunityComplete && !strategyGenerated;
    if (task.moduleName === "strategy_approval") return strategyGenerated && !strategyApproved;
    if (!strategyApproved && !["core_intake", "opportunity", "strategy", "strategy_approval"].includes(task.moduleName)) return false;
    return true;
  });

  const milestones = [
    {
      title: "Intake Completed",
      detail: intakeComplete ? "Completed" : "Pending",
      done: intakeComplete,
      active: !intakeComplete,
      badge: !intakeComplete ? "Current" : undefined,
    },
    {
      title: "Opportunities Generated",
      detail: opportunityComplete ? "Completed" : intakeComplete ? "Ready" : "Pending",
      done: opportunityComplete,
      active: intakeComplete && !opportunityComplete,
      badge: intakeComplete && !opportunityComplete ? "Ready" : undefined,
    },
    {
      title: "Strategy Generated",
      detail: strategyGenerated ? "Completed" : opportunityComplete ? "Ready" : "Pending",
      done: strategyGenerated,
      active: opportunityComplete && !strategyGenerated,
      badge: opportunityComplete && !strategyGenerated ? "Ready" : undefined,
    },
    {
      title: "Strategy Approved",
      detail: strategyApproved ? "Completed" : strategyGenerated ? "Needs review" : "Pending",
      done: strategyApproved,
      active: strategyGenerated && !strategyApproved,
      badge: strategyGenerated && !strategyApproved ? "Review" : undefined,
    },
  ];

  const completedMilestones = milestones.filter((milestone) => milestone.done).length;
  const progress = milestones.length ? Math.round((completedMilestones / milestones.length) * 100) : (fallbackScore ?? 0);

  return {
    intakeComplete,
    opportunityComplete,
    strategyGenerated,
    strategyApproved,
    projectSteps,
    validOpenTasks,
    milestones,
    progress,
  };
}

function taskText(task: GuidedExecutionTask) {
  return `${task.moduleName} ${task.title} ${task.description}`.toLowerCase();
}

function isTaskDone(task: GuidedExecutionTask) {
  return ["completed", "skipped"].includes(task.status);
}

function isOpenTask(task: GuidedExecutionTask) {
  return !["completed", "skipped", "cancelled", "canceled"].includes(task.status);
}

function isProjectIntakeComplete(project: GuidedProject | undefined) {
  if (!project) return false;
  if ((project._count?.intakeAnswers ?? 0) > 0) return true;
  if (project.businessProfile) return true;
  return project.currentStep !== "intake";
}

function actionGroupForTask(task: GuidedExecutionTask, project: GuidedProject | undefined, website: Website | undefined): { key: string; priority: string; action: DashboardAction } {
  const text = `${task.moduleName} ${task.title} ${task.description}`.toLowerCase();
  const projectId = project?.id;
  const websiteId = website?.id;

  if (text.includes("sitemap") && (text.includes("not reachable") || text.includes("broken") || text.includes("no response"))) {
    return {
      key: "sitemap_unreachable",
      priority: priorityLabel(task.priority),
      action: {
        title: "Fix unreachable sitemap URLs",
        detail: "Remove broken URLs from the sitemap or restore/redirect them to live canonical pages.",
        priority: priorityLabel(task.priority),
        tone: "amber",
        to: websiteId ? `/website-projects/${websiteId}` : "/site-analysis",
      },
    };
  }

  if (text.includes("complete") && text.includes("intake")) {
    return {
      key: "complete_intake",
      priority: priorityLabel(task.priority),
      action: {
        title: "Complete project intake",
        detail: "Answer the core business, audience, offer, SEO, publishing, and automation questions.",
        priority: priorityLabel(task.priority),
        tone: "blue",
        to: projectId ? `/guided-projects/${projectId}/intake` : "/projects/new",
      },
    };
  }

  if (text.includes("generate") && text.includes("strateg")) {
    return {
      key: "generate_strategy",
      priority: priorityLabel(task.priority),
      action: {
        title: "Generate execution strategy",
        detail: "Create the SEO, AI citation, content, authority, social, and publishing strategy.",
        priority: priorityLabel(task.priority),
        tone: "violet",
        to: projectId ? `/guided-projects/${projectId}?view=strategy#strategy-review` : "/strategy",
      },
    };
  }

  if (text.includes("opportunit")) {
    return {
      key: "generate_opportunities",
      priority: priorityLabel(task.priority),
      action: {
        title: "Generate opportunities",
        detail: "Create scored growth opportunities using the completed intake and business profile.",
        priority: priorityLabel(task.priority),
        tone: "green",
        to: projectId ? `/opportunities?projectId=${projectId}` : "/opportunities",
      },
    };
  }

  if (text.includes("review") && text.includes("strateg")) {
    return {
      key: "review_strategy",
      priority: priorityLabel(task.priority),
      action: {
        title: "Review and approve strategy",
        detail: "Review the generated strategy before downstream keyword, site, content, domain, publishing, and social tasks are created.",
        priority: priorityLabel(task.priority),
        tone: "violet",
        to: projectId ? `/guided-projects/${projectId}?view=strategy#strategy-review` : "/strategy",
      },
    };
  }

  const moduleRoute = routeForModule(task.moduleName, websiteId);
  const contentRoute = ["content", "ai_content"].includes(task.moduleName)
    ? contentExecutionTaskRoute(task, projectId || task.projectId || "")
    : null;
  return {
    key: `${task.moduleName}:${normalizedActionTitle(task.title)}`,
    priority: priorityLabel(task.priority),
    action: {
      title: normalizedActionTitle(task.title),
      detail: task.description || task.moduleName.replace(/_/g, " "),
      priority: priorityLabel(task.priority),
      tone: toneForModule(task.moduleName),
      to: contentRoute || task.relatedUrl || moduleRoute,
    },
  };
}

function routeForModule(moduleName: string, websiteId?: string) {
  const value = moduleName.toLowerCase();
  if (value.includes("backlink")) return "/backlinks";
  if (value.includes("citation") || value.includes("schema")) return "/ai-citations";
  if (value.includes("keyword")) return "/keywords";
  if (value.includes("social")) return "/social-strategy";
  if (value.includes("content") || value.includes("publish")) return "/ai-content";
  if (value.includes("strategy")) return "/strategy";
  if (value.includes("site") || value.includes("crawl") || value.includes("sitemap")) return websiteId ? `/website-projects/${websiteId}` : "/site-analysis";
  return "/opportunities";
}

function contentExecutionTaskRoute(task: GuidedExecutionTask, projectId: string) {
  // Website Development is the canonical editor for content already mapped to
  // a build page. Preserve that deep link instead of forcing every content task
  // back through AI Content and creating a second asset for the same URL.
  if (task.relatedUrl && !task.relatedUrl.startsWith("/ai-content")) return task.relatedUrl;
  const query = new URLSearchParams(task.relatedUrl?.startsWith("/ai-content?") ? task.relatedUrl.split("?", 2)[1] : "");
  query.set("projectId", projectId);
  query.set("taskId", task.id);
  query.set("open", "1");
  return `/ai-content?${query.toString()}`;
}

function normalizedActionTitle(title: string) {
  if (title.toLowerCase().startsWith("sitemap url is not reachable")) return "Fix unreachable sitemap URLs";
  return title;
}

function priorityRank(priority: string) {
  const value = priority.toLowerCase();
  if (value === "high") return 0;
  if (value === "medium") return 1;
  if (value === "low") return 2;
  return 3;
}

function dashboardActivity(projects: GuidedProject[], websites: Website[], keywordRuns: KeywordResearchRun[], tasks: GuidedExecutionTask[]): [string, string, string][] {
  const completedTasks = tasks.filter((task) => ["completed", "skipped"].includes(task.status));
  const rows: [string, string, string][] = [
    ...projects.slice(0, 2).map((project) => [`Project created: ${project.name}`, relativeDate(project.createdAt), "green"] satisfies [string, string, string]),
    ...websites.slice(0, 2).map((website) => [`Website connected: ${website.domain}`, relativeDate(website.createdAt), "blue"] satisfies [string, string, string]),
    ...keywordRuns.slice(0, 2).map((run) => [`Keyword research saved: ${run.seedKeyword}`, `${run.keywordCount} keywords`, "purple"] satisfies [string, string, string]),
    ...completedTasks.slice(0, 2).map((task) => [`Task completed: ${task.title}`, relativeDate(task.createdAt), "amber"] satisfies [string, string, string]),
  ];
  return rows.slice(0, 5);
}

function dashboardQueue(tasks: GuidedExecutionTask[], fallbackProject: string, websiteId?: string): QueueRow[] {
  return tasks.slice(0, 5).map((task) => ({
    task: normalizedActionTitle(task.title),
    project: fallbackProject,
    status: statusLabel(task.status),
    to: ["content", "ai_content"].includes(task.moduleName)
      ? contentExecutionTaskRoute(task, task.projectId || "")
      : task.relatedUrl || routeForModule(task.moduleName, websiteId),
  }));
}

function dashboardSocial(tasks: GuidedExecutionTask[]) {
  const socialTasks = tasks.filter((task) => task.moduleName.includes("social") || task.title.toLowerCase().includes("social"));
  return socialTasks.slice(0, 3).map((task, index) => ({
    icon: index === 0 ? "IG" : index === 1 ? "f" : "in",
    title: task.title,
    date: statusLabel(task.status),
    network: task.moduleName.replace(/_/g, " "),
    tone: index === 0 ? "pink" : index === 1 ? "blue" : "sky",
  }));
}

function priorityLabel(priority: string) {
  if (priority === "high") return "High";
  if (priority === "medium") return "Medium";
  if (priority === "low") return "Low";
  return priority.replace(/_/g, " ");
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toneForModule(moduleName: string) {
  if (moduleName.includes("backlink")) return "green";
  if (moduleName.includes("citation")) return "purple";
  if (moduleName.includes("content")) return "amber";
  if (moduleName.includes("social")) return "cyan";
  if (moduleName.includes("strategy")) return "violet";
  return "blue";
}

function toneForProjectStep(stepKey: string) {
  if (stepKey.includes("opportunit")) return "green";
  if (stepKey.includes("strategy")) return "violet";
  if (stepKey.includes("execution")) return "amber";
  return "blue";
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString();
}

function prettifyDomain(domain: string) {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(".")[0]
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
