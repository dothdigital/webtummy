import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { getActiveProjectId, setActiveProjectId } from "../active-project.js";
import { Button, Card, EmptyState } from "../components/ui.js";

type EvidenceType = "observed" | "inferred" | "user_provided" | "connected" | "unavailable";
type Intelligence = {
  version: string;
  generatedAt: string;
  store: { platform: string; pageCount: number; productCount: number; collectionCount: number; guideCount: number; publicPriceSignals: number; publicReviewSignals: number };
  pages: Array<{ id: string; url: string; name: string; kind: string; score: number; priority: string; evidenceType: EvidenceType; signals: string[]; gaps: string[] }>;
  recommendations: Array<{ key: string; category: string; title: string; explanation: string; recommendedAction: string; expectedImpact: string; evidenceType: EvidenceType; evidence: string[]; affectedUrls: string[]; priority: string; impactScore: number; confidenceScore: number; destination: string }>;
  evidenceCoverage: Array<{ key: string; label: string; status: EvidenceType; detail: string }>;
  limitations: string[];
};
type Response = {
  project: { id: string; name: string; projectType: string; workspaceType: string; storeUrl?: string | null; ecommerceContext: boolean };
  readiness: { storeUrl: boolean; publicCrawl: boolean; keywordEvidence: boolean; performanceEvidence: boolean; strategyStatus: string };
  intelligence: Intelligence;
  latestSavedRun?: { id: string; status: string; createdAt: string } | null;
  capabilities: { sharedGrowthOperatingSystem: boolean; modules: string[]; canAnalyze: boolean; canApprove: boolean };
};

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function evidenceTone(value: EvidenceType) {
  if (value === "observed" || value === "connected") return "bg-emerald-100 text-emerald-800";
  if (value === "user_provided") return "bg-blue-100 text-blue-800";
  if (value === "inferred") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function priorityTone(value: string) {
  if (value === "critical") return "bg-rose-100 text-rose-800";
  if (value === "high") return "bg-orange-100 text-orange-800";
  if (value === "medium") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const cells = (line: string) => line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
  const headers = cells(lines[0]).map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  const numberValue = (value: string | undefined) => value?.trim() ? Number(value.replace(/[$,%]/g, "")) : null;
  return lines.slice(1).map((line) => {
    const values = cells(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return {
      productName: row.product_name || row.product || row.name,
      sku: row.sku || null,
      revenue: numberValue(row.revenue),
      marginPercent: numberValue(row.margin_percent || row.margin),
      conversionRate: numberValue(row.conversion_rate || row.conversion),
      inventory: numberValue(row.inventory),
      orders: numberValue(row.orders),
    };
  }).filter((row) => row.productName && [row.revenue, row.marginPercent, row.conversionRate, row.inventory, row.orders].some((value) => Number.isFinite(value)));
}

export default function EcommerceIntelligence() {
  const [params] = useSearchParams();
  const projectId = params.get("projectId") || getActiveProjectId() || "";
  const [data, setData] = useState<Response | null>(null);
  const [tab, setTab] = useState<"overview" | "catalog" | "recommendations" | "evidence">("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [csvText, setCsvText] = useState("");
  const [pageFilter, setPageFilter] = useState<"all" | "product" | "collection" | "guide">("all");

  const load = async () => {
    if (!projectId) return;
    setError("");
    try {
      const result = await api.get<Response>(`/api/projects/${projectId}/ecommerce-intelligence`);
      setData(result);
      setActiveProjectId(projectId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Ecommerce Intelligence."); }
  };
  useEffect(() => { void load(); }, [projectId]);

  const runAnalysis = async () => {
    if (!projectId) return;
    setBusy("analyze"); setError(""); setMessage("");
    try {
      await api.post(`/api/projects/${projectId}/ecommerce-intelligence/analyze`, {});
      setMessage("Ecommerce Intelligence is ready. Review the evidence and approve only the recommendations that should shape Strategy.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ecommerce Intelligence could not be completed."); }
    finally { setBusy(""); }
  };

  const approve = async (key: string) => {
    setBusy(`approve:${key}`); setError(""); setMessage("");
    try {
      const result = await api.post<{ message: string }>(`/api/projects/${projectId}/ecommerce-intelligence/recommendations/${encodeURIComponent(key)}/approve`, {});
      setMessage(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The recommendation could not be approved."); }
    finally { setBusy(""); }
  };

  const uploadPerformance = async () => {
    const rows = parseCsv(csvText);
    if (!rows.length) { setError("Add a CSV header and at least one product row with a numeric performance field."); return; }
    setBusy("performance"); setError(""); setMessage("");
    try {
      const result = await api.post<{ message: string }>(`/api/projects/${projectId}/ecommerce-intelligence/performance-data`, { rows, replace: true });
      setMessage(result.message); setCsvText(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Product performance data could not be saved."); }
    finally { setBusy(""); }
  };

  const filteredPages = useMemo(() => (data?.intelligence.pages ?? []).filter((page) => pageFilter === "all" || page.kind === pageFilter), [data, pageFilter]);
  const analysisAvailable = Boolean(data?.latestSavedRun && data.latestSavedRun.status === "completed");
  const editStoreUrl = `/projects/new?edit=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(`/ecommerce-intelligence?projectId=${projectId}`)}`;
  if (!projectId) return <EmptyState title="Select an ecommerce project" description="Open a project first so SEnuke can evaluate its public store evidence." action={<Link to="/projects" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">Open Projects</Link>} />;
  if (!data && !error) return <div className="grid min-h-[380px] place-items-center text-sm font-bold text-slate-500">Loading Ecommerce Intelligence…</div>;

  if (data && !data.project.ecommerceContext) {
    const editUrl = `/projects/new?edit=${encodeURIComponent(projectId)}&step=business-type&returnTo=${encodeURIComponent(`/ecommerce-intelligence?projectId=${projectId}`)}`;
    return <div className="space-y-6 pb-10">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-xl">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Ecommerce Intelligence</div>
        <h1 className="mt-2 text-3xl font-black">{data.project.name}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Product, collection, merchandising, and online-store intelligence is available only for projects explicitly identified as Ecommerce.</p>
      </section>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div>}
      <Card className="border-amber-200 bg-amber-50 p-6">
        <div className="inline-flex rounded-full bg-amber-200 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-950">Current Business Type: {label(data.project.projectType)}</div>
        <h2 className="mt-4 text-2xl font-black text-slate-950">This is not an Ecommerce project</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">Use Website Intelligence for this project’s website, SEO, content, lead generation, and conversion work. Do not change the Business Type merely to unlock this screen.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to={`/site-analysis?projectId=${encodeURIComponent(projectId)}`} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-black text-white">Open Website Intelligence</Link>
          <Link to={editUrl} className="rounded-lg border border-amber-400 bg-white px-4 py-2.5 text-sm font-black text-amber-950">Change project to Ecommerce</Link>
        </div>
        <p className="mt-4 text-xs leading-5 text-amber-900"><b>Choose Ecommerce only if this project represents an online store</b> with products, collections or categories, shopping journeys, and sales-focused growth. Reclassification changes future analysis and recommendations but does not change the workspace plan.</p>
      </Card>
    </div>;
  }

  const intelligence = data?.intelligence;
  return <div className="space-y-6 pb-10">
    <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl"><div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Ecommerce Intelligence</div><h1 className="mt-2 text-3xl font-black">{data?.project.name || "Public store growth"}</h1><p className="mt-2 text-sm leading-6 text-slate-300">The same AI Growth Operating System, specialized for products, collections, buying journeys, merchandising, and public store evidence.</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{data?.project.workspaceType ? `${label(data.project.workspaceType)} Workspace` : "Shared platform"}</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{data?.project.storeUrl || "Store URL needed"}</span><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">No private store access assumed</span></div></div>
        <div className="flex flex-wrap gap-2">{!data?.readiness.storeUrl ? <Link to={editStoreUrl} className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-950">Add Store URL</Link> : <Button disabled={!data?.project.ecommerceContext || !data?.capabilities.canAnalyze || busy === "analyze"} onClick={() => void runAnalysis()}>{busy === "analyze" ? "Analyzing…" : data?.latestSavedRun ? "Refresh Ecommerce Intelligence" : "Run Ecommerce Intelligence"}</Button>}</div>
      </div>
    </section>

    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{message}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ["Products detected", analysisAvailable ? intelligence?.store.productCount ?? 0 : "Not analyzed", "Public crawl"], ["Collections detected", analysisAvailable ? intelligence?.store.collectionCount ?? 0 : "Not analyzed", "Public crawl"], ["Buying guides", analysisAvailable ? intelligence?.store.guideCount ?? 0 : "Not analyzed", "Supporting content"], ["Recommendations", analysisAvailable ? intelligence?.recommendations.length ?? 0 : "Not analyzed", "Strategy candidates"], ["Performance evidence", data?.readiness.performanceEvidence ? "Supplied" : "Not supplied", data?.readiness.performanceEvidence ? "User-provided" : "Never treated as zero"],
      ].map(([title, value, detail]) => <Card key={String(title)} className="p-4"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{title}</div><div className="mt-2 text-2xl font-black text-slate-950">{value}</div><div className="mt-1 text-xs text-slate-500">{detail}</div></Card>)}
    </div>

    <nav className="flex flex-wrap gap-2 rounded-xl border bg-white p-2 shadow-sm">{(["overview", "catalog", "recommendations", "evidence"] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-lg px-4 py-2 text-sm font-black ${tab === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{item === "catalog" ? "Products & Collections" : label(item)}</button>)}</nav>

    {tab === "overview" && <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <Card className="p-5"><div className="text-xs font-black uppercase tracking-wide text-brand-600">Public-store workflow</div><h2 className="mt-1 text-xl font-black text-slate-950">From public evidence to approved execution</h2><div className="mt-5 grid gap-3 md:grid-cols-3">{[
        ["1", "Discover", "Crawl products, collections, visible prices, reviews, schema, navigation, and supporting content."], ["2", "Decide", "Compare catalog coverage with keywords, competitors, buyer intent, AI readiness, and authority evidence."], ["3", "Execute", "Approve Strategy, then create descriptions, collection copy, guides, comparisons, metadata, links, and briefs."],
      ].map(([number, title, body]) => <div key={number} className="rounded-xl border border-slate-200 p-4"><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-950 text-xs font-black text-white">{number}</span><h3 className="mt-3 font-black text-slate-950">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{body}</p></div>)}</div></Card>
      <Card className="p-5"><div className="text-xs font-black uppercase tracking-wide text-slate-400">Readiness</div><div className="mt-4 space-y-3">{([['Store website', data?.readiness.storeUrl], ['Public store analysis', data?.readiness.publicCrawl], ['Keyword evidence', data?.readiness.keywordEvidence], ['Performance evidence', data?.readiness.performanceEvidence], ['Strategy approval', data?.readiness.strategyStatus]] as Array<[string, boolean | string | undefined]>).map(([readinessLabel, value]) => <div key={readinessLabel} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 text-sm"><span className="font-bold text-slate-700">{readinessLabel}</span><span className={`rounded-full px-2.5 py-1 text-xs font-black ${value === true || value === "approved" ? "bg-emerald-100 text-emerald-800" : value === false || value === "not_started" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{typeof value === "boolean" ? value ? "Ready" : "Needed" : value ? label(String(value)) : "Not available"}</span></div>)}</div>{!data?.readiness.storeUrl ? <Link to={editStoreUrl} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-black text-white">Add Store URL</Link> : !data?.readiness.publicCrawl ? <Link to={`/site-analysis?projectId=${projectId}`} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-black text-white">Run Site Analysis</Link> : null}</Card>
    </div>}

    {tab === "catalog" && <Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="font-black text-slate-950">Public catalog assessment</h2><p className="mt-1 text-xs text-slate-500">Only crawl-visible evidence is shown. Product sales and profitability are not inferred.</p></div><div className="flex gap-2">{(["all", "product", "collection", "guide"] as const).map((kind) => <button key={kind} onClick={() => setPageFilter(kind)} className={`rounded-full px-3 py-1.5 text-xs font-black ${pageFilter === kind ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{label(kind)}</button>)}</div></div><div className="divide-y">{filteredPages.map((page) => <details key={page.id} className="group p-5"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-black text-slate-950">{page.name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${priorityTone(page.priority)}`}>{label(page.priority)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${evidenceTone(page.evidenceType)}`}>{label(page.evidenceType)}</span></div><div className="mt-1 truncate text-xs text-slate-500">{page.url}</div></div><div className="text-right"><div className="text-2xl font-black text-slate-950">{page.score}<span className="text-xs text-slate-400">/100</span></div><div className="text-[10px] font-black uppercase text-slate-400">{label(page.kind)}</div></div></summary><div className="mt-4 grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-emerald-50 p-4"><b className="text-xs uppercase text-emerald-800">Observed signals</b><ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-950">{page.signals.length ? page.signals.map((item) => <li key={item}>✓ {item}</li>) : <li>No strong public signals recorded.</li>}</ul></div><div className="rounded-xl bg-amber-50 p-4"><b className="text-xs uppercase text-amber-800">Gaps to review</b><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-950">{page.gaps.length ? page.gaps.map((item) => <li key={item}>• {item}</li>) : <li>No material crawl-visible gap detected.</li>}</ul></div></div></details>)}{!filteredPages.length && <div className="p-8 text-center text-sm text-slate-500">No matching public store pages were detected.</div>}</div></Card>}

    {tab === "recommendations" && <div className="space-y-4">{intelligence?.recommendations.map((item, index) => <Card key={item.key} className="p-5"><div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div className="max-w-4xl"><div className="flex flex-wrap items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-950 text-xs font-black text-white">{index + 1}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${priorityTone(item.priority)}`}>{item.priority}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${evidenceTone(item.evidenceType)}`}>{label(item.evidenceType)} evidence</span><span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-black uppercase text-violet-800">{label(item.destination)}</span></div><h2 className="mt-3 text-lg font-black text-slate-950">{item.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{item.explanation}</p><div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Recommended action</div><p className="mt-1 text-sm font-semibold leading-6 text-brand-950">{item.recommendedAction}</p></div><div className="mt-3 text-xs font-bold text-emerald-800"><span className="font-black">Expected direction:</span> {item.expectedImpact}</div></div><div className="min-w-[220px] rounded-xl bg-slate-50 p-4"><div className="grid grid-cols-2 gap-3"><div><div className="text-[10px] font-black uppercase text-slate-400">Impact</div><div className="text-2xl font-black text-slate-950">{item.impactScore}</div></div><div><div className="text-[10px] font-black uppercase text-slate-400">Confidence</div><div className="text-2xl font-black text-slate-950">{item.confidenceScore}%</div></div></div>{data?.capabilities.canApprove && <button disabled={busy === `approve:${item.key}`} onClick={() => void approve(item.key)} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-xs font-black text-white disabled:bg-slate-300">{busy === `approve:${item.key}` ? "Approving…" : "Approve for Strategy"}</button>}<details className="mt-3"><summary className="cursor-pointer text-xs font-black text-slate-600">View evidence</summary><ul className="mt-2 space-y-1 text-[11px] leading-5 text-slate-500">{item.evidence.map((evidence) => <li key={evidence}>• {evidence}</li>)}</ul></details></div></div></Card>)}{!intelligence?.recommendations.length && <EmptyState title="Run Ecommerce Intelligence" description="Complete the public crawl, then generate the product and collection opportunity report." />}</div>}

    {tab === "evidence" && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.65fr)]"><div className="space-y-4">{intelligence?.evidenceCoverage.map((item) => <Card key={item.key} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-slate-950">{item.label}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${evidenceTone(item.status)}`}>{label(item.status)}</span></div></Card>)}<Card className="border-amber-200 bg-amber-50 p-5"><h3 className="font-black text-amber-950">Evidence safeguards</h3><ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900">{intelligence?.limitations.map((item) => <li key={item}>• {item}</li>)}</ul></Card></div><Card className="h-fit p-5"><div className="text-xs font-black uppercase tracking-wide text-blue-700">Optional performance evidence</div><h2 className="mt-1 font-black text-slate-950">Add a product CSV without connecting the store</h2><p className="mt-2 text-xs leading-5 text-slate-600">This data is labelled user-provided. It is never represented as connected or independently verified.</p><div className="mt-4 rounded-lg bg-slate-50 p-3 font-mono text-[10px] leading-5 text-slate-600">product_name,sku,revenue,margin_percent,conversion_rate,inventory,orders<br/>Trail Pack,TP-1,12000,42,3.1,85,170</div><textarea rows={8} value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="Paste CSV rows here" className="mt-4 w-full rounded-xl border border-slate-200 p-3 text-xs outline-none focus:border-brand-400"/><button disabled={busy === "performance" || !csvText.trim()} onClick={() => void uploadPerformance()} className="mt-3 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy === "performance" ? "Saving…" : "Save as User-Provided Evidence"}</button></Card></div>}
  </div>;
}
