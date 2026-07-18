import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GuidedExecutionTask, GuidedProject, ProjectNotification } from "../types.js";
import { api } from "../api.js";

type NextBestAction = { taskId: string; title: string; reason: string; expectedOutcome: string; priority: string; score: number; confidence: number; signals: { key: string; label: string; contribution: number; evidence: string }[]; actionUrl: string | null; actionLabel: string; actionable: boolean; requiresApproval: boolean };
type RankingPlan = {
  keyword: string;
  intent: string;
  targetMode: "optimize_existing" | "create_new";
  targetUrl: string | null;
  pageTitle: string;
  recommendedKeywordVariants: string[];
  contentSections: string[];
  internalLinkActions: string[];
  authorityActions: string[];
  successMetrics: string[];
  evidence: { searchVolume: number | null; currentRank: number | null; location: string; competitors: string[]; targetMarkets: string[] };
};
type PageOptimization = {
  keyword: string;
  targetUrl: string | null;
  current: { title: string | null; metaDescription: string | null; h1: string | null; wordCount: number | null };
  proposed: { title: string; metaDescription: string; h1: string; callToAction: string };
  keywordVariants: string[];
  sections: Array<{ heading: string; guidance: string }>;
  internalLinkActions: string[];
  implementationChecklist: string[];
};
type SeoPlan = {
  summary: string;
  objectives: string[];
  keywordPriorities: string[];
  technicalPriorities: string[];
  contentRoadmap: string[];
  localSeoActions: string[];
  authorityActions: string[];
  kpis: string[];
  phases: { now: string[]; next: string[]; later: string[] };
};

const finishedStatuses = new Set(["completed", "skipped", "published", "approved"]);
const closedStatuses = new Set([...finishedStatuses, "cancelled", "canceled"]);
const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function unresolved(task: GuidedExecutionTask) {
  return (task.dependencies ?? []).filter((item) => !finishedStatuses.has(item.requiredTask.status));
}

function automationLabel(value: string) {
  if (["automatic", "recommend", "generate", "prepare", "execute_through_integration"].includes(value)) return "Automatic";
  if (["one_click_approval", "one_click", "execute_with_approval", "approval_required"].includes(value)) return "One-Click Approval";
  if (value === "manual_guided") return "Manual Guided Step";
  return "Manual Task";
}

function taskPhase(task: GuidedExecutionTask) {
  if (["domain", "site_architect", "local_seo", "keyword_research", "site_analysis", "crawl"].includes(task.moduleName)) return "setup_discovery";
  if (["opportunity", "strategy", "strategy_approval"].includes(task.moduleName)) return "strategy";
  if (["content", "lead_magnet", "ai_citations", "publishing"].includes(task.moduleName)) return "build_publish";
  if (["backlinks", "social", "growth", "reports"].includes(task.moduleName)) return "promote_measure";
  return "execution";
}

function matchesTaskFilter(task: GuidedExecutionTask, filter: string) {
  if (filter === "pending") return !closedStatuses.has(task.status);
  if (filter === "blocked") return task.status === "blocked" || unresolved(task).length > 0;
  if (filter === "approvals") return task.requiresApproval || ["submitted_for_approval", "awaiting_confirmation", "changes_requested"].includes(task.status);
  if (filter === "manual") return ["manual_guided", "manual_task"].includes(task.automationLevel);
  return taskPhase(task) === filter;
}

function isRankingPlanTask(task: GuidedExecutionTask) {
  return task.sourceType === "keyword_research_run" && /ranking plan/i.test(task.title);
}

function savedRankingPlan(task: GuidedExecutionTask): RankingPlan | null {
  const value = task.approvalSnapshotJson?.rankingPlan;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Partial<RankingPlan>;
  return typeof plan.keyword === "string" && typeof plan.pageTitle === "string" && Array.isArray(plan.contentSections) && plan.evidence && typeof plan.evidence === "object" ? plan as RankingPlan : null;
}

function isPageOptimizationTask(task: GuidedExecutionTask) {
  return task.sourceType === "ranking_plan_page";
}

function savedPageOptimization(task: GuidedExecutionTask): PageOptimization | null {
  const value = task.approvalSnapshotJson?.pageOptimization;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const optimization = value as Partial<PageOptimization>;
  return typeof optimization.keyword === "string" && optimization.proposed && typeof optimization.proposed === "object" && Array.isArray(optimization.sections) ? optimization as PageOptimization : null;
}

function isSeoPlanTask(task: GuidedExecutionTask) {
  return /create seo plan/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`);
}

function savedSeoPlan(task: GuidedExecutionTask): SeoPlan | null {
  const value = task.approvalSnapshotJson?.seoPlan;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Partial<SeoPlan>;
  return typeof plan.summary === "string" && Array.isArray(plan.objectives) && Array.isArray(plan.keywordPriorities) && plan.phases && typeof plan.phases === "object" ? plan as SeoPlan : null;
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function taskDisplayKey(task: GuidedExecutionTask) {
  const generatedRankingWork = task.sourceType === "keyword_research_run" && /ranking plan/i.test(task.title) || task.sourceType.startsWith("ranking_plan_");
  return generatedRankingWork ? `${task.projectId ?? "project"}:${task.sourceType}:${task.title.toLowerCase().replace(/\s+/g, " ").trim()}` : task.id;
}

function preferredTask(left: GuidedExecutionTask, right: GuidedExecutionTask) {
  const rank = (task: GuidedExecutionTask) => closedStatuses.has(task.status) ? 4 : task.status === "in_progress" ? 3 : task.status === "needs_review" ? 2 : 1;
  return rank(right) > rank(left) ? right : left;
}

export default function ProjectExecutionBar({ project, tasks: suppliedTasks, notifications = [] }: { project: GuidedProject; tasks?: GuidedExecutionTask[]; notifications?: ProjectNotification[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [decision, setDecision] = useState<NextBestAction | null>(null);
  const [sourceSummaries, setSourceSummaries] = useState(project.sourceActivitySummaries ?? []);
  const [inboxTasks, setInboxTasks] = useState<GuidedExecutionTask[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [taskOverrides, setTaskOverrides] = useState<Record<string, GuidedExecutionTask>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [taskMessage, setTaskMessage] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskPage, setTaskPage] = useState(1);
  const [rankingPlanTask, setRankingPlanTask] = useState<GuidedExecutionTask | null>(null);
  const [rankingPlanDraft, setRankingPlanDraft] = useState<RankingPlan | null>(null);
  const [rankingPlanBusy, setRankingPlanBusy] = useState(false);
  const [rankingPlanError, setRankingPlanError] = useState("");
  const rankingPlanReadOnly = Boolean(rankingPlanTask && closedStatuses.has(rankingPlanTask.status));
  const [pageOptimizationTask, setPageOptimizationTask] = useState<GuidedExecutionTask | null>(null);
  const [pageOptimizationDraft, setPageOptimizationDraft] = useState<PageOptimization | null>(null);
  const [pageOptimizationBusy, setPageOptimizationBusy] = useState(false);
  const [pageOptimizationError, setPageOptimizationError] = useState("");
  const [pageOptimizationEvidence, setPageOptimizationEvidence] = useState("");
  const pageOptimizationReadOnly = Boolean(pageOptimizationTask && closedStatuses.has(pageOptimizationTask.status));
  const [seoPlanTask, setSeoPlanTask] = useState<GuidedExecutionTask | null>(null);
  const [seoPlanDraft, setSeoPlanDraft] = useState<SeoPlan | null>(null);
  const [seoPlanBusy, setSeoPlanBusy] = useState(false);
  const [seoPlanError, setSeoPlanError] = useState("");
  const seoPlanReadOnly = Boolean(seoPlanTask && closedStatuses.has(seoPlanTask.status));
  const planTasks = project.executionPlans?.flatMap((plan) => plan.tasks ?? []) ?? [];
  const tasks = Array.from([...(suppliedTasks ?? planTasks), ...inboxTasks].reduce((map, rawTask) => {
    const task = taskOverrides[rawTask.id] ? { ...rawTask, ...taskOverrides[rawTask.id] } : rawTask;
    const key = taskDisplayKey(task);
    const existing = map.get(key);
    map.set(key, existing ? preferredTask(existing, task) : task);
    return map;
  }, new Map<string, GuidedExecutionTask>()).values());
  const finished = tasks.filter((task) => finishedStatuses.has(task.status));
  const pending = tasks.filter((task) => !closedStatuses.has(task.status));
  const blocked = pending.filter((task) => task.status === "blocked" || unresolved(task).length > 0);
  const ordered = [...pending].sort((a, b) => (blocked.includes(a) ? 1 : 0) - (blocked.includes(b) ? 1 : 0) || (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const next = ordered[0];
  const nextActionTask = decision?.taskId ? tasks.find((task) => task.id === decision.taskId) ?? next : next;
  const taskStatusKey = tasks.map((task) => `${task.id}:${task.status}:${task.priority}:${(task.dependencies ?? []).map((item) => item.requiredTask.status).join(",")}`).join("|");
  useEffect(() => {
    let active = true;
    api.get<{ nextBestAction: NextBestAction | null }>(`/api/projects/${project.id}/next-best-action`).then((result) => { if (active) setDecision(result.nextBestAction); }).catch(() => { if (active) setDecision(null); });
    return () => { active = false; };
  }, [project.id, taskStatusKey]);
  useEffect(() => {
    if (!open || sourceSummaries.length) return;
    let active = true;
    api.get<{ project: GuidedProject }>(`/api/projects-v2/${project.id}`).then((result) => {
      if (active) setSourceSummaries(result.project.sourceActivitySummaries ?? []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [open, project.id, sourceSummaries.length]);
  useEffect(() => {
    let active = true;
    setLoadingInbox(true);
    api.get<{ tasks: GuidedExecutionTask[] }>(`/api/execution-tasks?projectId=${encodeURIComponent(project.id)}`).then((result) => {
      if (active) setInboxTasks(result.tasks);
    }).catch(() => undefined).finally(() => { if (active) setLoadingInbox(false); });
    return () => { active = false; };
  }, [project.id]);
  const allOrdered = [...tasks].sort((a, b) => Number(closedStatuses.has(a.status)) - Number(closedStatuses.has(b.status)) || (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const visibleTasks = filter === "all" ? allOrdered : filter === "completed" ? allOrdered.filter((task) => closedStatuses.has(task.status)) : allOrdered.filter((task) => matchesTaskFilter(task, filter));
  const normalizedSearch = taskSearch.trim().toLowerCase();
  const matchingTasks = normalizedSearch ? visibleTasks.filter((task) => [task.title, task.description, task.moduleName, task.manualInstructions, task.expectedOutcome, task.impact].some((value) => value?.toLowerCase().includes(normalizedSearch))) : visibleTasks;
  const taskPageSize = 15;
  const taskPageCount = Math.max(1, Math.ceil(matchingTasks.length / taskPageSize));
  const effectiveTaskPage = Math.min(taskPage, taskPageCount);
  const pagedTasks = matchingTasks.slice((effectiveTaskPage - 1) * taskPageSize, effectiveTaskPage * taskPageSize);
  const completionPercent = tasks.length ? Math.round((finished.length / tasks.length) * 100) : 0;
  const completeTask = async (task: GuidedExecutionTask) => {
    setBusyTaskId(task.id);
    setTaskMessage("");
    try {
      const isUnsyncedCrawlFinding = task.id.startsWith("crawl-issue:") && task.sourceType === "crawl_issue" && task.sourceId && task.relatedModule;
      const result = isUnsyncedCrawlFinding
        ? await api.patch<{ issue: { status: string } }>(`/api/crawls/${task.relatedModule}/issues/${task.sourceId}`, { status: "fixed" })
        : await api.post<{ task: GuidedExecutionTask }>(`/api/execution-tasks/${task.id}/complete`, {});
      const updatedTask = "task" in result ? result.task : { ...task, status: "completed" };
      setTaskOverrides((current) => ({ ...current, [task.id]: { ...task, ...updatedTask } }));
      setTaskMessage(`“${task.title}” was marked complete.`);
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : "This task could not be completed.");
    } finally {
      setBusyTaskId(null);
    }
  };
  const prepareRankingPlan = async (task: GuidedExecutionTask) => {
    setRankingPlanBusy(true);
    setRankingPlanError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; plan: RankingPlan }>(`/api/execution-tasks/${task.id}/ranking-plan/prepare`, {});
      setTaskOverrides((current) => ({ ...current, [task.id]: { ...task, ...result.task } }));
      setRankingPlanTask({ ...task, ...result.task });
      setRankingPlanDraft(result.plan);
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : "The ranking plan could not be prepared.");
    } finally {
      setRankingPlanBusy(false);
    }
  };
  const confirmRankingPlan = async () => {
    if (!rankingPlanTask || !rankingPlanDraft) return;
    setRankingPlanBusy(true);
    setRankingPlanError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; tasks: GuidedExecutionTask[]; childTaskCount: number }>(`/api/execution-tasks/${rankingPlanTask.id}/ranking-plan/confirm`, { plan: rankingPlanDraft });
      setTaskOverrides((current) => ({ ...current, [rankingPlanTask.id]: { ...rankingPlanTask, ...result.task } }));
      setInboxTasks(result.tasks);
      setTaskMessage(`Ranking plan saved. ${result.childTaskCount} actionable tasks were added to the Execution Plan.`);
      setRankingPlanTask(null);
      setRankingPlanDraft(null);
    } catch (error) {
      setRankingPlanError(error instanceof Error ? error.message : "The ranking plan could not be saved.");
    } finally {
      setRankingPlanBusy(false);
    }
  };
  const preparePageOptimization = async (task: GuidedExecutionTask) => {
    setPageOptimizationBusy(true);
    setPageOptimizationError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; optimization: PageOptimization }>(`/api/execution-tasks/${task.id}/page-optimization/prepare`, {});
      setTaskOverrides((current) => ({ ...current, [task.id]: { ...task, ...result.task } }));
      setPageOptimizationTask({ ...task, ...result.task });
      setPageOptimizationDraft(result.optimization);
      setPageOptimizationEvidence("");
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : "The page optimization could not be prepared.");
    } finally {
      setPageOptimizationBusy(false);
    }
  };
  const savePageOptimization = async (applied: boolean) => {
    if (!pageOptimizationTask || !pageOptimizationDraft) return;
    if (applied && pageOptimizationEvidence.trim().length < 3) {
      setPageOptimizationError("Add a short implementation note before marking this task applied—for example, where the page was updated or published.");
      return;
    }
    setPageOptimizationBusy(true);
    setPageOptimizationError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; optimization: PageOptimization; applied: boolean }>(`/api/execution-tasks/${pageOptimizationTask.id}/page-optimization/save`, { optimization: pageOptimizationDraft, applied, evidenceNote: pageOptimizationEvidence });
      setTaskOverrides((current) => ({ ...current, [pageOptimizationTask.id]: { ...pageOptimizationTask, ...result.task } }));
      setInboxTasks((current) => current.map((task) => task.id === pageOptimizationTask.id ? { ...task, ...result.task } : task));
      setTaskMessage(applied ? "Page optimization marked applied and completed." : "Page optimization saved. Return anytime to review and apply it.");
      setPageOptimizationTask(null);
      setPageOptimizationDraft(null);
    } catch (error) {
      setPageOptimizationError(error instanceof Error ? error.message : "The page optimization could not be saved.");
    } finally {
      setPageOptimizationBusy(false);
    }
  };
  const prepareSeoPlan = async (task: GuidedExecutionTask) => {
    setSeoPlanBusy(true);
    setSeoPlanError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; plan: SeoPlan }>(`/api/execution-tasks/${task.id}/seo-plan/prepare`, {});
      setTaskOverrides((current) => ({ ...current, [task.id]: { ...task, ...result.task } }));
      setSeoPlanTask({ ...task, ...result.task });
      setSeoPlanDraft(result.plan);
    } catch (error) {
      setTaskMessage(error instanceof Error ? error.message : "The SEO plan could not be prepared.");
    } finally {
      setSeoPlanBusy(false);
    }
  };
  const confirmSeoPlan = async () => {
    if (!seoPlanTask || !seoPlanDraft) return;
    setSeoPlanBusy(true);
    setSeoPlanError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; tasks: GuidedExecutionTask[]; childTaskCount: number }>(`/api/execution-tasks/${seoPlanTask.id}/seo-plan/confirm`, { plan: seoPlanDraft });
      setTaskOverrides((current) => ({ ...current, [seoPlanTask.id]: { ...seoPlanTask, ...result.task } }));
      setInboxTasks(result.tasks);
      setTaskMessage(`SEO plan saved. ${result.childTaskCount} execution tasks are ready.`);
      setSeoPlanTask(null);
      setSeoPlanDraft(null);
    } catch (error) {
      setSeoPlanError(error instanceof Error ? error.message : "The SEO plan could not be saved.");
    } finally {
      setSeoPlanBusy(false);
    }
  };
  useEffect(() => { setTaskPage(1); }, [filter, taskSearch]);
  const filterOptions = [
    ["pending", "Pending", pending.length],
    ["blocked", "Blocked", blocked.length],
    ["completed", "Completed", finished.length],
    ["all", "All", tasks.length + notifications.length],
    ["setup_discovery", "Setup + Discovery", tasks.filter((task) => taskPhase(task) === "setup_discovery").length],
    ["strategy", "Strategy", tasks.filter((task) => taskPhase(task) === "strategy").length],
    ["build_publish", "Build + Publish", tasks.filter((task) => taskPhase(task) === "build_publish").length],
    ["promote_measure", "Promote + Measure", tasks.filter((task) => taskPhase(task) === "promote_measure").length],
    ["execution", "Execution", tasks.filter((task) => taskPhase(task) === "execution").length],
    ["approvals", "Approvals", tasks.filter((task) => matchesTaskFilter(task, "approvals")).length],
    ["notifications", "Notifications", notifications.length],
    ["manual", "Manual", tasks.filter((task) => matchesTaskFilter(task, "manual")).length],
  ] as const;
  const primaryFilterKeys = new Set(["pending", "setup_discovery", "strategy", "build_publish", "promote_measure", "execution"]);
  const primaryFilterOptions = filterOptions.filter(([key]) => primaryFilterKeys.has(key));
  const secondaryFilterOptions = filterOptions.filter(([key]) => !primaryFilterKeys.has(key));
  const latestStrategy = project.strategyPlans?.[0] as { status?: string } | undefined;
  const approved = latestStrategy?.status === "approved" || project.currentStep === "execution";
  const pendingOnly = Math.max(0, pending.length - blocked.length);
  const share = (count: number) => `${tasks.length ? (count / tasks.length) * 100 : 0}%`;
  const tracker = <div className="flex flex-wrap items-center gap-2" aria-label={`${finished.length} of ${tasks.length} tasks finished`}>
    <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
      <span className="bg-emerald-500" style={{ width: share(finished.length) }} />
      <span className="bg-amber-400" style={{ width: share(pendingOnly) }} />
      <span className="bg-red-500" style={{ width: share(blocked.length) }} />
    </div>
    <span className="text-xs font-bold text-charcoal-700">{tasks.length} <span className="font-medium text-charcoal-400">total</span></span>
    <span className="text-xs font-bold text-emerald-700">{finished.length} <span className="font-medium">finished</span></span>
    <span className="text-xs font-bold text-amber-700">{pending.length} <span className="font-medium">pending</span></span>
    {blocked.length > 0 && <span className="text-xs font-bold text-red-700">{blocked.length} <span className="font-medium">blocked</span></span>}
  </div>;

  return <>
    {approved
      ? <button type="button" onClick={() => { setFilter("pending"); setOpen(true); }} className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-slate-50" title={next ? `View pending tasks · Next: ${next.title}` : "View pending tasks"}>{loadingInbox ? <span className="text-xs font-semibold text-charcoal-500">Loading project actions…</span> : tracker}<span className="text-xs font-bold text-brand-700">View pending →</span></button>
      : <Link to={`/strategy?projectId=${project.id}`} className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-slate-50" title="Approve Strategy to unlock execution">{loadingInbox ? <span className="text-xs font-semibold text-charcoal-500">Loading project actions…</span> : tracker}<span className="text-xs font-bold text-brand-700">Review Strategy →</span></Link>}

    {open && <div className="fixed inset-0 z-[70] bg-slate-950/40" role="dialog" aria-modal="true" aria-label="Execution Plan" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-6 py-5">
          <div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">{project.name}</div><h2 className="mt-1 text-xl font-bold text-charcoal-950">{filter === "pending" ? "Pending tasks" : filter === "blocked" ? "Blocked tasks" : filter === "completed" ? "Completed tasks" : "Execution Plan"}</h2><p className="mt-1 text-sm text-charcoal-500">Review the work below and complete eligible tasks here.</p></div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {taskMessage && <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm font-semibold text-brand-800"><span>{taskMessage}</span><button type="button" onClick={() => setTaskMessage("")} className="shrink-0 text-brand-600" aria-label="Dismiss task message">×</button></div>}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Project action progress</div><div className="mt-1 text-lg font-black text-charcoal-950">{completionPercent}% complete</div></div><div className="flex flex-wrap gap-3 text-xs"><span className="font-bold text-charcoal-700">{tasks.length} total</span><span className="font-bold text-emerald-700">{finished.length} finished</span><span className="font-bold text-amber-700">{pending.length} pending</span>{blocked.length > 0 && <span className="font-bold text-red-700">{blocked.length} blocked</span>}</div></div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all" style={{ width: `${completionPercent}%` }} /></div>
          </div>
          {(decision || next) && filter === "all" && <div className="rounded-xl border border-brand-200 bg-brand-50 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Next Best Action</div><h3 className="mt-2 text-lg font-bold text-charcoal-950">{decision?.title || next?.title}</h3></div>{decision && <div className="shrink-0 rounded-lg bg-white px-3 py-2 text-center shadow-sm"><b className="text-lg text-brand-700">{decision.score}</b><span className="block text-[10px] font-bold uppercase text-charcoal-400">Decision score</span></div>}</div><p className="mt-2 text-sm leading-6 text-charcoal-600">{decision?.reason || next?.description}</p><p className="mt-2 text-sm font-semibold text-brand-800">Expected outcome: {decision?.expectedOutcome || next?.expectedOutcome || next?.impact || next?.description}</p>{decision?.signals?.length ? <div className="mt-3 flex flex-wrap gap-2">{decision.signals.filter((item) => item.key !== "priority").slice(0, 4).map((item) => <span key={item.key} title={item.evidence} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-charcoal-600">{item.label} +{item.contribution}</span>)}</div> : null}{nextActionTask && isSeoPlanTask(nextActionTask) ? <button type="button" disabled={seoPlanBusy} onClick={() => void prepareSeoPlan(nextActionTask)} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{seoPlanBusy ? "Building plan…" : "Create SEO Plan →"}</button> : (decision?.actionUrl || next?.relatedUrl) && <Link to={decision?.actionUrl || next!.relatedUrl!} onClick={() => setOpen(false)} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white">{decision?.actionLabel || next?.actionButtonLabel || "Open Task"} →</Link>}</div>}
          <div className="mt-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1" aria-label="Pending tasks by execution group">{primaryFilterOptions.map(([key, label, count]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`inline-flex shrink-0 items-center rounded-md px-3 py-2 text-xs font-bold transition ${filter === key ? "bg-brand-600 text-white shadow-sm" : count > 0 ? "text-charcoal-700 hover:bg-white hover:text-brand-700" : "text-charcoal-400"}`}>{label} <span className="ml-1">{count}</span></button>)}</div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-black text-charcoal-900">Actual action items</div><div className="text-xs text-charcoal-500">Showing {matchingTasks.length} task{matchingTasks.length === 1 ? "" : "s"} in this view{loadingInbox ? " · loading project sources…" : ""}</div></div><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks, pages, keywords…" className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:w-64" /></div>
          {filter === "all" && sourceSummaries.length > 0 && <div className="mt-5 space-y-3">
            {sourceSummaries.filter((summary) => ["site_analysis", "keyword_research", "domain", "site_architect"].includes(summary.key)).map((summary) => <div key={summary.key} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><div className="font-bold text-charcoal-900">{summary.label}</div><div className="mt-0.5 text-xs text-charcoal-500">Combined source activity behind the Execution Plan</div></div><Link to={summary.actionUrl} onClick={() => setOpen(false)} className="shrink-0 text-xs font-bold text-brand-700">Review all {summary.total} →</Link></div><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{summary.metrics.map((metric) => <div key={metric.label} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2"><div className="text-[9px] font-black uppercase tracking-wide text-charcoal-400">{metric.label}</div><div className="mt-0.5 text-lg font-black text-charcoal-800">{metric.value}</div></div>)}</div></div>)}
          </div>}
          {filter === "notifications" || filter === "all" ? <div className="mt-5 space-y-3">{notifications.map((notification) => <div key={notification.id} className={`rounded-xl border p-4 ${notification.readAt ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50/60"}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${notification.readAt ? "bg-slate-300" : "bg-blue-500"}`} /><div className="min-w-0 flex-1"><div className="font-bold text-charcoal-900">{notification.title}</div><p className="mt-1 text-sm leading-5 text-charcoal-500">{notification.body}</p><div className="mt-2 flex items-center gap-3 text-xs"><span className="font-semibold text-charcoal-400">{notification.type.replace(/_/g, " ")}</span>{notification.actionUrl && <Link to={notification.actionUrl} onClick={() => setOpen(false)} className="font-bold text-brand-700">Open →</Link>}</div></div></div></div>)}</div> : null}
          {filter !== "notifications" && <div className="mt-3 space-y-3">{pagedTasks.map((task) => {
            const dependencies = unresolved(task);
            const needsApproval = task.requiresApproval && !task.approvedAt;
            const completeDisabled = busyTaskId === task.id || dependencies.length > 0;
            return <div key={task.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div>{task.moduleName === "strategy_intelligence" && <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">Strategy Intelligence</div>}<div className="font-bold text-charcoal-900">{task.title}</div><p className="mt-1 text-sm leading-5 text-charcoal-500">{task.description}</p>{task.expectedOutcome && <p className="mt-2 text-xs font-semibold leading-5 text-brand-800">Expected outcome: {task.expectedOutcome}</p>}{task.manualInstructions && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">How to complete it</div><p className="mt-1 text-xs leading-5 text-charcoal-600">{task.manualInstructions}</p></div>}</div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${task.priority === "critical" ? "bg-red-100 text-red-700" : task.priority === "high" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-charcoal-600"}`}>{task.priority}</span></div><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-50 px-2 py-1 font-semibold">{task.status.replace(/_/g, " ")}</span><span className="rounded-full bg-slate-50 px-2 py-1 font-semibold">{automationLabel(task.automationLevel)}</span>{task.requiresApproval && <span className="rounded-full bg-violet-50 px-2 py-1 font-semibold text-violet-700">Approval required</span>}{dependencies.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">Blocked by {dependencies.length}</span>}</div>{!closedStatuses.has(task.status) && <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">{task.relatedUrl && !isRankingPlanTask(task) && !isPageOptimizationTask(task) && !isSeoPlanTask(task) && <Link to={task.relatedUrl} onClick={() => setOpen(false)} className="inline-flex items-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50">View details</Link>}{needsApproval ? <Link to={`/approvals?projectId=${project.id}`} onClick={() => setOpen(false)} className="inline-flex items-center rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700">Review approval</Link> : isSeoPlanTask(task) ? <button type="button" disabled={seoPlanBusy || dependencies.length > 0} onClick={() => void prepareSeoPlan(task)} className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">{seoPlanBusy && seoPlanTask?.id === task.id ? "Building plan…" : task.status === "in_progress" ? "Review SEO Plan" : "Create SEO Plan"}</button> : isRankingPlanTask(task) ? <button type="button" disabled={rankingPlanBusy || dependencies.length > 0} onClick={() => void prepareRankingPlan(task)} className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">{rankingPlanBusy && rankingPlanTask?.id === task.id ? "Building plan…" : task.status === "in_progress" ? "Review Ranking Plan" : "Build Ranking Plan"}</button> : isPageOptimizationTask(task) ? <button type="button" disabled={pageOptimizationBusy || dependencies.length > 0} onClick={() => void preparePageOptimization(task)} className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">{task.status === "in_progress" ? "Review & Apply" : "Prepare Page Optimization"}</button> : <button type="button" disabled={completeDisabled} onClick={() => void completeTask(task)} title={dependencies.length ? `Complete first: ${dependencies.map((item) => item.requiredTask.title).join(", ")}` : "Mark this task complete"} className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">{busyTaskId === task.id ? "Completing…" : dependencies.length ? "Dependency required" : "Mark complete"}</button>}</div>}{closedStatuses.has(task.status) && isSeoPlanTask(task) && savedSeoPlan(task) && <div className="mt-4 flex justify-end border-t border-slate-100 pt-3"><button type="button" onClick={() => { setSeoPlanTask(task); setSeoPlanDraft(savedSeoPlan(task)); setSeoPlanError(""); }} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50">View SEO Plan</button></div>}{closedStatuses.has(task.status) && isRankingPlanTask(task) && savedRankingPlan(task) && <div className="mt-4 flex justify-end border-t border-slate-100 pt-3"><button type="button" onClick={() => { setRankingPlanTask(task); setRankingPlanDraft(savedRankingPlan(task)); setRankingPlanError(""); }} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50">View Ranking Plan</button></div>}{closedStatuses.has(task.status) && isPageOptimizationTask(task) && savedPageOptimization(task) && <div className="mt-4 flex justify-end border-t border-slate-100 pt-3"><button type="button" onClick={() => { setPageOptimizationTask(task); setPageOptimizationDraft(savedPageOptimization(task)); setPageOptimizationError(""); }} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50">View Page Optimization</button></div>}</div>;
          })}{matchingTasks.length === 0 && <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50 px-5 py-8 text-center"><div className="font-bold text-emerald-800">No tasks in this view</div><p className="mt-1 text-sm text-emerald-700">Try another group or clear the task search.</p></div>}{matchingTasks.length > taskPageSize && <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><button type="button" disabled={effectiveTaskPage <= 1} onClick={() => setTaskPage((page) => Math.max(1, page - 1))} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-charcoal-700 disabled:opacity-40">Previous</button><span className="text-xs font-bold text-charcoal-500">Page {effectiveTaskPage} of {taskPageCount}</span><button type="button" disabled={effectiveTaskPage >= taskPageCount} onClick={() => setTaskPage((page) => Math.min(taskPageCount, page + 1))} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-charcoal-700 disabled:opacity-40">Next</button></div>}</div>}
          <details className="mt-5 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-xs font-bold text-charcoal-500 hover:text-brand-700">More task views</summary><div className="mt-3 flex flex-wrap gap-2">{secondaryFilterOptions.map(([key, label, count]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold ${filter === key ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-charcoal-600"}`}>{label} <span className="ml-1">{count}</span></button>)}</div></details>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4"><Link to={`/guided-projects/${project.id}?tab=execution#execution-tasks`} onClick={() => setOpen(false)} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white">Open Full Execution Workspace</Link></div>
      </aside>
    </div>}
    {seoPlanTask && seoPlanDraft && <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Create SEO plan">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Project-wide guided plan</div><h2 className="mt-1 text-xl font-black text-charcoal-950">Create SEO Plan</h2><p className="mt-1 text-sm text-charcoal-500">Built from intake, approved keywords, Strategy, target markets, and the latest crawl evidence.</p></div><button type="button" onClick={() => { setSeoPlanTask(null); setSeoPlanDraft(null); setSeoPlanError(""); }} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button></div>
        <fieldset disabled={seoPlanReadOnly} className="flex-1 overflow-y-auto p-5 disabled:opacity-90">
          {seoPlanError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{seoPlanError}</div>}
          <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
            <div className="space-y-4">
              <label className="block text-xs font-bold text-charcoal-600">Executive SEO direction<textarea value={seoPlanDraft.summary} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, summary: event.target.value })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-bold text-charcoal-600">Business objectives · one per line<textarea value={seoPlanDraft.objectives.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, objectives: lines(event.target.value) })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label><label className="block text-xs font-bold text-charcoal-600">Priority keywords · one per line<textarea value={seoPlanDraft.keywordPriorities.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, keywordPriorities: lines(event.target.value) })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label></div>
              <label className="block text-xs font-bold text-charcoal-600">Technical SEO priorities<textarea value={seoPlanDraft.technicalPriorities.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, technicalPriorities: lines(event.target.value) })} rows={6} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label>
              <label className="block text-xs font-bold text-charcoal-600">Content and page roadmap<textarea value={seoPlanDraft.contentRoadmap.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, contentRoadmap: lines(event.target.value) })} rows={7} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4"><div className="text-xs font-black uppercase tracking-wide text-brand-700">90-day execution order</div><div className="mt-3 space-y-3"><label className="block text-xs font-bold text-charcoal-600">Now · highest priority<textarea value={seoPlanDraft.phases.now.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, phases: { ...seoPlanDraft.phases, now: lines(event.target.value) } })} rows={4} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm leading-5" /></label><label className="block text-xs font-bold text-charcoal-600">Next<textarea value={seoPlanDraft.phases.next.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, phases: { ...seoPlanDraft.phases, next: lines(event.target.value) } })} rows={4} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm leading-5" /></label><label className="block text-xs font-bold text-charcoal-600">Later<textarea value={seoPlanDraft.phases.later.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, phases: { ...seoPlanDraft.phases, later: lines(event.target.value) } })} rows={4} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm leading-5" /></label></div></div>
              <label className="block text-xs font-bold text-charcoal-600">Local SEO actions<textarea value={seoPlanDraft.localSeoActions.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, localSeoActions: lines(event.target.value) })} rows={4} placeholder="Not applicable when the project has no local-market requirement." className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-5" /></label>
              <label className="block text-xs font-bold text-charcoal-600">Authority and AI visibility<textarea value={seoPlanDraft.authorityActions.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, authorityActions: lines(event.target.value) })} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-5" /></label>
              <label className="block text-xs font-bold text-charcoal-600">Success metrics<textarea value={seoPlanDraft.kpis.join("\n")} onChange={(event) => setSeoPlanDraft({ ...seoPlanDraft, kpis: lines(event.target.value) })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-5" /></label>
            </div>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4"><p className="max-w-2xl text-xs text-charcoal-500">{seoPlanReadOnly ? "This confirmed plan remains available from Completed tasks. Its execution items are tracked in the Action Inbox." : "Review and edit the plan. Saving confirms it and creates five deduplicated execution tasks for technical SEO, keyword mapping, content, authority, and measurement."}</p><div className="flex gap-2"><button type="button" onClick={() => { setSeoPlanTask(null); setSeoPlanDraft(null); }} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">{seoPlanReadOnly ? "Close" : "Cancel"}</button>{!seoPlanReadOnly && <button type="button" disabled={seoPlanBusy} onClick={() => void confirmSeoPlan()} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">{seoPlanBusy ? "Creating tasks…" : "Save SEO Plan & Create Tasks"}</button>}</div></div>
      </div>
    </div>}
    {rankingPlanTask && rankingPlanDraft && <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Build ranking plan">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-5 py-4"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">SEnuke guided execution</div><h2 className="mt-1 text-xl font-black text-charcoal-950">Build Ranking Plan</h2><p className="mt-1 text-sm text-charcoal-500">Review the evidence and plan before SEnuke creates the actionable child tasks.</p></div><button type="button" onClick={() => { setRankingPlanTask(null); setRankingPlanDraft(null); setRankingPlanError(""); }} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button></div>
        <div className="grid flex-1 overflow-y-auto lg:grid-cols-[1fr_280px]">
          <fieldset disabled={rankingPlanReadOnly} className="space-y-5 p-5 disabled:opacity-90">
            {rankingPlanError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{rankingPlanError}</div>}
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-charcoal-600">Target keyword<input value={rankingPlanDraft.keyword} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, keyword: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-medium outline-none focus:border-brand-400" /></label><label className="text-xs font-bold text-charcoal-600">Search intent<select value={rankingPlanDraft.intent} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, intent: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-brand-400"><option>Commercial investigation</option><option>Transactional</option><option>Informational research</option><option>Local commercial</option></select></label></div>
            <div><div className="text-xs font-bold text-charcoal-600">Target-page decision</div><div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setRankingPlanDraft({ ...rankingPlanDraft, targetMode: "optimize_existing" })} className={`rounded-lg border p-3 text-left ${rankingPlanDraft.targetMode === "optimize_existing" ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200"}`}><b className="text-sm">Optimize an existing page</b><span className="mt-1 block text-xs">Use when a suitable page already targets this intent.</span></button><button type="button" onClick={() => setRankingPlanDraft({ ...rankingPlanDraft, targetMode: "create_new", targetUrl: null })} className={`rounded-lg border p-3 text-left ${rankingPlanDraft.targetMode === "create_new" ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200"}`}><b className="text-sm">Create a new page</b><span className="mt-1 block text-xs">Use when the site has no strong page for this keyword.</span></button></div></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-charcoal-600">Recommended page title<input value={rankingPlanDraft.pageTitle} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, pageTitle: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-medium outline-none focus:border-brand-400" /></label><label className="text-xs font-bold text-charcoal-600">Target URL<input value={rankingPlanDraft.targetUrl ?? ""} disabled={rankingPlanDraft.targetMode === "create_new"} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, targetUrl: event.target.value || null })} placeholder={rankingPlanDraft.targetMode === "create_new" ? "A new URL will be planned" : "https://example.com/page"} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-medium outline-none focus:border-brand-400 disabled:bg-slate-100" /></label></div>
            <label className="block text-xs font-bold text-charcoal-600">Recommended keyword variants<textarea value={rankingPlanDraft.recommendedKeywordVariants.join("\n")} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, recommendedKeywordVariants: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label>
            <label className="block text-xs font-bold text-charcoal-600">Page sections and content requirements<textarea value={rankingPlanDraft.contentSections.join("\n")} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, contentSections: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} rows={6} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-bold text-charcoal-600">Internal-link actions<textarea value={rankingPlanDraft.internalLinkActions.join("\n")} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, internalLinkActions: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label><label className="block text-xs font-bold text-charcoal-600">Success metrics<textarea value={rankingPlanDraft.successMetrics.join("\n")} onChange={(event) => setRankingPlanDraft({ ...rankingPlanDraft, successMetrics: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label></div>
          </fieldset>
          <aside className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Evidence used</div><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[10px] font-bold uppercase text-charcoal-400">Volume</div><div className="mt-1 text-lg font-black">{rankingPlanDraft.evidence.searchVolume ?? "Pending"}</div></div><div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[10px] font-bold uppercase text-charcoal-400">Current rank</div><div className="mt-1 text-lg font-black">{rankingPlanDraft.evidence.currentRank ? `#${rankingPlanDraft.evidence.currentRank}` : "Not found"}</div></div></div><div className="mt-4 text-xs font-bold text-charcoal-600">Location</div><div className="mt-1 text-sm text-charcoal-800">{rankingPlanDraft.evidence.location}</div><div className="mt-4 text-xs font-bold text-charcoal-600">Target markets</div><div className="mt-2 flex flex-wrap gap-1.5">{rankingPlanDraft.evidence.targetMarkets.length ? rankingPlanDraft.evidence.targetMarkets.map((market) => <span key={market} className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-charcoal-600 shadow-sm">{market}</span>) : <span className="text-xs text-charcoal-400">Not provided</span>}</div><div className="mt-4 text-xs font-bold text-charcoal-600">SERP competitors</div><div className="mt-2 space-y-1.5">{rankingPlanDraft.evidence.competitors.length ? rankingPlanDraft.evidence.competitors.map((domain) => <div key={domain} className="truncate rounded-md bg-white px-2 py-1.5 text-xs font-semibold text-charcoal-600 shadow-sm">{domain}</div>) : <div className="text-xs text-charcoal-400">Competitor evidence is not available yet.</div>}</div></aside>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4"><p className="text-xs text-charcoal-500">{rankingPlanReadOnly ? "This saved plan remains available from Completed tasks. Its follow-up tasks are tracked separately in the Action Inbox." : "Saving completes the planning task and creates four trackable execution tasks."}</p><div className="flex gap-2"><button type="button" onClick={() => { setRankingPlanTask(null); setRankingPlanDraft(null); }} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">{rankingPlanReadOnly ? "Close" : "Cancel"}</button>{!rankingPlanReadOnly && <button type="button" disabled={rankingPlanBusy} onClick={() => void confirmRankingPlan()} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">{rankingPlanBusy ? "Creating tasks…" : "Save Plan & Create Tasks"}</button>}</div></div>
      </div>
    </div>}
    {pageOptimizationTask && pageOptimizationDraft && <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Prepare page optimization">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-5 py-4"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">SEnuke guided execution</div><h2 className="mt-1 text-xl font-black text-charcoal-950">Optimize the target page</h2><p className="mt-1 text-sm text-charcoal-500">Review the current evidence, edit the proposed changes, then save or confirm that they were applied.</p></div><button type="button" onClick={() => { setPageOptimizationTask(null); setPageOptimizationDraft(null); setPageOptimizationError(""); }} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button></div>
        <div className="flex-1 overflow-y-auto p-5">
          {pageOptimizationError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{pageOptimizationError}</div>}
          <div className="mb-4 flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-800">{pageOptimizationDraft.keyword}</span><span className="truncate text-xs font-semibold text-charcoal-500">{pageOptimizationDraft.targetUrl || "New page planned"}</span></div>
          <fieldset disabled={pageOptimizationReadOnly} className="space-y-5">
            <div className="grid gap-3 lg:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Current page evidence</div><dl className="mt-3 space-y-3 text-sm"><div><dt className="text-xs font-bold text-charcoal-400">Title</dt><dd className="mt-1 text-charcoal-700">{pageOptimizationDraft.current.title || "Not detected"}</dd></div><div><dt className="text-xs font-bold text-charcoal-400">Meta description</dt><dd className="mt-1 text-charcoal-700">{pageOptimizationDraft.current.metaDescription || "Not detected"}</dd></div><div><dt className="text-xs font-bold text-charcoal-400">H1</dt><dd className="mt-1 text-charcoal-700">{pageOptimizationDraft.current.h1 || "Not detected"}</dd></div><div><dt className="text-xs font-bold text-charcoal-400">Word count</dt><dd className="mt-1 font-bold text-charcoal-700">{pageOptimizationDraft.current.wordCount ?? "Not detected"}</dd></div></dl></div><div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4"><div className="text-xs font-black uppercase tracking-wide text-brand-700">Proposed optimization</div><div className="mt-3 space-y-3"><label className="block text-xs font-bold text-charcoal-600">SEO title<input value={pageOptimizationDraft.proposed.title} onChange={(event) => setPageOptimizationDraft({ ...pageOptimizationDraft, proposed: { ...pageOptimizationDraft.proposed, title: event.target.value } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label><label className="block text-xs font-bold text-charcoal-600">Meta description<textarea value={pageOptimizationDraft.proposed.metaDescription} onChange={(event) => setPageOptimizationDraft({ ...pageOptimizationDraft, proposed: { ...pageOptimizationDraft.proposed, metaDescription: event.target.value } })} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label><label className="block text-xs font-bold text-charcoal-600">Primary heading<input value={pageOptimizationDraft.proposed.h1} onChange={(event) => setPageOptimizationDraft({ ...pageOptimizationDraft, proposed: { ...pageOptimizationDraft.proposed, h1: event.target.value } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label><label className="block text-xs font-bold text-charcoal-600">Call to action<textarea value={pageOptimizationDraft.proposed.callToAction} onChange={(event) => setPageOptimizationDraft({ ...pageOptimizationDraft, proposed: { ...pageOptimizationDraft.proposed, callToAction: event.target.value } })} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label></div></div></div>
            <div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Recommended page sections</div><div className="mt-2 space-y-2">{pageOptimizationDraft.sections.map((section, index) => <div key={`${section.heading}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[220px_1fr]"><input value={section.heading} onChange={(event) => setPageOptimizationDraft({ ...pageOptimizationDraft, sections: pageOptimizationDraft.sections.map((item, itemIndex) => itemIndex === index ? { ...item, heading: event.target.value } : item) })} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-bold" /><textarea value={section.guidance} onChange={(event) => setPageOptimizationDraft({ ...pageOptimizationDraft, sections: pageOptimizationDraft.sections.map((item, itemIndex) => itemIndex === index ? { ...item, guidance: event.target.value } : item) })} rows={2} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" /></div>)}</div></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Internal links</div><ul className="mt-2 space-y-2">{pageOptimizationDraft.internalLinkActions.map((action) => <li key={action} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-charcoal-700">{action}</li>)}</ul></div><div><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Implementation checklist</div><ul className="mt-2 space-y-2">{pageOptimizationDraft.implementationChecklist.map((item) => <li key={item} className="flex gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-charcoal-700"><span className="text-brand-600">○</span><span>{item}</span></li>)}</ul></div></div>
          </fieldset>
          {!pageOptimizationReadOnly && <label className="mt-5 block text-xs font-bold text-charcoal-600">Implementation evidence or note <span className="text-red-600">· Required to complete</span><textarea value={pageOptimizationEvidence} onChange={(event) => { setPageOptimizationEvidence(event.target.value); if (pageOptimizationError) setPageOptimizationError(""); }} placeholder="Example: Applied to the WordPress service page and verified on mobile." rows={3} className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand-400 ${pageOptimizationError && pageOptimizationEvidence.trim().length < 3 ? "border-red-300 bg-red-50" : "border-slate-200"}`} />{pageOptimizationError && pageOptimizationEvidence.trim().length < 3 && <span className="mt-1 block font-semibold text-red-600">Add a short note confirming where the optimization was applied.</span>}<span className="mt-1 block font-medium text-charcoal-400">You can save the optimization without this note. A note is required only when confirming that the live or draft page was actually updated.</span></label>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4"><p className="text-xs text-charcoal-500">{pageOptimizationReadOnly ? "This applied optimization remains available from Completed tasks." : "Save the package for later, or add evidence and mark it applied after the page has actually been updated."}</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setPageOptimizationTask(null); setPageOptimizationDraft(null); }} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">{pageOptimizationReadOnly ? "Close" : "Cancel"}</button>{!pageOptimizationReadOnly && <><button type="button" disabled={pageOptimizationBusy} onClick={() => void savePageOptimization(false)} className="rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 disabled:opacity-50">Save for Later</button><button type="button" disabled={pageOptimizationBusy} onClick={() => void savePageOptimization(true)} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">{pageOptimizationBusy ? "Saving…" : "Mark Applied & Complete"}</button></>}</div></div>
      </div>
    </div>}
  </>;
}
