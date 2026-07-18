import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { GuidedExecutionTask } from "../types.js";

export type SeoPlan = {
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

function savedSeoPlan(task: GuidedExecutionTask): SeoPlan | null {
  const value = task.approvalSnapshotJson?.seoPlan;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Partial<SeoPlan>;
  return typeof plan.summary === "string" && Array.isArray(plan.objectives) && Array.isArray(plan.keywordPriorities) && plan.phases && typeof plan.phases === "object" ? plan as SeoPlan : null;
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function isSeoPlanTask(task: GuidedExecutionTask) {
  return /create seo plan/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`);
}

export default function SeoPlanDialog({ task, onClose, onSaved }: {
  task: GuidedExecutionTask;
  onClose: () => void;
  onSaved?: (task: GuidedExecutionTask, tasks: GuidedExecutionTask[], childTaskCount: number) => void;
}) {
  const readOnly = ["completed", "approved", "published", "skipped"].includes(task.status);
  const [plan, setPlan] = useState<SeoPlan | null>(() => savedSeoPlan(task));
  const [busy, setBusy] = useState(!savedSeoPlan(task));
  const [error, setError] = useState("");

  useEffect(() => {
    if (plan) return;
    let active = true;
    setBusy(true);
    api.post<{ task: GuidedExecutionTask; plan: SeoPlan }>(`/api/execution-tasks/${task.id}/seo-plan/prepare`, {}).then((result) => {
      if (active) setPlan(result.plan);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "The SEO plan could not be prepared.");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [plan, task.id]);

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; tasks: GuidedExecutionTask[]; childTaskCount: number }>(`/api/execution-tasks/${task.id}/seo-plan/confirm`, { plan });
      onSaved?.(result.task, result.tasks, result.childTaskCount);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The SEO plan could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Create SEO plan">
    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Project-wide guided plan</div><h2 className="mt-1 text-xl font-black text-charcoal-950">Create SEO Plan</h2><p className="mt-1 text-sm text-charcoal-500">Built from intake, approved keywords, Strategy, target markets, and the latest crawl evidence.</p></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button></div>
      {busy && !plan ? <div className="grid min-h-80 flex-1 place-items-center p-8"><div className="text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" /><div className="mt-4 font-bold text-charcoal-800">Building the project SEO plan…</div><p className="mt-1 text-sm text-charcoal-500">Combining keywords, Strategy, markets, and crawl evidence.</p></div></div> : plan ? <>
        <fieldset disabled={readOnly} className="flex-1 overflow-y-auto p-5 disabled:opacity-90">
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
          <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
            <div className="space-y-4">
              <label className="block text-xs font-bold text-charcoal-600">Executive SEO direction<textarea value={plan.summary} onChange={(event) => setPlan({ ...plan, summary: event.target.value })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-bold text-charcoal-600">Business objectives · one per line<textarea value={plan.objectives.join("\n")} onChange={(event) => setPlan({ ...plan, objectives: lines(event.target.value) })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label><label className="block text-xs font-bold text-charcoal-600">Priority keywords · one per line<textarea value={plan.keywordPriorities.join("\n")} onChange={(event) => setPlan({ ...plan, keywordPriorities: lines(event.target.value) })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label></div>
              <label className="block text-xs font-bold text-charcoal-600">Technical SEO priorities<textarea value={plan.technicalPriorities.join("\n")} onChange={(event) => setPlan({ ...plan, technicalPriorities: lines(event.target.value) })} rows={6} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label>
              <label className="block text-xs font-bold text-charcoal-600">Content and page roadmap<textarea value={plan.contentRoadmap.join("\n")} onChange={(event) => setPlan({ ...plan, contentRoadmap: lines(event.target.value) })} rows={7} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /></label>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4"><div className="text-xs font-black uppercase tracking-wide text-brand-700">90-day execution order</div><div className="mt-3 space-y-3"><label className="block text-xs font-bold text-charcoal-600">Now · highest priority<textarea value={plan.phases.now.join("\n")} onChange={(event) => setPlan({ ...plan, phases: { ...plan.phases, now: lines(event.target.value) } })} rows={4} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm leading-5" /></label><label className="block text-xs font-bold text-charcoal-600">Next<textarea value={plan.phases.next.join("\n")} onChange={(event) => setPlan({ ...plan, phases: { ...plan.phases, next: lines(event.target.value) } })} rows={4} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm leading-5" /></label><label className="block text-xs font-bold text-charcoal-600">Later<textarea value={plan.phases.later.join("\n")} onChange={(event) => setPlan({ ...plan, phases: { ...plan.phases, later: lines(event.target.value) } })} rows={4} className="mt-1 w-full rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm leading-5" /></label></div></div>
              <label className="block text-xs font-bold text-charcoal-600">Local SEO actions<textarea value={plan.localSeoActions.join("\n")} onChange={(event) => setPlan({ ...plan, localSeoActions: lines(event.target.value) })} rows={4} placeholder="Not applicable when the project has no local-market requirement." className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-5" /></label>
              <label className="block text-xs font-bold text-charcoal-600">Authority and AI visibility<textarea value={plan.authorityActions.join("\n")} onChange={(event) => setPlan({ ...plan, authorityActions: lines(event.target.value) })} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-5" /></label>
              <label className="block text-xs font-bold text-charcoal-600">Success metrics<textarea value={plan.kpis.join("\n")} onChange={(event) => setPlan({ ...plan, kpis: lines(event.target.value) })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-5" /></label>
            </div>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4"><p className="max-w-2xl text-xs text-charcoal-500">{readOnly ? "This confirmed plan remains available from Completed tasks. Its execution items are tracked in the Action Inbox." : "Review and edit the plan. Saving confirms it and creates five deduplicated execution tasks for technical SEO, keyword mapping, content, authority, and measurement."}</p><div className="flex gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">{readOnly ? "Close" : "Cancel"}</button>{!readOnly && <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">{busy ? "Creating tasks…" : "Save SEO Plan & Create Tasks"}</button>}</div></div>
      </> : <div className="grid min-h-72 flex-1 place-items-center p-8"><div className="max-w-lg rounded-xl border border-red-200 bg-red-50 p-5 text-center"><div className="font-bold text-red-800">SEO plan could not be opened</div><p className="mt-2 text-sm text-red-700">{error}</p><button type="button" onClick={onClose} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-bold text-red-700 shadow-sm">Close</button></div></div>}
    </div>
  </div>;
}
