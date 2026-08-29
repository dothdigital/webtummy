import { useState } from "react";
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
  const currentIndex = workflow.stages.findIndex((stage) => !completeStatuses.has(stage.status) && !["not_required", "not_applicable", "waived"].includes(stage.status));
  const stepIndex = currentIndex >= 0 ? currentIndex : Math.max(0, workflow.stages.length - 1);
  const currentStage = workflow.stages[stepIndex];
  const waitingForApproval = workflow.nextBestAction.action.type === "approve";
  const needsAttention = workflow.blockers.length > 0 || attentionStatuses.has(currentStage?.status ?? "");
  const projectStatus = waitingForApproval ? "Waiting for Approval" : needsAttention ? "Needs Attention" : statusLabel(currentStage?.status ?? project.status);
  const heading = workflow.state === "continuous_growth" ? "Next Best Action" : "Project Setup Guidance";
  const governanceAction = workflow.nextBestAction.title === "Review and approve the Business Brain"
    ? { endpoint: `/api/projects-v2/${project.id}/workflow-controller/business-brain/approve`, confirmation: "Approve this exact Business Brain version for downstream research and planning?" }
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
  const runGovernanceAction = async () => {
    if (!governanceAction || !window.confirm(governanceAction.confirmation)) return;
    const reason = "reasonPrompt" in governanceAction ? window.prompt(governanceAction.reasonPrompt)?.trim() : undefined;
    if ("reasonPrompt" in governanceAction && (!reason || reason.length < 5)) return;
    setBusy(true); setError("");
    try {
      await api.post(governanceAction.endpoint, { confirmed: true, ...(reason ? { reason } : {}) });
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

  return <section className="sticky top-0 z-[18] border-b border-cyan-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:px-8" aria-label="Project workflow guidance">
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">
            <span>{heading}</span>
            {workflow.state === "continuous_growth" && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">Continuous Growth Loop Active</span>}
            {project.agencyClient && <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-800">Client: {project.agencyClient.name}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="truncate text-base font-black text-slate-950">{project.name}</h2>
            <span className="text-xs font-bold text-slate-500">Step {stepIndex + 1} of {workflow.stages.length}: {currentStage?.label ?? workflow.stateLabel}</span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${needsAttention ? "bg-rose-100 text-rose-800" : waitingForApproval ? "bg-amber-100 text-amber-900" : "bg-cyan-100 text-cyan-800"}`}>{projectStatus}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600"><b className="text-slate-900">{workflow.nextBestAction.title}.</b> {workflow.nextBestAction.reason}</p>
          {workflow.blockers.length > 0 && <p className="mt-1 text-xs font-semibold text-rose-700">Missing: {workflow.blockers.map((blocker) => blocker.title).join(" · ")}</p>}
          {error && <p className="mt-1 text-xs font-semibold text-rose-700">{error}</p>}
          <p className="mt-1 text-[11px] text-slate-500"><b>Next:</b> {workflow.nextBestAction.expectedResult}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden w-36 sm:block"><div className="flex justify-between text-[10px] font-black text-slate-500"><span>Project progress</span><span>{workflow.overallProgressPercent}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${workflow.overallProgressPercent}%` }} /></div></div>
          {governanceAction ? <button type="button" disabled={busy} onClick={() => void runGovernanceAction()} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-700 px-5 py-3 text-center text-sm font-black text-white shadow-md transition hover:bg-cyan-800 hover:shadow-lg disabled:cursor-wait disabled:bg-slate-400">{busy ? "Saving approval…" : `${workflow.nextBestAction.action.label} →`}</button> : <Link to={workflow.nextBestAction.action.url} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-700 px-5 py-3 text-center text-sm font-black text-white shadow-md transition hover:bg-cyan-800 hover:shadow-lg">{workflow.nextBestAction.action.label} →</Link>}
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wide text-slate-500">View complete project checklist</summary>
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
    </div>
  </section>;
}
