import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

type Metric = { key: string; label: string; value: number | null };
type PerformanceResponse = {
  project: { id: string; name: string; businessName: string | null };
  website: { id: string; domain: string; rootUrl: string; status: string } | null;
  periodDays: number;
  growthStatus: { key: string; label: string; detail: string };
  importantResults: Metric[];
  metrics: { pageViews: number; sessions: number; ctaClicks: number; phoneClicks: number; formStarts: number; formSuccesses: number; formErrors: number; bookings: number; purchases: number; averageLoadMs: number | null; lastEventAt: string | null };
  searchPerformance: { searchConsoleStatus: string; ga4Status: string; trackedKeywords: number; rankings: Array<{ keyword: string; location: string; rank: number | null; observedAt: string }> };
  leadsAndConversions: Record<string, number>;
  workCompleted: Array<{ id: string; title: string; moduleName: string; status: string; completedAt: string | null; publishedAt: string | null }>;
  problemsAndOpportunities: Array<{ type: "problem" | "opportunity" | "limitation"; title: string; detail: string }>;
  trackingHealth: { state: string; planVersion: number | null; lastVerifiedAt: string | null; lastEventAt: string | null; installation: string; sources: Array<{ key: string; status: string; required: boolean }> };
  nextBestAction: { id: string; title: string; recommendation: string; expectedImpact: string; reasoningSummary?: string; status: string; priorityScore: number; route: string; sourceType?: string; followupTaskId?: string|null; followupTask?: {id:string;title:string;status:string;relatedUrl:string|null}|null; updatedAt: string } | null;
  postLaunch: { workflow:string[];websiteLive:boolean;releaseId:string|null;tracking:{verified:boolean;state:string};baseline:{state:string;label:string;evaluationWindowDays:number;completeVerifiedDays:number;remainingDays:number;publishedAt:string|null;startedAt:string|null;completesAt:string|null;performanceClaimsAllowed:boolean};growthBlueprint:{id:string;title:string;status:string;currentVersion:number;approvedStrategyId:string|null;nextReviewAt:string|null}|null };
  performanceHistory: Array<{ releaseId: string; version: number; target: string; publishedAt: string; status: string; metrics: { pageViews: number; sessions: number; formSuccesses: number; ctaClicks: number }; eventCount: number }>;
  reportUrl: string;
};

const human = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusClass = (value: string) => /connected|collecting|verified|ready|published|completed/i.test(value) ? "bg-emerald-100 text-emerald-800" : /error|attention|blocked|problem/i.test(value) ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800";
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not yet";

export default function WebsitePerformance() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const projectId = params.projectId ?? searchParams.get("projectId") ?? "";
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [startingAction, setStartingAction] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try { setData(await api.get<PerformanceResponse>(`/api/projects/${projectId}/website-performance`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Website performance could not be loaded."); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function startNextBestAction() {
    if (!data?.nextBestAction || startingAction) return;
    setStartingAction(true); setMessage("");
    try {
      await api.post(`/api/projects-v2/${projectId}/growth/actions/${data.nextBestAction.id}/decision`, { decision: "accepted" });
      await load();
      setMessage("The Next Best Action was added to the Execution Plan. AI preparation, approval, publishing, and verification remain governed by the normal workflow.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The Next Best Action could not be started."); }
    finally { setStartingAction(false); }
  }

  if (loading) return <div className="grid min-h-[28rem] place-items-center rounded-2xl border bg-white"><div className="flex items-center gap-3 text-sm font-bold text-slate-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand-700" />Loading website performance…</div></div>;
  if (!data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-800">{message || "Website performance is unavailable."}</div>;

  return <div className="space-y-5">
    <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-900 text-white shadow-xl">
      <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Website · Ongoing Performance</div><h1 className="mt-2 text-2xl font-black">{data.project.businessName || data.project.name}</h1><p className="mt-1 text-sm text-slate-300">{data.website?.domain || "Production website connection required"} · Last {data.periodDays} days</p><div className="mt-3 flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${statusClass(data.growthStatus.key)}`}>{data.growthStatus.label}</span><span className="text-xs text-slate-300">{data.growthStatus.detail}</span></div></div>
        <div className="flex flex-wrap gap-2">{data.website&&<a href={data.website.rootUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white px-4 py-2.5 text-sm font-black text-slate-950">View Live Website ↗</a>}<Link to={`/site-architect?projectId=${encodeURIComponent(projectId)}&step=publish&manage=1`} className="rounded-lg border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-black text-white">Edit Website</Link><Link to={data.reportUrl} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-4 py-2.5 text-sm font-black text-cyan-100">Open Reports</Link></div>
      </div>
    </header>

    <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white"><div className="grid gap-3 p-4 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black uppercase text-slate-400">Tracking</div><b className={`mt-1 block text-sm ${data.postLaunch.tracking.verified?"text-emerald-700":"text-amber-700"}`}>{data.postLaunch.tracking.verified?"Active and verified":"Verification required"}</b></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black uppercase text-slate-400">Initial baseline</div><b className="mt-1 block text-sm text-slate-900">{data.postLaunch.baseline.label}</b><p className="mt-1 text-[10px] text-slate-500">{data.postLaunch.baseline.completeVerifiedDays} of {data.postLaunch.baseline.evaluationWindowDays} complete verified days</p></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black uppercase text-slate-400">Growth Blueprint</div><b className="mt-1 block text-sm text-indigo-800">{data.postLaunch.growthBlueprint?`Active · Version ${data.postLaunch.growthBlueprint.currentVersion}`:"Activating"}</b><Link to={`/growth?projectId=${encodeURIComponent(projectId)}`} className="mt-1 inline-block text-[10px] font-black text-indigo-700">Open Blueprint →</Link></div></div><div className="border-t bg-indigo-50/60 px-4 py-3"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold text-indigo-900">{data.postLaunch.workflow.map((item,index)=><span key={item} className="flex items-center gap-2"><span>{item}</span>{index<data.postLaunch.workflow.length-1&&<span className="text-indigo-300">→</span>}</span>)}</div></div></section>

    {!data.postLaunch.baseline.performanceClaimsAllowed&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>Evidence safeguard:</b> traffic, ranking and conversion improvement claims remain disabled until the initial verified baseline is established. Growth Blueprint work can continue now.</div>}

    <section><div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-black text-slate-950">Important results</h2><span className="text-xs text-slate-500">First-party measured activity</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{data.importantResults.map((result) => <div key={result.key} className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{result.label}</div><div className="mt-2 text-2xl font-black text-slate-950">{result.value ?? "—"}</div>{result.value==null&&<p className="mt-1 text-[10px] text-amber-700">Not collected yet</p>}</div>)}</div></section>

    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-black text-slate-950">Search performance</h2><span className="text-xs text-slate-500">{data.searchPerformance.trackedKeywords} tracked queries</span></div><div className="mt-3 flex gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(data.searchPerformance.searchConsoleStatus)}`}>Search Console · {human(data.searchPerformance.searchConsoleStatus)}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(data.searchPerformance.ga4Status)}`}>GA4 · {human(data.searchPerformance.ga4Status)}</span></div>{data.searchPerformance.rankings.length?<div className="mt-4 divide-y rounded-xl border">{data.searchPerformance.rankings.slice(0,6).map((ranking) => <div key={`${ranking.keyword}:${ranking.location}`} className="grid grid-cols-[1fr_auto] gap-3 p-3 text-xs"><div><b className="text-slate-900">{ranking.keyword}</b><span className="ml-2 text-slate-400">{ranking.location}</span></div><b className="text-brand-700">{ranking.rank == null ? "Not ranked" : `#${ranking.rank}`}</b></div>)}</div>:<p className="mt-4 rounded-xl border border-dashed p-4 text-xs leading-5 text-slate-500">No saved ranking observations are available yet. Missing integrations are shown as unavailable, not zero.</p>}</section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-black text-slate-950">Leads and conversions</h2><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries(data.leadsAndConversions).map(([key, value]) => <div key={key} className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] font-black uppercase text-slate-400">{human(key)}</div><b className="mt-1 block text-xl text-slate-950">{value}</b></div>)}</div></section>
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-black text-slate-950">Problems and opportunities</h2>{data.problemsAndOpportunities.length?<div className="mt-3 space-y-2">{data.problemsAndOpportunities.map((item, index) => <div key={`${item.title}-${index}`} className={`rounded-xl border p-3 ${item.type==="problem"?"border-rose-200 bg-rose-50":item.type==="opportunity"?"border-cyan-200 bg-cyan-50":"border-amber-200 bg-amber-50"}`}><div className="text-[9px] font-black uppercase text-slate-500">{item.type}</div><b className="mt-1 block text-sm text-slate-950">{item.title}</b><p className="mt-1 text-xs leading-5 text-slate-600">{item.detail}</p></div>)}</div>:<p className="mt-3 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">No recorded performance problem currently requires attention.</p>}</section>
      <section className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-black text-slate-950">Tracking health</h2><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${statusClass(data.trackingHealth.state)}`}>{human(data.trackingHealth.state)}</span></div><div className="mt-3 grid gap-2 text-xs"><div className="flex justify-between rounded-lg bg-slate-50 p-3"><span>Measurement Plan</span><b>{data.trackingHealth.planVersion ? `Version ${data.trackingHealth.planVersion}` : "Not configured"}</b></div><div className="flex justify-between rounded-lg bg-slate-50 p-3"><span>Last verified</span><b>{date(data.trackingHealth.lastVerifiedAt)}</b></div><div className="flex justify-between rounded-lg bg-slate-50 p-3"><span>Last event</span><b>{date(data.trackingHealth.lastEventAt)}</b></div></div><div className="mt-3 flex flex-wrap gap-1.5">{data.trackingHealth.sources.map((source) => <span key={source.key} className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${statusClass(source.status)}`}>{human(source.key)} · {human(source.status)}{source.required?" · required":""}</span>)}</div></section>
    </div>

    {data.nextBestAction&&<section id="next-best-action" className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-[10px] font-black uppercase tracking-wide text-indigo-700">Current Next Best Action</div><h2 className="mt-1 text-lg font-black text-slate-950">{data.nextBestAction.title}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{data.nextBestAction.recommendation}</p>{data.nextBestAction.reasoningSummary&&<p className="mt-2 text-xs text-slate-500">Why now: {data.nextBestAction.reasoningSummary}</p>}<p className="mt-2 text-xs font-semibold text-indigo-800">Expected outcome: {data.nextBestAction.expectedImpact}</p></div>{["accepted","in_progress"].includes(data.nextBestAction.status)?<Link to={data.nextBestAction.followupTask?.relatedUrl||`/guided-projects/${projectId}?tab=execution`} className="shrink-0 rounded-xl bg-emerald-700 px-5 py-3 text-center text-sm font-black text-white">Open Execution Task →</Link>:<button type="button" disabled={startingAction||data.nextBestAction.sourceType!=="growth_engine"} onClick={()=>void startNextBestAction()} className="shrink-0 rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:bg-slate-300">{startingAction?"Adding to Execution Plan…":"Review and Start Action"}</button>}</div></section>}

    {message&&<div className={`rounded-xl border p-4 text-sm font-semibold ${/could not|failed|error/i.test(message)?"border-rose-200 bg-rose-50 text-rose-800":"border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message}</div>}

    <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border bg-white p-5"><h2 className="font-black text-slate-950">Work completed</h2><div className="mt-3 divide-y">{data.workCompleted.length?data.workCompleted.slice(0,8).map((task) => <div key={task.id} className="py-3"><div className="flex items-center justify-between gap-3"><b className="text-sm text-slate-900">{task.title}</b><span className="text-[9px] font-black uppercase text-emerald-700">{human(task.status)}</span></div><p className="mt-1 text-[11px] text-slate-400">{human(task.moduleName)} · {date(task.publishedAt || task.completedAt)}</p></div>):<p className="text-sm text-slate-500">No completed project work is recorded yet.</p>}</div></section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="font-black text-slate-950">Performance history by website version</h2><div className="mt-3 space-y-2">{data.performanceHistory.length?data.performanceHistory.map((release) => <div key={release.releaseId} className="rounded-xl border p-3"><div className="flex items-center justify-between"><b className="text-sm text-slate-950">Website version {release.version}</b><span className="text-[9px] font-black uppercase text-slate-500">{human(release.target)}</span></div><p className="mt-1 text-[11px] text-slate-400">Published {date(release.publishedAt)} · Release {release.releaseId.slice(-6)}</p><div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-slate-600"><span>{release.metrics.pageViews} views</span><span>{release.metrics.sessions} sessions</span><span>{release.metrics.formSuccesses} leads</span><span>{release.metrics.ctaClicks} CTA clicks</span>{release.eventCount===0&&<span className="text-amber-700">No version-labelled events yet</span>}</div></div>):<p className="rounded-xl border border-dashed p-4 text-xs text-slate-500">Performance history begins after the first verified production publication.</p>}</div></section></div>
  </div>;
}
