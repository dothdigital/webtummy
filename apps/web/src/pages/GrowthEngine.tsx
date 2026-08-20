import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";
import ProjectModuleHeader from "../components/ProjectModuleHeader.js";
import ProjectWorkflowController from "../components/ProjectWorkflowController.js";
import { Button, Card, EmptyState } from "../components/ui.js";
import type { GrowthCandidateAction, GrowthContentOpportunity, GrowthExperiment, GrowthOverviewResponse, GrowthReadinessItem, GuidedProject } from "../types.js";

type Tab = "overview" | "blueprint" | "content" | "recommendations" | "diagnosis" | "evidence" | "funnel" | "experiments" | "tracker" | "history" | "report";

type BlueprintItem = { dedupeKey?: string; title?: string; route?: string; score?: number; rationale?: string; conditions?: string[] };

function blueprintItems(value: unknown): BlueprintItem[] {
  return Array.isArray(value) ? value.filter((item): item is BlueprintItem => Boolean(item) && typeof item === "object") : [];
}

function findingItems(value: unknown): { key?: string; title?: string; summary?: string; severity?: string; confidence?: number; evidenceState?: string }[] {
  return Array.isArray(value) ? value.filter((item): item is { key?: string; title?: string; summary?: string; severity?: string; confidence?: number; evidenceState?: string } => Boolean(item) && typeof item === "object") : [];
}

function scoreFactors(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {};
}

function stringItems(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type ExperimentStartInput = { baselineValue: number; baselineSampleSize: number; evaluationWindowDays: number; sourceStatus: "AVAILABLE"; baselineNote: string };
type ExperimentResultInput = { baselineValue: number; currentValue: number; currentSampleSize: number; minimumSampleSize: number; evaluationWindowComplete: boolean; sourceStatus: "AVAILABLE" | "LIMITED" | "STALE" | "UNAVAILABLE" | "INSUFFICIENT"; decision?: "adopt" | "revise" | "stop"; notes?: string };

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function toneClass(value: number) {
  if (value >= 75) return "text-emerald-700";
  if (value >= 55) return "text-amber-700";
  return "text-rose-700";
}

function statusBadge(status: string) {
  if (["healthy", "completed", "winner", "scaled", "evidence_available", "ready"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["running", "watch", "approved", "limited_evidence", "partial"].includes(status)) return "bg-brand-50 text-brand-700";
  if (["failed", "needs_attention", "connection_required", "blocked"].includes(status)) return "bg-rose-50 text-rose-700";
  if (["insufficient_sample", "measurement_required", "approval_required"].includes(status)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function automationBadge(level: string) {
  if (level === "execute_through_integration") return "Integration needed";
  if (level === "execute_with_approval" || level === "prepare") return "One-click approval";
  if (level === "manual_guided") return "Manual guided";
  return level === "generate" ? "Automated" : titleCase(level);
}

function growthActionWorkspace(action: GrowthCandidateAction, projectId: string) {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedActionId = encodeURIComponent(action.id);
  const text = `${action.actionType} ${action.route} ${action.title}`.toLowerCase();
  if (/lead_capture|lead_nurture|retention_referral|lead magnet|follow.?up|retention|referral|enquiry|handoff/.test(text)) {
    return {
      url: `/lead-magnets?projectId=${encodedProjectId}&start=1&growthActionId=${encodedActionId}`,
      label: "Continue in AI Funnel Builder",
      preparation: "AI researches and prepares the asset, form, delivery, CTA, and follow-up flow for review.",
    };
  }
  if (action.route === "authority" || /authority|backlink|outreach/.test(text)) {
    return {
      url: `/backlinks?projectId=${encodedProjectId}&start=discover&growthActionId=${encodedActionId}`,
      label: "Continue in AI Authority Builder",
      preparation: "AI researches evidence-safe authority opportunities and prepares an asset or outreach brief for approval.",
    };
  }
  if (action.route === "local_seo") {
    return {
      url: `/local-seo?projectId=${encodedProjectId}`,
      label: "Continue in Local SEO",
      preparation: "AI opens the Local SEO workspace so the profile, citation, and location work can be prepared and verified.",
    };
  }
  if (/sitemap|intent architecture|canonical owner|page map/.test(text) && action.actionType !== "search_setup") {
    return {
      url: `/seo-page-map?projectId=${encodedProjectId}`,
      label: "Continue in AI Page Map",
      preparation: "AI opens the page-map workspace to prepare canonical owners, page roles, CTAs, and internal links.",
    };
  }
  if (/analytics|measurement|tracking|evidence loop/.test(text)) {
    return {
      url: `/projects/${encodedProjectId}/website/performance#search-performance`,
      label: "Continue in Measurement Setup",
      preparation: "SEnuke opens the measured-performance workspace so the data source, events, and baseline can be configured and verified.",
    };
  }
  if (action.route === "technical") {
    return {
      url: action.actionType === "search_setup"
        ? `/projects/${encodedProjectId}/website/performance#search-performance`
        : `/gap-analysis?projectId=${encodedProjectId}`,
      label: action.actionType === "search_setup" ? "Open Search Setup" : "Continue in Technical Analysis",
      preparation: action.actionType === "search_setup"
        ? "SEnuke provides the verified sitemap and checklist; the user connects the external Search Console property and submits it."
        : "AI opens the technical evidence and prepares the scoped fixes; live changes remain subject to review.",
    };
  }
  if (action.followupTask) {
    return {
      url: `/ai-content?projectId=${encodedProjectId}&taskId=${encodeURIComponent(action.followupTask.id)}&open=1`,
      label: "Continue in AI Content",
      preparation: "AI loads the approved task brief and prepares the exact content asset for review.",
    };
  }
  return {
    url: `/ai-content?projectId=${encodedProjectId}&open=1&type=article&topic=${encodeURIComponent(action.title)}&instruction=${encodeURIComponent(action.recommendation)}`,
    label: "Continue in AI Content",
    preparation: "AI opens a scoped draft from this recommendation for review before anything is published.",
  };
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-bold text-charcoal-950">{value}</div>
      {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
    </Card>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className={`font-bold ${toneClass(value)}`}>{value}/100</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${value >= 75 ? "bg-emerald-500" : value >= 55 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.max(6, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function ExperimentCard({ experiment, onApprove, onStart, onPause, onRecord, busy }: {
  experiment: GrowthExperiment;
  onApprove: (id: string, input: ExperimentStartInput) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onRecord: (id: string, input: ExperimentResultInput) => void;
  busy: boolean;
}) {
  const baseline = recordObject(experiment.baselineJson);
  const savedBaseline = typeof baseline.value === "number" ? baseline.value : 0;
  const savedMinimumSample = typeof baseline.sampleSize === "number" ? baseline.sampleSize : 30;
  const [baselineValue, setBaselineValue] = useState(String(savedBaseline));
  const [baselineSampleSize, setBaselineSampleSize] = useState(String(savedMinimumSample));
  const [evaluationWindowDays, setEvaluationWindowDays] = useState(String(typeof baseline.evaluationWindowDays === "number" ? baseline.evaluationWindowDays : 14));
  const [baselineNote, setBaselineNote] = useState(typeof baseline.note === "string" ? baseline.note : "Verified from the connected measurement source before launch.");
  const [currentValue, setCurrentValue] = useState("");
  const [currentSampleSize, setCurrentSampleSize] = useState("");
  const [sourceStatus, setSourceStatus] = useState<ExperimentResultInput["sourceStatus"]>("AVAILABLE");
  const [windowComplete, setWindowComplete] = useState(false);
  const [decision, setDecision] = useState<"adopt" | "revise" | "stop">("adopt");
  const [notes, setNotes] = useState("");
  const canStart = Number.isFinite(Number(baselineValue)) && Number(baselineSampleSize) >= 0 && Number(evaluationWindowDays) > 0 && baselineNote.trim().length >= 2;
  const canRecord = Number.isFinite(Number(currentValue)) && Number(currentSampleSize) >= 0;
  const reviewReady = Boolean(experiment.reviewAt && new Date(experiment.reviewAt).getTime() <= Date.now());
  const terminal = ["completed", "stopped", "inconclusive", "failed", "scaled"].includes(experiment.status);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-charcoal-950">{experiment.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadge(experiment.status)}`}>{titleCase(experiment.status)}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{experiment.hypothesis}</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">ICE</div>
          <div className="text-2xl font-bold text-brand-700">{experiment.iceScore}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold text-slate-400">Metric</span>{experiment.metric}</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold text-slate-400">Success</span>{experiment.successThreshold}</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold text-slate-400">Automation</span>{automationBadge(experiment.automationLevel)}</div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Guardrails</div>
        <div className="mt-2 flex flex-wrap gap-2">{stringItems(experiment.guardrailMetrics).map((item) => <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">{item}</span>)}</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(Array.isArray(experiment.requiredAssets) ? experiment.requiredAssets : []).map((asset) => (
            <span key={String(asset)} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{String(asset)}</span>
          ))}
        </div>
      </div>
      {["planned", "draft"].includes(experiment.status) && <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
        <div className="text-xs font-black uppercase tracking-wide text-brand-700">Approve baseline and start</div>
        <p className="mt-1 text-xs leading-5 text-slate-600">An Owner/Admin or Manager/Approver must confirm the baseline before the experiment can run.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-bold text-slate-600">Baseline value<input type="number" value={baselineValue} onChange={(event) => setBaselineValue(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
          <label className="text-xs font-bold text-slate-600">Baseline sample size<input type="number" min="0" value={baselineSampleSize} onChange={(event) => setBaselineSampleSize(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
          <label className="text-xs font-bold text-slate-600">Evaluation window (days)<input type="number" min="1" max="180" value={evaluationWindowDays} onChange={(event) => setEvaluationWindowDays(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
        </div>
        <label className="mt-3 block text-xs font-bold text-slate-600">Baseline evidence note<textarea value={baselineNote} onChange={(event) => setBaselineNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
        <div className="mt-3 flex justify-end"><Button onClick={() => onApprove(experiment.id, { baselineValue: Number(baselineValue), baselineSampleSize: Number(baselineSampleSize), evaluationWindowDays: Number(evaluationWindowDays), sourceStatus: "AVAILABLE", baselineNote: baselineNote.trim() })} disabled={busy || !canStart}>Approve Experiment</Button></div>
      </div>}
      {experiment.status === "approved" && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div><div className="text-xs font-black uppercase tracking-wide text-emerald-700">Approved and ready</div><p className="mt-1 text-sm text-emerald-950">Baseline {savedBaseline} is saved. Start when the approved change is ready to go live.</p></div><Button onClick={() => onStart(experiment.id)} disabled={busy}>Start Experiment</Button></div>}
      {experiment.status === "paused" && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><div><div className="text-xs font-black uppercase tracking-wide text-amber-800">Experiment paused</div><p className="mt-1 text-sm text-amber-950">The approved baseline is preserved. Resume only when data collection can continue.</p></div><Button onClick={() => onStart(experiment.id)} disabled={busy}>Resume Experiment</Button></div>}
      {experiment.status === "running" && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs font-black uppercase tracking-wide text-emerald-700">Record measured outcome</div><p className="mt-1 text-xs text-slate-600">Review date: {experiment.reviewAt ? formatDate(experiment.reviewAt) : "Not set"}. Missing or insufficient evidence remains inconclusive.</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-emerald-700">Baseline {savedBaseline}</span><button type="button" onClick={() => onPause(experiment.id)} disabled={busy} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 disabled:opacity-50">Pause</button></div></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-bold text-slate-600">Current value<input type="number" value={currentValue} onChange={(event) => setCurrentValue(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
          <label className="text-xs font-bold text-slate-600">Current sample size<input type="number" min="0" value={currentSampleSize} onChange={(event) => setCurrentSampleSize(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
          <label className="text-xs font-bold text-slate-600">Evidence status<select value={sourceStatus} onChange={(event) => setSourceStatus(event.target.value as ExperimentResultInput["sourceStatus"])} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="AVAILABLE">Available</option><option value="LIMITED">Partial / limited</option><option value="STALE">Stale</option><option value="UNAVAILABLE">Connection required</option><option value="INSUFFICIENT">Insufficient sample</option></select></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={windowComplete} disabled={!reviewReady} onChange={(event) => setWindowComplete(event.target.checked)} /> {reviewReady ? "The evaluation window is complete" : "Final evaluation unlocks on the review date; measurements can still be saved now"}</label>
        {windowComplete && <div className="mt-3"><div className="text-xs font-bold text-slate-600">Decision after evaluation</div><div className="mt-2 grid gap-2 sm:grid-cols-3">{(["adopt", "revise", "stop"] as const).map((item) => <button key={item} type="button" onClick={() => setDecision(item)} className={`rounded-lg border px-3 py-2 text-sm font-bold ${decision === item ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600"}`}>{titleCase(item)}</button>)}</div></div>}
        <label className="mt-3 block text-xs font-bold text-slate-600">Evidence and learning note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="What changed, what remained uncertain, and what should happen next?" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
        <div className="mt-3 flex justify-end"><Button onClick={() => onRecord(experiment.id, { baselineValue: savedBaseline, currentValue: Number(currentValue), currentSampleSize: Number(currentSampleSize), minimumSampleSize: Math.max(1, savedMinimumSample || 30), evaluationWindowComplete: windowComplete, sourceStatus, ...(windowComplete ? { decision } : {}), notes: notes.trim() || undefined })} disabled={busy || !canRecord}>{windowComplete ? "Evaluate & Save Decision" : "Save Measurement"}</Button></div>
      </div>}
      {terminal && experiment.results?.[0] && <div className="mt-4 rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-slate-400">Latest verified result</div><div className="mt-1 font-bold text-charcoal-950">{titleCase(experiment.results[0].resultStatus)} · {experiment.results[0].followUpAction ? titleCase(experiment.results[0].followUpAction) : "Decision recorded"}</div></div><div className="text-sm font-bold text-brand-700">{experiment.results[0].baselineValue ?? "—"} → {experiment.results[0].currentValue ?? "—"}</div></div>{experiment.results[0].notes && <p className="mt-2 text-sm leading-6 text-slate-600">{experiment.results[0].notes}</p>}</div>}
    </Card>
  );
}

function RecommendationCard({ action, projectId, primary, busy, onDecision }: {
  action: GrowthCandidateAction;
  projectId: string;
  primary?: boolean;
  busy: boolean;
  onDecision: (action: GrowthCandidateAction, decision: "accepted" | "edited" | "deferred" | "rejected" | "alternatives") => void;
}) {
  const factors = scoreFactors(action.scoreJson);
  const workspace = growthActionWorkspace(action, projectId);
  const taskHref = action.followupTask ? workspace.url : null;
  const blockers = stringItems(action.dependencyIdsJson);
  const canCreateTask = !action.followupTask && action.status !== "completed" && blockers.length === 0;
  const startLabel = action.status === "deferred"
    ? "Resume This Action"
    : ["rejected", "dismissed", "superseded"].includes(action.status)
      ? "Reconsider This Action"
      : action.status === "accepted"
        ? "Create Missing Task"
        : primary
          ? "Accept & Create Task"
          : "Start This Action";
  const nextStep = action.followupTask
    ? `${workspace.preparation} The linked task is currently ${titleCase(action.followupTask.status)}.`
    : blockers.length
      ? `This action cannot start yet. Resolve the listed requirement; the engine will keep it as a ranked alternative and select ready work instead.`
      : action.status === "deferred"
      ? `${action.reviewAfter ? `This was deferred until ${formatDate(action.reviewAfter)}. ` : ""}Resume it now to create a trackable Execution task.`
      : ["rejected", "dismissed", "superseded"].includes(action.status)
        ? "This was previously passed over. Reconsider it to create a trackable Execution task from the recommendation."
        : action.status === "completed"
          ? "This recommendation is complete. Open its decision history for the saved outcome."
          : "Start this recommendation to create a trackable Execution task, then use that task to complete and record the work.";
  return (
    <Card className={`p-5 ${primary ? "border-brand-300 ring-2 ring-brand-100" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            {primary && <span className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">Next Best Action</span>}
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadge(action.status)}`}>{titleCase(action.status)}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{titleCase(action.route)}</span>
          </div>
          <h3 className="mt-3 text-lg font-bold text-charcoal-950">{action.title}</h3>
          <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-brand-700">What to do</div>
            <p className="mt-1 text-sm leading-6 text-slate-700">{action.recommendation}</p>
          </div>
          <div className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Why now</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">{action.reasoningSummary}</p>
        </div>
        <div className="min-w-24 rounded-xl bg-brand-50 p-3 text-center">
          <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Priority</div>
          <div className="mt-1 text-3xl font-bold text-brand-700">{action.priorityScore}</div>
          <div className="text-xs font-semibold text-brand-700">{action.confidence}% confidence</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold uppercase text-slate-400">Expected impact</span>{action.expectedImpact}</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold uppercase text-slate-400">Effort / risk</span>{titleCase(action.estimatedEffort)} effort · {titleCase(action.riskLevel)} risk</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold uppercase text-slate-400">Goal</span>{action.businessGoal || "Project growth goal"}</div>
      </div>
      {Object.keys(factors).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(factors).map(([key, value]) => (
            <span key={key} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">{titleCase(key)} {value}</span>
          ))}
        </div>
      )}
      {blockers.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-amber-800">Required before this can start</div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">{blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}</ul>
        </div>
      )}
      {action.followupTask && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          Execution task created: {action.followupTask.title} · {titleCase(action.followupTask.status)}
        </div>
      )}
      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Next step</div>
          <p className="mt-1 text-xs leading-5 text-slate-600">{nextStep}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {taskHref ? (
            <Link to={taskHref} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
              {workspace.label} →
            </Link>
          ) : canCreateTask ? (
            <>
              <Button onClick={() => onDecision(action, "accepted")} disabled={busy}>{primary ? "Start with AI" : startLabel}</Button>
              <Button variant="ghost" onClick={() => onDecision(action, "edited")} disabled={busy}>Edit & Start</Button>
            </>
          ) : blockers.length ? (
            <Link to="/billing" className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-50">
              Review AI Capacity →
            </Link>
          ) : (
            <Link to={`/growth?projectId=${encodeURIComponent(projectId)}&tab=history`} className="inline-flex items-center justify-center rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50">
              View Decision History →
            </Link>
          )}
          {primary && !action.followupTask && !["accepted", "completed"].includes(action.status) && (
            <>
              <Button variant="ghost" onClick={() => onDecision(action, "deferred")} disabled={busy}>Defer 7 Days</Button>
              <Button variant="ghost" onClick={() => onDecision(action, "alternatives")} disabled={busy}>Show Alternatives</Button>
              <Button variant="ghost" onClick={() => onDecision(action, "rejected")} disabled={busy}>Reject</Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function ReadinessChecklist({ items }: { items: GrowthReadinessItem[] }) {
  const missing = items.filter((item) => item.status !== "complete");
  const complete = items.filter((item) => item.status === "complete");
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Readiness Checklist</div>
        <h2 className="mt-2 text-xl font-bold text-charcoal-950">Before SEnuke AI - AI Growth Operating System can run this, we need to complete these missing steps.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Growth Engine depends on the project direction, approved strategy, and site analysis so it does not create false recommendations from missing data.
        </p>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {missing.map((item) => {
          const inProgress = item.status === "in_progress";
          return (
          <div key={item.key} className={`rounded-xl border p-4 ${inProgress ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`font-bold ${inProgress ? "text-blue-950" : "text-amber-950"}`}>{item.title}</h3>
                <p className={`mt-2 text-sm leading-6 ${inProgress ? "text-blue-900" : "text-amber-900"}`}>{item.description}</p>
              </div>
              <span className={`rounded-full bg-white px-2 py-1 text-xs font-bold ${inProgress ? "text-blue-700" : "text-amber-700"}`}>{inProgress ? "In progress" : "Required"}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.actions.map((action) => (
                <Link
                  key={`${item.key}-${action.label}`}
                  to={action.url}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
          );
        })}
      </div>
      {complete.length > 0 && (
        <div className="border-t border-slate-100 p-5">
          <div className="text-sm font-bold text-slate-700">Already complete</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {complete.map((item) => (
              <span key={item.key} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">✓ {item.title}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function IntelligenceReadiness({ controller }: { controller: NonNullable<GrowthOverviewResponse["workflowController"]> }) {
  const incomplete = controller.intelligenceModules.filter((item) =>
    item.required && !["complete", "approved", "waived"].includes(item.status),
  );
  const consolidatedGapAction = incomplete.find((item) =>
    ["technical_seo", "content_gap_analysis"].includes(item.key) && item.action?.url.includes("/gap-analysis"),
  )?.action ?? null;

  if (!incomplete.length && !controller.strategyStale) return null;

  return (
    <Card className="overflow-hidden border-amber-200">
      <div className="border-b border-amber-100 bg-amber-50 p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Growth readiness</div>
        <h2 className="mt-2 text-xl font-bold text-charcoal-950">
          {incomplete.length ? "Gap Analysis was completed earlier and now needs a refresh" : `Strategy v${controller.strategyVersion || 1} was completed earlier and now needs regeneration`}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {incomplete.length
            ? consolidatedGapAction
              ? "The website crawl is complete. Run the consolidated SEO & Gap Analysis once to refresh the Technical SEO, Content Gap, AI Citation, and Authority evidence below."
              : "The website crawl is complete, but Growth needs the post-crawl findings below so it does not recommend work from older pre-launch evidence."
            : "The live-site evidence is newer than the approved Strategy. Regenerate and approve the Strategy so Growth uses the current website."}
        </p>
        {consolidatedGapAction && (
          <Link
            to={consolidatedGapAction.url}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700"
          >
            Refresh Gap Analysis · Run Again
          </Link>
        )}
      </div>
      {incomplete.length > 0 && (
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          {incomplete.map((item) => (
            <div key={item.key} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-amber-950">{item.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-amber-900">{item.reason}</p>
                </div>
                <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-700">Required</span>
              </div>
              {item.action && !consolidatedGapAction && (
                <Link
                  to={item.action.url}
                  className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  {item.action.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
      {!incomplete.length && controller.strategyStale && (
        <div className="p-5">
          <Link to={`/strategy?projectId=${controller.projectId}`} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
            Regenerate Strategy · Create New Version
          </Link>
        </div>
      )}
    </Card>
  );
}

export default function GrowthEngine() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [data, setData] = useState<GrowthOverviewResponse | null>(null);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentQueue, setContentQueue] = useState<"now" | "next" | "later" | "conditional" | "all">("now");
  const [selectedContentIds, setSelectedContentIds] = useState<string[]>([]);
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0);
  const projectId = resolveActiveProjectId(projects, params.get("projectId"), getActiveProjectId());

  useEffect(() => {
    api.get<{ projects: GuidedProject[] }>("/api/projects-v2")
      .then((result) => { setProjects(result.projects); const resolved = resolveActiveProjectId(result.projects, params.get("projectId"), getActiveProjectId()); if (resolved) { setActiveProjectId(resolved); if (params.get("projectId") !== resolved) setParams({ projectId: resolved, tab }); } })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load projects"));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setActiveProjectId(projectId);
    api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`)
      .then((result) => {
        setData(result);
        if (!params.get("projectId")) setParams({ projectId });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load growth engine"))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    setSelectedContentIds([]);
    setContentQueue("now");
  }, [projectId]);

  const scoreEntries = useMemo(() => Object.entries(data?.signals.scoreJson ?? {}), [data]);

  async function runAction(path: string, nextTab?: Tab) {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(path, {});
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setWorkflowRefreshKey((value) => value + 1);
      if (nextTab) {
        setTab(nextTab);
        setParams({ projectId, tab: nextTab });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function decideRecommendation(action: GrowthCandidateAction, decision: "accepted" | "edited" | "deferred" | "rejected" | "alternatives") {
    if (!projectId) return;
    let title: string | undefined;
    let recommendation: string | undefined;
    let comment: string | undefined;
    if (decision === "edited") {
      const editedTitle = window.prompt("Edit the action title", action.title);
      if (editedTitle === null) return;
      const editedRecommendation = window.prompt("Edit the recommended action", action.recommendation);
      if (editedRecommendation === null) return;
      title = editedTitle.trim();
      recommendation = editedRecommendation.trim();
    }
    if (decision === "rejected") {
      const feedback = window.prompt("Why should the Growth Engine avoid this recommendation next time? (optional)", "");
      if (feedback === null) return;
      comment = feedback.trim() || undefined;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects-v2/${projectId}/growth/actions/${action.id}/decision`, {
        decision,
        title,
        recommendation,
        comment,
        deferDays: decision === "deferred" ? 7 : undefined,
      });
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      const savedAction = fresh.growth.candidateActions.find((candidate) => candidate.id === action.id) ?? action;
      if ((decision === "accepted" || decision === "edited") && savedAction.followupTask) {
        navigate(growthActionWorkspace(savedAction, projectId).url);
        return;
      }
      setTab("recommendations");
      setParams({ projectId, tab: "recommendations" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recommendation decision");
    } finally {
      setBusy(false);
    }
  }

  async function updateExperiment(path: string, body: unknown, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post(path, body);
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setTab("experiments");
      setParams({ projectId, tab: "experiments" });
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function approveExperiment(id: string, input: ExperimentStartInput) {
    return updateExperiment(`/api/growth/experiments/${id}/approve`, input, "Could not approve experiment");
  }

  function startExperiment(id: string) {
    return updateExperiment(`/api/growth/experiments/${id}/start`, {}, "Could not start experiment");
  }

  function pauseExperiment(id: string) {
    return updateExperiment(`/api/growth/experiments/${id}/pause`, {}, "Could not pause experiment");
  }

  async function recordExperimentResult(id: string, input: ExperimentResultInput) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/growth/experiments/${id}/results`, input);
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setWorkflowRefreshKey((value) => value + 1);
      setTab(input.evaluationWindowComplete ? "history" : "tracker");
      setParams({ projectId, tab: input.evaluationWindowComplete ? "history" : "tracker" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the experiment result");
    } finally {
      setBusy(false);
    }
  }

  async function updateContentOpportunity(opportunity: GrowthContentOpportunity, input: { queue?: "now" | "next" | "later" | "conditional"; lifecycleStatus?: "proposed" | "deferred" | "rejected" }) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/projects-v2/${projectId}/growth/content-roadmap/opportunities/${opportunity.id}`, input);
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setSelectedContentIds((current) => current.filter((id) => id !== opportunity.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the content opportunity");
    } finally {
      setBusy(false);
    }
  }

  async function approveContentOpportunities(opportunityIds = selectedContentIds, openAfterCreate = false) {
    if (!opportunityIds.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects-v2/${projectId}/growth/content-roadmap/batches/approve`, { opportunityIds });
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setSelectedContentIds([]);
      if (openAfterCreate && opportunityIds.length === 1) {
        const created = fresh.growth.contentRoadmap?.opportunities.find((item) => item.id === opportunityIds[0]);
        if (created?.executionTaskId) navigate(`/ai-content?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(created.executionTaskId)}&open=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the selected content task");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-charcoal-400">Loading Growth Engine...</div>;
  if (!projects.length) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-2xl font-bold text-charcoal-950">No project available</h1>
        <p className="mt-2 text-sm text-slate-500">Create a project first so Growth Engine can diagnose funnel constraints and create experiments.</p>
        <Button className="mt-5" onClick={() => navigate("/projects/new")}>Create Project</Button>
      </Card>
    );
  }
  if (!data) return <Card className="p-4 text-sm text-red-700">{error || "Growth data unavailable"}</Card>;
  const foundationReady = data.readiness.canRun;
  const workflowReady = Boolean(data.workflowController?.intelligenceReady && !data.workflowController.strategyStale);
  const canRunGrowth = foundationReady && workflowReady;
  const blueprintVersion = data.growth.blueprint?.versions[0] ?? null;
  const contentRoadmap = data.growth.contentRoadmap;
  const contentQueueOrder = { now: 0, next: 1, later: 2, conditional: 3 };
  const visibleContentOpportunities = (contentRoadmap?.opportunities ?? []).filter((item) =>
    contentQueue === "all" ? item.lifecycleStatus !== "superseded" : item.queue === contentQueue && item.lifecycleStatus !== "superseded",
  ).sort((left, right) => contentQueueOrder[left.queue] - contentQueueOrder[right.queue] || right.priorityScore - left.priorityScore);
  const selectableContentOpportunities = visibleContentOpportunities.filter((item) => ["proposed", "deferred"].includes(item.lifecycleStatus) && !item.executionTaskId);
  const recommendedContentOpportunity = selectableContentOpportunities[0] ?? null;
  const findings = findingItems(data.growth.diagnosis?.findingsJson);
  const growthStrategySynced = Boolean(data.strategyContext?.strategyId && data.growth.blueprint?.approvedStrategyId === data.strategyContext.strategyId && data.growth.blueprint?.status === "active");
  const officialNextAction = data.workflowController?.nextBestAction ?? null;
  const contentQueueHelp = contentQueue === "now"
    ? "Now contains the content worth executing first. Create one task and open it, or select several to create a small working batch."
    : contentQueue === "next"
      ? "Next is the near-term queue. Move an item to Now when it becomes a priority, or create its task immediately if you are ready."
      : contentQueue === "later"
        ? "Later is an idea backlog, not active work. Move only a strong item forward; do not create all of these tasks at once."
        : contentQueue === "conditional"
          ? "Conditional items should wait until their stated evidence or dependency exists. Move one forward only when that condition is met."
          : "All shows the complete opportunity inventory. Filter to Now when choosing the next work to execute.";

  return (
    <div className="space-y-5">
      <ProjectModuleHeader
        eyebrow="AI Growth Engine"
        title={data.project.businessName || data.project.name}
        subtitle="Turn the approved Strategy and live project evidence into one prioritized Growth Blueprint, Next Best Action, execution sequence, measurement, and continuous learning."
        project={data.project}
        projects={projects}
        tasks={data.project.executionTasks ?? []}
        onProjectChange={(nextProjectId) => { setActiveProjectId(nextProjectId); setParams({ projectId: nextProjectId, tab }); }}
        actions={[{
          key: "refresh-growth",
          label: busy ? "Refreshing…" : data.growth.blueprint ? "Refresh Growth Engine" : "Run Growth Engine",
          disabled: busy || !canRunGrowth,
          onClick: () => { void runAction(`/api/projects-v2/${projectId}/growth/analyze`, "recommendations"); },
        }]}
        showExecution
      />

      <ProjectWorkflowController
        projectId={projectId}
        refreshKey={workflowRefreshKey + (data.project.executionTasks?.length ?? 0) + (data.growth.blueprint?.currentVersion ?? 0)}
        compact
      />

      {error && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>}

      {!foundationReady && <ReadinessChecklist items={data.readiness.items} />}
      {foundationReady && data.workflowController && !workflowReady && <IntelligenceReadiness controller={data.workflowController} />}

      {!canRunGrowth ? null : (
      <>

      {!growthStrategySynced && <Card className="border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-600 px-2.5 py-1 text-xs font-bold text-white">Strategy refresh required</span>
              <span className="text-xs font-bold text-amber-900">Approved Strategy v{data.strategyContext?.version ?? "—"}</span>
              <span className="text-xs font-semibold text-slate-500">{data.strategyContext?.focusAreas.length ?? 0} focus areas drive Growth</span>
            </div>
            <h2 className="mt-3 font-bold text-charcoal-950">Synchronize Growth with the approved Strategy</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              A newer Strategy is approved. Refresh the Growth Engine to rebuild the Blueprint and Next Best Action from that exact Strategy version and current evidence.
            </p>
            {data.strategyContext?.phases[0] && (
              <p className="mt-2 text-xs font-semibold text-amber-800">Current strategic phase: {data.strategyContext.phases[0].name} · {data.strategyContext.phases[0].timeframe}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "recommendations")} disabled={busy}>Refresh Growth Engine</Button>
            <Link to={`/strategy?projectId=${projectId}`} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50">Review Strategy</Link>
          </div>
        </div>
      </Card>}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Evidence readiness" value={data.signals.growthScore} detail="Readiness to diagnose and measure—not a performance score" />
        <Stat label="Current diagnosis" value={titleCase(data.growth.diagnosis?.bottleneckType || data.signals.bottleneckType)} detail={data.signals.evidenceStates[data.growth.diagnosis?.bottleneckType || data.signals.bottleneckType] === "observed" ? "Supported by mapped outcome evidence" : "Measurement required before declaring a constraint"} />
        <Stat label="Next Best Action" value={officialNextAction?.confidence ?? data.growth.selectedAction?.priorityScore ?? "—"} detail={officialNextAction?.title || data.growth.selectedAction?.title || "Run the engine to select one action"} />
        <Stat label="Blueprint version" value={data.growth.blueprint ? `v${data.growth.blueprint.currentVersion}` : "—"} detail={data.growth.blueprint?.nextReviewAt ? `Review ${new Date(data.growth.blueprint.nextReviewAt).toLocaleDateString()}` : "Not generated"} />
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap gap-2">
          {(["overview", "blueprint", "content", "recommendations", "diagnosis", "evidence", "funnel", "experiments", "tracker", "history", "report"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setTab(item); setParams({ projectId, tab: item }); }}
              className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === item ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {titleCase(item)}
            </button>
          ))}
        </div>
      </Card>

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-white shadow-sm">
            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Growth Intelligence · continuous optimization</div>
                <h2 className="mt-2 text-xl font-bold">Measure what changed, learn from evidence, then choose one valid next action</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Verified execution activates measurement. SEnuke AI - AI Growth Operating System separates missing evidence from zero, evaluates the result without inventing causality, updates the versioned Growth Blueprint, and sends one governed Next Best Action to execution.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-white/10 p-3"><div className="text-2xl font-bold">{data.growthIntelligence.lifecycle.verifiedExposures}</div><div className="text-[11px] text-slate-300">Verified exposures</div></div>
                <div className="rounded-xl bg-white/10 p-3"><div className="text-2xl font-bold">{data.growthIntelligence.lifecycle.dueEvaluations}</div><div className="text-[11px] text-slate-300">Evaluations due</div></div>
                <div className="rounded-xl bg-white/10 p-3"><div className="text-2xl font-bold">{data.growthIntelligence.blueprint.patchCount}</div><div className="text-[11px] text-slate-300">Blueprint learnings</div></div>
                <div className="rounded-xl bg-white/10 p-3"><div className="text-sm font-bold text-emerald-300">{titleCase(data.growthIntelligence.lifecycle.state)}</div><div className="text-[11px] text-slate-300">Measurement state</div></div>
              </div>
            </div>
            {data.growthIntelligence.dataQuality.limitations.length > 0 && <div className="border-t border-white/10 bg-white/5 px-5 py-3 text-xs text-amber-200">Known limitations: {data.growthIntelligence.dataQuality.limitations.join(" · ")}</div>}
          </div>
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Automatic monitoring</div>
                  <h2 className="mt-1 text-lg font-bold text-charcoal-950">Continuous Growth Intelligence</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Runs after qualifying project events and on saved source schedules. It records unavailable evidence honestly, combines event bursts, and changes Growth priority only after a meaningful comparison.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className={`rounded-full px-3 py-1 ${statusBadge(data.growthIntelligence.continuousMonitoring.status)}`}>{titleCase(data.growthIntelligence.continuousMonitoring.status)}</span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">0 AI Capacity</span>
                </div>
              </div>
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[280px_1fr]">
              <div className="space-y-3 text-sm">
                <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Last checked</div><div className="mt-1 font-bold text-slate-800">{data.growthIntelligence.continuousMonitoring.lastCheckedAt ? new Date(data.growthIntelligence.continuousMonitoring.lastCheckedAt).toLocaleString() : "Waiting for first cycle"}</div></div>
                <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Next scheduled</div><div className="mt-1 font-bold text-slate-800">{data.growthIntelligence.continuousMonitoring.nextScheduledAt ? new Date(data.growthIntelligence.continuousMonitoring.nextScheduledAt).toLocaleString() : "Activates after Strategy approval"}</div></div>
                <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">NBA decision</div><div className="mt-1 font-bold text-slate-800">{data.growthIntelligence.continuousMonitoring.decision?.outcome ?? "No decision yet"}</div>{data.growthIntelligence.continuousMonitoring.decision && <p className="mt-1 text-xs leading-5 text-slate-500">{data.growthIntelligence.continuousMonitoring.decision.reason}</p>}</div>
              </div>
              <div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {data.growthIntelligence.continuousMonitoring.sources.map((source) => <div key={source.key} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-800">{titleCase(source.key)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusBadge(source.status)}`}>{titleCase(source.status)}</span></div><div className="mt-2 text-[11px] leading-5 text-slate-500">{source.restrictionReason || source.skipReason || `${source.recordCount} evidence record${source.recordCount === 1 ? "" : "s"}`}</div></div>)}
                  {!data.growthIntelligence.continuousMonitoring.sources.length && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 sm:col-span-2 xl:col-span-3">The scheduler will create the first source ledger after the approved Strategy gate is satisfied. No manual Analyze button is required.</div>}
                </div>
                {data.growthIntelligence.continuousMonitoring.findings.length > 0 && <div className="mt-4 space-y-2"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Latest evidence findings</div>{data.growthIntelligence.continuousMonitoring.findings.slice(0, 5).map((finding) => <div key={finding.id} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-900">{titleCase(finding.sourceType)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusBadge(finding.status)}`}>{titleCase(finding.findingType)}</span><span className="text-[10px] font-bold text-slate-400">{finding.confidence}% confidence</span></div><p className="mt-1 text-xs leading-5 text-slate-600">{finding.observedFact}</p>{finding.recommendedResponse && <p className="mt-1 text-xs font-semibold leading-5 text-brand-700">Next response: {finding.recommendedResponse}</p>}</div>)}</div>}
              </div>
            </div>
          </Card>
          <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-charcoal-950">Growth evidence-readiness scorecard</h2><p className="mt-1 text-xs text-slate-500">A low score means evidence or measurement is missing. It does not prove that business performance is poor.</p></div><button type="button" onClick={() => { setTab("diagnosis"); setParams({ projectId, tab: "diagnosis" }); }} className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-bold text-brand-700">Resolve evidence gaps →</button></div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {scoreEntries.map(([key, value]) => <ScoreBar key={key} label={titleCase(key)} value={value} />)}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Decision loop</h2>
            <div className="mt-4 space-y-3">
              <button type="button" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "recommendations")} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">Refresh evidence and recommendation</div>
                <div className="mt-1 text-sm text-slate-500">Normalize current signals, diagnose constraints, score candidates, and select one action. No task is created yet.</div>
              </button>
              {data.growth.selectedAction?.followupTask ? (() => { const workspace = growthActionWorkspace(data.growth.selectedAction!, projectId); return <Link to={workspace.url} className="block w-full rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-left hover:bg-brand-50"><div className="font-bold text-charcoal-950">{data.growth.selectedAction!.title}</div><div className="mt-1 text-sm text-slate-500">{workspace.preparation}</div><div className="mt-3 text-xs font-bold text-brand-700">{workspace.label} →</div></Link>; })() : data.growth.selectedAction ? (
                <button type="button" disabled={busy} onClick={() => void decideRecommendation(data.growth.selectedAction!, "accepted")} className="w-full rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-left hover:bg-brand-50 disabled:opacity-50">
                  <div className="font-bold text-charcoal-950">{data.growth.selectedAction.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{data.growth.selectedAction.recommendation}</div>
                  <div className="mt-3 text-xs font-bold text-brand-700">Start Next Best Action with AI →</div>
                </button>
              ) : (
                <button type="button" onClick={() => { setTab("recommendations"); setParams({ projectId, tab: "recommendations" }); }} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"><div className="font-bold text-charcoal-950">Review the Next Best Action</div><div className="mt-1 text-sm text-slate-500">Run the Growth Engine to generate an explainable recommendation.</div></button>
              )}
              <Link to={`/strategy?projectId=${projectId}`} className="block rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">Review approved strategy</div>
                <div className="mt-1 text-sm text-slate-500">The Blueprint and recommendations remain anchored to this approved direction.</div>
              </Link>
            </div>
          </Card>
          </div>
        </div>
      )}

      {tab === "blueprint" && (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Versioned growth direction</div>
                <h2 className="mt-2 text-xl font-bold text-charcoal-950">{data.growth.blueprint?.title || "Growth Blueprint not generated"}</h2>
                <p className="mt-2 text-sm text-slate-500">{data.growth.blueprint?.primaryGoal || "Run the Growth Engine after approving strategy to create Now, Next, Later, and Conditional phases."}</p>
              </div>
              {data.growth.blueprint && <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">Version {data.growth.blueprint.currentVersion}</span>}
            </div>
          </Card>
          {blueprintVersion ? (
            <div className="grid gap-4 xl:grid-cols-4">
              {([
                ["Now", blueprintVersion.nowJson, "The single action selected for attention now."],
                ["Next", blueprintVersion.nextJson, "Sequenced actions after the current constraint."],
                ["Later", blueprintVersion.laterJson, "Valid opportunities deliberately held back."],
                ["Conditional", blueprintVersion.conditionalJson, "Actions waiting for prerequisites or better evidence."],
              ] as const).map(([label, value, description]) => (
                <Card key={label} className="p-4">
                  <h3 className="font-bold text-charcoal-950">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                  <div className="mt-4 space-y-3">
                    {blueprintItems(value).length === 0 ? <div className="text-sm text-slate-400">No action assigned.</div> : blueprintItems(value).map((item, index) => {
                      const matchingAction = data.growth.candidateActions.find((action) => action.dedupeKey === item.dedupeKey || action.title === item.title);
                      const workspace = matchingAction ? growthActionWorkspace(matchingAction, projectId) : null;
                      return <div key={item.dedupeKey || `${label}-${index}`} className="rounded-lg border border-slate-200 p-3">
                        <div className="font-semibold text-slate-800">{item.title || "Growth action"}</div>
                        <div className="mt-1 text-xs font-bold text-brand-600">{titleCase(item.route || "growth")} · score {item.score ?? "—"}</div>
                        {item.rationale && <p className="mt-2 text-xs leading-5 text-slate-500">{item.rationale}</p>}
                        {item.conditions && item.conditions.length > 0 && <div className="mt-2 text-xs text-amber-700">Needs: {item.conditions.join(", ")}</div>}
                        {matchingAction && <div className="mt-3 border-t border-slate-100 pt-3">{matchingAction.followupTask && workspace ? <Link to={workspace.url} className="inline-flex rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">{workspace.label} →</Link> : matchingAction.status === "completed" ? <button type="button" onClick={() => { setTab("history"); setParams({ projectId, tab: "history" }); }} className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-bold text-brand-700">View outcome →</button> : <button type="button" disabled={busy || Boolean(item.conditions?.length)} onClick={() => void decideRecommendation(matchingAction, "accepted")} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">Start with AI →</button>}</div>}
                      </div>;
                    })}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="overflow-hidden"><EmptyState eyebrow="Growth Intelligence" title="No Growth Blueprint exists yet" description="Create the first evidence-led Blueprint from the approved Strategy and current project signals." action={<Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "blueprint")} disabled={busy}>Generate Blueprint</Button>} /></Card>
          )}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-white p-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Plan within the Growth Blueprint</div>
                <h2 className="mt-2 text-xl font-bold text-charcoal-950">Supporting Content Distribution Plan</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{contentRoadmap?.recommendationRationale || "Map the complete supporting-content opportunity, then generate only the current approved phase."}</p>
              </div>
              <Button onClick={() => contentRoadmap ? (setTab("content"), setParams({ projectId, tab: "content" })) : runAction(`/api/projects-v2/${projectId}/growth/content-roadmap/refresh`, "content")} disabled={busy || !canRunGrowth}>{contentRoadmap ? "Open Content Plan" : "Generate Content Plan"}</Button>
            </div>
            {contentRoadmap && <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Total opportunity" value={contentRoadmap.opportunityCount} />
              <Stat label="Now" value={contentRoadmap.nowCount} detail="Current approved phase" />
              <Stat label="Next" value={contentRoadmap.nextCount} detail="Next 30–90 days" />
              <Stat label="Later" value={contentRoadmap.laterCount} detail="Long-term backlog" />
              <Stat label="Conditional" value={contentRoadmap.conditionalCount} detail="Evidence-triggered" />
            </div>}
          </Card>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-pink-50 to-white p-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-pink-700">Plan within the Growth Blueprint</div>
                <h2 className="mt-2 text-xl font-bold text-charcoal-950">Social Distribution & Repurposing Plan</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{data.growth.socialDistribution?.strategySummary || "Turn approved project intelligence and existing content into a coordinated, approval-based social calendar, then feed measured results back into Growth."}</p>
              </div>
              <Link to={`/social-strategy?projectId=${projectId}`} className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold text-white">{data.growth.socialDistribution ? "Open Social Plan" : "Create Social Plan"}</Link>
            </div>
            {data.growth.socialDistribution && (
              <div className="border-b border-slate-100 bg-white px-5 py-3 text-xs font-semibold text-slate-600">
                {data.growth.socialDistribution.campaignName || "Social campaign"} · {data.growth.socialDistribution.campaignStartAt ? formatDate(data.growth.socialDistribution.campaignStartAt) : "Start date not set"} – {data.growth.socialDistribution.campaignEndAt ? formatDate(data.growth.socialDistribution.campaignEndAt) : "End date not set"} · Target: {data.growth.socialDistribution.goalTarget ?? "Baseline"} {(data.growth.socialDistribution.goalMetric || "success metric").replaceAll("_", " ")}
              </div>
            )}
            {data.growth.socialDistribution && <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Platforms" value={data.growth.socialDistribution.platforms.length} detail={data.growth.socialDistribution.platforms.join(", ")} />
              <Stat label="Calendar posts" value={data.growth.socialDistribution.posts.length} detail={data.growth.socialDistribution.postingFrequency || "Rolling calendar"} />
              <Stat label="Repurposing batches" value={data.growth.socialDistribution.repurposingBatches.length} detail="Existing content reused" />
              <Stat label="Performance records" value={data.growth.socialDistribution.metrics.length} detail="Feeds Growth learning" />
              <Stat label="Approved assets" value={data.growth.socialDistribution.repurposingBatches.flatMap((batch) => batch.assets).filter((asset) => asset.status === "approved").length} detail="Ready or distributed" />
            </div>}
          </Card>
        </div>
      )}

      {tab === "content" && (
        <div className="space-y-5">
          {!contentRoadmap ? (
            <Card className="overflow-hidden"><EmptyState eyebrow="Growth Blueprint" title="Generate the Supporting Content Plan" description="SEnuke AI - AI Growth Operating System will use the approved Strategy, keyword research, website pages, target markets, and business goals to build a complete opportunity map. It will not generate the articles yet." action={<Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/content-roadmap/refresh`, "content")} disabled={busy || !canRunGrowth}>{busy ? "Researching opportunities…" : "Generate Supporting Content Plan"}</Button>} /></Card>
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-cyan-50 p-5">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Growth Blueprint · Supporting Content Plan v{contentRoadmap.currentVersion}</div>
                    <h2 className="mt-2 text-xl font-bold text-charcoal-950">Phased authority and publishing roadmap</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{contentRoadmap.recommendationRationale}</p>
                    <div className="mt-3 text-xs font-semibold text-slate-500">Cadence: {contentRoadmap.recommendedCadence}{contentRoadmap.nextReviewAt ? ` · Reassess ${new Date(contentRoadmap.nextReviewAt).toLocaleDateString()}` : ""}</div>
                  </div>
                  <Button variant="ghost" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/content-roadmap/refresh`, "content")} disabled={busy}>{busy ? "Refreshing research…" : "Refresh Research"}</Button>
                </div>
                <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
                  <Stat label="Total opportunity" value={contentRoadmap.opportunityCount} />
                  <Stat label="Now" value={contentRoadmap.nowCount} detail="Generate this phase first" />
                  <Stat label="Next" value={contentRoadmap.nextCount} detail="30–90 day plan" />
                  <Stat label="Later" value={contentRoadmap.laterCount} detail="Expansion backlog" />
                  <Stat label="Conditional" value={contentRoadmap.conditionalCount} detail="Wait for evidence" />
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="border-b border-brand-100 bg-brand-50/60 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Turn the plan into work</div><h2 className="mt-1 text-lg font-bold text-charcoal-950">Choose content to create as an Execution task</h2><p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">{contentQueueHelp}</p></div>{recommendedContentOpportunity&&<button type="button" disabled={busy} onClick={() => void approveContentOpportunities([recommendedContentOpportunity.id], true)} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">Start Highest-Priority Content with AI →</button>}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["now", `Now · ${contentRoadmap.nowCount}`],
                      ["next", `Next · ${contentRoadmap.nextCount}`],
                      ["later", `Later · ${contentRoadmap.laterCount}`],
                      ["conditional", `Conditional · ${contentRoadmap.conditionalCount}`],
                      ["all", `All · ${contentRoadmap.opportunityCount}`],
                    ] as const).map(([queue, label]) => <button key={queue} type="button" onClick={() => { setContentQueue(queue); setSelectedContentIds([]); }} className={`rounded-full px-3 py-2 text-xs font-bold ${contentQueue === queue ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!selectableContentOpportunities.length} onClick={() => setSelectedContentIds(selectableContentOpportunities.map((item) => item.id))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:text-slate-300">Select all in this view</button>
                    <Button onClick={() => void approveContentOpportunities()} disabled={busy || !selectedContentIds.length}>{busy ? "Creating tasks…" : `Create Selected Content Tasks${selectedContentIds.length ? ` (${selectedContentIds.length})` : ""}`}</Button>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  {visibleContentOpportunities.map((opportunity) => {
                    const selectable = ["proposed", "deferred"].includes(opportunity.lifecycleStatus) && !opportunity.executionTaskId;
                    const selected = selectedContentIds.includes(opportunity.id);
                    return <div key={opportunity.id} className={`rounded-xl border p-4 ${selected ? "border-brand-400 bg-brand-50/40 ring-1 ring-brand-100" : "border-slate-200 bg-white"}`}>
                      <div className="flex flex-wrap items-start gap-3">
                        <label className={`mt-1 ${selectable ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}><input type="checkbox" disabled={!selectable} checked={selected} onChange={() => setSelectedContentIds((current) => current.includes(opportunity.id) ? current.filter((id) => id !== opportunity.id) : [...current, opportunity.id])}/></label>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${opportunity.queue === "now" ? "bg-emerald-100 text-emerald-700" : opportunity.queue === "next" ? "bg-cyan-100 text-cyan-700" : opportunity.queue === "conditional" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{opportunity.queue}</span>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusBadge(opportunity.lifecycleStatus)}`}>{titleCase(opportunity.lifecycleStatus)}</span>
                            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">{titleCase(opportunity.plannedPhase)}</span>
                          </div>
                          <h3 className="mt-2 text-base font-bold text-charcoal-950">{opportunity.title}</h3>
                          <div className="mt-1 text-xs font-semibold text-brand-700">{opportunity.primaryKeyword} · {titleCase(opportunity.searchIntent)} · {opportunity.clusterName}</div>
                          <p className="mt-3 text-sm leading-6 text-slate-600">{opportunity.recommendationReason}</p>
                          <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                            <div className="rounded-lg bg-slate-50 p-3"><span className="block font-bold uppercase text-slate-400">Business purpose</span><span className="mt-1 block leading-5 text-slate-700">{opportunity.businessPurpose}</span></div>
                            <div className="rounded-lg bg-slate-50 p-3"><span className="block font-bold uppercase text-slate-400">Target page</span><span className="mt-1 block break-all leading-5 text-slate-700">{opportunity.internalLinkTargetUrl || opportunity.targetUrl || "Assign during content review"}</span></div>
                            <div className="rounded-lg bg-slate-50 p-3"><span className="block font-bold uppercase text-slate-400">Priority</span><span className="mt-1 block text-lg font-bold text-brand-700">{opportunity.priorityScore}/100</span><span className="text-slate-500">{opportunity.confidence}% confidence</span></div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                        {opportunity.executionTaskId && <Link to={`/ai-content?projectId=${projectId}&taskId=${opportunity.executionTaskId}&open=1`} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Open Content Task →</Link>}
                        {selectable && <button type="button" disabled={busy} onClick={() => void approveContentOpportunities([opportunity.id], true)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">{busy ? "Creating task…" : "Create Task & Open →"}</button>}
                        {selectable && opportunity.queue !== "next" && <button type="button" disabled={busy} onClick={() => void updateContentOpportunity(opportunity, { queue: "next" })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">Move to Next</button>}
                        {selectable && opportunity.queue !== "now" && <button type="button" disabled={busy} onClick={() => void updateContentOpportunity(opportunity, { queue: "now" })} className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-bold text-brand-700">Move to Now</button>}
                        {selectable && <button type="button" disabled={busy} onClick={() => void updateContentOpportunity(opportunity, { lifecycleStatus: "rejected" })} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Reject</button>}
                      </div>
                    </div>;
                  })}
                  {!visibleContentOpportunities.length && <div className="p-8 text-center text-sm text-slate-500">No supporting-content opportunities are assigned to this queue.</div>}
                </div>
              </Card>

              {contentRoadmap.batches.length > 0 && <Card className="overflow-hidden">
                <div className="border-b border-slate-100 p-5"><h2 className="font-bold text-charcoal-950">Approved generation batches</h2><p className="mt-1 text-sm text-slate-500">Only these approved opportunities are available for AI generation.</p></div>
                <div className="space-y-3 p-5">{contentRoadmap.batches.map((batch) => <div key={batch.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-bold text-charcoal-950">{batch.title}</div><div className="mt-1 text-xs font-semibold text-emerald-700">{batch.opportunityCount} opportunities · {titleCase(batch.phase)} · {titleCase(batch.status)}</div></div><span className="text-xs text-slate-500">{batch.approvedAt ? `Approved ${new Date(batch.approvedAt).toLocaleDateString()}` : "Approved batch"}</span></div><div className="mt-3 flex flex-wrap gap-2">{batch.opportunities.map((item) => item.executionTaskId ? <Link key={item.id} to={`/ai-content?projectId=${projectId}&taskId=${item.executionTaskId}&open=1`} className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700">{item.title} →</Link> : <span key={item.id} className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-500">{item.title}</span>)}</div></div>)}</div>
              </Card>}
            </>
          )}
        </div>
      )}

      {tab === "recommendations" && (
        <div className="space-y-4">
          {data.growth.selectedAction ? (
            <RecommendationCard action={data.growth.selectedAction} projectId={projectId} primary busy={busy} onDecision={decideRecommendation} />
          ) : (
            <Card className="p-8 text-center">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusBadge(data.growth.decisionState.key === "NO_MATERIAL_ACTION" ? "evidence_available" : data.growth.decisionState.key === "BLOCKED_BY_DEPENDENCY" ? "blocked" : "watch")}`}>{titleCase(data.growth.decisionState.key)}</span>
              <h2 className="mt-3 font-bold text-charcoal-950">{data.growth.decisionState.title}</h2>
              <p className="mt-2 text-sm text-slate-500">{data.growth.decisionState.message}</p>
              <Button className="mt-4" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "recommendations")} disabled={busy}>Refresh Evidence &amp; Actions</Button>
            </Card>
          )}
          {data.growth.candidateActions.filter((action) => action.id !== data.growth.selectedAction?.id).length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-charcoal-950">Other scored candidates and prior decisions</h2>
              {data.growth.candidateActions.filter((action) => action.id !== data.growth.selectedAction?.id).map((action) => (
                <RecommendationCard key={action.id} action={action} projectId={projectId} busy={busy} onDecision={decideRecommendation} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "diagnosis" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Top diagnosis</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{data.growth.diagnosis?.summary || "Run diagnosis to create a stored growth bottleneck and scorecard."}</p>
            {data.growth.diagnosis && <div className="mt-2 text-xs font-semibold text-slate-400">{data.growth.diagnosis.confidence}% confidence · {titleCase(data.growth.diagnosis.runType)} run</div>}
            {data.signals.contradictions.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-amber-800">Conflicting evidence needs review</div>
                <div className="mt-2 space-y-2">{data.signals.contradictions.map((item) => <p key={item.dimension} className="text-sm leading-6 text-amber-950"><b>{titleCase(item.dimension)}:</b> {item.message}</p>)}</div>
                <p className="mt-2 text-xs text-amber-800">The affected result is treated as limited evidence and diagnosis confidence is reduced until the source, period, segment, or metric mapping is resolved.</p>
              </div>
            )}
            {findings.length > 0 && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-brand-700">How to resolve the diagnosis</div>
                  <p className="mt-1 text-sm leading-6 text-slate-700">Work from the lowest score down, one action at a time. Create the matching Execution task, complete it, and record the result; the next Growth refresh will then reassess the score from current evidence.</p>
                </div>
                {findings.map((finding, index) => {
                  const dimension = finding.key?.replace(/^constraint:/, "") ?? "";
                  const matchingAction = data.growth.candidateActions.find((action) => stringItems(action.targetEntitiesJson).includes(dimension));
                  const matchingWorkspace = matchingAction ? growthActionWorkspace(matchingAction, projectId) : null;
                  const matchingTaskHref = matchingAction?.followupTask ? matchingWorkspace?.url ?? null : null;
                  return (
                  <div key={finding.key || index} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-bold text-slate-800">{finding.title}</div>
                      <div className="flex flex-wrap justify-end gap-2"><span className={`rounded-full px-2 py-1 text-xs font-bold ${finding.evidenceState === "observed" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>{finding.evidenceState === "observed" ? "Observed" : finding.evidenceState === "hypothesis" ? "Hypothesis" : "Evidence gap"}</span><span className={`rounded-full px-2 py-1 text-xs font-bold ${finding.severity === "critical" || finding.severity === "high" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{titleCase(finding.severity || "finding")}</span></div>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{finding.summary}</p>
                    {matchingAction ? (
                      <div className="mt-3 rounded-lg bg-slate-50 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Resolution</div>
                        <div className="mt-1 text-sm font-bold text-charcoal-950">{matchingAction.title}</div>
                        <p className="mt-1 text-xs leading-5 text-slate-600">{matchingAction.recommendation}</p>
                        <div className="mt-3">
                          {matchingTaskHref ? (
                            <Link to={matchingTaskHref} className="inline-flex rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">{matchingWorkspace?.label ?? "Continue with AI"} →</Link>
                          ) : matchingAction.status === "completed" ? (
                            <button type="button" onClick={() => { setTab("recommendations"); setParams({ projectId, tab: "recommendations" }); }} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700">Review Completed Action →</button>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => void decideRecommendation(matchingAction, "accepted")} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">Fix {titleCase(dimension)} with AI →</button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setTab("recommendations"); setParams({ projectId, tab: "recommendations" }); }} className="mt-3 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700">Review Growth Actions →</button>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {scoreEntries.map(([key, value]) => <ScoreBar key={key} label={titleCase(key)} value={value} />)}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Automation status</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{data.automationPolicy.coverage}</p>
            <div className="mt-4 space-y-2">
              {data.automationPolicy.levels.map((level) => <div key={level} className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">{automationBadge(level)}</div>)}
            </div>
          </Card>
        </div>
      )}

      {tab === "evidence" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-charcoal-950">Normalized evidence signals</h2>
            <p className="mt-1 text-sm text-slate-500">Every recommendation records its source, effective date, confidence, and freshness so stale data is visible.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data.growth.evidenceSignals.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">Run the Growth Engine to collect normalized signals.</div>
            ) : data.growth.evidenceSignals.map((signal) => (
              <div key={signal.id} className="grid gap-3 p-4 md:grid-cols-[1fr_180px_120px_120px] md:items-center">
                <div>
                  <div className="font-bold text-charcoal-950">{titleCase(signal.signalKey)}</div>
                  <div className="mt-1 text-sm text-slate-500">{titleCase(signal.category)} · {titleCase(signal.sourceType)}</div>
                </div>
                <div className="text-sm text-slate-600">Effective {new Date(signal.effectiveDate).toLocaleDateString()}</div>
                <div className="text-sm font-bold text-slate-700">{signal.confidence}% confidence</div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${signal.freshnessStatus === "fresh" ? "bg-emerald-50 text-emerald-700" : signal.freshnessStatus === "aging" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{titleCase(signal.freshnessStatus)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "funnel" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-charcoal-950">Measured customer journey</h2>
              <p className="mt-1 text-sm text-slate-500">Each stage shows what is actually measured, what is still unknown, and the next setup action.</p>
            </div>
            <Button variant="ghost" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/funnel-map`, "funnel")} disabled={busy}>Refresh Journey Evidence</Button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {data.growth.funnelStages.map((stage) => (
              <div key={stage.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-charcoal-950">{stage.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadge(stage.status)}`}>{titleCase(stage.status)}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-700">{stage.conversionMetric}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{stage.issueSummary}</p>
                <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">{automationBadge(stage.automationStatus)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "experiments" && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-charcoal-950">Compare acquisition channels</h2>
                <p className="mt-1 text-sm text-slate-500">Compare the role, evidence, readiness, cost, effort, and risk before approving a channel test.</p>
              </div>
              <Button variant="ghost" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/channel-tests`, "experiments")} disabled={busy}>{data.growth.channelTests.length ? "Refresh Comparison" : "Create Comparison"}</Button>
            </div>
            {data.growth.channelTests.length > 0 && (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {data.growth.channelTests.map((test) => {
                  const details = recordObject(test.assetsNeeded);
                  const assets = Array.isArray(details.assets) ? details.assets.map(String) : [];
                  return (
                    <div key={test.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-charcoal-950">{test.channel}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadge(String(details.readiness ?? test.status))}`}>{titleCase(String(details.readiness ?? test.status))}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{String(details.role ?? test.cadence)}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold text-slate-600">
                        <span>Cost: {titleCase(String(details.cost ?? "unknown"))}</span>
                        <span>Effort: {titleCase(String(details.effort ?? "unknown"))}</span>
                        <span>Risk: {titleCase(String(details.risk ?? "unknown"))}</span>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">Evidence: {String(details.evidence ?? "No evidence recorded")}</p>
                      <p className="mt-2 text-xs text-slate-500">Measure: {test.metric}</p>
                      {assets.length > 0 && <p className="mt-2 text-xs text-slate-500">Needs: {assets.join(" · ")}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          {data.growth.experiments.length === 0 ? (
            <Card className="overflow-hidden"><EmptyState eyebrow="Growth Experiments" title="No experiments yet" description="Generate experiments from the latest diagnosis and approved project Strategy." action={<Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/experiments/generate`, "experiments")} disabled={busy}>Generate Experiments</Button>} /></Card>
          ) : data.growth.experiments.map((experiment) => <ExperimentCard key={experiment.id} experiment={experiment} onApprove={approveExperiment} onStart={startExperiment} onPause={pauseExperiment} onRecord={recordExperimentResult} busy={busy} />)}
        </div>
      )}

      {tab === "tracker" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-charcoal-950">Experiment tracker</h2>
            <p className="mt-1 text-sm text-slate-500">Track planned, running, completed, winning, failed, and scaled experiments.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data.growth.experiments.map((experiment) => (
              <div key={experiment.id} className="grid gap-3 p-4 md:grid-cols-[1fr_120px_120px_120px_auto] md:items-center">
                <div>
                  <div className="font-bold text-charcoal-950">{experiment.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{experiment.metric}</div>
                </div>
                <div className="text-sm font-semibold text-slate-700">ICE {experiment.iceScore}</div>
                <div className="text-sm font-semibold text-slate-700">PIE {experiment.pieScore}</div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${statusBadge(experiment.status)}`}>{titleCase(experiment.status)}</span>
                <button type="button" onClick={() => { setTab("experiments"); setParams({ projectId, tab: "experiments" }); }} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700">{experiment.status === "running" ? "Record result" : "Open"}</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "history" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-bold text-charcoal-950">Engine runs</h2>
              <p className="mt-1 text-sm text-slate-500">Auditable snapshots of the evidence and selected output.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.growth.recentRuns.length === 0 ? <div className="p-6 text-sm text-slate-500">No runs recorded.</div> : data.growth.recentRuns.map((run) => (
                <div key={run.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-charcoal-950">Growth Engine run</div>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusBadge(run.status)}`}>{titleCase(run.status)}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">{new Date(run.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-bold text-charcoal-950">Project learning</h2>
              <p className="mt-1 text-sm text-slate-500">Experiment outcomes and user feedback that influence future recommendations.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.growth.learnings.length === 0 ? <div className="p-6 text-sm text-slate-500">Learning begins when recommendations are rejected or experiments produce outcomes.</div> : data.growth.learnings.map((learning) => (
                <div key={learning.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-charcoal-950">{titleCase(learning.outcome)}</div>
                    <div className="text-xs text-slate-400">{new Date(learning.createdAt).toLocaleDateString()}</div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{learning.summary}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "report" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-charcoal-950">Agency Growth Report</h2>
              <p className="mt-1 text-sm text-slate-500">Draft client-ready diagnosis, experiment roadmap, and KPI plan. Human review is required before delivery.</p>
            </div>
            <Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/reports`, "report")} disabled={busy}>Generate Report</Button>
          </div>
          <div className="mt-5 grid gap-3">
            {data.growth.reports.map((report) => (
              <div key={report.id} className="rounded-lg border border-slate-200 p-4">
                <div className="font-bold text-charcoal-950">{titleCase(report.reportType)}</div>
                <div className="mt-1 text-sm text-slate-500">{titleCase(report.status)} · {new Date(report.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      </>
      )}
    </div>
  );
}
