import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

type Status = "COMPLETE" | "PARTIAL" | "MISSING" | "BLOCKED" | "DEFERRED" | "NOT_APPLICABLE";
type CoverageResult = {
  capabilityId: string;
  title: string;
  section: string;
  signal: string;
  status: Status;
  message: string;
  workflowDestination: string;
};
type CoverageRun = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  summary: { score: number; applicable: number; total: number; counts: Record<Status, number> };
  results: CoverageResult[];
};
type CoveragePayload = { latestRun: CoverageRun | null };

const statusStyle: Record<Status, string> = {
  COMPLETE: "bg-emerald-50 text-emerald-700",
  PARTIAL: "bg-amber-50 text-amber-800",
  MISSING: "bg-rose-50 text-rose-700",
  BLOCKED: "bg-red-100 text-red-800",
  DEFERRED: "bg-violet-50 text-violet-700",
  NOT_APPLICABLE: "bg-slate-100 text-slate-500",
};

function actionUrl(result: CoverageResult, projectId: string) {
  return result.workflowDestination.replace("{projectId}", encodeURIComponent(projectId));
}

export default function SiteCapabilityExtension({ projectId, crawlCompletedAt }: { projectId: string; crawlCompletedAt?: string | null }) {
  const [run, setRun] = useState<CoverageRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showAllGaps, setShowAllGaps] = useState(false);
  const automaticRunStarted = useRef(false);

  async function runCoverage() {
    setRefreshing(true); setError("");
    try {
      setRun(await api.post<CoverageRun>(`/api/projects/${encodeURIComponent(projectId)}/dev053-verification/run`, {}));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Connected coverage checks could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); automaticRunStarted.current = false;
    api.get<CoveragePayload>(`/api/projects/${encodeURIComponent(projectId)}/dev053-verification`)
      .then((payload) => {
        if (cancelled) return;
        setRun(payload.latestRun);
        const evidenceAt = payload.latestRun?.completedAt ?? payload.latestRun?.createdAt;
        const staleForCrawl = Boolean(crawlCompletedAt && (!evidenceAt || new Date(evidenceAt).getTime() < new Date(crawlCompletedAt).getTime()));
        if ((!payload.latestRun || staleForCrawl) && !automaticRunStarted.current) {
          automaticRunStarted.current = true;
          void runCoverage();
        }
      })
      .catch((requestError) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Connected coverage checks could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [crawlCompletedAt, projectId]);

  const connectedGaps = useMemo(() => (run?.results ?? [])
    .filter((item) => ["BLOCKED", "MISSING", "PARTIAL"].includes(item.status))
    .sort((left, right) => ({ BLOCKED: 0, MISSING: 1, PARTIAL: 2 }[left.status] ?? 3) - ({ BLOCKED: 0, MISSING: 1, PARTIAL: 2 }[right.status] ?? 3)), [run]);
  const visibleGaps = showAllGaps ? connectedGaps : connectedGaps.slice(0, 6);

  if (loading && !run) return <div className="border-t border-slate-100 px-5 py-4 text-sm font-semibold text-slate-500">Checking connected SEO and growth coverage…</div>;
  if (!run) return <div className="border-t border-slate-100 px-5 py-4"><div className="text-sm font-bold text-slate-800">Connected coverage is not available yet.</div>{error && <div className="mt-1 text-xs font-semibold text-rose-700">{error}</div>}<button type="button" onClick={() => void runCoverage()} disabled={refreshing} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{refreshing ? "Analyzing…" : "Analyze connected coverage"}</button></div>;

  const needsAction = (run.summary.counts.MISSING ?? 0) + (run.summary.counts.PARTIAL ?? 0);
  return <div className="border-t border-slate-100">
    <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
      {[
        ["Connected Coverage", `${run.summary.score} /100`, `${run.summary.applicable} applicable checks`, "text-brand-700"],
        ["Ready", String(run.summary.counts.COMPLETE ?? 0), "Verified from saved evidence", "text-emerald-700"],
        ["Needs Action", String(needsAction), "Flows into Gap Analysis and Strategy", "text-amber-700"],
        ["Blocked", String(run.summary.counts.BLOCKED ?? 0), "Access, provider, or prerequisite required", "text-rose-700"],
      ].map(([title, value, detail, tone]) => <div key={title} className="px-5 py-4"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{title}</div><div className={`mt-2 text-2xl font-bold leading-none ${tone}`}>{value}</div><div className="mt-2 text-xs font-semibold text-charcoal-500">{detail}</div></div>)}
    </div>
    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-black uppercase tracking-wide text-slate-500">Highest-priority connected gaps</div><p className="mt-1 text-sm text-slate-600">These findings are reused by Gap Analysis, approved Strategy, the Execution Plan, and Growth—not maintained as a separate checklist.</p></div><button type="button" onClick={() => void runCoverage()} disabled={refreshing} className="shrink-0 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-50">{refreshing ? "Refreshing…" : "Refresh connected checks"}</button></div>
      {error && <div className="mt-3 text-xs font-semibold text-rose-700">{error}</div>}
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {visibleGaps.map((item) => <div key={item.capabilityId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${statusStyle[item.status]}`}>{item.status.toLowerCase()}</span><span className="truncate text-sm font-black text-slate-900">{item.title}</span></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.message}</p></div><Link to={actionUrl(item, projectId)} className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">Resolve</Link></div>)}
        {!connectedGaps.length && <div className="text-sm font-semibold text-emerald-700">No missing, blocked, or partial connected checks remain.</div>}
      </div>
      {connectedGaps.length > 6 && <button type="button" onClick={() => setShowAllGaps((value) => !value)} className="mt-3 w-full rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-xs font-black text-brand-700 hover:bg-brand-50">{showAllGaps ? "Show highest-priority gaps only" : `View all  connected gaps`}</button>}
    </div>
  </div>;
}
