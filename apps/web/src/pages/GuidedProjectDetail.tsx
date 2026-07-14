import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input, StatusPill } from "../components/ui.js";
import { projectHasWebsite, requiresSiteAnalysisBeforeStrategy } from "../project-flow.js";
import type { GuidedExecutionTask, GuidedProject } from "../types.js";
import ProjectOperations from "../components/ProjectOperations.js";
import BusinessLocationTargetMarkets from "../components/BusinessLocationTargetMarkets.js";
import ProjectGoals from "../components/ProjectGoals.js";
import { canonicalPrimaryGoal } from "@webtummy/core/project-goals";

function taskTone(task: GuidedExecutionTask) {
  if (task.priority === "high") return "border-rose-200 bg-rose-50/70";
  if (task.priority === "low") return "border-slate-200 bg-slate-50";
  return "border-amber-200 bg-amber-50/70";
}

function executionPhase(task: GuidedExecutionTask) {
  if (["domain", "site_architect", "local_seo", "keyword_research", "site_analysis"].includes(task.moduleName)) return "Setup + Discovery";
  if (["content", "lead_magnet", "ai_citations", "publishing"].includes(task.moduleName)) return "Build + Publish";
  if (["backlinks", "social", "growth", "reports"].includes(task.moduleName)) return "Promote + Measure";
  if (["opportunity", "strategy", "strategy_approval"].includes(task.moduleName)) return "Strategy";
  return "Execution";
}

function moduleLabel(moduleName: string) {
  return labelize(moduleName);
}

function executionInstruction(task: GuidedExecutionTask) {
  return task.manualInstructions || task.description;
}

function projectTypeLabel(project: GuidedProject) {
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website);
  if (project.projectType === "existing_website" && !hasWebsite) return "Pre-website project";
  if (project.projectType === "new_business") return hasWebsite ? "New website launch" : "Pre-website project";
  return labelize(project.projectType);
}

function labelize(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not set";
}

function stageClasses(state: string) {
  if (state === "Completed" || state === "Approved") return "border-green-200 bg-green-50 text-green-800";
  if (state === "Current stage" || state === "Draft") return "border-brand-300 bg-brand-50 text-brand-800";
  if (state === "Ready") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-charcoal-100 bg-white text-charcoal-500";
}

function stageBadgeClasses(state: string) {
  if (state === "Completed" || state === "Approved") return "bg-green-600 text-white";
  if (state === "Current stage" || state === "Draft") return "bg-brand-600 text-white";
  if (state === "Ready") return "bg-amber-500 text-white";
  return "bg-charcoal-100 text-charcoal-500";
}

function SectionTitle({ eyebrow, title, helper }: { eyebrow?: string; title: string; helper?: string }) {
  return (
    <div>
      {eyebrow && <div className="text-[11px] font-bold uppercase tracking-wide text-brand-700">{eyebrow}</div>}
      <h2 className="text-base font-semibold text-charcoal-900">{title}</h2>
      {helper && <p className="mt-1 text-sm leading-6 text-charcoal-500">{helper}</p>}
    </div>
  );
}

function MetricTile({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none text-charcoal-900">{value}</div>
      {helper && <div className="mt-1 text-xs font-medium text-charcoal-500">{helper}</div>}
    </div>
  );
}

function ProgressStageTile({ label, state, badge, count, helper, to }: { label: string; state: string; badge: string | number; count: string | number; helper: string; to: string }) {
  const content = (
    <div className={`h-full rounded-lg border px-3 py-3 transition hover:border-brand-300 hover:shadow-sm ${stageClasses(state)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${stageBadgeClasses(state)}`}>{badge}</span>
            <span className="truncate text-sm font-semibold">{label}</span>
          </div>
          <div className="mt-2 text-xs font-medium">{state}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold leading-none text-charcoal-950">{count}</div>
          <div className="mt-1 text-[11px] font-semibold text-charcoal-500">{helper}</div>
        </div>
      </div>
    </div>
  );
  return (
    <Link to={to} className="block h-full focus:outline-none focus:ring-2 focus:ring-brand-300">
      {content}
    </Link>
  );
}

function InfoBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-1 text-sm font-semibold leading-6 text-charcoal-800">{children}</div>
    </div>
  );
}

function BusinessProfileCard({ project }: { project: GuidedProject }) {
  const profile = project.businessProfile;
  const audienceSegments = splitList(profile?.targetAudience).slice(0, 3);
  const offerSegments = splitList(profile?.offerSummary).slice(0, 3);

  return (
    <Card className="overflow-hidden border-brand-100 bg-white">
      <div className="p-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-brand-700">Project snapshot</div>
          <div className="mt-2">
            <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600">Industry / Niche</div>
              <div className="mt-1 text-sm font-bold leading-5 text-brand-900">{project.niche ?? "Not set"}</div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <CompactProfileBlock label="Audience" items={audienceSegments} empty="Audience not set" />
            <CompactProfileBlock label="Offer" items={offerSegments} empty="Offer not set" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ProjectLocationEditor({ project, onSaved }: { project: GuidedProject; onSaved: (project: GuidedProject) => void }) {
  const current = project.businessLocationJson;
  const existingBusinessLocation = [current?.city, current?.stateProvince, current?.country].filter(Boolean).join(", ") || project.businessLocation || "Not set";
  const existingTargetMarkets = Array.isArray(project.targetLocations) && project.targetLocations.length
    ? project.targetLocations.map(String)
    : project.targetLocation
      ? [project.targetLocation]
      : [];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    country: current?.country ?? "", stateProvince: current?.stateProvince ?? "", city: current?.city ?? "",
    streetAddress: current?.streetAddress ?? "", postalCode: current?.postalCode ?? "",
    targetMarkets: Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [], updateClient: false, updateWorkspace: false,
  });
  const patch = (value: Partial<typeof form>) => setForm((existing) => ({ ...existing, ...value }));
  const save = async () => {
    if (!form.country || !form.stateProvince || !form.city || !form.targetMarkets.length) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api.patch<{ project: GuidedProject; refreshRecommended: boolean }>(`/api/projects-v2/${project.id}/locations`, { businessLocationDetails: form, targetMarkets: form.targetMarkets, updateClient: form.updateClient, updateWorkspace: form.updateWorkspace });
      onSaved({ ...project, ...result.project }); setEditing(false);
      if (result.refreshRecommended) setMessage("Saved. Strategy and Keyword Research should now be refreshed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update locations"); }
    finally { setBusy(false); }
  };
  return <Card className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-charcoal-950">Business Location & Target Markets</h3><p className="mt-1 text-sm text-charcoal-500">Business identity and campaign targeting remain separate.</p></div><button type="button" onClick={() => setEditing(!editing)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">{editing ? "Cancel" : "Edit locations"}</button></div>
    {message && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {!editing && <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Business location</div>
        <div className="mt-1 text-sm font-bold text-charcoal-900">{existingBusinessLocation}</div>
        {(current?.streetAddress || current?.postalCode) && <div className="mt-1 text-xs text-charcoal-500">{[current.streetAddress, current.postalCode].filter(Boolean).join(", ")}</div>}
      </div>
      <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Target markets</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {existingTargetMarkets.length ? existingTargetMarkets.map((market) => <span key={market} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-charcoal-700 shadow-sm">{market}</span>) : <span className="text-sm font-bold text-charcoal-900">Not set</span>}
        </div>
      </div>
    </div>}
    {editing && <div className="mt-4 grid gap-4 md:grid-cols-2">
      <BusinessLocationTargetMarkets value={{ country: form.country, stateProvince: form.stateProvince, city: form.city, streetAddress: form.streetAddress, postalCode: form.postalCode, targetMarkets: form.targetMarkets }} onChange={(value) => patch({ country: value.country, stateProvince: value.stateProvince, city: value.city, streetAddress: value.streetAddress, postalCode: value.postalCode, targetMarkets: value.targetMarkets })} />
      {project.agencyClientId && <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm md:col-span-2"><input type="checkbox" checked={form.updateClient} onChange={(event) => patch({ updateClient: event.target.checked })} className="mt-1" /><span className="min-w-0"><span className="flex items-center gap-2 font-bold text-charcoal-900">Update the Agency Client defaults too <span className="group relative inline-flex" tabIndex={0}><span className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-brand-300 bg-white text-xs font-bold text-brand-700" aria-label="About Agency Client defaults">i</span><span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-72 -translate-x-1/2 rounded-lg bg-charcoal-950 px-3 py-2 text-xs font-medium leading-5 text-white shadow-xl group-hover:block group-focus:block">Turn this on only when the new Business Location and Target Markets should become the reusable defaults for this Agency Client. Future projects can inherit them. Leave it off to change only this project.</span></span></span><span className="mt-1 block leading-5 text-charcoal-600">Off: project-only override. On: also update the client record used by future projects.</span></span></label>}
      {!project.agencyClientId && <label className="flex gap-2 text-sm md:col-span-2"><input type="checkbox" checked={form.updateWorkspace} onChange={(event) => patch({ updateWorkspace: event.target.checked })} /> Update workspace location defaults too</label>}
      <Button type="button" disabled={busy || !form.country || !form.stateProvince || !form.city || !form.targetMarkets.length} onClick={() => void save()}>{busy ? "Saving…" : "Save locations"}</Button>
    </div>}
  </Card>;
}

function ProjectGoalsEditor({ project, onSaved }: { project: GuidedProject; onSaved: (project: GuidedProject) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState(project.primaryGoal ? canonicalPrimaryGoal(project.primaryGoal) : "");
  const [secondaryGoals, setSecondaryGoals] = useState<string[]>(Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : []);
  const existingPrimaryGoal = project.primaryGoal ? canonicalPrimaryGoal(project.primaryGoal) : "Not set";
  const existingSecondaryGoals = Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [];
  const [reason, setReason] = useState("");
  const save = async () => {
    if (!primaryGoal) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api.patch<{ project: GuidedProject; strategyRegenerationRecommended: boolean }>(`/api/projects-v2/${project.id}/goals`, { primaryGoal, secondaryGoals, reason: reason || null });
      onSaved({ ...project, ...result.project }); setEditing(false);
      setMessage(result.strategyRegenerationRecommended ? "Saved. Strategy, Keyword Research, and the Execution Plan should now be refreshed." : "Goals saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update goals"); }
    finally { setBusy(false); }
  };
  return <Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-charcoal-950">Primary & Secondary Goals</h3><p className="mt-1 text-sm text-charcoal-500">One primary objective with optional supporting outcomes.</p></div><button type="button" onClick={() => setEditing(!editing)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">{editing ? "Cancel" : "Edit goals"}</button></div>{message && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}{!editing && <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Primary goal</div><div className="mt-1 text-sm font-bold text-charcoal-900">{existingPrimaryGoal}</div></div><div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Secondary goals</div><div className="mt-2 flex flex-wrap gap-2">{existingSecondaryGoals.length ? existingSecondaryGoals.map((goal) => <span key={goal} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-charcoal-700 shadow-sm">{goal}</span>) : <span className="text-sm font-bold text-charcoal-900">None</span>}</div></div></div>}{editing && <div className="mt-4 space-y-4"><ProjectGoals workspaceType={project.agencyClientId ? "agency" : "business"} primaryGoal={primaryGoal} secondaryGoals={secondaryGoals} onChange={(value) => { setPrimaryGoal(value.primaryGoal); setSecondaryGoals(value.secondaryGoals); }} /><label className="block"><span className="text-sm font-bold">Reason for change (optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border p-3 text-sm" placeholder="Why are these goals changing?" /></label><Button type="button" disabled={busy || !primaryGoal} onClick={() => void save()}>{busy ? "Saving…" : "Save goals"}</Button></div>}</Card>;
}

function splitList(value?: string | null) {
  return (value ?? "").split(/,|\n/).map((item) => item.trim()).filter(Boolean);
}

function CompactProfileBlock({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-2 grid gap-1.5">
        {items.length ? items.map((item) => (
          <span key={item} className="rounded-md bg-white px-2.5 py-1.5 text-xs font-semibold leading-5 text-charcoal-700">{item}</span>
        )) : <span className="text-xs font-semibold text-amber-700">{empty}</span>}
      </div>
    </div>
  );
}

function FocusCard({
  title,
  status,
  detail,
  tone = "brand",
  children,
}: {
  title: string;
  status: string;
  detail: string;
  tone?: "brand" | "green" | "amber" | "slate";
  children: ReactNode;
}) {
  const toneClass = tone === "green"
    ? "border-emerald-100 bg-emerald-50/70 text-emerald-700"
    : tone === "amber"
      ? "border-amber-100 bg-amber-50/70 text-amber-700"
      : tone === "slate"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-brand-100 bg-brand-50/70 text-brand-700";
  return (
    <Card className="flex min-h-[150px] flex-col justify-between p-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold text-charcoal-950">{title}</h3>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${toneClass}`}>{status}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-charcoal-600">{detail}</p>
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

type ProjectNextAction = {
  title: string;
  detail: string;
  label: string;
  to?: string;
  onClick?: () => void;
  tone: "brand" | "green" | "amber";
};

function ProjectNextActionCard({ action }: { action: ProjectNextAction }) {
  const toneClass = action.tone === "green"
    ? "border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-brand-50"
    : action.tone === "amber"
      ? "border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50"
      : "border-brand-200 bg-gradient-to-r from-brand-50 via-white to-sky-50";
  const buttonClass = "bg-brand-600 hover:bg-brand-700";
  const cta = (
    <span className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow-sm ${buttonClass}`}>
      {action.label} <span className="ml-2">→</span>
    </span>
  );
  return (
    <Card className={`overflow-hidden border ${toneClass}`}>
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-bold text-white shadow-sm ${buttonClass}`}>→</div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-700">What to do next</div>
            <h2 className="mt-1 text-xl font-bold text-charcoal-950">{action.title}</h2>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">{action.detail}</p>
          </div>
        </div>
        <div className="shrink-0">
          {action.to ? <Link to={action.to}>{cta}</Link> : <button type="button" onClick={action.onClick}>{cta}</button>}
        </div>
      </div>
    </Card>
  );
}

type StrategyView = {
  status?: string;
  strategySummary?: string | null;
  positioningStatement?: string | null;
  audienceProfile?: string | null;
  offerRecommendation?: string | null;
  businessModel?: string | null;
  seoStrategy?: string | null;
  contentStrategy?: string | null;
};

export default function GuidedProjectDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [project, setProject] = useState<GuidedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    api.get<{ project: GuidedProject }>(`/api/projects-v2/${id}`)
      .then((result) => setProject(result.project))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load project"));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  useEffect(() => {
    if (!project || !location.hash) return;
    const targetId = location.hash.slice(1);
    let attempts = 0;
    const scrollToHash = () => {
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 8) window.setTimeout(scrollToHash, 80);
    };
    window.setTimeout(scrollToHash, 0);
  }, [location.hash, project]);

  const runTask = async (task: GuidedExecutionTask) => {
    if (!project) return;
    if (task.moduleName === "strategy_approval") {
      navigate("/strategy");
      return;
    }
    const endpoint = task.moduleName === "opportunity"
      ? `/api/projects-v2/${project.id}/opportunities/generate`
      : task.moduleName === "strategy"
        ? `/api/projects-v2/${project.id}/strategy/generate`
        : null;
    if (!endpoint) return;
    setBusyAction(task.id);
    setError(null);
    try {
      const result = await api.post<{ project: GuidedProject }>(endpoint, {});
      setProject(result.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction(null);
    }
  };

  const createExecutionPlan = async () => {
    if (!project) return;
    setBusyAction("execution-plan");
    setError(null);
    try {
      const result = await api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/execution-plan/create`, {});
      setProject(result.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create execution plan");
    } finally {
      setBusyAction(null);
    }
  };

  if (error) return <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>;
  if (!project) return <div className="text-charcoal-400">Loading project...</div>;
  const archived = project.status === "archived";

  const executionPlan = project.executionPlans?.[0] ?? null;
  const tasks = executionPlan?.tasks ?? [];
  const projectUrl = project.website?.rootUrl ?? project.websiteUrl ?? project.businessName ?? "No website connected yet";
  const displayName = project.businessName ?? project.name;
  const internalProjectName = project.name !== displayName ? project.name : null;
  const intakeCount = project.intakeAnswers?.length ?? project._count?.intakeAnswers ?? 0;
  const opportunityCount = project.opportunities?.length ?? project._count?.opportunities ?? 0;
  const strategyCount = project.strategyPlans?.length ?? project._count?.strategyPlans ?? 0;
  const latestStrategy = project.strategyPlans?.[0] as StrategyView | undefined;
  const workflowState = (key: string) => project.workflowSteps?.find((step) => step.stepKey === key);
  const strategyReviewTasks = tasks.filter((task) => task.moduleName === "strategy_approval");
  const strategyApproved = latestStrategy?.status === "approved" || project.currentStep === "execution" || strategyReviewTasks.some((task) => ["completed", "skipped"].includes(task.status));
  const activeTasks = tasks.filter((task) => !["completed", "skipped"].includes(task.status) && !(strategyApproved && task.moduleName === "strategy_approval"));
  const completedTasks = tasks.filter((task) => ["completed", "skipped"].includes(task.status) || (strategyApproved && task.moduleName === "strategy_approval"));
  const nextExecutionTask = activeTasks[0] ?? null;
  const executionGroups = ["Setup + Discovery", "Strategy", "Build + Publish", "Promote + Measure", "Execution"]
    .map((phase) => ({ phase, tasks: activeTasks.filter((task) => executionPhase(task) === phase) }))
    .filter((group) => group.tasks.length > 0);
  const emptyWorkflowTitle = strategyApproved
    ? activeTasks.length === 0 && tasks.length > 0
      ? "All current workflow tasks are complete"
      : "Strategy is approved"
    : latestStrategy
      ? "Strategy is ready for review"
      : project.currentStep === "intake"
        ? "Intake is the next required step"
        : "No workflow tasks are waiting";
  const emptyWorkflowMessage = strategyApproved
    ? activeTasks.length === 0 && tasks.length > 0
      ? "The intake, opportunity, strategy, and visible execution tasks for this project have no open items right now. You can review the approved strategy or generate/update the execution plan if more downstream work is needed."
      : "Approve stage is complete. Create the execution plan to generate downstream tasks for sitemap, homepage, lead magnet, SEO plan, domains, and publishing."
    : latestStrategy
      ? "A draft strategy exists, but it has not been approved yet. Review and approve it before downstream execution tasks are created."
      : project.currentStep === "intake"
        ? "Complete the intake wizard so the system can generate opportunities and strategy from the business context."
        : "There are no open tasks in the current project plan.";
  const progressSteps = [
    { key: "intake", label: "Intake", to: `/guided-projects/${project.id}/intake` },
    { key: "opportunities", label: "Opportunity", to: `/opportunities?projectId=${project.id}` },
    { key: "keyword_analysis", label: "Keywords", to: `/keywords?projectId=${project.id}` },
    { key: "site_analysis", label: "Site analysis", to: `/site-analysis?projectId=${project.id}` },
    { key: "strategy", label: "Strategy", to: `/strategy?projectId=${project.id}` },
    { key: "execution_plan", label: "Execution", to: `/guided-projects/${project.id}?tab=execution#execution-tasks` },
  ];
  const intakeComplete = intakeCount > 0 || Boolean(project.businessProfile) || project.currentStep !== "intake";
  const opportunityComplete = opportunityCount > 0;
  const strategyGenerated = strategyCount > 0 || Boolean(latestStrategy);
  const keywordWorkflow = workflowState("keyword_analysis");
  const siteWorkflow = workflowState("site_analysis");
  const executionWorkflow = workflowState("execution_plan");
  const keywordComplete = keywordWorkflow?.status === "completed";
  const siteComplete = siteWorkflow?.status === "completed";
  const hasWebsite = projectHasWebsite(project);
  const siteAnalysisRequired = requiresSiteAnalysisBeforeStrategy(project);
  const strategyCanStart = !siteAnalysisRequired || siteComplete;
  const derivedCurrentStep = !intakeComplete
    ? "intake"
    : !opportunityComplete
      ? "opportunities"
      : !strategyGenerated && strategyCanStart
        ? "strategy"
      : hasWebsite && !keywordComplete
        ? "keyword_analysis"
      : siteAnalysisRequired && !siteComplete
        ? "site_analysis"
      : !strategyGenerated || !strategyApproved
        ? "strategy"
        : "execution_plan";
  const currentStepIndex = Math.max(0, progressSteps.findIndex((step) => step.key === derivedCurrentStep));
  const stageState = (key: string, index: number) => {
    if (key === "intake") return intakeComplete ? "Completed" : "Current stage";
    if (key === "opportunities") return opportunityComplete ? "Completed" : derivedCurrentStep === "opportunities" ? "Current stage" : "Coming next";
    if (key === "keyword_analysis") return keywordComplete ? "Completed" : derivedCurrentStep === "keyword_analysis" ? "Current stage" : workflowState("keyword_analysis")?.status === "ready" ? "Ready" : !hasWebsite ? "Setup task" : "Coming next";
    if (key === "site_analysis") {
      if (!siteAnalysisRequired) return "Scheduled later";
      return siteComplete ? "Completed" : derivedCurrentStep === "site_analysis" ? "Current stage" : workflowState("site_analysis")?.status === "ready" ? "Ready" : "Coming next";
    }
    if (key === "strategy") {
      if (strategyApproved) return "Approved";
      if (strategyGenerated) return "Draft";
      return derivedCurrentStep === "strategy" ? "Current stage" : "Coming next";
    }
    if (key === "execution_plan") return executionWorkflow?.status === "completed" ? "Completed" : derivedCurrentStep === "execution_plan" ? (activeTasks.length ? "Current stage" : "Ready") : "Coming next";
    return index <= currentStepIndex ? "Completed" : "Coming next";
  };
  const strategyTask = activeTasks.find((task) => task.moduleName === "strategy");
  const nextAction: ProjectNextAction = !intakeComplete
    ? {
        title: "Complete the project profile",
        detail: "Answer the required intake questions so SEnuke AI can use the business, audience, offer, goal, and project path across every module.",
        label: "Open Intake",
        to: `/guided-projects/${project.id}/intake`,
        tone: "brand",
      }
    : !opportunityComplete
      ? {
          title: "Find the best opportunity",
          detail: "Generate and select the project direction before keyword analysis, site analysis, strategy, and execution planning.",
          label: "Open Opportunity Finder",
          to: `/opportunities?projectId=${project.id}`,
          tone: "brand",
        }
      : !strategyGenerated && !hasWebsite
        ? {
            title: "Generate launch strategy",
            detail: "No website or domain is connected yet, so SEnuke AI will build the plan from the project profile: website structure, keyword seeds, local/GBP setup, content, publishing path, and measurement tasks.",
            label: "Open Strategy",
            to: `/strategy?projectId=${project.id}`,
            tone: "brand",
          }
      : hasWebsite && !keywordComplete
        ? {
            title: "Run keyword analysis",
            detail: "Research target keywords, buyer intent, clusters, competitor gaps, difficulty, opportunity score, and revenue potential before strategy.",
            label: "Add Keywords",
            to: project.website?.id ? `/keyword-insights?project=${project.website.id}&add=1` : "/keyword-insights?add=1",
            tone: "amber",
          }
        : siteAnalysisRequired && !siteComplete
          ? {
              title: "Run site analysis",
              detail: "For an existing website, crawl the site before the full execution plan so recommendations use current pages, SEO issues, content gaps, links, speed, and conversion signals.",
              label: "Analyze Site",
              to: `/site-analysis?projectId=${project.id}`,
              tone: "amber",
            }
          : !strategyApproved
            ? {
                title: strategyGenerated ? "Review and approve strategy" : "Generate strategy",
                detail: strategyGenerated
                  ? "A draft strategy exists. Approve it only after confirming it uses the opportunity, keyword, and site-analysis context."
                  : "Create the strategy from opportunity, keyword analysis, site analysis, business goal, and user path.",
                label: strategyGenerated ? "Review Strategy" : "Open Strategy",
                to: `/strategy?projectId=${project.id}`,
                tone: "brand",
              }
            : {
                title: activeTasks.length ? "Work the next execution task" : "Create the full execution plan",
                detail: activeTasks.length
                  ? `${activeTasks[0].title}: ${activeTasks[0].description}`
                  : "Discovery and strategy are ready. Create the prioritized SEO/Growth execution plan with impact, effort, automation, approval, cost, and next action.",
                label: activeTasks.length ? activeTasks[0].actionButtonLabel ?? "Open Next Task" : "Create Execution Plan",
                to: activeTasks.length ? activeTasks[0].relatedUrl ?? `/guided-projects/${project.id}?tab=execution#execution-tasks` : undefined,
                onClick: activeTasks.length ? undefined : () => void createExecutionPlan(),
                tone: activeTasks.length ? "amber" : "green",
              };
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const activeTab = requestedTab === "profile" || requestedTab === "execution" ? requestedTab : "overview";
  const projectTab = (tab: "overview" | "profile" | "execution") =>
    `/guided-projects/${project.id}${tab === "overview" ? "" : `?tab=${tab}`}`;
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 bg-charcoal-50/70 px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">{displayName}</h1>
                {project.website ? (
                  <Link to={`/website-projects/${project.website.id}`} className="max-w-full break-all text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline">{project.website.rootUrl}</Link>
                ) : (
                  <span className="max-w-full break-all text-sm font-semibold text-brand-700">{projectUrl}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-charcoal-500">
                {internalProjectName && <span>Project: {internalProjectName}</span>}
                <span><span className="font-semibold text-charcoal-700">Project type:</span> {projectTypeLabel(project)}</span>
                <span aria-hidden="true" className="text-charcoal-300">•</span>
                <span><span className="font-semibold text-charcoal-700">Location:</span> {project.businessLocation ?? "Not set"}</span>
                <span aria-hidden="true" className="text-charcoal-300">•</span>
                <span><span className="font-semibold text-charcoal-700">Timeline:</span> {project.targetLaunchTimeline ?? "Not set"}</span>
                <span aria-hidden="true" className="text-charcoal-300">•</span>
                <span><span className="font-semibold text-charcoal-700">Primary goal:</span> {project.primaryGoal ?? "Not set"}</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 xl:justify-end">
                <span className="shrink-0"><StatusPill status={project.currentStep} /></span>
                <span className="shrink-0"><StatusPill status={project.status} /></span>
                {!archived && <Link to={`/guided-projects/${project.id}/intake`} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Edit profile</Link>}
                <Link to="/projects" className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Back to projects</Link>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-charcoal-200 bg-white px-3 pt-2 sm:px-5" aria-label="Project sections">
          {([
            ["overview", "Overview"],
            ["profile", "Profile & Settings"],
            ["execution", `Execution (${activeTasks.length})`],
          ] as const).map(([tab, label]) => (
            <Link
              key={tab}
              to={projectTab(tab)}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-bold transition ${activeTab === tab ? "border-brand-600 text-brand-700" : "border-transparent text-charcoal-500 hover:border-charcoal-300 hover:text-charcoal-800"}`}
              aria-current={activeTab === tab ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="space-y-5 p-5">
          {archived && <Card className="border-slate-300 bg-slate-100 p-4 text-sm text-slate-700"><b>Archived project — view only.</b> Restore this project from the Projects page before editing, assigning, approving, generating, publishing, or changing tasks.</Card>}
          {activeTab === "overview" && <>
          {!archived && <ProjectNextActionCard action={nextAction} />}
          <BusinessProfileCard project={project} />

          <div>
            <Card className="p-4">
              <SectionTitle title="Project progress" helper="Stage status and record counts from the same project data." />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {progressSteps.map((step, index) => {
                  const state = stageState(step.key, index);
                  const reached = index <= currentStepIndex || state === "Completed" || state === "Approved";
                  const badge = reached && (state === "Completed" || state === "Approved") ? "✓" : index + 1;
                  const count = step.key === "intake"
                    ? intakeCount
                    : step.key === "opportunities"
                      ? opportunityCount
                      : step.key === "keyword_analysis"
                        ? keywordComplete ? "✓" : activeTasks.filter((task) => task.moduleName === "keyword_research").length
                      : step.key === "site_analysis"
                        ? siteComplete ? "✓" : activeTasks.filter((task) => task.moduleName === "site_analysis").length
                      : step.key === "strategy"
                        ? strategyCount
                        : activeTasks.length;
                  const helper = step.key === "intake"
                    ? "answers saved"
                    : step.key === "opportunities"
                      ? "generated ideas"
                  : step.key === "keyword_analysis"
                        ? keywordComplete ? "complete" : hasWebsite ? "keyword discovery" : "seed plan task"
                      : step.key === "site_analysis"
                        ? siteComplete ? "complete" : hasWebsite ? "required for existing site" : "after pages exist"
                      : step.key === "strategy"
                        ? "plans created"
                        : "open tasks";
                  return <ProgressStageTile key={step.key} label={step.label} state={state} badge={badge} count={count} helper={helper} to={step.to} />;
                })}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
              <FocusCard
                title="Opportunity"
                status={opportunityComplete ? "Ready to view" : intakeComplete ? "Pending" : "Waiting"}
                tone={opportunityComplete ? "green" : intakeComplete ? "amber" : "slate"}
                detail={opportunityComplete ? `${opportunityCount} scored opportunit${opportunityCount === 1 ? "y" : "ies"} generated from the intake profile.` : intakeComplete ? "Generate scored opportunities from the completed intake before strategy work." : "Complete intake before opportunity generation."}
              >
                <Link to={`/opportunities?projectId=${project.id}`} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                  {opportunityComplete ? "View Opportunities" : "Generate Opportunities"}
                </Link>
              </FocusCard>

              <FocusCard
                title="Strategy"
                status={strategyApproved ? "Approved" : strategyGenerated ? "Needs review" : opportunityComplete ? "Pending" : "Waiting"}
                tone={strategyApproved ? "green" : strategyGenerated || opportunityComplete ? "amber" : "slate"}
                detail={strategyApproved
                  ? `${latestStrategy?.businessModel ?? "Strategy"} approved. ${latestStrategy?.seoStrategy ? "SEO plan is ready for execution." : "Downstream work can use this strategy."}`
                  : strategyGenerated
                    ? "A draft strategy exists and needs review before execution tasks proceed."
                    : opportunityComplete
                      ? hasWebsite
                        ? "Generate the AI strategy now, then refine it as keyword and site analysis data is added."
                        : "Generate the launch strategy now. Website, domain, GBP, keyword, and crawl work will become setup tasks."
                      : "Generate opportunities before strategy creation."}
              >
                <Link to={`/strategy?projectId=${project.id}`} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                  {strategyApproved ? "View Strategy" : strategyGenerated ? "Review Strategy" : "Open Strategy"}
                </Link>
              </FocusCard>

              <FocusCard
                title="Execution"
                status={strategyApproved ? activeTasks.length ? `${activeTasks.length} pending` : "Ready" : "Locked"}
                tone={strategyApproved ? activeTasks.length ? "amber" : "green" : "slate"}
                detail={strategyApproved
                  ? activeTasks.length
                    ? `${activeTasks[0].title}: ${activeTasks[0].description}`
                    : "No open execution tasks. Create or review the execution plan when more work is needed."
                  : "Approve the strategy before execution tasks become actionable."}
              >
                {strategyApproved && activeTasks.length && activeTasks[0].relatedUrl ? (
                  <Link to={activeTasks[0].relatedUrl} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                    {activeTasks[0].actionButtonLabel ?? "Open Task"}
                  </Link>
                ) : strategyApproved && !tasks.length ? (
                  <Button onClick={() => void createExecutionPlan()} disabled={busyAction === "execution-plan"} className="w-full">
                    {busyAction === "execution-plan" ? "Creating..." : "Create Execution Plan"}
                  </Button>
                ) : (
                  <Link to={strategyApproved ? projectTab("execution") : `/strategy?projectId=${project.id}`} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                    {strategyApproved ? "View Execution" : "Review Strategy"}
                  </Link>
                )}
              </FocusCard>
          </div>
          </>}

          {activeTab === "profile" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-charcoal-950">Project profile & settings</h2>
                <p className="mt-1 text-sm text-charcoal-500">Business profile, location, target markets, goals, and Agency Client defaults.</p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <ProjectLocationEditor project={project} onSaved={setProject} />
                <ProjectGoalsEditor project={project} onSaved={setProject} />
              </div>
              {!archived && project.agencyClientId && <ProjectOperations projectId={project.id} />}
            </div>
          )}
        </div>
      </Card>

      {activeTab === "overview" && project.currentStep === "intake" && (
        <Card className="border-brand-100 bg-brand-50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-charcoal-900">Complete intake to unlock strategy</div>
              <p className="mt-1 text-sm text-charcoal-600">The business profile is created from intake answers and reused by keyword, site, content, domain, and publishing modules.</p>
            </div>
            <Link to={`/guided-projects/${project.id}/intake`} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Open Intake</Link>
          </div>
        </Card>
      )}

      {activeTab === "execution" && (
        <Card id="execution-tasks" className="scroll-mt-24 overflow-hidden">
          <div className="border-b border-charcoal-100 bg-charcoal-50/70 px-5 py-4">
            <SectionTitle title="Execution tasks" helper="Work through these in order. Generated actions and manual review steps stay together here." />
          </div>
          <div className="border-b border-charcoal-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-sm">→</div>
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wide text-brand-700">Execution plan</div>
                  <h2 className="mt-1 text-xl font-bold text-charcoal-950">{executionPlan?.title ?? "Execution plan is ready"}</h2>
                  <p className="mt-2 text-sm leading-6 text-charcoal-600">
                    {executionPlan?.summary ?? "This plan was created from the approved strategy. Review tasks in order and open each module when you are ready to act."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-white/90 px-3 py-1 text-brand-700 shadow-sm">{activeTasks.length} open task{activeTasks.length === 1 ? "" : "s"}</span>
                    <span className="rounded-full bg-white/90 px-3 py-1 text-emerald-700 shadow-sm">{completedTasks.length} completed</span>
                    <span className="rounded-full bg-white/90 px-3 py-1 text-charcoal-600 shadow-sm">{labelize(executionPlan?.status ?? project.currentStep)}</span>
                  </div>
                </div>
              </div>
              <div className="shrink-0">
                {nextExecutionTask?.relatedUrl ? (
                  <Link to={nextExecutionTask.relatedUrl} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
                    {nextExecutionTask.actionButtonLabel ?? "Open Next Task"} <span className="ml-2">→</span>
                  </Link>
                ) : strategyApproved && !tasks.length ? (
                  <Button onClick={() => void createExecutionPlan()} disabled={busyAction === "execution-plan"}>
                    {busyAction === "execution-plan" ? "Creating..." : "Create Execution Plan"}
                  </Button>
                ) : (
                  <Link to={`/strategy?projectId=${project.id}`} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
                    Review Strategy
                  </Link>
                )}
              </div>
            </div>
          </div>
          {activeTasks.length === 0 ? (
            <div className="p-5">
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/70 p-4">
                <div className="font-semibold text-charcoal-900">{emptyWorkflowTitle}</div>
                <p className="mt-2 text-sm leading-6 text-charcoal-600">{emptyWorkflowMessage}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MetricTile label="Completed" value={completedTasks.length} helper="tasks closed" />
                  <MetricTile label="Open" value={activeTasks.length} helper="tasks waiting" />
                  <MetricTile label="Stage" value={labelize(project.currentStep)} helper={strategyApproved ? "strategy approved" : "workflow status"} />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-5">
              {nextExecutionTask && (
                <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-xs font-bold uppercase tracking-wide text-brand-700">Execute next</div>
                      <h3 className="mt-1 text-lg font-bold text-charcoal-950">{nextExecutionTask.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-charcoal-700">{executionInstruction(nextExecutionTask)}</p>
                      {nextExecutionTask.impact && <p className="mt-2 text-sm font-medium text-brand-800">Why it matters: {nextExecutionTask.impact}</p>}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-white px-2 py-1 font-bold text-charcoal-600">{executionPhase(nextExecutionTask)}</span>
                        <span className="rounded-full bg-white px-2 py-1 font-bold text-charcoal-600">{moduleLabel(nextExecutionTask.moduleName)}</span>
                        <span className="rounded-full bg-white px-2 py-1 font-bold text-charcoal-600">Priority: {nextExecutionTask.priority}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {nextExecutionTask.relatedUrl ? (
                        <Link to={nextExecutionTask.relatedUrl} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
                          {nextExecutionTask.actionButtonLabel ?? "Open Task"}
                        </Link>
                      ) : (
                        <Button onClick={() => void runTask(nextExecutionTask)} disabled={busyAction === nextExecutionTask.id}>
                          {busyAction === nextExecutionTask.id ? "Working..." : nextExecutionTask.actionButtonLabel ?? "Run Task"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {executionGroups.map((group) => (
                <div key={group.phase}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-charcoal-600">{group.phase}</h3>
                    <span className="rounded-full bg-charcoal-100 px-2.5 py-1 text-xs font-bold text-charcoal-600">{group.tasks.length} task{group.tasks.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.tasks.map((task) => (
                      <div key={task.id} className={`flex min-h-[250px] flex-col justify-between rounded-lg border p-4 shadow-sm ${taskTone(task)}`}>
                        <div>
                          <div className="flex flex-col gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-charcoal-900">{task.title}</span>
                                <StatusPill status={task.status} />
                              </div>
                              <p className="mt-2 text-sm leading-6 text-charcoal-600">{task.description}</p>
                              <div className="mt-3 rounded-md bg-white/80 p-3">
                                <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-500">Do this</div>
                                <p className="mt-1 text-sm leading-6 text-charcoal-700">{executionInstruction(task)}</p>
                              </div>
                              {task.impact && (
                                <div className="mt-3 text-sm leading-6 text-charcoal-600">
                                  <span className="font-semibold text-charcoal-800">Expected result:</span> {task.impact}
                                </div>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-charcoal-500">
                                <span className="rounded-full bg-white px-2 py-1 font-medium">Module: {moduleLabel(task.moduleName)}</span>
                                <span className="rounded-full bg-white px-2 py-1 font-medium">Priority: {task.priority}</span>
                                <span className="rounded-full bg-white px-2 py-1 font-medium">Automation: {labelize(task.automationLevel)}</span>
                                {task.requiresApproval && <span className="rounded-full bg-white px-2 py-1">Approval required</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4">
                          {(task.moduleName === "opportunity" || task.moduleName === "strategy" || task.moduleName === "strategy_approval") ? (
                            <Button onClick={() => void runTask(task)} disabled={busyAction === task.id} className="w-full">
                              {busyAction === task.id ? "Generating..." : task.actionButtonLabel ?? "Run"}
                            </Button>
                          ) : task.relatedUrl ? (
                            <Link to={task.relatedUrl} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
                              {task.actionButtonLabel ?? "Open"}
                            </Link>
                          ) : (
                            <span className="inline-flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-charcoal-400 shadow-sm">No action</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

    </div>
  );
}
