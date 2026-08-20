import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Card } from "../components/ui.js";
import { useAuth } from "../auth.js";
import type { GuidedExecutionTask, GuidedProject } from "../types.js";

type ProjectFilter = "all" | "in_progress" | "needs_review" | "completed" | "archived";

const completedStatuses = new Set(["completed", "skipped", "published"]);
const reviewStatuses = new Set(["submitted_for_approval", "needs_review", "changes_requested"]);

const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const taskStatusRank: Record<string, number> = { changes_requested: 0, needs_review: 1, submitted_for_approval: 2, ready_to_publish: 3, ready: 4, in_progress: 5, pending: 6, blocked: 7 };

function taskDependenciesReady(task: GuidedExecutionTask) {
  return (task.dependencies ?? []).every((dependency) => completedStatuses.has(dependency.requiredTask.status) || dependency.requiredTask.status === "approved");
}

function nextTask(project: GuidedProject) {
  const tasks = Array.from(new Map([...(project.executionTasks ?? []), ...(project.executionPlans?.flatMap((plan) => plan.tasks ?? []) ?? [])].map((task) => [task.id, task])).values());
  return tasks.filter((task) => !completedStatuses.has(task.status) && !["cancelled", "canceled"].includes(task.status)).sort((a, b) => {
    const aReady = taskDependenciesReady(a) && a.status !== "blocked" ? 0 : 1;
    const bReady = taskDependenciesReady(b) && b.status !== "blocked" ? 0 : 1;
    return aReady - bReady || (taskStatusRank[a.status] ?? 8) - (taskStatusRank[b.status] ?? 8) || (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })[0] ?? null;
}

function nextActionHref(project: GuidedProject, task: GuidedExecutionTask | null, workflowStep: ReturnType<typeof nextWorkflowStep>) {
  if (!task) return workflowStep ? milestoneHref(project, workflowStep.actionUrl, workflowStep.stepKey) : `/guided-projects/${project.id}`;
  if (["submitted_for_approval", "waiting_for_approval", "pending_approval", "needs_approval"].includes(task.status)) return `/approvals?projectId=${encodeURIComponent(project.id)}&taskId=${encodeURIComponent(task.id)}`;
  if (task.moduleName === "opportunity") return `/opportunities?projectId=${encodeURIComponent(project.id)}`;
  if (task.relatedUrl) {
    if (task.relatedUrl.startsWith(`/guided-projects/${project.id}`) || /[?&]projectId=/.test(task.relatedUrl)) return task.relatedUrl;
    return `${task.relatedUrl}${task.relatedUrl.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(project.id)}`;
  }
  if (task.moduleName === "content") return task.status === "ready" ? `/ai-content?projectId=${encodeURIComponent(project.id)}&taskId=${encodeURIComponent(task.id)}&open=1` : `/ai-content?projectId=${encodeURIComponent(project.id)}#publishing`;
  const routes: Record<string, string> = {
    opportunity: "/opportunities",
    keyword_research: "/keywords",
    keyword_intelligence: "/keywords",
    site_analysis: "/site-analysis",
    website_intelligence: "/site-analysis",
    seo: "/gap-analysis",
    gap_analysis: "/gap-analysis",
    strategy: "/strategy",
    strategy_approval: "/strategy",
    site_architect: "/site-architect",
    website: "/site-architect",
    lead_magnets: "/lead-magnets",
    ai_citations: "/ai-citations",
    local_seo: "/local-seo",
    authority: "/backlinks",
    backlinks: "/backlinks",
    publishing: "/ai-content",
    social: "/social-strategy",
    growth: "/growth",
    measurement: "/growth",
    reports: "/reports",
    execution_plan: `/guided-projects/${project.id}?tab=execution#execution-tasks`,
  };
  const route = routes[task.moduleName];
  if (!route) return `/guided-projects/${project.id}?tab=execution#execution-tasks`;
  if (route.startsWith(`/guided-projects/${project.id}`)) return route;
  return `${route}?projectId=${encodeURIComponent(project.id)}`;
}

function nextWorkflowStep(project: GuidedProject) {
  return project.workflowSteps?.find((step) => !completedStatuses.has(step.status)) ?? null;
}

function projectProgress(project: GuidedProject) {
  if (project.status === "completed") return 100;
  const steps = project.workflowSteps ?? [];
  const completedSteps = steps.filter((step) => completedStatuses.has(step.status)).length;
  const workflowRatio = steps.length ? completedSteps / steps.length : 0;
  const execution = project.executionProgress ?? { total: 0, completed: 0 };
  const executionRatio = execution.total ? execution.completed / execution.total : 0;
  return Math.round((workflowRatio * 50) + (executionRatio * 50));
}

function projectProgressBreakdown(project: GuidedProject) {
  const steps = project.workflowSteps ?? [];
  const completedSteps = steps.filter((step) => completedStatuses.has(step.status)).length;
  const execution = project.executionProgress ?? { total: 0, completed: 0 };
  return {
    intakeComplete: steps.some((step) => step.stepKey === "intake" && completedStatuses.has(step.status)),
    setupCompleted: completedSteps,
    setupTotal: steps.length,
    setupPercent: project.status === "completed" ? 100 : steps.length ? Math.round((completedSteps / steps.length) * 100) : 0,
    executionCompleted: execution.completed,
    executionTotal: execution.total,
    executionPercent: project.status === "completed" ? 100 : execution.total ? Math.round((execution.completed / execution.total) * 100) : 0,
  };
}

function projectNeedsReview(project: GuidedProject) {
  return Boolean(project.executionPlans?.[0]?.tasks?.some((task) => reviewStatuses.has(task.status)) || project.workflowSteps?.some((step) => reviewStatuses.has(step.status)));
}

function workflowState(project: GuidedProject, index: number): "completed" | "skipped" | "current" | "pending" | "blocked" | "review" {
  const steps = project.workflowSteps ?? [];
  const step = steps[index];
  if (!step) return "pending";
  if (step.status === "skipped") return "skipped";
  if (completedStatuses.has(step.status)) return "completed";
  if (reviewStatuses.has(step.status)) return "review";
  if (step.status === "blocked") return "blocked";
  const firstIncomplete = steps.findIndex((item) => !completedStatuses.has(item.status));
  return index === firstIncomplete ? "current" : "pending";
}

function milestoneHref(project: GuidedProject, actionUrl: string | null, stepKey?: string) {
  const routeByStep: Record<string, string> = { opportunities: "/opportunities", keyword_analysis: "/keywords", site_analysis: "/site-analysis", strategy: "/strategy", strategy_approval: "/strategy", execution_plan: `/guided-projects/${project.id}?tab=execution#execution-tasks` };
  const base = stepKey && routeByStep[stepKey] ? routeByStep[stepKey] : actionUrl || `/guided-projects/${project.id}`;
  if (base.startsWith(`/guided-projects/${project.id}`)) return base;
  return `${base}${base.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(project.id)}`;
}

function WorkflowMilestones({ project }: { project: GuidedProject }) {
  const steps = project.workflowSteps ?? [];
  if (!steps.length) return null;
  const completed = steps.filter((step) => step.status === "completed" || step.status === "published").length;
  const skipped = steps.filter((step) => step.status === "skipped").length;
  const activeIndex = steps.findIndex((_, index) => ["current", "review", "blocked"].includes(workflowState(project, index)));
  const currentIndex = activeIndex < 0 ? steps.length - 1 : activeIndex;
  const lineProgress = steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 100;
  const edgeInset = `${50 / steps.length}%`;
  const markerLeft = `${((currentIndex + 0.5) / steps.length) * 100}%`;
  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Milestones</div><div className="text-right text-[11px] text-slate-400">{completed} achieved · {skipped} skipped · {steps.length} total</div></div>
      <div className="relative w-full pb-14 pt-1">
        <div className="absolute top-3.5 h-0.5 bg-slate-200" style={{ left: edgeInset, right: edgeInset }}><div className="h-full bg-emerald-400" style={{ width: `${lineProgress}%` }} /></div>
        <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>{steps.map((step, index) => { const state = workflowState(project, index); return <Link key={step.id} to={milestoneHref(project, step.actionUrl, step.stepKey)} title={`Open ${step.title}`} className="group flex min-w-0 flex-col items-center rounded-lg text-center outline-none focus-visible:ring-2 focus-visible:ring-teal-400"><span className={`relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black shadow-[0_0_0_3px_white] transition group-hover:scale-110 ${state === "completed" ? "bg-emerald-500 text-white" : state === "skipped" ? "bg-slate-300 text-slate-700" : state === "current" ? "bg-teal-500 text-white ring-4 ring-teal-100" : state === "review" ? "bg-amber-500 text-white" : state === "blocked" ? "bg-rose-500 text-white" : "border-2 border-slate-300 bg-white text-slate-400"}`}>{state === "completed" ? "✓" : state === "skipped" ? "–" : state === "current" ? "●" : state === "review" ? "!" : state === "blocked" ? "×" : index + 1}</span><div className={`mt-2 max-w-[104px] text-[10px] font-bold leading-3.5 group-hover:underline ${state === "completed" ? "text-emerald-700" : state === "current" ? "text-teal-800" : state === "review" ? "text-amber-800" : state === "blocked" ? "text-rose-700" : "text-slate-500"}`}>{step.title}</div><div className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-400">{state === "completed" ? "Achieved" : state === "review" ? "Review" : state}</div></Link>; })}</div>
        {project.status !== "completed" && project.status !== "archived" && <div className="pointer-events-none absolute bottom-0 z-10 -translate-x-1/2 text-center" style={{ left: markerLeft }} aria-hidden="true"><span className="mx-auto block h-0 w-0 border-x-[7px] border-b-[9px] border-x-transparent border-b-teal-600 motion-safe:animate-pulse" /><span className="inline-flex max-w-44 items-center rounded-full bg-teal-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-lg"><span className="truncate">↑ Next task</span></span></div>}
      </div>
    </div>
  );
}

function projectTypeLabel(project: GuidedProject) {
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website);
  if (project.projectType === "existing_website" && !hasWebsite) return "Pre-website project";
  if (project.projectType === "new_business") return hasWebsite ? "New website launch" : "Pre-website project";
  return project.projectType.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function stageLabel(project: GuidedProject) {
  const next = nextWorkflowStep(project);
  if (next) return next.title;
  if (project.status === "completed") return "Completed";
  return project.currentStep.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function relativeUpdated(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

const avatarTones = ["bg-teal-100 text-teal-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-violet-100 text-violet-700"];

export default function GuidedProjects() {
  const { user } = useAuth();
  const canManageProjects = user?.role === "super_admin" || Boolean(user?.workspace?.capabilities.manageProjects);
  const canEditProjects = user?.role === "super_admin" || Boolean(user?.workspace?.capabilities.edit);
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GuidedProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [agencyHasActiveClient, setAgencyHasActiveClient] = useState(true);

  const load = async () => {
    try {
      const [result, agencyWorkspace] = await Promise.all([
        api.get<{ projects: GuidedProject[] }>("/api/projects-v2"),
        user?.workspace?.type === "agency"
          ? api.get<{ clients: { status: string }[] }>("/api/agency/workspace")
          : Promise.resolve(null),
      ]);
      setProjects(result.projects);
      setAgencyHasActiveClient(agencyWorkspace ? agencyWorkspace.clients.some((client) => client.status === "active") : true);
    } catch (error) {
      // A 401 is handled globally by clearing the expired session and routing
      // to login. Do not leave an unhandled Promise rejection in the console.
      if (error instanceof Error && /invalid or expired token|missing bearer token/i.test(error.message)) return;
      throw error;
    }
  };

  useEffect(() => { void load().catch(() => undefined); }, [user?.workspace?.type]);
  const agencyNeedsClient = user?.workspace?.type === "agency" && !agencyHasActiveClient;

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch = !query || [project.name, project.agencyClient?.name, project.businessName, project.website?.domain, project.websiteUrl, project.projectType]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      const matchesFilter = filter === "all"
        || (filter === "completed" && project.status === "completed")
        || (filter === "archived" && project.status === "archived")
        || (filter === "needs_review" && projectNeedsReview(project))
        || (filter === "in_progress" && !["completed", "archived"].includes(project.status) && !projectNeedsReview(project));
      return matchesSearch && matchesFilter;
    });
  }, [filter, projects, search]);

  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete<{ deleted: boolean; deletedWebsite: boolean }>(`/api/projects-v2/${deleteTarget.id}`);
      setProjects((current) => current.filter((project) => project.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete project");
    } finally {
      setDeleting(false);
    }
  };

  const changeArchiveStatus = async (project: GuidedProject, action: "archive" | "restore") => {
    setStatusBusy(project.id);
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/${action}`, {});
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, ...result.project } : item));
    } finally {
      setStatusBusy(null);
    }
  };

  return (
    <div className="-m-4 min-h-full bg-[#f7f7ff] p-4 lg:-m-8 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Projects</h1>
          <p className="mt-1 text-base text-slate-500">Every guided project and its current AI growth stage.</p>
        </div>
        {canManageProjects && <Link to={agencyNeedsClient ? "/workspace?tab=clients" : "/projects/new"} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-400 to-teal-600 px-5 text-sm font-bold text-white shadow-lg shadow-teal-200/70 hover:from-teal-500 hover:to-teal-700">
          <span className="text-xl leading-none">+</span> {agencyNeedsClient ? "New Client" : "New Project"}
        </Link>}
      </div>

      <div className="mt-7 flex flex-col gap-3 xl:flex-row xl:items-center">
        <label className="relative block w-full xl:max-w-[480px]">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-12 w-full rounded-xl border border-violet-100 bg-white pl-12 pr-4 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-teal-300 focus:ring-4 focus:ring-teal-100/60" placeholder="Search projects..." />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {([{ id: "all", label: "All" }, { id: "in_progress", label: "In Progress" }, { id: "needs_review", label: "Needs Review" }, { id: "completed", label: "Completed" }, { id: "archived", label: "Archived" }] as { id: ProjectFilter; label: string }[]).map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`h-11 shrink-0 rounded-full border px-5 text-sm font-bold transition ${filter === item.id ? "border-teal-300 bg-teal-100 text-teal-800 shadow-sm" : "border-violet-100 bg-transparent text-slate-500 hover:border-violet-200 hover:bg-white"}`}>{item.label}</button>)}
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="mt-7 rounded-2xl border border-dashed border-violet-200 bg-white p-10 text-center shadow-sm">
          <div className="text-lg font-bold text-slate-950">{agencyNeedsClient ? "Create a client first" : "No projects yet"}</div>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{agencyNeedsClient ? "Agency projects must belong to an active client. Add the client before creating their first project." : "Create a project to begin intake, strategy, analysis, execution, approval, and delivery."}</p>
          {canManageProjects && <Link to={agencyNeedsClient ? "/workspace?tab=clients" : "/projects/new"} className="mt-5 inline-flex rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-700">{agencyNeedsClient ? "Create Client" : "Create Project"}</Link>}
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="mt-7 rounded-2xl border border-violet-100 bg-white p-10 text-center shadow-sm"><div className="font-bold text-slate-900">No matching projects</div><p className="mt-2 text-sm text-slate-500">Try another search or status filter.</p><button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className="mt-4 text-sm font-bold text-teal-700">Clear filters</button></div>
      ) : (
        <div className="mt-7 space-y-4">
          {visibleProjects.map((project, index) => {
            const task = nextTask(project);
            const workflowStep = nextWorkflowStep(project);
            const progress = projectProgress(project);
            const breakdown = projectProgressBreakdown(project);
            const needsReview = projectNeedsReview(project);
            const nextTitle = task?.title ?? workflowStep?.title ?? (project.status === "completed" ? "Project complete" : "Review project overview");
            const nextHref = nextActionHref(project, task, workflowStep);
            const projectHref = `/guided-projects/${project.id}`;
            return <article key={project.id} className="rounded-2xl border border-violet-100 bg-white px-5 py-5 shadow-sm transition hover:border-teal-200 hover:shadow-md sm:px-6">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
                <div className="flex w-full min-w-0 items-start gap-4">
                  <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${avatarTones[index % avatarTones.length]}`}>{project.name.slice(0, 2).toUpperCase()}</div>
                  <div className="w-full min-w-0">
                    {project.agencyClient?.name && <div className="mb-0.5 truncate text-[11px] font-black uppercase tracking-[0.12em] text-teal-700">Client · {project.agencyClient.name}</div>}
                    <Link to={`/guided-projects/${project.id}`} className="block break-words text-lg font-bold leading-6 text-slate-950 hover:text-teal-700">{project.name}</Link>
                    <div className="mt-2 grid min-w-0 gap-x-5 gap-y-1.5 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                      <div className="min-w-0"><b className="font-semibold text-slate-700">Website:</b>{" "}{project.website?.id ? <Link to={`/website-projects/${project.website.id}`} title={project.website.rootUrl ?? project.websiteUrl ?? project.website.domain} className="break-all font-semibold text-teal-700 hover:underline">{project.website.rootUrl ?? project.websiteUrl ?? project.website.domain}</Link> : <span className="break-all">{project.websiteUrl ?? "No website connected"}</span>}</div>
                      <div className="min-w-0 break-words"><b className="font-semibold text-slate-700">Project type:</b> {projectTypeLabel(project)}</div>
                      <div className="min-w-0 break-words"><b className="font-semibold text-slate-700">Location:</b> {project.businessLocation ?? "Not set"}</div>
                      <div className="min-w-0 break-words"><b className="font-semibold text-slate-700">Timeline:</b> {project.targetLaunchTimeline ?? "Not set"}</div>
                      <div className="min-w-0 break-words"><b className="font-semibold text-slate-700">Primary goal:</b> {project.primaryGoal ?? "Not set"}</div>
                    </div>
                  </div>
                </div>
                <span className={`shrink-0 self-start rounded-full px-4 py-1.5 text-xs font-bold ${project.status === "archived" ? "bg-slate-200 text-slate-700" : project.status === "intake_draft" ? "bg-violet-100 text-violet-800" : needsReview ? "bg-amber-100 text-amber-800" : project.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-teal-100 text-teal-800"}`}>{project.status === "archived" ? "Archived · View only" : project.status === "intake_draft" ? "Intake draft" : needsReview ? "Needs Review" : stageLabel(project)}</span>
              </div>


              <div className="mt-6 rounded-xl border border-violet-100 bg-slate-50/60 px-4 py-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)_auto] sm:items-center sm:gap-5">
                  <div>
                    <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-wide text-teal-700">Project workflow</span><span className="text-sm font-black text-teal-800">{breakdown.setupPercent}%</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-teal-100"><div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${breakdown.setupPercent}%` }} /></div>
                    <div className="mt-1.5 text-[11px] font-semibold text-slate-500">{breakdown.intakeComplete ? "Intake complete · " : ""}{breakdown.setupCompleted} of {breakdown.setupTotal} workflow milestones complete · 50% weight</div>
                  </div>
                  <div className="h-px bg-violet-200 sm:h-12 sm:w-px" aria-hidden="true" />
                  <div>
                    <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-wide text-violet-700">Execution tasks</span><span className="text-sm font-black text-violet-800">{breakdown.executionPercent}%</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${breakdown.executionPercent}%` }} /></div>
                    <div className="mt-1.5 text-[11px] font-semibold text-slate-500">{breakdown.executionCompleted} of {breakdown.executionTotal} tasks complete · 50% weight</div>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 px-5 py-3 text-white shadow-md shadow-teal-200 sm:block sm:min-w-[112px] sm:text-center"><span className="text-[10px] font-black uppercase tracking-[0.16em] text-teal-50">Overall</span><div className="text-3xl font-black leading-none tracking-tight sm:mt-1">{progress}%</div></div>
                </div>
              </div>

              <WorkflowMilestones project={project} />

              <div className="mt-5 flex flex-col gap-3 border-t border-violet-50 pt-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:gap-7"><Link to={nextHref} className="group inline-flex min-w-0 items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-teal-800 transition hover:border-teal-400 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"><span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-teal-600">Next task</span><span className="truncate font-black">{nextTitle}</span><span aria-hidden="true" className="shrink-0 font-black transition-transform group-hover:translate-x-1">→</span></Link><div className="shrink-0">Updated <span className="font-bold text-slate-800">{relativeUpdated(project.updatedAt)}</span></div></div>
                <div className="flex shrink-0 items-center gap-4">{canEditProjects && !["archived", "intake_draft"].includes(project.status) && <Link to={`/projects/new?edit=${project.id}`} className="text-xs font-bold text-teal-700 hover:text-teal-900">Edit</Link>}{canManageProjects && project.status !== "archived" && <button disabled={statusBusy === project.id} type="button" onClick={() => void changeArchiveStatus(project, "archive")} className="text-xs font-bold text-slate-500 hover:text-amber-700 disabled:opacity-50">Archive</button>}{canManageProjects && project.status === "archived" && <><button disabled={statusBusy === project.id} type="button" onClick={() => void changeArchiveStatus(project, "restore")} className="text-xs font-bold text-teal-700 disabled:opacity-50">Restore</button><button type="button" onClick={() => setDeleteTarget(project)} className="text-xs font-bold text-rose-600 hover:text-rose-800">Permanently delete</button></>}<Link to={project.status === "intake_draft" ? `/projects/new?resumeConversation=${project.id}` : projectHref} className="text-sm font-bold text-teal-700 hover:text-teal-900">{project.status === "archived" ? "View project →" : project.status === "intake_draft" ? "Continue intake →" : "Open project →"}</Link></div>
              </div>
            </article>;
          })}
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-950/35 p-4" role="dialog" aria-modal="true" aria-label="Delete project">
          <Card className="w-full max-w-lg p-5 shadow-2xl">
            <div className="text-lg font-bold text-charcoal-950">Permanently delete project?</div>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">
              This will permanently delete <span className="font-semibold text-charcoal-900">{deleteTarget.name}</span>, including its intake answers, business profile, opportunities, strategies, AI runs, execution plans, workflow steps, and project tasks.
            </p>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">
              If the connected website is not used by another project, its website audit, crawl, keyword, backlink, social, and module data will also be deleted.
            </p>
            {deleteError && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{deleteError}</div>}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteError(""); }}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteProject()}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {deleting ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
