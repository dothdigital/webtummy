import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import type { LocalBusinessProfile } from "../types.js";

type Point = { id: string; rowIndex: number; columnIndex: number; rank: number | null; found: boolean; latitude: number; longitude: number };
type ScanSummary = { progress?: number; completedPoints?: number; pointCount?: number };
type Scan = {
  id: string;
  status: string;
  scanDate: string;
  averageRank: number | null;
  top3Share: number | null;
  top10Share: number | null;
  weakAreaCount: number;
  summaryJson?: ScanSummary;
  errorMessage?: string | null;
  points: Point[];
  competitors: Array<{ id: string; businessName: string; domain: string | null; averageRank: number | null; top3Share: number | null; top10Share: number | null }>;
};
type Configuration = {
  id: string;
  name: string;
  gridSize: number;
  radiusKm: number;
  centerLatitude: number;
  centerLongitude: number;
  device: string;
  language: string;
  engine: string;
  schedule: string;
  keyword: { id: string; keyword: string; city: string };
  scans: Scan[];
};
type Setup = { keywordId: string; name: string; gridSize: string; radiusKm: string; latitude: string; longitude: string; schedule: string };

const heatTone = (rank: number | null) => rank == null ? "bg-slate-200 text-slate-700" : rank <= 3 ? "bg-emerald-500 text-white" : rank <= 10 ? "bg-amber-400 text-amber-950" : rank <= 20 ? "bg-orange-500 text-white" : "bg-red-600 text-white";
const activeStatus = (status?: string) => status === "queued" || status === "running";

export default function LocalGridPanel({ business }: { business: LocalBusinessProfile }) {
  const keywords = useMemo(() => (business.keywords ?? []).filter((keyword) => keyword.active), [business.keywords]);
  const firstKeyword = keywords[0];
  const initialSetup = (): Setup => ({
    keywordId: firstKeyword?.id ?? "",
    name: firstKeyword ? `${firstKeyword.keyword} — ${firstKeyword.city}` : "",
    gridSize: "5",
    radiusKm: "5",
    latitude: business.latitude == null ? "" : String(business.latitude),
    longitude: business.longitude == null ? "" : String(business.longitude),
    schedule: "monthly",
  });
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<Setup>(initialSetup);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    const result = await api.get<{ configurations: Configuration[] }>(`/api/local/business/${business.id}/grids`);
    setConfigurations(result.configurations);
    setSelectedId((current) => current && result.configurations.some((item) => item.id === current) ? current : result.configurations[0]?.id ?? "");
  };
  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load grids.")); }, [business.id]);
  const configuration = configurations.find((item) => item.id === selectedId) ?? configurations[0];
  const scan = configuration?.scans[0];

  useEffect(() => {
    if (!activeStatus(scan?.status)) return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 2500);
    return () => window.clearInterval(timer);
  }, [scan?.id, scan?.status, business.id]);

  const openSetup = () => {
    setSetup(initialSetup());
    setSetupOpen(true);
    setError("");
    setNotice("");
  };
  const chooseKeyword = (keywordId: string) => {
    const keyword = keywords.find((item) => item.id === keywordId);
    setSetup((current) => ({ ...current, keywordId, name: keyword ? `${keyword.keyword} — ${keyword.city}` : current.name }));
  };
  const findLocation = async () => {
    setLocating(true); setError(""); setNotice("");
    try {
      const result = await api.post<{ latitude: number; longitude: number; matchedBusinessName?: string; confidence?: number }>(`/api/local/business/${business.id}/grid-center`, {});
      setSetup((current) => ({ ...current, latitude: String(result.latitude), longitude: String(result.longitude) }));
      setNotice(result.matchedBusinessName ? `Matched ${result.matchedBusinessName}${result.confidence ? ` with ${result.confidence}% confidence` : ""}.` : "Saved business coordinates loaded.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not find the business location."); }
    finally { setLocating(false); }
  };
  const create = async () => {
    const keyword = keywords.find((item) => item.id === setup.keywordId);
    if (!keyword) { setError("Choose a tracked keyword for this grid."); return; }
    const latitude = Number(setup.latitude);
    const longitude = Number(setup.longitude);
    const gridSize = Number(setup.gridSize);
    const radiusKm = Number(setup.radiusKm);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { setError("Find or enter valid business coordinates."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.post<{ configuration: Configuration }>(`/api/local/business/${business.id}/grids`, {
        keywordId: keyword.id,
        name: setup.name.trim() || `${keyword.keyword} — ${keyword.city}`,
        gridSize,
        radiusKm,
        centerLatitude: latitude,
        centerLongitude: longitude,
        device: "mobile",
        language: keyword.language || "en",
        engine: "google_maps",
        resultDepth: 20,
        schedule: setup.schedule,
        movementThreshold: 10,
      });
      await load();
      setSelectedId(result.configuration.id);
      setSetupOpen(false);
      setNotice("Grid created. Run the first scan when you are ready.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create grid."); }
    finally { setBusy(false); }
  };
  const run = async () => {
    if (!configuration) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.post(`/api/local/business/${business.id}/grids/${configuration.id}/scans`, {});
      await load();
      setNotice("Local grid scan started in the background. You can leave this page and return later.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start scan."); }
    finally { setBusy(false); }
  };
  const cancelScan = async () => {
    if (!configuration || !scan || !activeStatus(scan.status)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.post(`/api/local/business/${business.id}/grids/${configuration.id}/scans/${scan.id}/manage`, { action: "cancel" });
      await load();
      setNotice("Local grid scan cancelled. Saved results from earlier completed scans were preserved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel the scan."); }
    finally { setBusy(false); }
  };
  const exportData = () => {
    if (!configuration || !scan) return;
    const blob = new Blob([JSON.stringify({ business: business.businessName, keyword: configuration.keyword, settings: { gridSize: configuration.gridSize, radiusKm: configuration.radiusKm, device: configuration.device, engine: configuration.engine }, scan }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${configuration.keyword.keyword.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-local-grid.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const progress = Math.max(0, Math.min(100, Number(scan?.summaryJson?.progress ?? (scan?.status === "completed" ? 100 : 0))));
  return <section id="local-grid" className="scroll-mt-24 rounded-xl border border-violet-200 bg-white p-5" aria-labelledby="local-grid-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="local-grid-title" className="font-black text-charcoal-950">Local grid &amp; heatmap tracking</h2><p className="mt-1 max-w-3xl text-sm text-charcoal-500">See where the business ranks across its service area for one tracked keyword. Each numbered square is a real map result from that geographic point.</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => window.print()} disabled={scan?.status !== "completed"} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 disabled:opacity-40">Print / PDF</button><button onClick={exportData} disabled={scan?.status !== "completed"} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 disabled:opacity-40">Export data</button><button onClick={openSetup} disabled={busy} className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-bold text-violet-700">New grid</button>{activeStatus(scan?.status)&&<button onClick={() => void cancelScan()} disabled={busy} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-40">Cancel scan</button>}<button onClick={() => void run()} disabled={busy || !configuration || activeStatus(scan?.status)} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300">{activeStatus(scan?.status) ? "Scan running…" : "Run scan"}</button></div>
    </div>
    {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 whitespace-pre-line">{error}</div>}
    {notice && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{notice}</div>}

    {setupOpen && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-black text-slate-900">Create a local ranking grid</h3><p className="mt-1 text-sm text-slate-600">Choose one saved keyword and the geographic area to measure. A 5×5 grid performs 25 map checks.</p></div><button onClick={() => setSetupOpen(false)} className="rounded-lg px-2 py-1 text-sm font-bold text-slate-500 hover:bg-white">Close</button></div>
      {keywords.length ? <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-bold text-slate-700 md:col-span-2">Tracked keyword and market<select value={setup.keywordId} onChange={(event) => chooseKeyword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{keywords.map((keyword) => <option key={keyword.id} value={keyword.id}>{keyword.keyword} — {keyword.city}</option>)}</select></label>
        <label className="text-sm font-bold text-slate-700">Grid size<select value={setup.gridSize} onChange={(event) => setSetup((current) => ({ ...current, gridSize: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="3">3×3 · 9 checks</option><option value="5">5×5 · 25 checks</option><option value="7">7×7 · 49 checks</option></select></label>
        <label className="text-sm font-bold text-slate-700">Coverage radius<select value={setup.radiusKm} onChange={(event) => setSetup((current) => ({ ...current, radiusKm: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="2">2 km</option><option value="5">5 km</option><option value="10">10 km</option><option value="20">20 km</option><option value="40">40 km</option></select></label>
        <label className="text-sm font-bold text-slate-700 md:col-span-2">Grid name<input value={setup.name} onChange={(event) => setSetup((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
        <label className="text-sm font-bold text-slate-700">Latitude<input inputMode="decimal" value={setup.latitude} onChange={(event) => setSetup((current) => ({ ...current, latitude: event.target.value }))} placeholder="43.5890" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
        <label className="text-sm font-bold text-slate-700">Longitude<input inputMode="decimal" value={setup.longitude} onChange={(event) => setSetup((current) => ({ ...current, longitude: event.target.value }))} placeholder="-79.6441" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
        <label className="text-sm font-bold text-slate-700">Repeat scan<select value={setup.schedule} onChange={(event) => setSetup((current) => ({ ...current, schedule: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="manual">Manual only</option><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option></select></label>
        <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-3"><button onClick={() => void findLocation()} disabled={locating} className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-bold text-violet-700">{locating ? "Finding location…" : "Find business location"}</button><button onClick={() => void create()} disabled={busy || locating} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-black text-white disabled:bg-slate-300">{busy ? "Creating…" : "Create grid"}</button></div>
      </div> : <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><b className="text-amber-900">Tracked keywords are required first.</b><p className="mt-1 text-sm text-amber-800">Save keyword and location targets in Rank Tracking Setup, then return here to create a grid.</p></div>}
    </div>}

    {configurations.length > 0 ? <>
      <div className="mt-4 flex gap-2 overflow-x-auto">{configurations.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-bold ${item.id === configuration?.id ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{item.name}</button>)}</div>
      {configuration && <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap justify-between gap-2"><div><b>{configuration.keyword.keyword}</b><div className="text-xs text-slate-500">{configuration.keyword.city} · {configuration.gridSize}×{configuration.gridSize} · {configuration.radiusKm} km · {configuration.device} · {configuration.schedule}</div></div>{scan?.status === "completed" && <div className="flex gap-2 text-xs font-bold"><span>Avg {scan.averageRank?.toFixed(1) ?? "—"}</span><span>Top 3 {scan.top3Share?.toFixed(1) ?? "0"}%</span><span>Top 10 {scan.top10Share?.toFixed(1) ?? "0"}%</span></div>}</div>
          {activeStatus(scan?.status) && <div className="mt-4 rounded-lg border border-violet-200 bg-white p-4"><div className="flex justify-between text-sm font-bold text-violet-800"><span>{scan?.status === "queued" ? "Waiting to start" : "Checking map positions"}</span><span>{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-slate-500">{scan?.summaryJson?.completedPoints ?? 0} of {scan?.summaryJson?.pointCount ?? configuration.gridSize ** 2} geographic points checked. You can leave this page while it runs.</p></div>}
          {["failed","cancelled"].includes(scan?.status ?? "") && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><b>{scan?.status === "cancelled" ? "Scan was cancelled." : "Scan could not be completed."}</b><p className="mt-1">{scan?.errorMessage || "Review the provider connection and try again."}</p><button onClick={() => void run()} disabled={busy} className="mt-3 rounded-lg bg-red-700 px-3 py-2 font-bold text-white">Try again</button></div>}
          {scan?.points.length ? <div className="mt-4 grid gap-1" style={{ gridTemplateColumns: `repeat(${configuration.gridSize}, minmax(0, 1fr))` }} role="grid" aria-label={`${configuration.keyword.keyword} geographic rank grid from ${new Date(scan.scanDate).toLocaleDateString()}`}>{scan.points.map((point) => <div key={point.id} role="gridcell" aria-label={`Row ${point.rowIndex + 1}, column ${point.columnIndex + 1}: ${point.rank ? `rank ${point.rank}` : "not found"}`} title={`${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`} className={`grid aspect-square min-h-9 place-items-center rounded-md text-xs font-black ${heatTone(point.rank)}`}>{point.rank ?? "—"}</div>)}</div> : !activeStatus(scan?.status) && scan?.status !== "failed" ? <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Run the first scan to create the heatmap.</div> : null}
          <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold"><span><i className="mr-1 inline-block h-3 w-3 rounded bg-emerald-500" />1–3</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-amber-400" />4–10</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-orange-500" />11–20</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-red-600" />21+</span><span><i className="mr-1 inline-block h-3 w-3 rounded bg-slate-200" />Not found</span></div>
        </div>
        <aside className="space-y-4"><div className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">Scan history</h3><div className="mt-2 space-y-2 text-xs">{configuration.scans.length ? configuration.scans.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-2"><b>{new Date(item.scanDate).toLocaleDateString()}</b> · {item.status.replaceAll("_", " ")}<div className="text-slate-500">Avg {item.averageRank?.toFixed(1) ?? "—"} · Top 10 {item.top10Share?.toFixed(1) ?? "0"}% · {item.weakAreaCount} weak</div></div>) : <p className="text-slate-500">No scans yet.</p>}</div></div><div className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">Competitors</h3><div className="mt-2 space-y-2 text-xs">{scan?.competitors.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-2"><b>{item.businessName}</b><div className="text-slate-500">Avg {item.averageRank?.toFixed(1) ?? "—"} · Top 3 {item.top3Share?.toFixed(1) ?? "0"}%</div></div>)}{!scan?.competitors.length && <p className="text-slate-500">Competitors appear after a completed scan.</p>}</div></div></aside>
      </div>}
    </> : !setupOpen && <div className="mt-4 rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-8 text-center"><b>No local grid configured</b><p className="mt-1 text-sm text-slate-500">Create a grid to measure one tracked keyword across the business service area.</p><button onClick={openSetup} className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-black text-white">Create first grid</button></div>}
  </section>;
}
