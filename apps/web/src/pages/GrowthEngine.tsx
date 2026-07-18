import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";
import { Button, Card } from "../components/ui.js";
import type { GrowthExperiment, GrowthOverviewResponse, GrowthReadinessItem, GuidedProject } from "../types.js";

type Tab = "overview" | "diagnosis" | "funnel" | "experiments" | "tracker" | "report";

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}

function toneClass(value: number) {
  if (value >= 75) return "text-emerald-700";
  if (value >= 55) return "text-amber-700";
  return "text-rose-700";
}

function statusBadge(status: string) {
  if (status === "healthy" || status === "completed" || status === "winner" || status === "scaled") return "bg-emerald-50 text-emerald-700";
  if (status === "running" || status === "watch" || status === "approved") return "bg-brand-50 text-brand-700";
  if (status === "failed" || status === "needs_attention") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

function automationBadge(level: string) {
  if (level === "execute_through_integration") return "Integration needed";
  if (level === "execute_with_approval" || level === "prepare") return "One-click approval";
  if (level === "manual_guided") return "Manual guided";
  return level === "generate" ? "Automated" : titleCase(level);
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-bold text-charcoal-950">{value}</div>
      {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
    </Card>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className={`font-bold ${toneClass(value)}`}>{value}/100</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${value >= 75 ? "bg-emerald-500" : value >= 55 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.max(6, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function ExperimentCard({ experiment, onStart, busy }: { experiment: GrowthExperiment; onStart: (id: string) => void; busy: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-charcoal-950">{experiment.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadge(experiment.status)}`}>{titleCase(experiment.status)}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{experiment.hypothesis}</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">ICE</div>
          <div className="text-2xl font-bold text-brand-700">{experiment.iceScore}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold text-slate-400">Metric</span>{experiment.metric}</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold text-slate-400">Success</span>{experiment.successThreshold}</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold text-slate-400">Automation</span>{automationBadge(experiment.automationLevel)}</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(Array.isArray(experiment.requiredAssets) ? experiment.requiredAssets : []).map((asset) => (
            <span key={String(asset)} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{String(asset)}</span>
          ))}
        </div>
        <Button onClick={() => onStart(experiment.id)} disabled={busy || experiment.status === "running" || experiment.status === "completed"}>
          {experiment.status === "running" ? "Running" : "Start Experiment"}
        </Button>
      </div>
    </Card>
  );
}

function ReadinessChecklist({ items }: { items: GrowthReadinessItem[] }) {
  const missing = items.filter((item) => item.status === "missing");
  const complete = items.filter((item) => item.status === "complete");
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Readiness Checklist</div>
        <h2 className="mt-2 text-xl font-bold text-charcoal-950">Before SEnuke AI can run this, we need to complete these missing steps.</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Growth Engine depends on the project direction, approved strategy, and site analysis so it does not create false recommendations from missing data.
        </p>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {missing.map((item) => (
          <div key={item.key} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-amber-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-amber-900">{item.description}</p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-700">Required</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.actions.map((action) => (
                <Link
                  key={`${item.key}-${action.label}`}
                  to={action.url}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      {complete.length > 0 && (
        <div className="border-t border-slate-100 p-5">
          <div className="text-sm font-bold text-slate-700">Already complete</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {complete.map((item) => (
              <span key={item.key} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">✓ {item.title}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function GrowthEngine() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [data, setData] = useState<GrowthOverviewResponse | null>(null);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = resolveActiveProjectId(projects, params.get("projectId"), getActiveProjectId());

  useEffect(() => {
    api.get<{ projects: GuidedProject[] }>("/api/projects-v2")
      .then((result) => { setProjects(result.projects); const resolved = resolveActiveProjectId(result.projects, params.get("projectId"), getActiveProjectId()); if (resolved) { setActiveProjectId(resolved); if (params.get("projectId") !== resolved) setParams({ projectId: resolved, tab }); } })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load projects"));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setActiveProjectId(projectId);
    api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`)
      .then((result) => {
        setData(result);
        if (!params.get("projectId")) setParams({ projectId });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load growth engine"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const scoreEntries = useMemo(() => Object.entries(data?.signals.scoreJson ?? {}), [data]);

  async function runAction(path: string, nextTab?: Tab) {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(path, {});
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      if (nextTab) {
        setTab(nextTab);
        setParams({ projectId, tab: nextTab });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function startExperiment(id: string) {
    setBusy(true);
    try {
      await api.post(`/api/growth/experiments/${id}/start`, {});
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setTab("tracker");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start experiment");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-charcoal-400">Loading Growth Engine...</div>;
  if (!projects.length) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-2xl font-bold text-charcoal-950">No project available</h1>
        <p className="mt-2 text-sm text-slate-500">Create a project first so Growth Engine can diagnose funnel constraints and create experiments.</p>
        <Button className="mt-5" onClick={() => navigate("/projects/new")}>Create Project</Button>
      </Card>
    );
  }
  if (!data) return <Card className="p-4 text-sm text-red-700">{error || "Growth data unavailable"}</Card>;
  const canRunGrowth = data.readiness.canRun;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Growth Marketing Engine</h1>
          <p className="text-sm text-slate-500">Diagnose bottlenecks, map funnel gaps, generate experiments, and push approved work into execution tasks.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId}
            onChange={(event) => { setActiveProjectId(event.target.value); setParams({ projectId: event.target.value, tab }); }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.businessName || project.name}</option>)}
          </select>
          <Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "diagnosis")} disabled={busy || !canRunGrowth}>Analyze Growth</Button>
          <Button variant="ghost" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/experiments/generate`, "experiments")} disabled={busy || !canRunGrowth}>Generate Experiments</Button>
        </div>
      </div>

      {error && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>}

      {!canRunGrowth && <ReadinessChecklist items={data.readiness.items} />}

      {!canRunGrowth ? null : (
      <>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Growth score" value={data.signals.growthScore} detail="Blended score from project signals" />
        <Stat label="Current bottleneck" value={titleCase(data.growth.diagnosis?.bottleneckType || data.signals.bottleneckType)} detail={data.growth.diagnosis ? "Latest diagnosis" : "Predicted from available data"} />
        <Stat label="Active experiments" value={data.growth.experiments.filter((item) => item.status === "running").length} detail={`${data.growth.experiments.length} total experiments`} />
        <Stat label="Open growth tasks" value={data.signals.openTasks.filter((task) => task.moduleName === "growth_marketing").length} detail={data.automationPolicy.approvalRequirement} />
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap gap-2">
          {(["overview", "diagnosis", "funnel", "experiments", "tracker", "report"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setTab(item); setParams({ projectId, tab: item }); }}
              className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === item ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {titleCase(item)}
            </button>
          ))}
        </div>
      </Card>

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Growth constraint scorecard</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {scoreEntries.map(([key, value]) => <ScoreBar key={key} label={titleCase(key)} value={value} />)}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Next recommended actions</h2>
            <div className="mt-4 space-y-3">
              <button type="button" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "diagnosis")} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">Run Growth Diagnosis</div>
                <div className="mt-1 text-sm text-slate-500">Create scorecard, bottleneck, funnel map, and a fix task.</div>
              </button>
              <button type="button" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/experiments/generate`, "experiments")} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">Generate Experiments</div>
                <div className="mt-1 text-sm text-slate-500">Create ICE/PIE-scored tests and execution tasks.</div>
              </button>
              <Link to="/strategy" className="block rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">Review Strategy Context</div>
                <div className="mt-1 text-sm text-slate-500">Growth Engine uses approved strategy before live execution.</div>
              </Link>
            </div>
          </Card>
        </div>
      )}

      {tab === "diagnosis" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Top diagnosis</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{data.growth.diagnosis?.summary || "Run diagnosis to create a stored growth bottleneck and scorecard."}</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {scoreEntries.map(([key, value]) => <ScoreBar key={key} label={titleCase(key)} value={value} />)}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Automation status</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{data.automationPolicy.coverage}</p>
            <div className="mt-4 space-y-2">
              {data.automationPolicy.levels.map((level) => <div key={level} className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">{automationBadge(level)}</div>)}
            </div>
          </Card>
        </div>
      )}

      {tab === "funnel" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-charcoal-950">Funnel map</h2>
            <Button variant="ghost" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/funnel-map`, "funnel")} disabled={busy}>Map Funnel</Button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {data.growth.funnelStages.map((stage) => (
              <div key={stage.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-charcoal-950">{stage.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadge(stage.status)}`}>{titleCase(stage.status)}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-700">{stage.conversionMetric}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{stage.issueSummary}</p>
                <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">{automationBadge(stage.automationStatus)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "experiments" && (
        <div className="space-y-4">
          {data.growth.experiments.length === 0 ? (
            <Card className="p-8 text-center">
              <h2 className="font-bold text-charcoal-950">No experiments yet</h2>
              <p className="mt-2 text-sm text-slate-500">Generate experiments from the latest diagnosis and project strategy.</p>
              <Button className="mt-4" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/experiments/generate`, "experiments")} disabled={busy}>Generate Experiments</Button>
            </Card>
          ) : data.growth.experiments.map((experiment) => <ExperimentCard key={experiment.id} experiment={experiment} onStart={startExperiment} busy={busy} />)}
        </div>
      )}

      {tab === "tracker" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-charcoal-950">Experiment tracker</h2>
            <p className="mt-1 text-sm text-slate-500">Track planned, running, completed, winning, failed, and scaled experiments.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data.growth.experiments.map((experiment) => (
              <div key={experiment.id} className="grid gap-3 p-4 md:grid-cols-[1fr_140px_140px_120px] md:items-center">
                <div>
                  <div className="font-bold text-charcoal-950">{experiment.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{experiment.metric}</div>
                </div>
                <div className="text-sm font-semibold text-slate-700">ICE {experiment.iceScore}</div>
                <div className="text-sm font-semibold text-slate-700">PIE {experiment.pieScore}</div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${statusBadge(experiment.status)}`}>{titleCase(experiment.status)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "report" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-charcoal-950">Agency Growth Report</h2>
              <p className="mt-1 text-sm text-slate-500">Draft client-ready diagnosis, experiment roadmap, and KPI plan. Human review is required before delivery.</p>
            </div>
            <Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/reports`, "report")} disabled={busy}>Generate Report</Button>
          </div>
          <div className="mt-5 grid gap-3">
            {data.growth.reports.map((report) => (
              <div key={report.id} className="rounded-lg border border-slate-200 p-4">
                <div className="font-bold text-charcoal-950">{titleCase(report.reportType)}</div>
                <div className="mt-1 text-sm text-slate-500">{titleCase(report.status)} · {new Date(report.createdAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      </>
      )}
    </div>
  );
}
