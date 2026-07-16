import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GuidedExecutionTask, GuidedProject, ProjectNotification } from "../types.js";
import { api } from "../api.js";

type NextBestAction = { taskId: string; title: string; reason: string; expectedOutcome: string; priority: string; score: number; confidence: number; signals: { key: string; label: string; contribution: number; evidence: string }[]; actionUrl: string | null; actionLabel: string; actionable: boolean; requiresApproval: boolean };

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

function taskCategory(task: GuidedExecutionTask) {
  const moduleName = task.moduleName.toLowerCase();
  if (moduleName.includes("crawl")) return "crawl";
  if (moduleName.includes("keyword")) return "keywords";
  if (moduleName.includes("site_analysis") || moduleName.includes("technical_seo")) return "site_analysis";
  if (moduleName.includes("strategy_intelligence")) return "intelligence";
  if (moduleName.includes("strategy") || moduleName.includes("opportunity")) return "strategy";
  if (task.sourceType === "user" || ["manual_guided", "manual_task"].includes(task.automationLevel)) return "manual";
  return "other";
}

function matchesTaskFilter(task: GuidedExecutionTask, filter: string) {
  if (filter === "approvals") return task.requiresApproval || ["submitted_for_approval", "awaiting_confirmation", "changes_requested"].includes(task.status);
  return taskCategory(task) === filter;
}

export default function ProjectExecutionBar({ project, tasks: suppliedTasks, notifications = [] }: { project: GuidedProject; tasks?: GuidedExecutionTask[]; notifications?: ProjectNotification[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [decision, setDecision] = useState<NextBestAction | null>(null);
  const planTasks = project.executionPlans?.flatMap((plan) => plan.tasks ?? []) ?? [];
  const tasks = Array.from(new Map((suppliedTasks ?? planTasks).map((task) => [task.id, task])).values());
  const finished = tasks.filter((task) => finishedStatuses.has(task.status));
  const pending = tasks.filter((task) => !closedStatuses.has(task.status));
  const blocked = pending.filter((task) => task.status === "blocked" || unresolved(task).length > 0);
  const ordered = [...pending].sort((a, b) => (blocked.includes(a) ? 1 : 0) - (blocked.includes(b) ? 1 : 0) || (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const next = ordered[0];
  const taskStatusKey = tasks.map((task) => `${task.id}:${task.status}:${task.priority}:${(task.dependencies ?? []).map((item) => item.requiredTask.status).join(",")}`).join("|");
  useEffect(() => {
    let active = true;
    api.get<{ nextBestAction: NextBestAction | null }>(`/api/projects/${project.id}/next-best-action`).then((result) => { if (active) setDecision(result.nextBestAction); }).catch(() => { if (active) setDecision(null); });
    return () => { active = false; };
  }, [project.id, taskStatusKey]);
  const allOrdered = [...tasks].sort((a, b) => Number(closedStatuses.has(a.status)) - Number(closedStatuses.has(b.status)) || (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const visibleTasks = filter === "all" ? allOrdered : filter === "completed" ? allOrdered.filter((task) => closedStatuses.has(task.status)) : allOrdered.filter((task) => matchesTaskFilter(task, filter));
  const filterOptions = [
    ["all", "All", tasks.length + notifications.length],
    ["crawl", "Crawl", tasks.filter((task) => taskCategory(task) === "crawl").length],
    ["keywords", "Keywords", tasks.filter((task) => taskCategory(task) === "keywords").length],
    ["site_analysis", "Site Analysis", tasks.filter((task) => taskCategory(task) === "site_analysis").length],
    ["strategy", "Strategy", tasks.filter((task) => taskCategory(task) === "strategy").length],
    ["intelligence", "Intelligence", tasks.filter((task) => taskCategory(task) === "intelligence").length],
    ["approvals", "Approvals", tasks.filter((task) => matchesTaskFilter(task, "approvals")).length],
    ["notifications", "Notifications", notifications.length],
    ["manual", "Manual", tasks.filter((task) => taskCategory(task) === "manual").length],
    ["completed", "Completed", finished.length],
  ] as const;
  const latestStrategy = project.strategyPlans?.[0];
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
      ? <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-slate-50" title={next ? `Next: ${next.title}` : "Open Execution Plan"}>{tracker}<span className="text-xs font-bold text-brand-700">Tasks →</span></button>
      : <Link to={`/strategy?projectId=${project.id}`} className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-slate-50" title="Approve Strategy to unlock execution">{tracker}<span className="text-xs font-bold text-brand-700">Review Strategy →</span></Link>}

    {open && <div className="fixed inset-0 z-[70] bg-slate-950/40" role="dialog" aria-modal="true" aria-label="Execution Plan" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-6 py-5">
          <div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">{project.name}</div><h2 className="mt-1 text-xl font-bold text-charcoal-950">Execution Plan</h2><p className="mt-1 text-sm text-charcoal-500">{pending.length} pending · {finished.length} finished · {blocked.length} blocked</p></div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {(decision || next) && filter === "all" && <div className="rounded-xl border border-brand-200 bg-brand-50 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Next Best Action</div><h3 className="mt-2 text-lg font-bold text-charcoal-950">{decision?.title || next?.title}</h3></div>{decision && <div className="shrink-0 rounded-lg bg-white px-3 py-2 text-center shadow-sm"><b className="text-lg text-brand-700">{decision.score}</b><span className="block text-[10px] font-bold uppercase text-charcoal-400">Decision score</span></div>}</div><p className="mt-2 text-sm leading-6 text-charcoal-600">{decision?.reason || next?.description}</p><p className="mt-2 text-sm font-semibold text-brand-800">Expected outcome: {decision?.expectedOutcome || next?.expectedOutcome || next?.impact || next?.description}</p>{decision?.signals?.length ? <div className="mt-3 flex flex-wrap gap-2">{decision.signals.filter((item) => item.key !== "priority").slice(0, 4).map((item) => <span key={item.key} title={item.evidence} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-charcoal-600">{item.label} +{item.contribution}</span>)}</div> : null}{(decision?.actionUrl || next?.relatedUrl) && <Link to={decision?.actionUrl || next!.relatedUrl!} onClick={() => setOpen(false)} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white">{decision?.actionLabel || next?.actionButtonLabel || "Open Task"} →</Link>}</div>}
          <div className="mt-4 flex flex-wrap gap-2">{filterOptions.map(([key, label, count]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${filter === key ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-charcoal-600 hover:border-brand-300 hover:text-brand-700"}`}>{label} <span className={filter === key ? "text-brand-100" : "text-charcoal-400"}>{count}</span></button>)}</div>
          {filter === "notifications" || filter === "all" ? <div className="mt-5 space-y-3">{notifications.map((notification) => <div key={notification.id} className={`rounded-xl border p-4 ${notification.readAt ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50/60"}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${notification.readAt ? "bg-slate-300" : "bg-blue-500"}`} /><div className="min-w-0 flex-1"><div className="font-bold text-charcoal-900">{notification.title}</div><p className="mt-1 text-sm leading-5 text-charcoal-500">{notification.body}</p><div className="mt-2 flex items-center gap-3 text-xs"><span className="font-semibold text-charcoal-400">{notification.type.replace(/_/g, " ")}</span>{notification.actionUrl && <Link to={notification.actionUrl} onClick={() => setOpen(false)} className="font-bold text-brand-700">Open →</Link>}</div></div></div></div>)}</div> : null}
          {filter !== "notifications" && <div className="mt-5 space-y-3">{visibleTasks.map((task) => <div key={task.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div>{task.moduleName === "strategy_intelligence" && <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">Strategy Intelligence</div>}<div className="font-bold text-charcoal-900">{task.title}</div><p className="mt-1 text-sm leading-5 text-charcoal-500">{task.description}</p>{task.expectedOutcome && <p className="mt-2 text-xs font-semibold leading-5 text-brand-800">Expected outcome: {task.expectedOutcome}</p>}{task.manualInstructions && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-charcoal-600">{task.manualInstructions}</p>}</div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${task.priority === "critical" ? "bg-red-100 text-red-700" : task.priority === "high" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-charcoal-600"}`}>{task.priority}</span></div><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-50 px-2 py-1 font-semibold">{task.status.replace(/_/g, " ")}</span><span className="rounded-full bg-slate-50 px-2 py-1 font-semibold">{automationLabel(task.automationLevel)}</span>{task.requiresApproval && <span className="rounded-full bg-violet-50 px-2 py-1 font-semibold text-violet-700">Approval required</span>}{unresolved(task).length > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">Blocked by {unresolved(task).length}</span>}{task.relatedUrl && <Link to={task.relatedUrl} onClick={() => setOpen(false)} className="ml-auto font-bold text-brand-700">Open →</Link>}</div></div>)}</div>}
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4"><Link to={`/guided-projects/${project.id}?tab=execution#execution-tasks`} onClick={() => setOpen(false)} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white">Open Full Execution Workspace</Link></div>
      </aside>
    </div>}
  </>;
}
