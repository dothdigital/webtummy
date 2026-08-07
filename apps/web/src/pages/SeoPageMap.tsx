import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import ContentPlanDialog from "../components/ContentPlanDialog.js";
import type { GuidedExecutionTask } from "../types.js";
import { isContentPlanTask, preferredContentPlanTask } from "../utils/contentPlan.js";

function safeReturnPath(value: string | null, projectId: string) {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  return `/guided-projects/${projectId}?tab=execution#execution-tasks`;
}

export default function SeoPageMap() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const projectId = params.get("projectId")?.trim() ?? "";
  const taskId = params.get("taskId")?.trim() ?? "";
  const returnTo = useMemo(() => safeReturnPath(params.get("returnTo"), projectId), [params, projectId]);
  const [task, setTask] = useState<GuidedExecutionTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setError("Select a project before opening the Website Page Map & Content Plan.");
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const result = await api.get<{ tasks: GuidedExecutionTask[] }>(`/api/execution-tasks?projectId=${encodeURIComponent(projectId)}`);
        const exact = taskId ? result.tasks.find((candidate) => candidate.id === taskId) : null;
        const contentPlans = result.tasks.filter(isContentPlanTask);
        const existing = exact ?? contentPlans.reduce<GuidedExecutionTask | null>((selected, candidate) => selected ? preferredContentPlanTask(selected, candidate) : candidate, null);
        if (existing) {
          if (active) setTask(existing);
          return;
        }
        const created = await api.post<{ task: GuidedExecutionTask }>(`/api/projects/${projectId}/seo-plan/task`, {});
        if (active) setTask(created.task);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "The Website Page Map & Content Plan could not be opened.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId, taskId]);

  const goBack = () => navigate(returnTo, { replace: true });

  return <div className="space-y-4 pb-8">
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-lg">
      <div className="grid gap-5 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.22),transparent_38%)] px-5 py-6 sm:px-7 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">Website planning workspace</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Website Page Map &amp; Content Plan</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Review page ownership, URLs, keyword intent, content briefs, Local SEO, links, FAQs, schema, and website files in one full-page workspace.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">One owner per intent</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">Editable before approval</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">Synchronized with Website Development</span>
          </div>
        </div>
        <button type="button" onClick={goBack} className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/15">← Back to previous workspace</button>
      </div>
    </section>

    {loading && <section className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
      <h2 className="mt-4 font-black text-charcoal-950">Opening your website plan…</h2>
      <p className="mt-1 text-sm text-charcoal-500">Loading the saved page map, evidence, and approval state.</p>
    </section>}

    {!loading && error && <section className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-black uppercase tracking-wide text-rose-600">Plan unavailable</div>
      <h2 className="mt-1 text-xl font-black text-charcoal-950">Website Page Map &amp; Content Plan could not be opened</h2>
      <p className="mt-2 text-sm leading-6 text-rose-700">{error}</p>
      <button type="button" onClick={goBack} className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">Go back</button>
    </section>}

    {!loading && !error && task && <ContentPlanDialog
      presentation="page"
      task={task}
      autoPrepare={params.get("autoPrepare") === "1"}
      onClose={goBack}
      onSaved={setTask}
    />}
  </div>;
}
