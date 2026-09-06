import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { ProjectWorkflowController as Workflow, WorkflowControllerStage } from "../types.js";

const done = new Set(["complete", "approved", "not_required", "waived"]);
const canonicalLifecycle = "Idea → Opportunity → Keyword → Website Analysis → Gap Analysis → Strategy → Growth Plan → SEO Plan → Website Development → Deployment → Measure & Track → Learn → Next Best Action → Loop";

function scopedUrl(url: string, projectId: string) {
  if (!url.startsWith("/")) return url;
  if (url.includes("projectId=")) return url;
  const separator = url.includes("?") ? "&" : "?";
  const [base, hash] = url.split("#", 2);
  return `${base}${separator}projectId=${encodeURIComponent(projectId)}${hash ? `#${hash}` : ""}`;
}

function statusTone(status: string) {
  if (["complete", "approved"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "not_required" || status === "waived" || status === "deferred") return "border-slate-200 bg-slate-50 text-slate-500";
  if (["failed", "blocked", "stale", "needs_attention"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "in_progress") return "border-violet-200 bg-violet-50 text-violet-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function label(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function StageRow({ stage, projectId }: { stage: WorkflowControllerStage; projectId: string }) {
  return <div className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 lg:grid-cols-[230px_1fr_auto] lg:items-center">
    <div className="flex items-center gap-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-black ${statusTone(stage.status)}`}>{done.has(stage.status) ? "✓" : stage.status === "in_progress" ? "…" : "•"}</span><div><div className="text-sm font-black text-charcoal-900">{stage.label}</div><span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${statusTone(stage.status)}`}>{label(stage.status)}</span></div></div>
    <div><p className="text-sm leading-6 text-charcoal-600">{stage.reason}</p><p className="mt-1 text-xs leading-5 text-violet-700"><b>AI:</b> {stage.ai.implementation}</p></div>
    {stage.action ? <Link to={scopedUrl(stage.action.url, projectId)} className="inline-flex min-w-36 items-center justify-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-50">{stage.action.label} <span className="ml-1">→</span></Link> : <span className="text-xs font-bold text-slate-400">No action required</span>}
  </div>;
}

export default function ProjectWorkflowController({ projectId, refreshKey = 0, compact = false, onLoaded, onNextAction, nextActionBusy = false, nextActionDisabled = false }: { projectId: string; refreshKey?: number | string; compact?: boolean; onLoaded?: (workflow: Workflow) => void; onNextAction?: () => void; nextActionBusy?: boolean; nextActionDisabled?: boolean }) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confidenceOpen, setConfidenceOpen] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    const loadWorkflow = async () => {
      if (requestInFlight || document.hidden) return;
      requestInFlight = true;
      try {
        const result = await api.get<{ workflow: Workflow }>(`/api/projects-v2/${encodeURIComponent(projectId)}/workflow-controller`);
        if (active) {
          setWorkflow(result.workflow);
          setError("");
          onLoaded?.(result.workflow);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Workflow status could not be loaded.");
      } finally {
        requestInFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void loadWorkflow();
    };
    setError("");
    void loadWorkflow();
    const timer = window.setInterval(() => { void loadWorkflow(); }, 8000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("senuke:workflow-refresh", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("senuke:workflow-refresh", refreshWhenVisible);
    };
  }, [projectId, refreshKey, onLoaded]);

  if (compact && (error || !workflow)) return null;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>;
  if (!workflow) return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="h-4 w-52 animate-pulse rounded bg-slate-200"/><div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100"/></div>;
  const decideModule = async (moduleKey: string, decision: "waive" | "defer" | "resume") => {
    const reason = window.prompt(decision === "waive" ? "Why is this evidence not required for the current strategy cycle?" : decision === "defer" ? "Why should this evidence be completed later?" : "Why is this requirement being resumed?");
    if (!reason?.trim()) return;
    setDecisionBusy(`${moduleKey}:${decision}`);
    setError("");
    try {
      const result = await api.post<{ workflow: Workflow }>(`/api/projects-v2/${encodeURIComponent(projectId)}/workflow-controller/modules/${encodeURIComponent(moduleKey)}/decision`, { decision, reason: reason.trim() });
      setWorkflow(result.workflow);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "The workflow decision could not be saved.");
    } finally {
      setDecisionBusy("");
    }
  };
  const next = workflow.nextBestAction;
  const governanceAction = next.title === "Review and approve the Business Brain"
    ? { endpoint: `/api/projects-v2/${encodeURIComponent(projectId)}/workflow-controller/business-brain/approve`, followupEndpoint: `/api/projects-v2/${encodeURIComponent(projectId)}/workflow-controller/readiness/complete`, confirmation: "Approve this exact Business Brain version and confirm it is ready for Opportunity Discovery?" }
    : next.title === "Complete the Readiness Check"
      ? { endpoint: `/api/projects-v2/${encodeURIComponent(projectId)}/workflow-controller/readiness/complete`, confirmation: "Confirm the required project details are ready for Opportunity Discovery?" }
      : null;
  const runNextAction = async () => {
    if (!governanceAction || !window.confirm(governanceAction.confirmation)) return;
    setActionBusy(true);
    setError("");
    try {
      const result = await api.post<{ workflow: Workflow }>(governanceAction.endpoint, { confirmed: true });
      const finalResult = "followupEndpoint" in governanceAction
        ? await api.post<{ workflow: Workflow }>(governanceAction.followupEndpoint, { confirmed: true })
        : result;
      setWorkflow(finalResult.workflow);
      onLoaded?.(finalResult.workflow);
      window.dispatchEvent(new Event("senuke:workflow-refresh"));
      window.dispatchEvent(new Event("senuke-ai:notifications-changed"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workflow action could not be completed.");
    } finally {
      setActionBusy(false);
    }
  };
  const completedStages = workflow.stages.filter((stage) => done.has(stage.status)).length;
  if (compact) return null;
  return <section className="overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-sm" aria-label="Master project workflow">
    <div className="bg-gradient-to-r from-slate-950 via-brand-950 to-violet-950 px-5 py-5 text-white">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl"><div className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-200">AI Growth Operating System</div><h2 className="mt-1 text-xl font-black">Master Project Workflow</h2><p className="mt-2 text-sm leading-6 text-slate-200">AI decides what evidence is required, recommends the next valid action, performs or prepares the work, and routes approval and implementation through the correct module.</p><p className="mt-3 text-[10px] font-bold leading-5 text-brand-100">{canonicalLifecycle}</p></div>
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[390px]">
          {[{ value: `${workflow.readinessPercent}%`, label: "Intelligence ready" }, { value: `${workflow.confidence.overall}%`, label: "AI confidence" }, { value: `${completedStages}/${workflow.stages.length}`, label: "Stages complete" }].map((item) => <div key={item.label} className="rounded-xl border border-white/15 bg-white/10 px-3 py-3 backdrop-blur"><div className="text-xl font-black">{item.value}</div><div className="mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-300">{item.label}</div></div>)}
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-brand-400 to-emerald-400 transition-all" style={{ width: `${workflow.overallProgressPercent}%` }}/></div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-slate-300"><span>{workflow.stateLabel} · {workflow.overallProgressPercent}% overall progress</span><span>Business Brain v{workflow.businessBrainVersion} · Evidence v{workflow.evidenceVersion} · Strategy v{workflow.strategyVersion || "—"} · Plan {workflow.executionPlanVersion ?? "—"}</span></div>
    </div>

    <div className="grid gap-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 via-white to-violet-50 p-5 xl:grid-cols-[1.25fr_.75fr]">
      <div className="rounded-2xl border border-brand-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-700 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">Next Best Action</span><span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">{next.confidence}% confidence</span></div><h3 className="mt-3 text-lg font-black text-charcoal-950">{next.title}</h3><p className="mt-2 text-sm leading-6 text-charcoal-600">{next.reason}</p><div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 px-4 py-3"><div className="text-[10px] font-black uppercase tracking-wide text-violet-700">Why this action</div><p className="mt-1 text-xs leading-5 text-violet-900">{next.explainability}</p></div><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs font-bold text-emerald-700">Expected result: {next.expectedResult}</div>{governanceAction ? <button type="button" onClick={() => void runNextAction()} disabled={actionBusy} className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-brand-700 to-violet-700 px-5 py-3 text-sm font-black text-white shadow-lg shadow-brand-100 hover:from-brand-800 hover:to-violet-800 disabled:cursor-wait disabled:from-slate-400 disabled:to-slate-400">{actionBusy ? "Saving…" : next.action.label} <span className="ml-2">→</span></button> : <Link to={scopedUrl(next.action.url, projectId)} className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-brand-700 to-violet-700 px-5 py-3 text-sm font-black text-white shadow-lg shadow-brand-100 hover:from-brand-800 hover:to-violet-800">{next.action.label} <span className="ml-2">→</span></Link>}</div></div>
      <div className="rounded-2xl border border-violet-200 bg-white p-5"><div className="text-[10px] font-black uppercase tracking-wide text-violet-700">AI does the heavy work</div><div className="mt-3 space-y-2">{next.aiWill.map((item) => <div key={item} className="flex gap-2 text-xs leading-5 text-charcoal-700"><span className="mt-0.5 text-violet-600">✦</span><span>{item}</span></div>)}</div><div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"><b>Your role:</b> {next.userWill}</div></div>
    </div>

    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-black text-charcoal-900">One governed workflow across every module</div><p className="mt-1 text-xs text-charcoal-500">Advanced access remains available, but protected Strategy, approval, execution, and publishing rules cannot be bypassed.</p></div><div className="flex gap-2"><button type="button" onClick={() => setConfidenceOpen((value) => !value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">{confidenceOpen ? "Hide confidence" : "Explain confidence"}</button><button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">{expanded ? "Hide workflow" : "View complete workflow"}</button></div></div>

    {confidenceOpen && <div className="border-t border-slate-100 bg-slate-50 px-5 py-4"><div className="grid gap-2 sm:grid-cols-4">{[{ label: "Evidence completeness", value: workflow.confidence.completeness }, { label: "Evidence freshness", value: workflow.confidence.freshness }, { label: "Signal coverage", value: workflow.confidence.signalCoverage }, { label: "Data quality", value: workflow.confidence.dataQuality }].map((item) => <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-xl font-black text-charcoal-950">{item.value}%</div><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{item.label}</div></div>)}</div><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">{workflow.confidence.reasons.map((reason) => <div key={reason}>✓ {reason}</div>)}</div><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{workflow.confidence.cautions.length ? workflow.confidence.cautions.map((reason) => <div key={reason}>⚠ {reason}</div>) : <div>✓ No material confidence warnings detected.</div>}</div></div></div>}

    {expanded && <div className="border-t border-slate-200"><div className="bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Complete project lifecycle</div>{workflow.stages.map((stage) => <StageRow key={stage.key} stage={stage} projectId={projectId}/>)}<div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Applicability and intelligence registry</div><div className="grid gap-3 bg-slate-50/70 p-4 lg:grid-cols-2">{workflow.intelligenceModules.map((module) => <article key={module.key} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-black text-charcoal-900">{module.label}</div><p className="mt-1 text-xs leading-5 text-charcoal-500">{module.description}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase ${statusTone(module.status)}`}>{label(module.status)}</span></div><p className="mt-3 text-xs leading-5 text-charcoal-700">{module.reason}</p><div className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-[11px] leading-5 text-violet-900"><b>AI implementation:</b> {module.ai.implementation}</div><div className="mt-3 flex flex-wrap items-center gap-2">{module.action && <Link to={scopedUrl(module.action.url, projectId)} className="rounded-lg bg-brand-600 px-3 py-2 text-[11px] font-black text-white hover:bg-brand-700">{module.action.label}</Link>}{module.required && !done.has(module.status) && module.status !== "waived" && <><button type="button" disabled={Boolean(decisionBusy)} onClick={() => void decideModule(module.key, "defer")} className="rounded-lg border border-amber-200 px-3 py-2 text-[11px] font-black text-amber-800 hover:bg-amber-50">Defer</button><button type="button" disabled={Boolean(decisionBusy)} onClick={() => void decideModule(module.key, "waive")} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-black text-slate-600 hover:bg-slate-50">Waive with reason</button></>}{["waived", "deferred"].includes(module.status) && <button type="button" disabled={Boolean(decisionBusy)} onClick={() => void decideModule(module.key, "resume")} className="rounded-lg border border-violet-200 px-3 py-2 text-[11px] font-black text-violet-700 hover:bg-violet-50">Resume requirement</button>}<span className="ml-auto text-[10px] font-bold text-slate-400">Weight {module.weight}</span></div></article>)}</div></div>}
  </section>;
}
