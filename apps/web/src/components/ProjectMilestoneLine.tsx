import { Link } from "react-router-dom";
import type { GuidedProject } from "../types.js";

const done = new Set(["completed", "published", "skipped"]);

const stateFor = (project: GuidedProject, index: number) => {
  const step = project.workflowSteps?.[index];
  if (!step) return "pending";
  if (step.status === "skipped") return "skipped";
  if (["completed", "published"].includes(step.status)) return "completed";
  if (["submitted_for_approval", "needs_review", "changes_requested"].includes(step.status)) return "review";
  if (step.status === "blocked") return "blocked";
  return index === (project.workflowSteps ?? []).findIndex((item) => !done.has(item.status)) ? "current" : "pending";
};

const hrefFor = (project: GuidedProject, url: string | null, stepKey?: string) => {
  const routeByStep: Record<string, string> = { opportunities: "/opportunities", keyword_analysis: "/keywords", site_analysis: "/site-analysis", strategy: "/strategy", strategy_approval: "/strategy", execution_plan: `/guided-projects/${project.id}?tab=execution#execution-tasks` };
  const base = stepKey && routeByStep[stepKey] ? routeByStep[stepKey] : url || `/guided-projects/${project.id}`;
  return base.startsWith(`/guided-projects/${project.id}`) ? base : `${base}${base.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(project.id)}`;
};

type NextAction = { title: string; detail?: string; label: string; to?: string; onAction?: () => void };

export default function ProjectMilestoneLine({ project, showDependency = false, nextAction }: { project: GuidedProject; showDependency?: boolean; nextAction?: NextAction | null }) {
  const steps = project.workflowSteps ?? [];
  if (!steps.length) return null;
  const activeIndex = steps.findIndex((_, index) => ["current", "review", "blocked"].includes(stateFor(project, index)));
  const currentIndex = activeIndex < 0 ? steps.length - 1 : activeIndex;
  const inset = `${50 / steps.length}%`;
  const markerLeft = `${((currentIndex + 0.5) / steps.length) * 100}%`;
  const achieved = steps.filter((step) => ["completed", "published"].includes(step.status)).length;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3"><div className="text-sm font-bold text-slate-900">Project Milestone</div><div className="text-[11px] text-slate-400">{achieved} achieved · {steps.length} total</div></div>
      <div className="relative pb-14 pt-1">
        <div className="absolute top-3.5 h-0.5 bg-slate-200" style={{ left: inset, right: inset }}><div className="h-full bg-emerald-400" style={{ width: `${steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 100}%` }} /></div>
        <div className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((step, index) => {
            const state = stateFor(project, index);
            const badge = state === "completed" ? "✓" : state === "skipped" ? "–" : state === "current" ? "●" : state === "review" ? "!" : state === "blocked" ? "×" : index + 1;
            const tone = state === "completed" ? "bg-emerald-500 text-white" : state === "skipped" ? "bg-slate-300 text-slate-700" : state === "current" ? "bg-teal-500 text-white ring-4 ring-teal-100" : state === "review" ? "bg-amber-500 text-white" : state === "blocked" ? "bg-rose-500 text-white" : "border-2 border-slate-300 bg-white text-slate-400";
            return <Link key={step.id} to={hrefFor(project, step.actionUrl, step.stepKey)} className="group flex min-w-0 flex-col items-center text-center"><span className={`relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-black shadow-[0_0_0_3px_white] group-hover:scale-110 ${tone}`}>{badge}</span><span className="mt-2 max-w-[104px] text-[10px] font-bold leading-3.5 text-slate-600 group-hover:text-teal-700 group-hover:underline">{step.title}</span><span className="mt-0.5 text-[8px] font-bold uppercase text-slate-400">{state === "completed" ? "Achieved" : state}</span></Link>;
          })}
        </div>
        {project.status !== "completed" && project.status !== "archived" && <div className="pointer-events-none absolute bottom-0 z-10 -translate-x-1/2 text-center" style={{ left: markerLeft }} aria-hidden="true"><span className="mx-auto block h-0 w-0 border-x-[7px] border-b-[9px] border-x-transparent border-b-teal-600 motion-safe:animate-pulse" /><span className="inline-flex max-w-44 items-center rounded-full bg-teal-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-lg"><span className="truncate">↑ Current task</span></span></div>}
      </div>
      {nextAction && <div className="mt-4 flex flex-col gap-2 rounded-lg bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 text-xs text-slate-600"><b className="text-slate-900">Next: {nextAction.title}</b>{nextAction.detail && <span className="ml-1">· {nextAction.detail}</span>}</div>{nextAction.onAction ? <button type="button" onClick={nextAction.onAction} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white">{nextAction.label} →</button> : nextAction.to ? <Link to={nextAction.to} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white">{nextAction.label} →</Link> : null}</div>}
    </div>
  );
}
