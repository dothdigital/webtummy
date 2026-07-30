import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";
import { Button, Card } from "../components/ui.js";
import type { GrowthCandidateAction, GrowthContentOpportunity, GrowthExperiment, GrowthOverviewResponse, GrowthReadinessItem, GuidedProject } from "../types.js";

type Tab = "overview" | "blueprint" | "content" | "recommendations" | "diagnosis" | "evidence" | "funnel" | "experiments" | "tracker" | "history" | "report";

type BlueprintItem = { dedupeKey?: string; title?: string; route?: string; score?: number; rationale?: string; conditions?: string[] };

function blueprintItems(value: unknown): BlueprintItem[] {
  return Array.isArray(value) ? value.filter((item): item is BlueprintItem => Boolean(item) && typeof item === "object") : [];
}

function findingItems(value: unknown): { key?: string; title?: string; summary?: string; severity?: string; confidence?: number }[] {
  return Array.isArray(value) ? value.filter((item): item is { key?: string; title?: string; summary?: string; severity?: string; confidence?: number } => Boolean(item) && typeof item === "object") : [];
}

function scoreFactors(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {};
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
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

function RecommendationCard({ action, primary, busy, onDecision }: {
  action: GrowthCandidateAction;
  primary?: boolean;
  busy: boolean;
  onDecision: (action: GrowthCandidateAction, decision: "accepted" | "edited" | "deferred" | "rejected" | "alternatives") => void;
}) {
  const factors = scoreFactors(action.scoreJson);
  const decided = ["accepted", "rejected", "dismissed", "deferred"].includes(action.status);
  return (
    <Card className={`p-5 ${primary ? "border-brand-300 ring-2 ring-brand-100" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            {primary && <span className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">Next Best Action</span>}
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadge(action.status)}`}>{titleCase(action.status)}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{titleCase(action.route)}</span>
          </div>
          <h3 className="mt-3 text-lg font-bold text-charcoal-950">{action.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">{action.recommendation}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{action.reasoningSummary}</p>
        </div>
        <div className="min-w-24 rounded-xl bg-brand-50 p-3 text-center">
          <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Priority</div>
          <div className="mt-1 text-3xl font-bold text-brand-700">{action.priorityScore}</div>
          <div className="text-xs font-semibold text-brand-700">{action.confidence}% confidence</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold uppercase text-slate-400">Expected impact</span>{action.expectedImpact}</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold uppercase text-slate-400">Effort / risk</span>{titleCase(action.estimatedEffort)} effort · {titleCase(action.riskLevel)} risk</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="block text-xs font-bold uppercase text-slate-400">Goal</span>{action.businessGoal || "Project growth goal"}</div>
      </div>
      {Object.keys(factors).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(factors).map(([key, value]) => (
            <span key={key} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">{titleCase(key)} {value}</span>
          ))}
        </div>
      )}
      {action.followupTask && (
        <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          Execution task created: {action.followupTask.title} · {titleCase(action.followupTask.status)}
        </div>
      )}
      {!decided && primary && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => onDecision(action, "accepted")} disabled={busy}>Accept & Create Task</Button>
          <Button variant="ghost" onClick={() => onDecision(action, "edited")} disabled={busy}>Edit & Accept</Button>
          <Button variant="ghost" onClick={() => onDecision(action, "deferred")} disabled={busy}>Defer 7 Days</Button>
          <Button variant="ghost" onClick={() => onDecision(action, "alternatives")} disabled={busy}>Show Alternatives</Button>
          <Button variant="ghost" onClick={() => onDecision(action, "rejected")} disabled={busy}>Reject</Button>
        </div>
      )}
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
  const [contentQueue, setContentQueue] = useState<"now" | "next" | "later" | "conditional" | "all">("now");
  const [selectedContentIds, setSelectedContentIds] = useState<string[]>([]);
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

  useEffect(() => {
    setSelectedContentIds([]);
    setContentQueue("now");
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

  async function decideRecommendation(action: GrowthCandidateAction, decision: "accepted" | "edited" | "deferred" | "rejected" | "alternatives") {
    if (!projectId) return;
    let title: string | undefined;
    let recommendation: string | undefined;
    let comment: string | undefined;
    if (decision === "edited") {
      const editedTitle = window.prompt("Edit the action title", action.title);
      if (editedTitle === null) return;
      const editedRecommendation = window.prompt("Edit the recommended action", action.recommendation);
      if (editedRecommendation === null) return;
      title = editedTitle.trim();
      recommendation = editedRecommendation.trim();
    }
    if (decision === "rejected") {
      const feedback = window.prompt("Why should the Growth Engine avoid this recommendation next time? (optional)", "");
      if (feedback === null) return;
      comment = feedback.trim() || undefined;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects-v2/${projectId}/growth/actions/${action.id}/decision`, {
        decision,
        title,
        recommendation,
        comment,
        deferDays: decision === "deferred" ? 7 : undefined,
      });
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setTab("recommendations");
      setParams({ projectId, tab: "recommendations" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recommendation decision");
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

  async function updateContentOpportunity(opportunity: GrowthContentOpportunity, input: { queue?: "now" | "next" | "later" | "conditional"; lifecycleStatus?: "proposed" | "deferred" | "rejected" }) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/projects-v2/${projectId}/growth/content-roadmap/opportunities/${opportunity.id}`, input);
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setSelectedContentIds((current) => current.filter((id) => id !== opportunity.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the content opportunity");
    } finally {
      setBusy(false);
    }
  }

  async function approveContentBatch() {
    if (!selectedContentIds.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects-v2/${projectId}/growth/content-roadmap/batches/approve`, { opportunityIds: selectedContentIds });
      const fresh = await api.get<GrowthOverviewResponse>(`/api/projects-v2/${projectId}/growth/overview`);
      setData(fresh);
      setSelectedContentIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve the selected content batch");
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
  const blueprintVersion = data.growth.blueprint?.versions[0] ?? null;
  const contentRoadmap = data.growth.contentRoadmap;
  const contentQueueOrder = { now: 0, next: 1, later: 2, conditional: 3 };
  const visibleContentOpportunities = (contentRoadmap?.opportunities ?? []).filter((item) =>
    contentQueue === "all" ? item.lifecycleStatus !== "superseded" : item.queue === contentQueue && item.lifecycleStatus !== "superseded",
  ).sort((left, right) => contentQueueOrder[left.queue] - contentQueueOrder[right.queue] || right.priorityScore - left.priorityScore);
  const selectableContentOpportunities = visibleContentOpportunities.filter((item) => ["proposed", "deferred"].includes(item.lifecycleStatus) && !item.executionTaskId);
  const findings = findingItems(data.growth.diagnosis?.findingsJson);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Growth Marketing Engine</h1>
          <p className="text-sm text-slate-500">Turn strategy and live evidence into one explainable next-best action, approved execution, measurement, and learning.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId}
            onChange={(event) => { setActiveProjectId(event.target.value); setParams({ projectId: event.target.value, tab }); }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.businessName || project.name}</option>)}
          </select>
          <Button onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "recommendations")} disabled={busy || !canRunGrowth}>{busy ? "Running…" : "Run Growth Engine"}</Button>
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
        <Stat label="Next Best Action" value={data.growth.selectedAction ? data.growth.selectedAction.priorityScore : "—"} detail={data.growth.selectedAction?.title || "Run the engine to select one action"} />
        <Stat label="Blueprint version" value={data.growth.blueprint ? `v${data.growth.blueprint.currentVersion}` : "—"} detail={data.growth.blueprint?.nextReviewAt ? `Review ${new Date(data.growth.blueprint.nextReviewAt).toLocaleDateString()}` : "Not generated"} />
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap gap-2">
          {(["overview", "blueprint", "content", "recommendations", "diagnosis", "evidence", "funnel", "experiments", "tracker", "history", "report"] as Tab[]).map((item) => (
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
            <h2 className="font-bold text-charcoal-950">Decision loop</h2>
            <div className="mt-4 space-y-3">
              <button type="button" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "recommendations")} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">Refresh evidence and recommendation</div>
                <div className="mt-1 text-sm text-slate-500">Normalize current signals, diagnose constraints, score candidates, and select one action. No task is created yet.</div>
              </button>
              <button type="button" onClick={() => { setTab("recommendations"); setParams({ projectId, tab: "recommendations" }); }} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">{data.growth.selectedAction ? data.growth.selectedAction.title : "Review the Next Best Action"}</div>
                <div className="mt-1 text-sm text-slate-500">{data.growth.selectedAction ? "Accept, edit, defer, reject, or request alternatives." : "Run the Growth Engine to generate an explainable recommendation."}</div>
              </button>
              <Link to="/strategy" className="block rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <div className="font-bold text-charcoal-950">Review approved strategy</div>
                <div className="mt-1 text-sm text-slate-500">The Blueprint and recommendations remain anchored to this approved direction.</div>
              </Link>
            </div>
          </Card>
        </div>
      )}

      {tab === "blueprint" && (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Versioned growth direction</div>
                <h2 className="mt-2 text-xl font-bold text-charcoal-950">{data.growth.blueprint?.title || "Growth Blueprint not generated"}</h2>
                <p className="mt-2 text-sm text-slate-500">{data.growth.blueprint?.primaryGoal || "Run the Growth Engine after approving strategy to create Now, Next, Later, and Conditional phases."}</p>
              </div>
              {data.growth.blueprint && <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">Version {data.growth.blueprint.currentVersion}</span>}
            </div>
          </Card>
          {blueprintVersion ? (
            <div className="grid gap-4 xl:grid-cols-4">
              {([
                ["Now", blueprintVersion.nowJson, "The single action selected for attention now."],
                ["Next", blueprintVersion.nextJson, "Sequenced actions after the current constraint."],
                ["Later", blueprintVersion.laterJson, "Valid opportunities deliberately held back."],
                ["Conditional", blueprintVersion.conditionalJson, "Actions waiting for prerequisites or better evidence."],
              ] as const).map(([label, value, description]) => (
                <Card key={label} className="p-4">
                  <h3 className="font-bold text-charcoal-950">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                  <div className="mt-4 space-y-3">
                    {blueprintItems(value).length === 0 ? <div className="text-sm text-slate-400">No action assigned.</div> : blueprintItems(value).map((item, index) => (
                      <div key={item.dedupeKey || `${label}-${index}`} className="rounded-lg border border-slate-200 p-3">
                        <div className="font-semibold text-slate-800">{item.title || "Growth action"}</div>
                        <div className="mt-1 text-xs font-bold text-brand-600">{titleCase(item.route || "growth")} · score {item.score ?? "—"}</div>
                        {item.conditions && item.conditions.length > 0 && <div className="mt-2 text-xs text-amber-700">Needs: {item.conditions.join(", ")}</div>}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-sm text-slate-500">No Blueprint exists yet.</p>
              <Button className="mt-4" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "blueprint")} disabled={busy}>Generate Blueprint</Button>
            </Card>
          )}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-white p-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Plan within the Growth Blueprint</div>
                <h2 className="mt-2 text-xl font-bold text-charcoal-950">Supporting Content Distribution Plan</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{contentRoadmap?.recommendationRationale || "Map the complete supporting-content opportunity, then generate only the current approved phase."}</p>
              </div>
              <Button onClick={() => contentRoadmap ? (setTab("content"), setParams({ projectId, tab: "content" })) : runAction(`/api/projects-v2/${projectId}/growth/content-roadmap/refresh`, "content")} disabled={busy || !canRunGrowth}>{contentRoadmap ? "Open Content Plan" : "Generate Content Plan"}</Button>
            </div>
            {contentRoadmap && <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Total opportunity" value={contentRoadmap.opportunityCount} />
              <Stat label="Now" value={contentRoadmap.nowCount} detail="Current approved phase" />
              <Stat label="Next" value={contentRoadmap.nextCount} detail="Next 30–90 days" />
              <Stat label="Later" value={contentRoadmap.laterCount} detail="Long-term backlog" />
              <Stat label="Conditional" value={contentRoadmap.conditionalCount} detail="Evidence-triggered" />
            </div>}
          </Card>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-pink-50 to-white p-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-pink-700">Plan within the Growth Blueprint</div>
                <h2 className="mt-2 text-xl font-bold text-charcoal-950">Social Distribution & Repurposing Plan</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{data.growth.socialDistribution?.strategySummary || "Turn approved project intelligence and existing content into a coordinated, approval-based social calendar, then feed measured results back into Growth."}</p>
              </div>
              <Link to={`/social-strategy?projectId=${projectId}`} className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold text-white">{data.growth.socialDistribution ? "Open Social Plan" : "Create Social Plan"}</Link>
            </div>
            {data.growth.socialDistribution && (
              <div className="border-b border-slate-100 bg-white px-5 py-3 text-xs font-semibold text-slate-600">
                {data.growth.socialDistribution.campaignName || "Social campaign"} · {data.growth.socialDistribution.campaignStartAt ? formatDate(data.growth.socialDistribution.campaignStartAt) : "Start date not set"} – {data.growth.socialDistribution.campaignEndAt ? formatDate(data.growth.socialDistribution.campaignEndAt) : "End date not set"} · Target: {data.growth.socialDistribution.goalTarget ?? "Baseline"} {(data.growth.socialDistribution.goalMetric || "success metric").replaceAll("_", " ")}
              </div>
            )}
            {data.growth.socialDistribution && <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Platforms" value={data.growth.socialDistribution.platforms.length} detail={data.growth.socialDistribution.platforms.join(", ")} />
              <Stat label="Calendar posts" value={data.growth.socialDistribution.posts.length} detail={data.growth.socialDistribution.postingFrequency || "Rolling calendar"} />
              <Stat label="Repurposing batches" value={data.growth.socialDistribution.repurposingBatches.length} detail="Existing content reused" />
              <Stat label="Performance records" value={data.growth.socialDistribution.metrics.length} detail="Feeds Growth learning" />
              <Stat label="Approved assets" value={data.growth.socialDistribution.repurposingBatches.flatMap((batch) => batch.assets).filter((asset) => asset.status === "approved").length} detail="Ready or distributed" />
            </div>}
          </Card>
        </div>
      )}

      {tab === "content" && (
        <div className="space-y-5">
          {!contentRoadmap ? (
            <Card className="p-8 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Growth Blueprint</div>
              <h2 className="mt-2 text-xl font-bold text-charcoal-950">Generate the Supporting Content Plan</h2>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">SEnuke AI will use approved strategy, keyword research, website pages, target markets and business goals to build a complete opportunity map. It will not generate the articles yet.</p>
              <Button className="mt-5" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/content-roadmap/refresh`, "content")} disabled={busy || !canRunGrowth}>{busy ? "Researching opportunities…" : "Generate Supporting Content Plan"}</Button>
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-cyan-50 p-5">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-violet-700">Growth Blueprint · Supporting Content Plan v{contentRoadmap.currentVersion}</div>
                    <h2 className="mt-2 text-xl font-bold text-charcoal-950">Phased authority and publishing roadmap</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{contentRoadmap.recommendationRationale}</p>
                    <div className="mt-3 text-xs font-semibold text-slate-500">Cadence: {contentRoadmap.recommendedCadence}{contentRoadmap.nextReviewAt ? ` · Reassess ${new Date(contentRoadmap.nextReviewAt).toLocaleDateString()}` : ""}</div>
                  </div>
                  <Button variant="ghost" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/content-roadmap/refresh`, "content")} disabled={busy}>{busy ? "Refreshing research…" : "Refresh Research"}</Button>
                </div>
                <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
                  <Stat label="Total opportunity" value={contentRoadmap.opportunityCount} />
                  <Stat label="Now" value={contentRoadmap.nowCount} detail="Generate this phase first" />
                  <Stat label="Next" value={contentRoadmap.nextCount} detail="30–90 day plan" />
                  <Stat label="Later" value={contentRoadmap.laterCount} detail="Expansion backlog" />
                  <Stat label="Conditional" value={contentRoadmap.conditionalCount} detail="Wait for evidence" />
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["now", `Now · ${contentRoadmap.nowCount}`],
                      ["next", `Next · ${contentRoadmap.nextCount}`],
                      ["later", `Later · ${contentRoadmap.laterCount}`],
                      ["conditional", `Conditional · ${contentRoadmap.conditionalCount}`],
                      ["all", `All · ${contentRoadmap.opportunityCount}`],
                    ] as const).map(([queue, label]) => <button key={queue} type="button" onClick={() => { setContentQueue(queue); setSelectedContentIds([]); }} className={`rounded-full px-3 py-2 text-xs font-bold ${contentQueue === queue ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!selectableContentOpportunities.length} onClick={() => setSelectedContentIds(selectableContentOpportunities.map((item) => item.id))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:text-slate-300">Select available</button>
                    <Button onClick={() => void approveContentBatch()} disabled={busy || !selectedContentIds.length}>{busy ? "Approving batch…" : `Approve Selected Batch${selectedContentIds.length ? ` (${selectedContentIds.length})` : ""}`}</Button>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  {visibleContentOpportunities.map((opportunity) => {
                    const selectable = ["proposed", "deferred"].includes(opportunity.lifecycleStatus) && !opportunity.executionTaskId;
                    const selected = selectedContentIds.includes(opportunity.id);
                    return <div key={opportunity.id} className={`rounded-xl border p-4 ${selected ? "border-brand-400 bg-brand-50/40 ring-1 ring-brand-100" : "border-slate-200 bg-white"}`}>
                      <div className="flex flex-wrap items-start gap-3">
                        <label className={`mt-1 ${selectable ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}><input type="checkbox" disabled={!selectable} checked={selected} onChange={() => setSelectedContentIds((current) => current.includes(opportunity.id) ? current.filter((id) => id !== opportunity.id) : [...current, opportunity.id])}/></label>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${opportunity.queue === "now" ? "bg-emerald-100 text-emerald-700" : opportunity.queue === "next" ? "bg-cyan-100 text-cyan-700" : opportunity.queue === "conditional" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{opportunity.queue}</span>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusBadge(opportunity.lifecycleStatus)}`}>{titleCase(opportunity.lifecycleStatus)}</span>
                            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700">{titleCase(opportunity.plannedPhase)}</span>
                          </div>
                          <h3 className="mt-2 text-base font-bold text-charcoal-950">{opportunity.title}</h3>
                          <div className="mt-1 text-xs font-semibold text-brand-700">{opportunity.primaryKeyword} · {titleCase(opportunity.searchIntent)} · {opportunity.clusterName}</div>
                          <p className="mt-3 text-sm leading-6 text-slate-600">{opportunity.recommendationReason}</p>
                          <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                            <div className="rounded-lg bg-slate-50 p-3"><span className="block font-bold uppercase text-slate-400">Business purpose</span><span className="mt-1 block leading-5 text-slate-700">{opportunity.businessPurpose}</span></div>
                            <div className="rounded-lg bg-slate-50 p-3"><span className="block font-bold uppercase text-slate-400">Target page</span><span className="mt-1 block break-all leading-5 text-slate-700">{opportunity.internalLinkTargetUrl || opportunity.targetUrl || "Assign during content review"}</span></div>
                            <div className="rounded-lg bg-slate-50 p-3"><span className="block font-bold uppercase text-slate-400">Priority</span><span className="mt-1 block text-lg font-bold text-brand-700">{opportunity.priorityScore}/100</span><span className="text-slate-500">{opportunity.confidence}% confidence</span></div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
                        {opportunity.executionTaskId && <Link to={`/ai-content?projectId=${projectId}&taskId=${opportunity.executionTaskId}&open=1`} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Open in AI Content →</Link>}
                        {selectable && opportunity.queue !== "next" && <button type="button" disabled={busy} onClick={() => void updateContentOpportunity(opportunity, { queue: "next" })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">Move to Next</button>}
                        {selectable && opportunity.queue !== "now" && <button type="button" disabled={busy} onClick={() => void updateContentOpportunity(opportunity, { queue: "now" })} className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-bold text-brand-700">Move to Now</button>}
                        {selectable && <button type="button" disabled={busy} onClick={() => void updateContentOpportunity(opportunity, { lifecycleStatus: "rejected" })} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Reject</button>}
                      </div>
                    </div>;
                  })}
                  {!visibleContentOpportunities.length && <div className="p-8 text-center text-sm text-slate-500">No supporting-content opportunities are assigned to this queue.</div>}
                </div>
              </Card>

              {contentRoadmap.batches.length > 0 && <Card className="overflow-hidden">
                <div className="border-b border-slate-100 p-5"><h2 className="font-bold text-charcoal-950">Approved generation batches</h2><p className="mt-1 text-sm text-slate-500">Only these approved opportunities are available for AI generation.</p></div>
                <div className="space-y-3 p-5">{contentRoadmap.batches.map((batch) => <div key={batch.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-bold text-charcoal-950">{batch.title}</div><div className="mt-1 text-xs font-semibold text-emerald-700">{batch.opportunityCount} opportunities · {titleCase(batch.phase)} · {titleCase(batch.status)}</div></div><span className="text-xs text-slate-500">{batch.approvedAt ? `Approved ${new Date(batch.approvedAt).toLocaleDateString()}` : "Approved batch"}</span></div><div className="mt-3 flex flex-wrap gap-2">{batch.opportunities.map((item) => item.executionTaskId ? <Link key={item.id} to={`/ai-content?projectId=${projectId}&taskId=${item.executionTaskId}&open=1`} className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700">{item.title} →</Link> : <span key={item.id} className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-500">{item.title}</span>)}</div></div>)}</div>
              </Card>}
            </>
          )}
        </div>
      )}

      {tab === "recommendations" && (
        <div className="space-y-4">
          {data.growth.selectedAction ? (
            <RecommendationCard action={data.growth.selectedAction} primary busy={busy} onDecision={decideRecommendation} />
          ) : (
            <Card className="p-8 text-center">
              <h2 className="font-bold text-charcoal-950">No undecided Next Best Action</h2>
              <p className="mt-2 text-sm text-slate-500">Run the engine to refresh evidence and select the strongest ready recommendation.</p>
              <Button className="mt-4" onClick={() => runAction(`/api/projects-v2/${projectId}/growth/analyze`, "recommendations")} disabled={busy}>Run Growth Engine</Button>
            </Card>
          )}
          {data.growth.candidateActions.filter((action) => action.id !== data.growth.selectedAction?.id).length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-charcoal-950">Other scored candidates and prior decisions</h2>
              {data.growth.candidateActions.filter((action) => action.id !== data.growth.selectedAction?.id).map((action) => (
                <RecommendationCard key={action.id} action={action} busy={busy} onDecision={decideRecommendation} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "diagnosis" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-950">Top diagnosis</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{data.growth.diagnosis?.summary || "Run diagnosis to create a stored growth bottleneck and scorecard."}</p>
            {data.growth.diagnosis && <div className="mt-2 text-xs font-semibold text-slate-400">{data.growth.diagnosis.confidence}% confidence · {titleCase(data.growth.diagnosis.runType)} run · {data.growth.diagnosis.engineVersion}</div>}
            {findings.length > 0 && (
              <div className="mt-5 space-y-3">
                {findings.map((finding, index) => (
                  <div key={finding.key || index} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-bold text-slate-800">{finding.title}</div>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${finding.severity === "critical" || finding.severity === "high" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{titleCase(finding.severity || "finding")}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{finding.summary}</p>
                  </div>
                ))}
              </div>
            )}
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

      {tab === "evidence" && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-charcoal-950">Normalized evidence signals</h2>
            <p className="mt-1 text-sm text-slate-500">Every recommendation records its source, effective date, confidence, and freshness so stale data is visible.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data.growth.evidenceSignals.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">Run the Growth Engine to collect normalized signals.</div>
            ) : data.growth.evidenceSignals.map((signal) => (
              <div key={signal.id} className="grid gap-3 p-4 md:grid-cols-[1fr_180px_120px_120px] md:items-center">
                <div>
                  <div className="font-bold text-charcoal-950">{titleCase(signal.signalKey)}</div>
                  <div className="mt-1 text-sm text-slate-500">{titleCase(signal.category)} · {titleCase(signal.sourceType)}</div>
                </div>
                <div className="text-sm text-slate-600">Effective {new Date(signal.effectiveDate).toLocaleDateString()}</div>
                <div className="text-sm font-bold text-slate-700">{signal.confidence}% confidence</div>
                <span className={`w-fit rounded-full px-2 py-1 text-xs font-bold ${signal.freshnessStatus === "fresh" ? "bg-emerald-50 text-emerald-700" : signal.freshnessStatus === "aging" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{titleCase(signal.freshnessStatus)}</span>
              </div>
            ))}
          </div>
        </Card>
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

      {tab === "history" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-bold text-charcoal-950">Engine runs</h2>
              <p className="mt-1 text-sm text-slate-500">Auditable snapshots of the evidence and selected output.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.growth.recentRuns.length === 0 ? <div className="p-6 text-sm text-slate-500">No runs recorded.</div> : data.growth.recentRuns.map((run) => (
                <div key={run.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-charcoal-950">{run.promptVersion}</div>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusBadge(run.status)}`}>{titleCase(run.status)}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">{new Date(run.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-bold text-charcoal-950">Project learning</h2>
              <p className="mt-1 text-sm text-slate-500">Experiment outcomes and user feedback that influence future recommendations.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.growth.learnings.length === 0 ? <div className="p-6 text-sm text-slate-500">Learning begins when recommendations are rejected or experiments produce outcomes.</div> : data.growth.learnings.map((learning) => (
                <div key={learning.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-charcoal-950">{titleCase(learning.outcome)}</div>
                    <div className="text-xs text-slate-400">{new Date(learning.createdAt).toLocaleDateString()}</div>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{learning.summary}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
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
