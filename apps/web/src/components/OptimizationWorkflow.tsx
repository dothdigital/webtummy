import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Link } from "react-router-dom";
import { isPageOwnershipReview, groupBacklinkActions, executionPlanActions, optimizationTaskGuide, optimizationTaskUrl } from "../optimization-task-guide.js";

type Discovery = { id: string; liveUrl: string; status: string; canonicalMatches: boolean | null; indexable: boolean | null; sitemapPresent: boolean | null; checkedAt: string | null; task: { title: string } };
type Checkpoint = { id: string; checkpointType: string; dueAt: string; status: string; diagnosis: string | null; task: { title: string } };
type Nba = { id: string; title: string; recommendation: string; reasoningSummary: string; expectedImpact: string; confidence: number; estimatedEffort: string; route: string; priorityScore: number; status: string; decision: string | null; followupTask: { id: string; title: string; status: string; relatedUrl: string | null } | null };
type Workflow = { discoveryChecks: Discovery[]; checkpoints: Checkpoint[]; nextBestActions: Nba[] };

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function OptimizationWorkflow({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Workflow | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => api.get<Workflow>(`/api/projects/${projectId}/optimization-workflow`).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load optimization workflow."));
  useEffect(() => { void load(); }, [projectId]);
  const decide = async (item: Nba, decision: "accepted" | "edited" | "dismissed" | "rerouted") => {
    const comment = window.prompt(decision === "dismissed" ? "Why do you want to remove this suggestion?" : "Add a note for this task:", decision === "dismissed" ? "Not needed for my current plan." : "Add this work to my plan for review and execution.")?.trim();
    if (!comment) return;
    const route = decision === "rerouted" ? window.prompt("Route to: content, technical, local_seo, gbp, citations_reviews, or authority", item.route)?.trim() : undefined;
    setBusy(item.id); setError("");
    try { await api.post(`/api/next-best-actions/${item.id}/decision`, { decision, comment, ...(route ? { route } : {}) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the decision."); }
    finally { setBusy(""); }
  };
  const [review, setReview] = useState<Checkpoint | null>(null);
  const completeCheckpoint = async (item: Checkpoint) => { setReview(item); };
  const saveResults = async (form: HTMLFormElement) => {
    if (!review) return;
    const fields = new FormData(form);
    const metrics: Record<string, unknown> = {};
    for (const key of ["organicClicks", "conversions", "averageRank"]) {
      const raw = String(fields.get(key) ?? "").trim();
      if (raw) metrics[key] = Number(raw);
    }
    metrics.source = String(fields.get("source") ?? "");
    metrics.periodStart = String(fields.get("periodStart") ?? "");
    metrics.periodEnd = String(fields.get("periodEnd") ?? "");
    if (String(metrics.periodEnd) < String(metrics.periodStart)) { setError("The end date must be on or after the start date."); return; }
    if (!["organicClicks", "conversions", "averageRank"].some(key => key in metrics)) { setError("Enter at least one measured result. Leave unavailable figures blank."); return; }
    setBusy(review.id); setError("");
    try {
      await api.post(`/api/measurement-checkpoints/${review.id}/complete`, { metrics, diagnosis: String(fields.get("diagnosis") ?? "") });
      setReview(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save results."); }
    finally { setBusy(""); }
  };
  const { tasks: actions, backlinks } = groupBacklinkActions(executionPlanActions(data?.nextBestActions ?? []));
  return <section id="optimization-workflow" className="scroll-mt-24 border-t border-slate-200 bg-slate-50/60 p-5" aria-labelledby="optimization-title">
    <h3 id="optimization-title" className="text-lg font-black text-charcoal-950">Your step-by-step growth plan</h3>
    <p className="mt-1 text-sm text-charcoal-600">Work through the tasks below. You can open any available task; tasks waiting on other work must be unblocked first. Adding a task to your plan does not mean the work is finished.</p>
    {!data && !error && <p className="mt-3 text-sm">Loading your tasks…</p>}
    {error && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    <div className="mt-4 space-y-4">
      {actions.map((item, index) => {
        const guide = optimizationTaskGuide(item);
        const finished = ["completed", "published"].includes(item.followupTask?.status ?? "");
        const blocked = item.followupTask?.status === "blocked";
        return <div key={item.id}>{(index === 0 || Boolean(actions[index - 1].followupTask) !== Boolean(item.followupTask)) && <h4 className="mb-3 text-base font-bold">{item.followupTask ? "Tasks in your plan" : "Suggestions to review before adding"}</h4>}<article className="rounded-xl border border-slate-200 bg-white p-5">
          <span className="text-xs font-bold text-brand-700">{finished ? "Completed" : blocked ? "Waiting on another task" : item.followupTask ? "In your plan · work remaining" : "Suggested task · needs your approval"}</span>
          <h4 className="mt-2 text-base font-black text-charcoal-950">{index + 1}. {guide.title}</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600"><b>Why:</b> {guide.purpose}</p>
          <div className="mt-3 text-sm"><b>How to do it</b><ol className="mt-2 list-decimal space-y-2 pl-5 text-slate-700">{guide.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
          <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><b>Finished when:</b> {guide.done}</p>
          {item.followupTask ? <Link to={optimizationTaskUrl(item.followupTask, projectId)} className="mt-4 inline-flex rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white">{isPageOwnershipReview(item.title) ? "Review existing SEO page plan" : finished ? "View completed task" : blocked ? "View what is blocking this task" : "Open task and continue"} →</Link>
            : item.status === "proposed" ? <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy === item.id} onClick={() => void decide(item, "accepted")} className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy === item.id ? "Saving…" : "Add to my tasks"}</button><button disabled={busy === item.id} onClick={() => void decide(item, "dismissed")} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold">Remove suggestion</button></div>
            : <Link to={`/growth?projectId=${encodeURIComponent(projectId)}`} className="mt-4 inline-flex text-sm font-bold text-brand-700">Review this action in Growth →</Link>}
          <details className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5"><summary className="cursor-pointer font-bold text-slate-600">Why this task was suggested</summary><p className="mt-2">{item.reasoningSummary}</p><p className="mt-2"><b>Expected benefit:</b> {item.expectedImpact}</p><p className="mt-2"><b>Original recommendation:</b> {item.recommendation}</p><p className="mt-2">Priority score: {item.priorityScore}/100 · Confidence: {item.confidence}% · Estimated effort: {label(item.estimatedEffort)}</p></details>
        </article></div>;
      })}
    </div>
    {backlinks.length > 0 && <article className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
      <h4 className="text-base font-black text-charcoal-950">Review backlinks</h4>
      <p className="mt-2 text-sm leading-6 text-slate-600">Review the websites linking to your competitors and identify useful opportunities for your business.</p>
      <div className="mt-3 text-sm"><b>How to do it</b><ol className="mt-2 list-decimal space-y-2 pl-5 text-slate-700"><li>Open the Backlinks page for this project.</li><li>Review the competitor comparisons and check which websites are relevant to your business.</li><li>Choose the opportunities worth following up on before starting outreach.</li></ol></div>
      <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><b>Finished when:</b> You have reviewed the available opportunities and identified which are worth pursuing.</p>
      <Link to={`/backlinks?projectId=${encodeURIComponent(projectId)}`} className="mt-4 inline-flex rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white">Review backlinks →</Link>
    </article>}
    {data && !actions.length && !backlinks.length && <p className="mt-4 text-sm text-slate-600">No growth suggestions are waiting here. Continue the execution tasks above; new suggestions appear when results are reviewed.</p>}
    {review && <form onSubmit={event => { event.preventDefault(); void saveResults(event.currentTarget); }} className="mt-5 space-y-3 rounded-xl border border-brand-200 bg-white p-5">
      <h4 className="font-bold">Record results: {review.task.title}</h4>
      <p className="text-sm text-slate-600">Use figures from your reporting source. Leave unavailable numbers blank; enter zero only if the source reports zero.</p>
      <div className="grid gap-3 sm:grid-cols-3">{[["organicClicks", "Visits from search"], ["conversions", "Enquiries or sales"], ["averageRank", "Average search position"]].map(([name, title]) => <label key={name} className="text-sm">{title}<input type="number" min="0" step={name === "averageRank" ? "any" : "1"} name={name} className="mt-1 w-full rounded-lg border p-2" /></label>)}</div>
      <label className="block text-sm">Where did these figures come from?<input required name="source" placeholder="Report name or link" className="mt-1 w-full rounded-lg border p-2" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Period start<input required type="date" name="periodStart" className="mt-1 block rounded-lg border p-2" /></label><label className="text-sm">Period end<input required type="date" name="periodEnd" className="mt-1 block rounded-lg border p-2" /></label></div>
      <label className="block text-sm">What changed compared with the starting figures?<textarea required minLength={2} name="diagnosis" placeholder="Describe the change, or explain why a comparison is not yet possible. Avoid assuming what caused it." className="mt-1 w-full rounded-lg border p-2" /></label>
      <div className="flex gap-3"><button disabled={Boolean(busy)} className="rounded-lg bg-brand-700 px-4 py-2 font-bold text-white">{busy ? "Saving…" : "Save results"}</button><button type="button" onClick={() => setReview(null)}>Cancel</button></div>
    </form>}
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="font-bold">After your changes go live</h4>
      <p className="mt-1 text-sm text-slate-600">First, complete and publish the relevant task. Once publication is verified, the system checks the page and schedules reviews to see what changed.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><h5 className="text-sm font-bold">Can search engines find your page?</h5><div className="mt-3 space-y-2">{data?.discoveryChecks.map(item => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{item.task.title}</b><p className="mt-1">{item.status === "verified" ? "Page checks passed" : item.status === "issue" ? "A page issue needs attention" : "Checks are pending"}</p><a href={item.liveUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-brand-700">View published page →</a><details className="mt-2 text-xs"><summary className="cursor-pointer">Check details</summary>{[["Correct main page address", item.canonicalMatches], ["Search indexing allowed", item.indexable], ["Included in the site’s page list", item.sitemapPresent]].map(([name, value]) => <p key={String(name)}>{name}: {value === true ? "Yes" : value === false ? "No" : "Not checked"}</p>)}</details></div>)}{data && !data.discoveryChecks.length && <p className="text-sm text-slate-500">No page checks yet. These appear after a publication is verified; this does not mean your site has passed all checks.</p>}</div></div>
        <div><h5 className="text-sm font-bold">Did the change help?</h5><p className="mt-1 text-sm text-slate-500">Review results after publishing and at the scheduled 30, 60 and 90-day reviews. A saved or published task is not proof of improved results.</p><div className="mt-3 space-y-2">{data?.checkpoints.map(item => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{item.task.title}</b><p className="mt-1">Review date: {new Date(item.dueAt).toLocaleDateString()}</p>{item.status === "completed" ? <span className="text-emerald-700">Results recorded</span> : <button disabled={busy === item.id} onClick={() => void completeCheckpoint(item)} className="mt-2 rounded-lg border border-brand-200 px-3 py-2 font-bold text-brand-700">{busy === item.id ? "Saving…" : "Record results"}</button>}</div>)}{data && !data.checkpoints.length && <p className="text-sm text-slate-500">No result reviews scheduled yet. Finish a publishing task and verify it is live to start this schedule.</p>}</div></div>
      </div>
    </div>
  </section>;
}
