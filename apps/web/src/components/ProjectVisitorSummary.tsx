import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";

type Summary = {
  periodDays: number; pageViews: number; sessions: number; trackingVerified: boolean;
  daily: Array<{ date: string; pageViews: number }>;
  topPages: Array<{ path: string; pageViews: number }>;
};
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export default function ProjectVisitorSummary({ websiteId }: { websiteId?: string | null }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const gradientId = useId().replaceAll(":", "");
  useEffect(() => {
    let active = true;
    setData(null);
    setError(false);
    if (websiteId) api.get<Summary>(`/api/websites/${encodeURIComponent(websiteId)}/visitor-summary`)
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [websiteId, attempt]);
  const setupUrl = websiteId ? `/websites?tracking=${encodeURIComponent(websiteId)}` : "/websites";
  return <section className="border-b border-slate-200 bg-white p-5" aria-label="Website visitor summary">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-bold text-slate-950">Website visitors</h3><p className="mt-1 text-xs text-slate-500">Last 28 days · SEnuke tracking · Daily totals in UTC</p></div>
      <Link to={setupUrl} className="text-xs font-semibold text-brand-700 hover:underline">Tracking setup →</Link>
    </div>
    {!websiteId ? <p className="mt-4 text-sm text-slate-500">Website tracking not available</p>
      : error ? <div className="mt-4 flex items-center gap-3 text-sm text-slate-600"><p>Visitor data could not be loaded.</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="font-semibold text-brand-700">Retry</button></div>
      : !data ? <p role="status" className="mt-4 text-sm text-slate-500">Loading visitor activity…</p>
      : !data.trackingVerified && data.pageViews === 0 ? <p className="mt-4 text-sm text-slate-500">Website tracking not available</p>
      : <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <div><span className="text-2xl font-bold text-slate-950">{data.sessions.toLocaleString()}</span><span className="ml-2 text-xs text-slate-500">Sessions</span></div>
            <div><span className="text-2xl font-bold text-slate-950">{data.pageViews.toLocaleString()}</span><span className="ml-2 text-xs text-slate-500">Page views</span></div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Sessions represent visits, not unique people.</p>
          {data.pageViews > 0 ? <div className="mt-3 h-36 w-full" role="img" aria-label={`Daily page views over the last 28 days: ${data.pageViews} total. Hover over the chart for daily counts.`}>
            <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily} margin={{ top: 5, right: 8, bottom: 0, left: -22 }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.25}/><stop offset="100%" stopColor="#6366f1" stopOpacity={0.02}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
              <XAxis dataKey="date" tickFormatter={dayLabel} minTickGap={36} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}/>
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}/>
              <Tooltip labelFormatter={(value) => dayLabel(String(value))} contentStyle={{ borderRadius: 10, fontSize: 12 }}/>
              <Area type="linear" dataKey="pageViews" name="Page views" stroke="#6366f1" strokeWidth={2} fill={`url(#${gradientId})`} isAnimationActive={false}/>
            </AreaChart></ResponsiveContainer>
          </div> : <p className="mt-5 text-sm text-slate-500">No page views recorded in the last 28 days.</p>}
        </div>
        <div className="min-w-0 lg:border-l lg:border-slate-100 lg:pl-6">
          <div className="flex items-center justify-between text-xs"><h4 className="font-semibold text-slate-800">Top 3 pages visited</h4><span className="text-slate-500">Views</span></div>
          {data.topPages.length ? <ol className="mt-2 divide-y divide-slate-100">{data.topPages.map((page, index) => <li key={page.path} className="py-3">
            <div className="flex items-start gap-2 text-xs"><span className="text-slate-400">{index + 1}.</span><span className="min-w-0 flex-1 break-all font-medium text-slate-700">{page.path}</span><span className="shrink-0 font-semibold text-slate-950">{page.pageViews.toLocaleString()}</span></div>
            <div className="mt-2 h-1 rounded-full bg-slate-100"><div className="h-1 rounded-full bg-indigo-400" style={{ width: `${page.pageViews / Math.max(1, data.topPages[0].pageViews) * 100}%` }}/></div>
          </li>)}</ol> : <p className="mt-4 text-xs text-slate-500">Your most viewed pages will appear here once visits are recorded.</p>}
        </div>
      </div>}
  </section>;
}
