import { Link } from "react-router-dom";
import type { ProjectWorkflowController } from "../types.js";

type Props = { workflow: ProjectWorkflowController; compact?: boolean; onAction?: () => void; actionHref?: string; actionBusy?: boolean; className?: string };

function statusLabel(workflow: ProjectWorkflowController) {
  if (workflow.blockers.length) return `${workflow.blockers.length} blocker${workflow.blockers.length === 1 ? "" : "s"}`;
  if (workflow.nextBestAction.action.type === "approve") return "Review required";
  if (workflow.nextBestAction.action.type === "generate") return "Ready to generate";
  return workflow.stateLabel;
}

function compactStageState(stage: ProjectWorkflowController["stages"][number], currentUrl: string) {
  if (["complete", "approved", "not_required", "not_applicable"].includes(stage.status)) return "complete";
  if (stage.action?.url === currentUrl || stage.status === "in_progress") return "current";
  if (stage.status === "ready" || stage.status === "needs_attention") return "review";
  return "upcoming";
}

export default function MasterWorkflowStatus({ workflow, compact = false, onAction, actionHref, actionBusy = false, className = "" }: Props) {
  const next = workflow.nextBestAction;
  const tone = workflow.blockers.length ? "amber" : next.action.type === "approve" ? "violet" : "cyan";
  const shell = tone === "amber" ? "border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50" : tone === "violet" ? "border-violet-200 bg-gradient-to-r from-violet-50 via-white to-brand-50" : "border-cyan-200 bg-gradient-to-r from-cyan-50 via-white to-emerald-50";
  const button = tone === "amber" ? "bg-amber-700 hover:bg-amber-800" : tone === "violet" ? "bg-violet-700 hover:bg-violet-800" : "bg-cyan-700 hover:bg-cyan-800";
  return <section className={`rounded-xl border p-4 ${shell} ${className}`} aria-label="Master Workflow status">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Master Workflow</span><span className="rounded-full border border-white bg-white/80 px-2 py-0.5 text-[10px] font-black text-slate-700">{statusLabel(workflow)}</span><span className="text-[10px] font-black text-slate-500">{workflow.overallProgressPercent}% complete · {workflow.readinessPercent}% ready</span></div>
        <h3 className="mt-1 text-base font-black text-slate-950">{next.title}</h3>
        <p className={`mt-1 text-xs leading-5 text-slate-600 ${compact ? "line-clamp-2" : ""}`}>{next.reason}</p>
        {!compact && <p className="mt-1 text-xs font-semibold text-slate-700"><b>Expected result:</b> {next.expectedResult}</p>}
      </div>
      {onAction ? <button type="button" onClick={onAction} disabled={actionBusy} className={`inline-flex shrink-0 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-400 ${button}`}>{actionBusy ? "Working…" : `${next.action.label} →`}</button> : <Link to={actionHref??next.action.url} className={`inline-flex shrink-0 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-black text-white ${button}`}>{next.action.label} →</Link>}
    </div>
    {compact && <div className="mt-4 overflow-x-auto border-t border-white/80 pt-3" aria-label="Project workflow steps">
      <div className="relative flex min-w-max gap-0 pb-1">
        {workflow.stages.map((stage, index) => {
          const state = compactStageState(stage, next.action.url);
          const href = stage.action?.url;
          const content = <>
            <span className={`relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-black shadow-[0_0_0_3px_white] ${state === "complete" ? "bg-emerald-500 text-white" : state === "current" ? "bg-cyan-600 text-white ring-4 ring-cyan-100" : state === "review" ? "bg-amber-500 text-white" : "border-2 border-slate-300 bg-white text-slate-400"}`}>{state === "complete" ? "✓" : state === "current" ? "●" : state === "review" ? "!" : index + 1}</span>
            <span className={`mt-2 w-24 text-center text-[10px] font-bold leading-3.5 ${state === "complete" ? "text-emerald-700" : state === "current" ? "text-cyan-800" : state === "review" ? "text-amber-800" : "text-slate-500"}`}>{stage.label}</span>
            <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-400">{state === "complete" ? "Achieved" : state === "current" ? "Current" : state === "review" ? "Review" : "Upcoming"}</span>
          </>;
          const className = `relative flex w-28 shrink-0 flex-col items-center px-2 text-center outline-none ${href ? "hover:underline focus-visible:ring-2 focus-visible:ring-cyan-400" : ""}`;
          return <div key={stage.key} className="relative flex w-28 shrink-0 justify-center before:absolute before:left-0 before:right-0 before:top-3 before:h-0.5 before:bg-slate-200 first:before:left-1/2 last:before:right-1/2">
            {href ? <Link to={href} title={`Open ${stage.label}`} className={className}>{content}</Link> : <div className={className}>{content}</div>}
          </div>;
        })}
      </div>
    </div>}
    {!compact && workflow.blockers.length > 0 && <div className="mt-3 border-t border-amber-200 pt-3 text-xs text-amber-900"><b>Also needs attention:</b> {workflow.blockers.map((item) => item.title).join(" · ")}</div>}
  </section>;
}
