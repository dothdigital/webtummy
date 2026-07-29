import { useEffect, useState } from "react";
import { api } from "../api.js";

type Discovery = { id: string; liveUrl: string; status: string; canonicalMatches: boolean | null; indexable: boolean | null; sitemapPresent: boolean | null; checkedAt: string | null; task: { title: string } };
type Checkpoint = { id: string; checkpointType: string; dueAt: string; status: string; diagnosis: string | null; task: { title: string } };
type Nba = { id: string; title: string; recommendation: string; reasoningSummary: string; expectedImpact: string; confidence: number; estimatedEffort: string; route: string; priorityScore: number; status: string; decision: string | null; followupTask: { title: string; status: string; relatedUrl: string | null } | null };
type Workflow = { discoveryChecks: Discovery[]; checkpoints: Checkpoint[]; nextBestActions: Nba[] };

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function OptimizationWorkflow({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Workflow | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => api.get<Workflow>(`/api/projects/${projectId}/optimization-workflow`).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load optimization workflow."));
  useEffect(() => { void load(); }, [projectId]);
  const decide = async (item: Nba, decision: "accepted" | "edited" | "dismissed" | "rerouted") => {
    const comment = window.prompt(`${label(decision)} — add the decision reason:`, decision === "dismissed" ? "Not appropriate for the current strategy." : "Approved based on the attached evidence and expected impact.")?.trim();
    if (!comment) return;
    const route = decision === "rerouted" ? window.prompt("Route to: content, technical, local_seo, gbp, citations_reviews, or authority", item.route)?.trim() : undefined;
    setBusy(item.id); setError("");
    try { await api.post(`/api/next-best-actions/${item.id}/decision`, { decision, comment, ...(route ? { route } : {}) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the decision."); }
    finally { setBusy(""); }
  };
  const completeCheckpoint = async (item: Checkpoint) => {
    const metricsText = window.prompt("Enter measured metrics as JSON:", '{"organicClicks":0,"conversions":0,"averageRank":null,"indexed":true}')?.trim();
    if (!metricsText) return;
    const diagnosis = window.prompt("Summarize what changed and why:", "Review the result against the publishing baseline and approved KPI targets.")?.trim();
    if (!diagnosis) return;
    let metrics: Record<string, unknown>;
    try { metrics = JSON.parse(metricsText) as Record<string, unknown>; } catch { setError("Metrics must be valid JSON."); return; }
    const createNba = window.confirm("Create a Next Best Action from this checkpoint?");
    let nextBestAction: Record<string, unknown> | undefined;
    if (createNba) {
      const title = window.prompt("Next Best Action title", "Improve this asset using the checkpoint evidence")?.trim();
      const recommendation = window.prompt("Recommended action", "Use the measured evidence to make the single highest-impact improvement.")?.trim();
      const route = window.prompt("Route: content, technical, local_seo, gbp, citations_reviews, or authority", "content")?.trim();
      if (!title || !recommendation || !route) return;
      nextBestAction = { title, recommendation, route, reasoningSummary: diagnosis, expectedImpact: "Improve the approved KPI outcome while preserving traceability to the published version.", confidence: 75, estimatedEffort: "medium", priorityScore: 75, evidence: metrics };
    }
    setBusy(item.id); setError("");
    try { await api.post(`/api/measurement-checkpoints/${item.id}/complete`, { metrics, diagnosis, ...(nextBestAction ? { nextBestAction } : {}) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete checkpoint."); }
    finally { setBusy(""); }
  };
  if (!data && !error) return <div id="optimization-workflow" className="border-t border-slate-200 p-5 text-sm text-slate-500">Loading discovery, checkpoints, and Next Best Actions…</div>;
  return <section id="optimization-workflow" className="scroll-mt-24 border-t border-slate-200 bg-slate-50/60 p-5" aria-labelledby="optimization-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="optimization-title" className="font-black text-charcoal-950">Continuous optimization loop</h3><p className="mt-1 text-sm text-charcoal-500">Publication → discovery → post-publish and 30/60/90-day measurement → one evidence-based Next Best Action.</p></div><div className="flex gap-2 text-xs font-bold"><span className="rounded-full bg-white px-3 py-1 text-rose-700">{data?.discoveryChecks.filter((item) => item.status === "issue").length ?? 0} discovery issues</span><span className="rounded-full bg-white px-3 py-1 text-amber-700">{data?.checkpoints.filter((item) => item.status !== "completed").length ?? 0} checkpoints</span><span className="rounded-full bg-white px-3 py-1 text-brand-700">{data?.nextBestActions.filter((item) => item.status === "proposed").length ?? 0} NBA pending</span></div></div>
    {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
    <div className="mt-4 grid gap-4 xl:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-bold">Discovery checks</h4><div className="mt-3 space-y-2">{data?.discoveryChecks.slice(0, 6).map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><div className="flex justify-between gap-2"><b className="truncate">{item.task.title}</b><span className={item.status === "verified" ? "font-bold text-emerald-700" : item.status === "issue" ? "font-bold text-red-700" : "font-bold text-amber-700"}>{label(item.status)}</span></div><a href={item.liveUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-brand-700">{item.liveUrl}</a><div className="mt-2 text-slate-500">Canonical {item.canonicalMatches === true ? "✓" : "—"} · Indexable {item.indexable === true ? "✓" : "—"} · Sitemap {item.sitemapPresent === true ? "✓" : "—"}</div></div>)}{!data?.discoveryChecks.length && <p className="text-sm text-slate-500">Checks are created after a content publishing attempt is verified.</p>}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-bold">Measurement checkpoints</h4><div className="mt-3 space-y-2">{data?.checkpoints.slice(0, 10).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-xs"><div><b>{label(item.checkpointType)}</b><div className="mt-1 text-slate-500">{item.task.title} · {new Date(item.dueAt).toLocaleDateString()}</div></div>{item.status === "completed" ? <span className="rounded-full bg-emerald-100 px-2 py-1 font-bold text-emerald-700">Completed</span> : <button disabled={busy === item.id} onClick={() => void completeCheckpoint(item)} className={`rounded-full px-2 py-1 font-bold ${new Date(item.dueAt) <= new Date() ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{busy === item.id ? "Saving…" : new Date(item.dueAt) <= new Date() ? "Review due" : "Record early"}</button>}</div>)}{!data?.checkpoints.length && <p className="text-sm text-slate-500">Publishing verification schedules post-publish, 30, 60, 90 and recurring reviews.</p>}</div></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-bold">Next Best Action</h4><div className="mt-3 space-y-3">{data?.nextBestActions.slice(0, 6).map((item) => <article key={item.id} className="rounded-lg border border-brand-100 bg-brand-50/40 p-3"><div className="flex justify-between gap-2"><b className="text-sm">{item.title}</b><span className="shrink-0 text-xs font-black text-brand-700">{item.priorityScore}/100</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{item.recommendation}</p><details className="mt-2 text-xs"><summary className="cursor-pointer font-bold text-brand-700">Evidence and reasoning</summary><p className="mt-2 text-slate-600">{item.reasoningSummary}</p><p className="mt-1"><b>Impact:</b> {item.expectedImpact}</p></details><div className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold"><span className="rounded-full bg-white px-2 py-1">{item.confidence}% confidence</span><span className="rounded-full bg-white px-2 py-1">{label(item.estimatedEffort)} effort</span><span className="rounded-full bg-white px-2 py-1">Route: {label(item.route)}</span></div>{item.status === "proposed" ? <div className="mt-3 grid grid-cols-2 gap-1">{(["accepted", "edited", "rerouted", "dismissed"] as const).map((decision) => <button key={decision} disabled={busy === item.id} onClick={() => void decide(item, decision)} className="rounded-md border border-brand-200 bg-white px-2 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50">{label(decision)}</button>)}</div> : <div className="mt-3 text-xs font-bold text-emerald-700">{label(item.decision || item.status)}{item.followupTask ? ` · ${item.followupTask.title}` : ""}</div>}</article>)}{!data?.nextBestActions.length && <p className="text-sm text-slate-500">Complete a checkpoint or local grid scan to create a prioritized recommendation.</p>}</div></div>
    </div>
  </section>;
}
