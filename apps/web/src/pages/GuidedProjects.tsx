import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Card } from "../components/ui.js";
import { useAuth } from "../auth.js";
import type { GuidedExecutionTask, GuidedProject } from "../types.js";

type ProjectFilter = "all" | "draft" | "in_progress" | "needs_review" | "completed" | "archived";

type ProjectDiscoveryDraft = {
  id: string;
  title: string;
  status: string;
  sourceText: string | null;
  convertedProjectId: string | null;
  updatedAt: string;
  ideas: Array<{ id: string; title: string; status: string }>;
};

const completedStatuses = new Set(["completed", "skipped", "published"]);
const reviewStatuses = new Set(["submitted_for_approval", "needs_review", "changes_requested", "waiting_for_approval", "pending_approval", "needs_approval"]);

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
  if (["content", "ai_content"].includes(task.moduleName)) {
    const query = new URLSearchParams(task.relatedUrl?.startsWith("/ai-content?") ? task.relatedUrl.split("?", 2)[1] : "");
    query.set("projectId", project.id);
    query.set("taskId", task.id);
    query.set("open", "1");
    return `/ai-content?${query.toString()}`;
  }
  if (task.relatedUrl) {
    if (task.relatedUrl.startsWith(`/guided-projects/${project.id}`) || /[?&]projectId=/.test(task.relatedUrl)) return task.relatedUrl;
    return `${task.relatedUrl}${task.relatedUrl.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(project.id)}`;
  }
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

function masterWorkflowHref(project: GuidedProject) {
  const url = project.workflowController?.nextBestAction.action.url;
  if (!url) return null;
  if (!url.startsWith("/") || /[?&]projectId=/.test(url)) return url;
  const [pathAndQuery, hash] = url.split("#", 2);
  return `${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(project.id)}${hash ? `#${hash}` : ""}`;
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
  return Boolean(project.executionTasks?.some((task) => reviewStatuses.has(task.status)) || project.executionPlans?.[0]?.tasks?.some((task) => reviewStatuses.has(task.status)) || project.workflowSteps?.some((step) => reviewStatuses.has(step.status)));
}

function projectState(project: GuidedProject): Exclude<ProjectFilter, "all"> {
  if (project.status === "archived") return "archived";
  if (project.status === "completed") return "completed";
  if (project.status === "intake_draft") return "draft";
  if (projectNeedsReview(project)) return "needs_review";
  return "in_progress";
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
  const [discoveryDrafts, setDiscoveryDrafts] = useState<ProjectDiscoveryDraft[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GuidedProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [agencyHasActiveClient, setAgencyHasActiveClient] = useState(true);

  const load = async () => {
    try {
      const [result, draftResult, agencyWorkspace] = await Promise.all([
        api.get<{ projects: GuidedProject[] }>("/api/projects-v2"),
        api.get<{ drafts: ProjectDiscoveryDraft[] }>("/api/discovery-drafts").catch(() => ({ drafts: [] })),
        user?.workspace?.type === "agency"
          ? api.get<{ clients: { status: string }[] }>("/api/agency/workspace")
          : Promise.resolve(null),
      ]);
      setProjects(result.projects);
      setDiscoveryDrafts(draftResult.drafts.filter((draft) => !draft.convertedProjectId));
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
  const personalWorkspace = ["personal", "entrepreneur", "individual"].includes(String(user?.workspace?.type || "").toLowerCase());

  const projectCounts = useMemo(() => {
    const counts: Record<ProjectFilter, number> = { all: discoveryDrafts.length, draft: discoveryDrafts.length, in_progress: 0, needs_review: 0, completed: 0, archived: 0 };
    for (const project of projects) {
      counts.all += 1;
      counts[projectState(project)] += 1;
    }
    return counts;
  }, [discoveryDrafts.length, projects]);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch = !query || [project.name, project.agencyClient?.name, project.businessName, project.website?.domain, project.websiteUrl, project.projectType]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      const matchesFilter = filter === "all" || projectState(project) === filter;
      return matchesSearch && matchesFilter;
    });
  }, [filter, projects, search]);

  const visibleDiscoveryDrafts = useMemo(() => {
    if (!["all", "draft"].includes(filter)) return [];
    const query = search.trim().toLowerCase();
    return discoveryDrafts.filter((draft) => !query || [draft.title, draft.sourceText, ...draft.ideas.map((idea) => idea.title)].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }, [discoveryDrafts, filter, search]);

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

  const deleteDiscoveryDraft = async (draft: ProjectDiscoveryDraft) => {
    if (!window.confirm(`Permanently delete the draft “${draft.title}”?\n\nIts saved discovery answers and generated ideas will be removed.`)) return;
    setStatusBusy(`draft:${draft.id}`);
    try {
      await api.delete<{ deleted: boolean }>(`/api/discovery-drafts/${encodeURIComponent(draft.id)}`);
      setDiscoveryDrafts((current) => current.filter((item) => item.id !== draft.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not delete the draft");
    } finally {
      setStatusBusy(null);
    }
  };

  const changeArchiveStatus = async (project: GuidedProject, action: "archive" | "restore") => {
    if (action === "archive" && !window.confirm(`Archive “${project.name}”?\n\nThe project will leave active views, but its reports, Strategy versions, evidence, generated assets, execution history, and audit records will be retained. You can restore it later.`)) return;
    setStatusBusy(project.id);
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/${action}`, {});
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, ...result.project } : item));
    } finally {
      setStatusBusy(null);
    }
  };

  const changeLifecycleStatus = async (project: GuidedProject, action: "complete" | "reopen") => {
    let completionEvidence = "";
    if (action === "complete") {
      const answer = window.prompt(`Mark “${project.name}” complete with evidence\n\nRecord the verified outcome, completion evidence, or reason for the manual override. Open approvals and publishing work should be resolved first.`, "");
      if (answer === null) return;
      completionEvidence = answer.trim();
      if (completionEvidence.length < 10) { window.alert("Add at least 10 characters describing the verified outcome or completion evidence."); return; }
    }
    const confirmed = window.confirm(action === "complete"
      ? `Confirm project completion for “${project.name}”? The evidence will be retained in the workspace audit history, and the project can be reopened later.`
      : `Reopen “${project.name}” and return it to In Progress?`);
    if (!confirmed) return;
    setStatusBusy(project.id);
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/${action}`, action === "complete" ? { completionEvidence } : {});
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, ...result.project } : item));
    } finally {
      setStatusBusy(null);
    }
  };

  const downloadIdeaPdf = async (draftId: string, ideaId: string) => {
    setStatusBusy(`pdf:${ideaId}`);
    try {
      await api.download(`/api/discovery-drafts/${draftId}/ideas/${ideaId}/download`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "The idea PDF could not be downloaded.");
    } finally {
      setStatusBusy(null);
    }
  };

  return (
    <div className="-m-4 min-h-full bg-[#f7f7ff] p-4 lg:-m-8 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Projects</h1>
          <p className="mt-1 text-base text-slate-500">See every project, its current stage, Next Best Action, review state and verified completion history.</p>
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
          {([{ id: "all", label: "All" }, { id: "draft", label: "Drafts" }, { id: "in_progress", label: "In Progress" }, { id: "needs_review", label: "Needs Review" }, { id: "completed", label: "Completed" }, { id: "archived", label: "Archived" }] as { id: ProjectFilter; label: string }[]).map((item) => <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`h-11 shrink-0 rounded-full border px-5 text-sm font-bold transition ${filter === item.id ? "border-teal-300 bg-teal-100 text-teal-800 shadow-sm" : "border-violet-100 bg-transparent text-slate-500 hover:border-violet-200 hover:bg-white"}`}>{item.label} ({projectCounts[item.id]})</button>)}
        </div>
      </div>

      {filter === "draft" && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-900"><b>Drafts are saved work that is not active yet.</b> Discovery ideas appear here after you start or generate them; select <b>Use This Idea</b> when you want one to become a Project. Intake drafts become active after you finish project setup.</div>}
      {filter === "needs_review" && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><b>{personalWorkspace ? "Your review is needed." : "A review is needed."}</b> {personalWorkspace ? "In an Entrepreneur Workspace, you are the reviewer. Open the project and approve, request changes, or complete the waiting item." : "Open the project to approve, request changes, or complete the waiting item."}</div>}
      {filter === "completed" && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900"><b>Completed projects remain available for reports and history.</b> Use Reopen if more work is needed.</div>}

      {projects.length === 0 && discoveryDrafts.length === 0 ? (
        <div className="mt-7 rounded-2xl border border-dashed border-violet-200 bg-white p-10 text-center shadow-sm">
          <div className="text-lg font-bold text-slate-950">{agencyNeedsClient ? "Create a client first" : "No projects yet"}</div>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{agencyNeedsClient ? "Agency projects must belong to an active client. Add the client before creating their first project." : "Create a project to begin intake, strategy, analysis, execution, approval, and delivery."}</p>
          {canManageProjects && <Link to={agencyNeedsClient ? "/workspace?tab=clients" : "/projects/new"} className="mt-5 inline-flex rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-700">{agencyNeedsClient ? "Create Client" : "Create Project"}</Link>}
        </div>
      ) : visibleProjects.length === 0 && visibleDiscoveryDrafts.length === 0 ? (
        <div className="mt-7 rounded-2xl border border-violet-100 bg-white p-10 text-center shadow-sm"><div className="font-bold text-slate-900">No matching projects</div><p className="mt-2 text-sm text-slate-500">Try another search or status filter.</p><button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className="mt-4 text-sm font-bold text-teal-700">Clear filters</button></div>
      ) : (
        <div className="mt-7 space-y-4">
          {visibleDiscoveryDrafts.map((draft) => <article key={`discovery-${draft.id}`} className="rounded-2xl border border-violet-200 bg-white px-5 py-5 shadow-sm sm:px-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-violet-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-violet-800">Discovery draft</span><span className="text-xs font-semibold text-slate-400">{draft.ideas.length} generated idea{draft.ideas.length === 1 ? "" : "s"}</span></div><h2 className="mt-2 break-words text-lg font-bold text-slate-950">{draft.title}</h2><p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{draft.sourceText || "Business Discovery started. Continue the draft to add context and generate ideas."}</p><p className="mt-2 text-xs text-slate-400">Updated {relativeUpdated(draft.updatedAt)} · Does not count as an active project</p>{draft.ideas.length > 0 && <div className="mt-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Download a saved idea again</div><div className="mt-2 flex flex-wrap gap-2">{draft.ideas.map((idea, ideaIndex) => <button key={idea.id} type="button" disabled={statusBusy === `pdf:${idea.id}`} title={`Download PDF: ${idea.title}`} onClick={() => void downloadIdeaPdf(draft.id, idea.id)} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50">{statusBusy === `pdf:${idea.id}` ? "Preparing PDF…" : `Idea ${ideaIndex + 1} PDF`}</button>)}</div></div>}</div><div className="flex shrink-0 flex-wrap items-center gap-3"><button type="button" disabled={statusBusy === `draft:${draft.id}`} onClick={() => void deleteDiscoveryDraft(draft)} className="text-xs font-bold text-rose-600 hover:text-rose-800 disabled:opacity-50">{statusBusy === `draft:${draft.id}` ? "Deleting…" : "Delete draft"}</button><Link to={`/projects/new?discoveryDraftId=${encodeURIComponent(draft.id)}`} className="inline-flex h-10 items-center justify-center rounded-lg bg-violet-700 px-4 text-sm font-bold text-white hover:bg-violet-800">{draft.ideas.length ? "Review ideas →" : "Continue discovery →"}</Link></div></div></article>)}
          {visibleProjects.map((project, index) => {
            const task = project.status === "completed" ? null : nextTask(project);
            const workflowStep = project.status === "completed" ? null : nextWorkflowStep(project);
            const masterAction = project.status === "completed" ? null : project.workflowController?.nextBestAction ?? null;
            const progress = projectProgress(project);
            const breakdown = projectProgressBreakdown(project);
            const needsReview = projectNeedsReview(project);
            const nextTitle = masterAction?.title ?? task?.title ?? workflowStep?.title ?? (project.status === "completed" ? "Project complete" : "Review project overview");
            const nextHref = masterWorkflowHref(project) ?? nextActionHref(project, task, workflowStep);
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
                <span className={`shrink-0 self-start rounded-full px-4 py-1.5 text-xs font-bold ${project.status === "archived" ? "bg-slate-200 text-slate-700" : project.status === "intake_draft" ? "bg-violet-100 text-violet-800" : project.status === "completed" ? "bg-emerald-100 text-emerald-800" : needsReview ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-800"}`}>{project.status === "archived" ? "Archived · View only" : project.status === "intake_draft" ? "Intake draft" : project.status === "completed" ? "Completed" : needsReview ? (personalWorkspace ? "Your review needed" : "Needs Review") : stageLabel(project)}</span>
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
                <div className="flex shrink-0 items-center gap-4">{canEditProjects && !["archived", "intake_draft", "completed"].includes(project.status) && <Link to={`/projects/new?edit=${project.id}`} className="text-xs font-bold text-teal-700 hover:text-teal-900">Edit</Link>}{canManageProjects && !["archived", "intake_draft", "completed"].includes(project.status) && <button disabled={statusBusy === project.id} type="button" onClick={() => void changeLifecycleStatus(project, "complete")} className="text-xs font-bold text-emerald-700 hover:text-emerald-900 disabled:opacity-50">Mark complete with evidence</button>}{canManageProjects && project.status === "completed" && <button disabled={statusBusy === project.id} type="button" onClick={() => void changeLifecycleStatus(project, "reopen")} className="text-xs font-bold text-teal-700 hover:text-teal-900 disabled:opacity-50">Reopen</button>}{canManageProjects && project.status !== "archived" && <button disabled={statusBusy === project.id} type="button" onClick={() => void changeArchiveStatus(project, "archive")} className="text-xs font-bold text-slate-500 hover:text-amber-700 disabled:opacity-50">Archive</button>}{canManageProjects && project.status === "archived" && <><button disabled={statusBusy === project.id} type="button" onClick={() => void changeArchiveStatus(project, "restore")} className="text-xs font-bold text-teal-700 disabled:opacity-50">Restore</button><button type="button" onClick={() => setDeleteTarget(project)} className="text-xs font-bold text-rose-600 hover:text-rose-800">Permanently delete</button></>}<Link to={project.status === "intake_draft" ? `/projects/new?resumeConversation=${project.id}` : projectHref} className="text-sm font-bold text-teal-700 hover:text-teal-900">{project.status === "archived" ? "View project →" : project.status === "intake_draft" ? "Continue intake →" : "Open project →"}</Link></div>
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
