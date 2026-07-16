import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { BACKGROUND_JOBS_EVENT, dismissBackgroundJob, dismissBackgroundJobs, isBackgroundJobFinished, normalizeBackgroundJobResponse, readBackgroundJobs, updateBackgroundJob, type BackgroundJob } from "../background-jobs.js";

export default function BackgroundJobCenter({ enabled }: { enabled: boolean }) {
  const [jobs, setJobs] = useState<BackgroundJob[]>(() => readBackgroundJobs());
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [refreshNotices, setRefreshNotices] = useState<Record<string, string>>({});

  const refreshJob = async (job: BackgroundJob) => {
    setRefreshingIds((current) => new Set(current).add(job.id));
    try {
      const raw = await api.get<unknown>(job.statusUrl);
      const result = normalizeBackgroundJobResponse(raw);
      const status = typeof result.status === "string" ? result.status : job.status;
      const metric = job.resultMetricKey && typeof result[job.resultMetricKey] === "number" ? Number(result[job.resultMetricKey]) : job.resultMetric;
      updateBackgroundJob(job.id, { status, resultMetric: metric, error: typeof result.error === "string" ? result.error : null });
      setRefreshNotices((current) => ({ ...current, [job.id]: `Status refreshed: ${status.replaceAll("_", " ")}.` }));
    } catch {
      setRefreshNotices((current) => ({ ...current, [job.id]: "Status could not be refreshed. The automatic check will try again." }));
    } finally {
      setRefreshingIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!enabled) { setJobs([]); return; }
    let cancelled = false;
    let refreshInFlight = false;
    const onChanged = (event: Event) => setJobs((event as CustomEvent<BackgroundJob[]>).detail ?? readBackgroundJobs());
    const refresh = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      const tracked = readBackgroundJobs();
      if (!cancelled) setJobs(tracked);
      try {
        const active = tracked.filter((job) => !isBackgroundJobFinished(job.status));
        for (let offset = 0; offset < active.length; offset += 10) {
          await Promise.all(active.slice(offset, offset + 10).map(async (job) => {
            try {
              const raw = await api.get<unknown>(job.statusUrl);
              const result = normalizeBackgroundJobResponse(raw);
              if (cancelled) return;
              const status = typeof result.status === "string" ? result.status : job.status;
              const metric = job.resultMetricKey && typeof result[job.resultMetricKey] === "number" ? Number(result[job.resultMetricKey]) : job.resultMetric;
              updateBackgroundJob(job.id, { status, resultMetric: metric, error: typeof result.error === "string" ? result.error : null });
              if (isBackgroundJobFinished(status) && document.hidden && "Notification" in window && Notification.permission === "granted") {
                new Notification(status === "completed" ? `${job.title} completed` : `${job.title} failed`, { body: status === "completed" ? `${job.subject} is ready to review.` : `${job.subject} needs attention.` });
              }
            } catch {
              // Keep tracking through temporary connection failures.
            }
          }));
          if (cancelled) return;
        }
      } finally {
        refreshInFlight = false;
      }
    };
    window.addEventListener(BACKGROUND_JOBS_EVENT, onChanged);
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener(BACKGROUND_JOBS_EVENT, onChanged); };
  }, [enabled]);

  if (!jobs.length) return null;
  const keywordJobs = jobs.filter((job) => job.type === "keyword-research");
  const otherJobs = jobs.filter((job) => job.type !== "keyword-research");
  const keywordCompleted = keywordJobs.filter((job) => job.status === "completed").length;
  const keywordFailed = keywordJobs.filter((job) => ["failed", "cancelled"].includes(job.status)).length;
  const keywordFinished = keywordCompleted + keywordFailed;
  const keywordDone = keywordJobs.length > 0 && keywordFinished === keywordJobs.length;
  const keywordPercent = keywordJobs.length ? Math.round((keywordFinished / keywordJobs.length) * 100) : 0;
  const keywordRefreshing = keywordJobs.some((job) => refreshingIds.has(job.id));
  const refreshKeywordBatch = async () => {
    const active = keywordJobs.filter((job) => !isBackgroundJobFinished(job.status));
    for (let offset = 0; offset < active.length; offset += 10) {
      await Promise.all(active.slice(offset, offset + 10).map(refreshJob));
    }
  };
  const keywordProjectId = keywordJobs.map((job) => {
    try { return new URL(job.resultUrl, window.location.origin).searchParams.get("projectId"); } catch { return null; }
  }).find(Boolean);
  const keywordResultUrl = keywordProjectId ? `/keywords?projectId=${encodeURIComponent(keywordProjectId)}` : "/keywords";
  return <div className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-sm" aria-label={`${jobs.length} background job${jobs.length === 1 ? "" : "s"}`}>
    {keywordJobs.length > 0 && <div className={`border-b px-4 py-3 text-sm lg:px-8 ${keywordDone && keywordFailed === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-950" : keywordDone ? "border-amber-200 bg-amber-50 text-amber-950" : "border-brand-200 bg-brand-50 text-brand-950"}`}>
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${keywordDone ? keywordFailed ? "bg-amber-500" : "bg-emerald-500" : "animate-pulse bg-brand-600"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-bold">{keywordDone ? keywordFailed ? "Keyword research finished with issues" : "Keyword research done" : "Keyword research is working"}</span><span className="text-xs font-bold opacity-75">{keywordCompleted} / {keywordJobs.length} completed{keywordFailed ? ` · ${keywordFailed} need attention` : ""}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70"><div className={`h-full rounded-full transition-all ${keywordDone && keywordFailed === 0 ? "bg-emerald-500" : keywordFailed ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${keywordPercent}%` }} /></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!keywordDone && <button type="button" onClick={() => void refreshKeywordBatch()} disabled={keywordRefreshing} className="rounded-lg border border-current/20 bg-white/80 px-3 py-2 text-xs font-bold hover:bg-white disabled:opacity-60">{keywordRefreshing ? "Refreshing…" : "Refresh Status"}</button>}
          {keywordDone && <Link to={keywordResultUrl} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700">View Results</Link>}
          <button type="button" onClick={() => dismissBackgroundJobs(keywordJobs.map((job) => job.id))} className="grid h-8 w-8 place-items-center rounded-lg border border-current/20 bg-white/80 text-base font-bold hover:bg-white" aria-label="Close keyword research status">×</button>
        </div>
      </div>
    </div>}
    {otherJobs.length > 0 && <div className="max-h-[330px] divide-y divide-slate-200 overflow-y-auto overscroll-contain sm:max-h-[228px]">{otherJobs.map((job) => {
    const failed = job.status === "failed" || job.status === "cancelled";
    const completed = job.status === "completed";
    const stage = job.status === "completed" ? "Finished" : job.status === "queued" ? "Queued" : ["running", "processing", "in_progress"].includes(job.status) ? "In process" : job.status === "failed" ? "Failed" : job.status === "cancelled" ? "Cancelled" : "Started";
    const message = completed ? `${job.completedMessage}${job.resultMetric != null && job.resultMetricLabel ? ` · ${job.resultMetric} ${job.resultMetricLabel}` : ""}` : failed ? (job.error || job.failedMessage) : job.progressMessage;
    return <div key={job.id} className={`border-b px-4 py-3 text-sm lg:px-8 ${completed ? "border-emerald-200 bg-emerald-50 text-emerald-950" : failed ? "border-red-200 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${completed ? "bg-emerald-500" : failed ? "bg-red-500" : "animate-pulse bg-amber-500"}`} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-bold">{job.title}</span><span className="max-w-full truncate font-semibold opacity-80" title={job.subject}>· {job.subject}</span><span className="rounded-full border border-current/15 bg-white/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{stage}</span></div><div className="mt-0.5 text-xs opacity-80">{message}</div>{!isBackgroundJobFinished(job.status) && <div className="mt-1 text-[11px] font-semibold opacity-70">Working in the background—you can continue anywhere in SEnuke AI.</div>}{refreshNotices[job.id] && <div className="mt-1 text-[11px] font-bold opacity-80" role="status">{refreshNotices[job.id]}</div>}</div></div><div className="flex shrink-0 flex-wrap items-center gap-2">{!isBackgroundJobFinished(job.status) && <button type="button" onClick={() => void refreshJob(job)} disabled={refreshingIds.has(job.id)} className="rounded-lg border border-current/20 bg-white/70 px-3 py-2 text-xs font-bold hover:bg-white disabled:opacity-60">{refreshingIds.has(job.id) ? "Refreshing…" : "Refresh Status"}</button>}<Link reloadDocument to={job.resultUrl} className={`rounded-lg px-3 py-2 text-xs font-bold text-white ${completed ? "bg-emerald-600 hover:bg-emerald-700" : failed ? "bg-red-600 hover:bg-red-700" : "bg-amber-700 hover:bg-amber-800"}`}>{completed ? "View Results" : failed ? "Review Error" : "View Progress"}</Link>{isBackgroundJobFinished(job.status) && <button type="button" onClick={() => dismissBackgroundJob(job.id)} className="rounded-lg border border-current/20 bg-white/70 px-3 py-2 text-xs font-bold">Dismiss</button>}</div></div></div>;
    })}</div>}
  </div>;
}
