import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { ProjectWorkflowController } from "../types.js";

type ProjectIdentity = {
  id: string;
  name: string;
  status: string;
  agencyClient: { id: string; name: string } | null;
};

const completeStatuses = new Set(["complete", "completed", "approved"]);
const attentionStatuses = new Set(["blocked", "failed", "stale", "needs_attention"]);

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    not_required: "Not Applicable",
    not_started: "Not Started",
    in_progress: "In Progress",
    needs_attention: "Needs Attention",
    ready: "In Progress",
    approved: "Complete",
    complete: "Complete",
    stale: "Needs Refresh",
    failed: "Needs Attention",
    blocked: "Blocked",
    deferred: "Deferred",
    not_applicable: "Not Applicable",
    waived: "Not Applicable",
  };
  return labels[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClasses(status: string) {
  if (completeStatuses.has(status)) return "bg-emerald-100 text-emerald-800";
  if (status === "stale") return "bg-amber-100 text-amber-900";
  if (attentionStatuses.has(status)) return "bg-rose-100 text-rose-800";
  if (["not_required", "not_applicable", "waived"].includes(status)) return "bg-slate-100 text-slate-600";
  return "bg-cyan-100 text-cyan-800";
}

export default function ProjectWorkflowGuidance({ workflow, project }: { workflow: ProjectWorkflowController; project: ProjectIdentity }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [governanceReviewOpen, setGovernanceReviewOpen] = useState(false);
  const [actionCompleted, setActionCompleted] = useState(false);
  useEffect(() => { setActionCompleted(false); }, [workflow.nextBestAction.title]);
  useEffect(() => {
    if (!governanceReviewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setGovernanceReviewOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [governanceReviewOpen]);
  const currentIndex = workflow.stages.findIndex((stage) => !completeStatuses.has(stage.status) && !["not_required", "not_applicable", "waived"].includes(stage.status));
  const stepIndex = currentIndex >= 0 ? currentIndex : Math.max(0, workflow.stages.length - 1);
  const currentStage = workflow.stages[stepIndex];
  const waitingForApproval = workflow.nextBestAction.action.type === "approve";
  const needsAttention = workflow.blockers.length > 0 || attentionStatuses.has(currentStage?.status ?? "");
  const projectStatus = waitingForApproval ? "Waiting for Approval" : needsAttention ? "Needs Attention" : statusLabel(currentStage?.status ?? project.status);
  const heading = workflow.state === "continuous_growth" ? "Next Best Action" : "Project Setup Guidance";
  const governanceAction = workflow.nextBestAction.title === "Review and approve the Business Brain"
    ? { endpoint: `/api/projects-v2/${project.id}/workflow-controller/business-brain/approve`, followupEndpoint: `/api/projects-v2/${project.id}/workflow-controller/readiness/complete`, confirmation: "Approve this exact Business Brain version and confirm it is ready for Opportunity Discovery?" }
    : workflow.nextBestAction.title === "Complete the Readiness Check"
      ? { endpoint: `/api/projects-v2/${project.id}/workflow-controller/readiness/complete`, confirmation: "Confirm the required project details are ready for Opportunity Discovery?" }
      : workflow.nextBestAction.title === "Review and approve the Growth Blueprint"
        ? { endpoint: `/api/projects-v2/${project.id}/growth/blueprint/approve`, confirmation: "Approve this exact Growth Blueprint version to control channel and execution planning?" }
        : workflow.nextBestAction.title === "Review and approve the Execution Plan"
          ? { endpoint: `/api/projects-v2/${project.id}/execution-plan/approve`, confirmation: "Approve this exact Execution Plan, its tasks, dependencies, destinations, and source versions for execution?" }
          : workflow.nextBestAction.title === "Review the findings"
            ? { endpoint: `/api/projects-v2/${project.id}/workflow-controller/findings/review`, confirmation: "Confirm that you reviewed the findings, evidence freshness, conflicts, confidence, and limitations?" }
            : workflow.nextBestAction.title === "Verify tracking or record its limitation"
              ? { endpoint: `/api/projects-v2/${project.id}/workflow-controller/tracking/limitation`, confirmation: "Record a tracking limitation instead of claiming that unavailable measurement data is zero?", reasonPrompt: "Explain the tracking limitation and why the project should continue:" }
          : null;
  const isFindingsReview = workflow.nextBestAction.title === "Review the findings";
  const runGovernanceAction = async (reviewConfirmed = false) => {
    if (!governanceAction) return;
    if (!reviewConfirmed) {
      setBannerExpanded(true);
      setGovernanceReviewOpen(true);
      return;
    }
    const reason = "reasonPrompt" in governanceAction ? window.prompt(governanceAction.reasonPrompt)?.trim() : undefined;
    if ("reasonPrompt" in governanceAction && (!reason || reason.length < 5)) return;
    setBusy(true); setError("");
    try {
      await api.post(governanceAction.endpoint, { confirmed: true, ...(reason ? { reason } : {}) });
      if ("followupEndpoint" in governanceAction) await api.post(governanceAction.followupEndpoint, { confirmed: true });
      setActionCompleted(true);
      setGovernanceReviewOpen(false);
      window.dispatchEvent(new Event("senuke:workflow-refresh"));
      window.dispatchEvent(new Event("senuke-ai:notifications-changed"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workflow action could not be completed.");
    } finally {
      setBusy(false);
    }
  };
  const decideModule = async (moduleKey: string, decision: "not_applicable" | "resume") => {
    const prompt = decision === "not_applicable" ? "Why does this module not apply to this project?" : "Why should this module be resumed?";
    const reason = window.prompt(prompt)?.trim();
    if (!reason || reason.length < 5) return;
    setBusy(true); setError("");
    try {
      await api.post(`/api/projects-v2/${project.id}/workflow-controller/modules/${moduleKey}/decision`, { decision, reason });
      window.dispatchEvent(new Event("senuke-ai:notifications-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The module decision could not be saved."); }
    finally { setBusy(false); }
  };

  return <section className="sticky top-0 z-[18] border-b border-cyan-200/80 bg-gradient-to-r from-white via-cyan-50/70 to-violet-50/60 px-4 py-2 shadow-[0_8px_30px_-18px_rgba(8,145,178,0.55)] backdrop-blur-xl lg:px-8" aria-label="Project workflow guidance">
    <div className="relative mx-auto max-w-[1600px] overflow-hidden rounded-xl border border-white/80 bg-white/85 p-3 shadow-sm ring-1 ring-cyan-100/80">
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-cyan-200/30 blur-3xl" />
      {!bannerExpanded ? (
        <div className="relative flex min-h-10 flex-wrap items-center gap-2 sm:flex-nowrap">
          <div className="min-w-0 flex-1 truncate text-sm font-black text-slate-950"><span className="mr-2 text-[10px] uppercase tracking-[0.15em] text-cyan-700">{heading}</span>{project.name}</div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ring-inset ${needsAttention ? "bg-rose-50 text-rose-700 ring-rose-200" : waitingForApproval ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-cyan-50 text-cyan-700 ring-cyan-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${needsAttention ? "bg-rose-500" : waitingForApproval ? "bg-amber-500" : "bg-cyan-500"}`} />{projectStatus}</span>
          <span className="shrink-0 text-xs font-black text-cyan-700">{workflow.overallProgressPercent}%</span>
          {governanceAction ? <button type="button" disabled={busy || actionCompleted} onClick={() => void runGovernanceAction()} className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-cyan-700 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-cyan-800 disabled:bg-slate-400">{busy ? "Saving…" : actionCompleted ? "Approved ✓" : `${workflow.nextBestAction.action.label} →`}</button> : <Link to={workflow.nextBestAction.action.url} className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-cyan-700 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-cyan-800">{workflow.nextBestAction.action.label} →</Link>}
          <button type="button" onClick={() => setBannerExpanded(true)} aria-expanded="false" className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:border-cyan-200 hover:text-cyan-700">Expand ↓</button>
        </div>
      ) : <>
      <div className="relative grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-stretch">
        <div className="min-w-0">
          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-700">
            <span>{heading}</span>
            {workflow.state === "continuous_growth" && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">Continuous Growth Loop Active</span>}
            {project.agencyClient && <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-700">Client: {project.agencyClient.name}</span>}
            <button type="button" onClick={() => setBannerExpanded(false)} aria-expanded="true" className="ml-auto rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500 shadow-sm hover:border-cyan-200 hover:text-cyan-700">Shrink ↑</button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-base font-black tracking-tight text-slate-950">{project.name}</h2>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm">Step {stepIndex + 1} of {workflow.stages.length} · {currentStage?.label ?? workflow.stateLabel}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ring-inset ${needsAttention ? "bg-rose-50 text-rose-700 ring-rose-200" : waitingForApproval ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-cyan-50 text-cyan-700 ring-cyan-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${needsAttention ? "bg-rose-500" : waitingForApproval ? "bg-amber-500" : "bg-cyan-500"}`} />{projectStatus}</span>
          </div>
          <p className="mt-1 max-w-4xl text-[11px] leading-4 text-slate-600"><b className="font-black text-slate-900">{workflow.nextBestAction.title}.</b> {workflow.nextBestAction.reason}</p>
          {workflow.nextBestAction.explainability && <p className="mt-0.5 hidden max-w-4xl text-[10px] font-medium leading-4 text-violet-700 2xl:block">{workflow.nextBestAction.explainability}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {workflow.blockers.length > 0 && <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800"><span aria-hidden="true">!</span><span>Also needs attention:</span>{workflow.blockers.map((blocker) => <span key={blocker.key} className="inline-flex items-center gap-1"><span>{blocker.title} — {blocker.reason}</span>{blocker.action && <Link to={blocker.action.url} className="whitespace-nowrap font-black text-cyan-800 underline decoration-cyan-400 underline-offset-2 hover:text-cyan-950">{blocker.action.label} →</Link>}</span>)}</div>}
            <span className="text-xs font-semibold leading-5 text-slate-700"><b className="font-black text-cyan-800">Next:</b> {workflow.nextBestAction.expectedResult}</span>
          </div>
          {error && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
          </div>
        </div>
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 via-cyan-950 to-cyan-800 p-3 text-white shadow-lg shadow-cyan-950/15 ring-1 ring-white/10">
          <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full border-[22px] border-white/5" />
          <div className="relative flex items-start justify-between gap-4">
            <div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Project progress</div><div className="mt-1 text-xs text-cyan-50/70">{stepIndex + 1} of {workflow.stages.length} stages</div></div>
            <div className="text-2xl font-black tracking-tight">{workflow.overallProgressPercent}<span className="text-sm text-cyan-200">%</span></div>
          </div>
          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/15 ring-1 ring-white/10"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 shadow-[0_0_14px_rgba(103,232,249,0.7)] transition-[width] duration-500" style={{ width: `${workflow.overallProgressPercent}%` }} /></div>
          <div className="relative mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-md border border-white/10 bg-white/10 px-2 py-1"><span className="text-sm font-black">{workflow.readinessPercent}%</span><span className="ml-1 text-[8px] font-bold uppercase tracking-wide text-cyan-100/70">Ready</span></div>
            <div className="rounded-md border border-white/10 bg-white/10 px-2 py-1"><span className="text-sm font-black">{workflow.confidence.overall}%</span><span className="ml-1 text-[8px] font-bold uppercase tracking-wide text-cyan-100/70">Confidence</span></div>
          </div>
          <div className="relative mt-2">
            {governanceAction ? <button type="button" disabled={busy} onClick={() => void runGovernanceAction()} className="inline-flex min-h-9 w-full items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-xs font-black text-cyan-900 shadow-md transition hover:bg-cyan-50 disabled:cursor-wait disabled:bg-slate-300 disabled:text-slate-600">{busy ? "Saving approval…" : `${workflow.nextBestAction.action.label} →`}</button> : <Link to={workflow.nextBestAction.action.url} className="inline-flex min-h-9 w-full items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-xs font-black text-cyan-900 shadow-md transition hover:bg-cyan-50">{workflow.nextBestAction.action.label} →</Link>}
          </div>
        </div>
      </div>
      {governanceReviewOpen && governanceAction && createPortal(<div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setGovernanceReviewOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="governance-review-title" className="relative my-auto max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-5 shadow-2xl sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">Review before confirming</div><h3 id="governance-review-title" className="mt-1 text-xl font-black text-slate-950">{workflow.nextBestAction.title}</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{workflow.nextBestAction.reason} Review the details below and confirm only when you understand what this checkpoint authorizes.</p></div>
          <button type="button" onClick={() => setGovernanceReviewOpen(false)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Close review</button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {[{ label: "Overall confidence", value: workflow.confidence.overall }, { label: "Evidence complete", value: workflow.confidence.completeness }, { label: "Evidence freshness", value: workflow.confidence.freshness }, { label: "Data quality", value: workflow.confidence.dataQuality }].map((metric) => <div key={metric.label} className="rounded-lg border border-white bg-white/90 px-3 py-2 shadow-sm"><div className="text-lg font-black text-slate-950">{metric.value}%</div><div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{metric.label}</div></div>)}
        </div>
        {workflow.blockers.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-amber-800">Revisions required before continuing</div><div className="mt-2 space-y-2">{workflow.blockers.map((blocker) => <div key={blocker.key} className="flex flex-col gap-2 rounded-lg border border-amber-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-black text-slate-900">{blocker.title}</div><p className="mt-0.5 text-[10px] leading-4 text-slate-600">{blocker.reason}</p></div>{blocker.action && <Link to={blocker.action.url} onClick={() => setGovernanceReviewOpen(false)} className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-amber-700 px-3 py-2 text-xs font-black text-white hover:bg-amber-800">{blocker.action.label} →</Link>}</div>)}</div></div>}
        {isFindingsReview ? <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Required intelligence</div><div className="mt-2 space-y-2">{workflow.intelligenceModules.filter((module) => module.required).map((module) => <div key={module.key} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"><div><div className="text-xs font-bold text-slate-900">{module.label}</div><div className="mt-0.5 text-[10px] leading-4 text-slate-500">{module.reason}</div></div><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${statusClasses(module.status)}`}>{statusLabel(module.status)}</span></div>)}</div></div>
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-amber-800">Conflicts and limitations</div><div className="mt-2 space-y-1 text-xs leading-5 text-amber-900">{workflow.confidence.cautions.length ? workflow.confidence.cautions.map((caution) => <div key={caution}>• {caution}</div>) : <div>No material conflicts or confidence warnings are currently recorded.</div>}</div></div>
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-cyan-800">Source-version changes</div><div className="mt-2 space-y-1 text-xs leading-5 text-cyan-900">{workflow.changedEvidence.length ? workflow.changedEvidence.map((item) => <div key={`${item.key}:${item.evidenceAt}`}>• {item.label}: {item.reason}</div>) : <div>No newer required evidence is recorded after the current Strategy source version.</div>}</div></div>
          </div>
        </div> : <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">What this confirmation does</div><p className="mt-2 text-xs font-semibold leading-5 text-slate-800">{workflow.nextBestAction.expectedResult}</p><div className="mt-3 text-[10px] font-black uppercase tracking-wide text-violet-700">System responsibility</div><div className="mt-1 space-y-1 text-xs leading-5 text-slate-600">{workflow.nextBestAction.aiWill.map((item) => <div key={item}>• {item}</div>)}</div><div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><b>Your responsibility:</b> {workflow.nextBestAction.userWill}</div></div>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-cyan-800">Versions and dependencies being confirmed</div><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-white px-3 py-2"><b>Business Brain</b><span className="block text-slate-500">Version {workflow.businessBrainVersion || "Not versioned"}</span></div><div className="rounded-lg bg-white px-3 py-2"><b>Evidence</b><span className="block text-slate-500">Version {workflow.evidenceVersion || "Not versioned"}</span></div><div className="rounded-lg bg-white px-3 py-2"><b>Strategy</b><span className="block text-slate-500">Version {workflow.strategyVersion || "Not created"}</span></div><div className="rounded-lg bg-white px-3 py-2"><b>Execution Plan</b><span className="block text-slate-500">Version {workflow.executionPlanVersion ?? "Not created"}</span></div></div><p className="mt-3 text-xs leading-5 text-cyan-900">{workflow.nextBestAction.explainability}</p></div>
        </div>}
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs font-semibold leading-5 text-emerald-900">By confirming, you acknowledge that you reviewed the displayed details and understand the recorded limitations and consequences. This does not publish content or consume AI Capacity.</p><div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row"><button type="button" disabled={busy} onClick={() => setGovernanceReviewOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">Not Ready — Do Not Confirm</button><button type="button" disabled={busy} onClick={() => void runGovernanceAction(true)} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-800 disabled:bg-slate-400">{busy ? "Saving review…" : "Confirm Review Complete ✓"}</button></div></div>
      </section></div>, document.body)}
      <details className="relative mt-1 border-t border-slate-100 pt-1 xl:-mt-5 xl:mr-[312px]">
        <summary className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500 transition hover:bg-slate-50 hover:text-cyan-700">View complete project checklist <span className="text-sm" aria-hidden="true">⌄</span></summary>
        <ol className="mt-3 grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-2 xl:grid-cols-3">
          {workflow.stages.map((stage, index) => <li key={stage.key} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-black ${statusClasses(stage.status)}`}>{completeStatuses.has(stage.status) ? "✓" : index + 1}</span>
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b className="truncate text-xs text-slate-900">{stage.label}</b><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${statusClasses(stage.status)}`}>{statusLabel(stage.status)}</span></span><span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{stage.reason}</span></span>
          </li>)}
        </ol>
      </details>
      {workflow.intelligenceModules.some((module) => module.required && !["complete", "approved"].includes(module.status)) && <details className="mt-2">
        <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wide text-slate-500">Review required and Not Applicable intelligence</summary>
        <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-2 xl:grid-cols-3">{workflow.intelligenceModules.filter((module) => module.required && !["complete", "approved"].includes(module.status)).map((module) => <div key={module.key} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex items-center justify-between gap-2"><b className="text-xs text-slate-900">{module.label}</b><span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${statusClasses(module.status)}`}>{statusLabel(module.status)}</span></div><p className="mt-1 text-[10px] leading-4 text-slate-500">{module.reason}</p><button type="button" disabled={busy} onClick={() => void decideModule(module.key, ["not_applicable", "waived"].includes(module.status) ? "resume" : "not_applicable")} className="mt-2 text-[10px] font-black text-cyan-700 hover:text-cyan-900 disabled:text-slate-400">{["not_applicable", "waived"].includes(module.status) ? "Resume this requirement" : "Mark Not Applicable"}</button></div>)}</div>
      </details>}
      </>}
    </div>
  </section>;
}
