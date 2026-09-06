import { useCallback, useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { api } from "../api.js";

type Row = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
type SearchData = {
  configured: boolean; canManage: boolean; websiteUrl: string | null;
  compatibleProperties: Array<{ siteUrl: string; permissionLevel: string }>;
  connection: { status: string; propertyUrl: string | null; syncStatus: string; lastSyncedAt: string | null; lastSyncAttemptAt: string | null; errorMessage: string | null } | null;
  snapshot: { startDate: string; endDate: string; fetchedAt: string; data: { opportunities?: Array<{ query: string; title: string; detail: string; impressions: number; clicks: number; ctr: number; position: number }>; totals: Row | null; daily: Row[]; pages: Row[]; queries: Row[]; inspections: Array<{ url: string; verdict?: string; coverageState?: string; googleCanonical?: string; lastCrawlTime?: string; error?: string }>; limited: boolean; limitation: string } } | null;
};
const readable = (value: string) => value.replaceAll("_", " ");
export default function GoogleSearchConsolePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<SearchData | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [property, setProperty] = useState("");
  const [later, setLater] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [trend, setTrend] = useState<"clicks" | "impressions" | "position">("clicks");
  const [view, setView] = useState<"queries" | "pages">("queries");
  const base = `/api/projects/${encodeURIComponent(projectId)}/google-search-console`;
  const load = useCallback(async () => {
    try { setData(await api.get<SearchData>(base)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Google connection status could not be loaded."); }
  }, [base]);
  useEffect(() => {
    setData(null); setError(""); setExpanded(false);
    try { setLater(localStorage.getItem(`senuke:search-setup-later:${projectId}`) === "yes"); } catch { setLater(false); }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [load, projectId]);
  useEffect(() => { setProperty(data?.connection?.propertyUrl || ""); }, [data?.connection?.propertyUrl]);
  async function action(name: string, body: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(name); setError("");
    try {
      const result = await api.post<{ authorizationUrl?: string }>(`${base}/${name}`, body);
      if (result.authorizationUrl) { window.location.assign(result.authorizationUrl); return; }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Google action failed. Try again."); }
    finally { setBusy(""); }
  }
  const defer = () => { setLater(true); setExpanded(false); try { localStorage.setItem(`senuke:search-setup-later:${projectId}`, "yes"); } catch { /* Remains optional if local storage is unavailable. */ } };
  const connection = data?.connection;
  const linked = Boolean(connection && ["connected", "needs_property"].includes(connection.status));
  const syncing = connection?.syncStatus === "queued" || connection?.syncStatus === "running";
  const rows = data?.snapshot?.data[view] ?? [];
  const totals = data?.snapshot?.data.totals;
  return <section id="search-performance" className="scroll-mt-6 overflow-hidden rounded-2xl border border-indigo-200 bg-white">
    <div className="flex flex-wrap items-start justify-between gap-4 bg-indigo-50/60 p-5"><div><div className="text-[10px] font-black uppercase tracking-wide text-indigo-700">Google Search Console · optional</div><h2 className="mt-1 text-lg font-black text-slate-950">{linked ? "Google search performance" : later ? "Search Console · set up later" : "Connect your Google search data"}</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">Read search clicks, impressions, queries and Google's recorded indexing status. Your growth plan and SEnuke measurement continue independently.</p>{connection && <span className="mt-2 inline-block rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase text-indigo-800">{readable(connection.status)}{connection.syncStatus !== "idle" ? ` · ${readable(connection.syncStatus)}` : ""}</span>}</div>
      <div className="flex flex-wrap gap-2">{!linked && <button type="button" onClick={defer} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700">Set up later</button>}{!linked && <button type="button" disabled={!data?.configured || !data?.canManage || Boolean(busy)} onClick={() => void action("connect")} className="rounded-lg bg-indigo-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{busy === "connect" ? "Opening Google…" : connection?.status === "reauth_required" ? "Reconnect Google" : "Connect Google Search Console"}</button>}{linked && connection?.propertyUrl && <button type="button" disabled={!data?.canManage || Boolean(busy) || syncing} onClick={() => void action("sync")} className="rounded-lg bg-indigo-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{syncing ? "Worker syncing…" : busy === "sync" ? "Queuing…" : "Sync now"}</button>}<button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-xs font-bold text-indigo-700">{expanded ? "Hide setup" : "Connection settings"}</button></div>
    </div>
    <div className="space-y-4 p-5">
      {(error || connection?.errorMessage) && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{error || connection?.errorMessage}</p>}
      {data && !data.configured && <p className="text-xs text-amber-800">Google OAuth credentials need to be configured by the server administrator.</p>}
      {(expanded || connection?.status === "needs_property") && <div className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-black text-slate-950">Choose the property for this website</h3><p className="mt-1 break-all text-xs text-slate-500">{data?.websiteUrl || "Add your production website first."}</p><p className="mt-2 text-xs leading-5 text-slate-600">Use a Google account with access to this site's Search Console property. Connecting imports data only; it does not submit your sitemap or request indexing.</p>
        {linked && <><div className="mt-3 flex flex-wrap gap-2"><select aria-label="Search Console property" value={property} onChange={event => setProperty(event.target.value)} disabled={!data?.canManage || Boolean(busy)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white p-2.5 text-sm"><option value="">Select a matching property</option>{data?.compatibleProperties.map(item => <option key={item.siteUrl} value={item.siteUrl}>{item.siteUrl}</option>)}</select><button type="button" disabled={!property || !data?.canManage || Boolean(busy)} onClick={() => void action("property", { propertyUrl: property })} className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Select & start sync</button><button type="button" disabled={!data?.canManage || Boolean(busy)} onClick={() => void action("properties/refresh")} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Refresh properties</button></div>{!data?.compatibleProperties.length && <p className="mt-3 text-xs leading-5 text-amber-800">No matching property was returned. Verify your domain in Search Console, or grant this Google account access, then refresh properties.</p>}<button type="button" disabled={!data?.canManage || Boolean(busy)} onClick={() => void action("connect")} className="mt-3 text-xs font-bold text-indigo-700 underline disabled:opacity-40">Reconnect or change Google account</button><p className="mt-3 text-[11px] text-slate-500">Disconnecting clears this connection's saved tokens and stops background imports. Previously imported history stays with the project.</p><button type="button" disabled={!data?.canManage || Boolean(busy)} onClick={() => void action("disconnect")} className="mt-2 text-xs font-bold text-rose-700 underline disabled:opacity-40">Disconnect Search Console</button></>}
        {!linked && <p className="mt-3 text-xs text-slate-500">After Google authorisation, return here to select your property. The worker imports the last 28 days of available finalized data and refreshes it daily.</p>}
      </div>}
      {connection?.propertyUrl && <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600"><b className="break-all">{connection.propertyUrl}</b><span>{connection.lastSyncedAt ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}` : "Waiting for the first successful import"}</span></div>}
      {syncing && <p role="status" className="rounded-lg bg-cyan-50 p-3 text-xs font-semibold text-cyan-900">The background worker is {connection?.syncStatus === "queued" ? "waiting to import" : "importing"} Google data. You can leave this page; progress is saved.</p>}
      {data?.snapshot && <><div className="text-xs text-slate-500">Google Web Search · {data.snapshot.startDate} to {data.snapshot.endDate} · finalized data</div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Clicks", totals?.clicks], ["Impressions", totals?.impressions], ["Click-through rate", totals ? `${(totals.ctr * 100).toFixed(1)}%` : null], ["Average position", totals ? totals.position.toFixed(1) : null]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-4"><div className="text-[10px] font-bold uppercase text-slate-500">{label}</div><b className="mt-2 block text-2xl text-slate-950">{value ?? "—"}</b></div>)}</div>
        {!totals && <p className="text-xs leading-5 text-amber-800">Google returned no finalized performance data for this period. This can happen with a new site or property; it is not a connection failure or proof of zero traffic.</p>}
        {data.snapshot.data.daily.length > 0 && <div className="rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black text-slate-950">Daily search trend</h3><select aria-label="Search trend metric" value={trend} onChange={event => setTrend(event.target.value as typeof trend)} className="rounded-lg border bg-white p-2 text-xs"><option value="clicks">Clicks</option><option value="impressions">Impressions</option><option value="position">Average position</option></select></div><div className="mt-3 h-56"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.snapshot.data.daily.map(row => ({ ...row, date: row.keys?.[0] }))}><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={35}/><YAxis reversed={trend === "position"} tick={{ fontSize: 10 }} width={45}/><Tooltip/><Line type="linear" dataKey={trend} stroke="#4338ca" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div><p className="text-[11px] text-slate-500">{trend === "position" ? "Average position across observed searches; lower is better. This is not a fixed live rank for every searcher." : "Only dates returned by Google are plotted; missing dates are not filled with zeros."}</p></div>}
        {Boolean(data.snapshot.data.opportunities?.length) && <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-4"><h3 className="text-sm font-black text-slate-950">Opportunities to review</h3><div className="mt-3 space-y-3">{data.snapshot.data.opportunities?.map(item => <div key={item.query}><b className="text-xs text-slate-900">{item.title}</b><p className="mt-1 text-xs text-cyan-900">{item.impressions} impressions · {item.clicks} clicks · {(item.ctr * 100).toFixed(1)}% CTR · average position {item.position.toFixed(1)}</p><p className="mt-1 text-[11px] leading-5 text-slate-600">{item.detail}</p></div>)}</div><Link to={`/gap-analysis?projectId=${encodeURIComponent(projectId)}`} className="mt-4 inline-block text-xs font-bold text-indigo-700">Review alongside the SEO & Gap Execution Plan →</Link></div>}
        <div className="flex gap-2">{(["queries", "pages"] as const).map(key => <button key={key} type="button" onClick={() => setView(key)} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === key ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-600"}`}>{key === "queries" ? "Search queries" : "Landing pages"}</button>)}</div>
        {rows.length > 0 && <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">{view === "queries" ? "Query" : "Page"}</th><th className="p-3">Clicks</th><th className="p-3">Impressions</th><th className="p-3">CTR</th><th className="p-3">Avg. position</th></tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={index} className="border-t"><td className="max-w-md break-all p-3 font-semibold">{row.keys?.[0]}</td><td className="p-3">{row.clicks}</td><td className="p-3">{row.impressions}</td><td className="p-3">{(row.ctr * 100).toFixed(1)}%</td><td className="p-3">{row.position.toFixed(1)}</td></tr>)}</tbody></table></div>}
        <div><h3 className="text-sm font-black text-slate-950">Google's recorded indexing status</h3><p className="mt-1 text-xs text-slate-500">Up to 10 published URLs per sync. These results describe Google's stored version.</p><div className="mt-3 space-y-2">{data.snapshot.data.inspections.map(item => <div key={item.url} className="rounded-lg border p-3 text-xs"><b className="block break-all text-slate-900">{item.url}</b><p className="mt-1 text-slate-600">{item.error || item.coverageState || item.verdict || "No inspection result available"}</p>{item.googleCanonical && <p className="mt-1 break-all text-slate-500">Google canonical: {item.googleCanonical}</p>}{item.lastCrawlTime && <p className="mt-1 text-slate-500">Last crawl: {new Date(item.lastCrawlTime).toLocaleString()}</p>}</div>)}</div></div>
        <p className="text-[11px] leading-5 text-slate-500">{data.snapshot.data.limitation}{data.snapshot.data.limited ? " This import reached the 5,000-row limit for at least one breakdown." : ""}</p></>}
    </div>
  </section>;
}
