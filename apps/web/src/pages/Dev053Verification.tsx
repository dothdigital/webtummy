import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { getActiveProjectId } from "../active-project.js";

type VerificationStatus = "COMPLETE" | "PARTIAL" | "MISSING" | "BLOCKED" | "DEFERRED" | "NOT_APPLICABLE";
type Capability = {
  id: string;
  title: string;
  section: string;
  workflowStage: string;
  route: string;
  signal: string;
};
type Result = Capability & {
  capabilityId: string;
  status: VerificationStatus;
  message: string;
  workflowDestination: string;
  evidenceJson: Record<string, unknown>;
  checkedAt: string;
};
type Run = {
  id: string;
  projectId: string;
  status: string;
  summary: { total: number; applicable: number; score: number; counts: Record<VerificationStatus, number> };
  createdAt: string;
  completedAt: string | null;
  results: Result[];
};
type Payload = { project: { id: string; name: string }; capabilities: Capability[]; latestRun: Run | null };

const statusOrder: VerificationStatus[] = ["MISSING", "BLOCKED", "PARTIAL", "COMPLETE", "DEFERRED", "NOT_APPLICABLE"];
const statusStyle: Record<VerificationStatus, string> = {
  COMPLETE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  PARTIAL: "border-amber-200 bg-amber-50 text-amber-800",
  MISSING: "border-rose-200 bg-rose-50 text-rose-800",
  BLOCKED: "border-red-300 bg-red-50 text-red-900",
  DEFERRED: "border-violet-200 bg-violet-50 text-violet-800",
  NOT_APPLICABLE: "border-slate-200 bg-slate-50 text-slate-600",
};

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function destination(result: Result, projectId: string) {
  return (result.workflowDestination || result.route).replace("{projectId}", encodeURIComponent(projectId));
}

export default function Dev053Verification({ projectId: projectIdOverride, embedded = false }: { projectId?: string; embedded?: boolean } = {}) {
  const [searchParams] = useSearchParams();
  const projectId = projectIdOverride || searchParams.get("projectId") || getActiveProjectId();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "ALL">("ALL");
  const [sectionFilter, setSectionFilter] = useState("ALL");

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError("");
    api.get<Payload>(`/api/projects/${encodeURIComponent(projectId)}/dev053-verification`)
      .then((response) => { if (!cancelled) { setPayload(response); setRun(response.latestRun); } })
      .catch((requestError) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load SEO capability coverage."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const sections = useMemo(() => [...new Set((run?.results ?? payload?.capabilities ?? []).map((item) => item.section))], [payload, run]);
  const siteSignals = new Set(["technical_seo", "on_page_seo", "internal_linking", "ai_citation", "aeo", "geo"]);
  const visible = useMemo(() => (run?.results ?? []).filter((item) => (!embedded || (siteSignals.has(item.signal) && item.status !== "COMPLETE" && item.status !== "NOT_APPLICABLE")) && (statusFilter === "ALL" || item.status === statusFilter) && (sectionFilter === "ALL" || item.section === sectionFilter)), [embedded, run, sectionFilter, statusFilter]);
  const grouped = useMemo(() => {
    const sections = new Map<string, Result[]>();
    for (const item of visible) sections.set(item.section, [...(sections.get(item.section) ?? []), item]);
    return [...sections.entries()];
  }, [visible]);

  async function runValidation() {
    if (!projectId || running) return;
    setRunning(true); setError("");
    try {
      const result = await api.post<Run>(`/api/projects/${encodeURIComponent(projectId)}/dev053-verification/run`, {});
      setRun(result);
      setStatusFilter("ALL");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SEO capability analysis failed.");
    } finally {
      setRunning(false);
    }
  }

  if (!projectId) return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-black text-slate-950">SEO capability coverage</h1>
      <p className="mt-3 text-sm text-slate-600">Select a project first. Verification always uses one project’s real evidence and never mixes workspaces.</p>
      <Link to="/projects" className="mt-5 inline-flex rounded-xl bg-brand-700 px-5 py-3 text-sm font-black text-white">Select a project</Link>
    </div>
  );

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500">Loading DEV-053 capability evidence…</div>;

  return (
    <div className="space-y-6">
      {!embedded && <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-[#14264a] to-brand-800 p-7 text-white shadow-xl sm:p-9">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Site Analysis · Capability Coverage</div>
            <h1 className="mt-3 text-3xl font-black tracking-tight">SEO, local, AEO and AI-search coverage</h1>
            <p className="mt-3 text-sm leading-6 text-slate-200">Each result is calculated from saved project evidence. Missing and blocked items include a direct action so the checklist becomes executable work.</p>
            {payload?.project && <div className="mt-4 text-sm font-bold text-white">Project: {payload.project.name}</div>}
          </div>
          <button type="button" onClick={runValidation} disabled={running} className="rounded-xl bg-white px-5 py-3 text-sm font-black text-brand-800 shadow disabled:cursor-not-allowed disabled:opacity-60">
            {running ? "Validating 115 capabilities…" : run ? "Run validation again" : "Run full validation"}
          </button>
        </div>
      </header>}

      {embedded && <div className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-r from-brand-50 via-white to-cyan-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Complete capability coverage</div><h2 className="mt-1 text-lg font-black text-slate-950">SEO, local, answer-engine and AI-search checks</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Uses the crawl plus all approved project evidence. Missing and blocked checks link to the exact workspace where the issue can be resolved.</p></div>
        <button type="button" onClick={runValidation} disabled={running} className="shrink-0 rounded-xl bg-brand-700 px-5 py-3 text-sm font-black text-white shadow disabled:opacity-60">{running ? "Analyzing…" : run ? "Analyze again" : "Analyze coverage"}</button>
      </div>}

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</div>}

      {!run ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h2 className="text-xl font-black text-slate-950">No capability analysis yet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">The complete register contains {payload?.capabilities.length ?? 115} checks. Run validation to classify each one as complete, partial, missing, blocked, deferred, or not applicable.</p>
          <button type="button" onClick={runValidation} disabled={running} className="mt-5 rounded-xl bg-brand-700 px-5 py-3 text-sm font-black text-white disabled:opacity-60">Run full validation</button>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
              <div className="text-xs font-black uppercase tracking-wider text-brand-700">Capability score</div>
              <div className="mt-2 text-4xl font-black text-brand-950">{run.summary.score}/100</div>
              <div className="mt-1 text-xs text-brand-700">{run.summary.applicable} applicable of {run.summary.total} total</div>
            </div>
            {(["COMPLETE", "PARTIAL", "MISSING"] as VerificationStatus[]).map((status) => (
              <button key={status} type="button" onClick={() => setStatusFilter(status)} className={`rounded-2xl border p-5 text-left ${statusStyle[status]}`}>
                <div className="text-xs font-black uppercase tracking-wider">{label(status)}</div>
                <div className="mt-2 text-3xl font-black">{run.summary.counts[status] ?? 0}</div>
                <div className="mt-1 text-xs">View these checks</div>
              </button>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-black text-slate-950">Evidence snapshot</div>
              <div className="mt-1 text-xs text-slate-500">Analyzed {new Date(run.completedAt ?? run.createdAt).toLocaleString()} from the latest saved project and website evidence.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as VerificationStatus | "ALL")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  <option value="ALL">All statuses</option>
                  {statusOrder.map((status) => <option key={status} value={status}>{label(status)} ({run.summary.counts[status] ?? 0})</option>)}
                </select>
                <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} className="max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  <option value="ALL">All checklist sections</option>
                  {sections.map((section) => <option key={section} value={section}>{section}</option>)}
                </select>
              </div>
            </div>
          </section>

          <div className="space-y-5">
            {grouped.map(([section, items]) => (
              <section key={section} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                  <h2 className="text-base font-black text-slate-950">{section}</h2>
                  <p className="mt-1 text-xs text-slate-500">{items?.length ?? 0} visible checks</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {(items ?? []).map((result) => (
                    <article key={result.capabilityId} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)_auto] lg:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${statusStyle[result.status]}`}>{label(result.status)}</span>
                        </div>
                        <h3 className="mt-2 text-sm font-black text-slate-950">{result.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{result.message}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-4 py-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Evidence used</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(result.evidenceJson ?? {}).length ? Object.entries(result.evidenceJson).map(([key, value]) => (
                            <span key={key} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">{label(key)}: {String(value)}</span>
                          )) : <span className="text-xs text-slate-500">No project evidence recorded.</span>}
                        </div>
                      </div>
                      <Link to={destination(result, projectId)} className="inline-flex justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white hover:bg-brand-800">
                        {result.status === "COMPLETE" ? "Review evidence" : result.status === "NOT_APPLICABLE" ? "Review scope" : "Resolve this item"}
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            {!visible.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">No checks match these filters.</div>}
          </div>
        </>
      )}
    </div>
  );
}
