import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { GuidedExecutionTask } from "../types.js";

type ContentPlan = {
  summary: string;
  pageUpdates: string[];
  supportingContent: string[];
  faqTopics: string[];
  proofBlocks: string[];
  contentBriefs: string[];
  publishingSequence: string[];
  kpis: string[];
};

export function isContentPlanTask(task: GuidedExecutionTask) {
  return /content\s*plan/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`);
}

function savedPlan(task: GuidedExecutionTask) {
  const value = task.approvalSnapshotJson?.contentPlan;
  return value && typeof value === "object" && !Array.isArray(value) ? value as ContentPlan : null;
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export default function ContentPlanDialog({ task, onClose, onSaved }: { task: GuidedExecutionTask; onClose: () => void; onSaved?: (task: GuidedExecutionTask) => void }) {
  const [plan, setPlan] = useState<ContentPlan | null>(() => savedPlan(task));
  const [busy, setBusy] = useState(!savedPlan(task));
  const [error, setError] = useState("");

  useEffect(() => {
    if (plan) return;
    let active = true;
    setBusy(true);
    api.post<{ task: GuidedExecutionTask; plan: ContentPlan }>(`/api/execution-tasks/${task.id}/content-plan/prepare`, {}).then((result) => {
      if (active) setPlan(result.plan);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "The content plan could not be prepared.");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [plan, task.id]);

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; plan: ContentPlan }>(`/api/execution-tasks/${task.id}/content-plan/save`, { plan });
      onSaved?.(result.task);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The content plan could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: Exclude<keyof ContentPlan, "summary">, rows = 5) => plan && <label className="block text-xs font-bold text-charcoal-600">{label}<textarea value={plan[key].join("\n")} onChange={(event) => setPlan({ ...plan, [key]: lines(event.target.value) })} rows={rows} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label>;

  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Create SEO content plan">
    <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 via-white to-violet-50 px-5 py-4"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Guided content execution</div><h2 className="mt-1 text-xl font-black text-charcoal-950">Create SEO Content Plan</h2><p className="mt-1 text-sm text-charcoal-500">Plan page updates, supporting content, FAQs, proof, briefs and publishing order from the approved project evidence.</p></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button></div>
      {busy && !plan ? <div className="grid min-h-80 flex-1 place-items-center"><div className="text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" /><div className="mt-4 font-bold">Building the content plan…</div></div></div> : plan ? <>
        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
          <label className="block text-xs font-bold text-charcoal-600">Content direction<textarea value={plan.summary} onChange={(event) => setPlan({ ...plan, summary: event.target.value })} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></label>
          <div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="space-y-4">{field("Priority page updates · one per line", "pageUpdates", 7)}{field("Supporting content", "supportingContent", 7)}{field("Content briefs", "contentBriefs", 7)}</div><div className="space-y-4">{field("FAQ topics", "faqTopics", 5)}{field("Proof and trust blocks", "proofBlocks", 5)}{field("Publishing sequence", "publishingSequence", 6)}{field("Success metrics", "kpis", 5)}</div></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4"><p className="max-w-2xl text-xs text-charcoal-500">Saving keeps this guided plan with the project. Because this task requires approval, publishing and protected content changes remain paused until reviewed.</p><div className="flex gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">{busy ? "Saving…" : "Save Content Plan"}</button></div></div>
      </> : <div className="grid min-h-72 place-items-center p-8"><div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-red-700">{error || "The content plan could not be opened."}</div></div>}
    </div>
  </div>;
}
