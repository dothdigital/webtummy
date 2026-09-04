import { Link } from "react-router-dom";
import type { ProjectWorkflowController } from "../types.js";

type Props = { workflow: ProjectWorkflowController; compact?: boolean; onAction?: () => void; actionBusy?: boolean; className?: string };

function statusLabel(workflow: ProjectWorkflowController) {
  if (workflow.blockers.length) return `${workflow.blockers.length} blocker${workflow.blockers.length === 1 ? "" : "s"}`;
  if (workflow.nextBestAction.action.type === "approve") return "Review required";
  if (workflow.nextBestAction.action.type === "generate") return "Ready to generate";
  return workflow.stateLabel;
}

export default function MasterWorkflowStatus({ workflow, compact = false, onAction, actionBusy = false, className = "" }: Props) {
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
      {onAction ? <button type="button" onClick={onAction} disabled={actionBusy} className={`inline-flex shrink-0 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-400 ${button}`}>{actionBusy ? "Working…" : `${next.action.label} →`}</button> : <Link to={next.action.url} className={`inline-flex shrink-0 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-black text-white ${button}`}>{next.action.label} →</Link>}
    </div>
    {!compact && workflow.blockers.length > 0 && <div className="mt-3 border-t border-amber-200 pt-3 text-xs text-amber-900"><b>Also needs attention:</b> {workflow.blockers.map((item) => item.title).join(" · ")}</div>}
  </section>;
}
