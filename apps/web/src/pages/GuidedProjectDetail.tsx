import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, StatusPill } from "../components/ui.js";
import type { GuidedExecutionTask, GuidedProject } from "../types.js";

function taskTone(task: GuidedExecutionTask) {
  if (task.priority === "high") return "border-rose-200 bg-rose-50/70";
  if (task.priority === "low") return "border-slate-200 bg-slate-50";
  return "border-amber-200 bg-amber-50/70";
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

function BusinessProfileCard({ project, preferredOutputs }: { project: GuidedProject; preferredOutputs: string[] }) {
  const profile = project.businessProfile;
  const profileItems = [
    ["Summary", profile?.businessSummary ?? "Not set"],
    ["Audience", profile?.targetAudience ?? "Not set"],
    ["Offer", profile?.offerSummary ?? "Not set"],
  ] as const;
  const briefItems = [
    ["Project type", labelize(project.projectType)],
    ["Primary goal", project.primaryGoal ?? "Not set"],
    ["Timeline", project.targetLaunchTimeline ?? "Not set"],
    ["Publishing", project.preferredPublishingMethod ?? "Not set"],
  ] as const;

  return (
    <Card className="overflow-hidden border-brand-100 bg-gradient-to-br from-white via-white to-brand-50/50">
      <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {briefItems.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-charcoal-100 bg-white px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div>
              <div className="mt-1 truncate text-sm font-bold capitalize text-charcoal-900">{value}</div>
            </div>
          ))}
          <div className="rounded-lg border border-charcoal-100 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">Outputs</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {preferredOutputs.length ? preferredOutputs.map((output) => <span key={output} className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-800">{output}</span>) : <span className="text-sm font-bold text-charcoal-900">Not set</span>}
            </div>
          </div>
        </div>
      </div>
      {profile ? (
        <div className="grid border-t border-brand-100 bg-white/70 md:grid-cols-3">
          {profileItems.map(([label, value]) => (
            <div key={label} className="border-t border-brand-100 p-5 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div>
              <p className="mt-2 text-sm font-semibold leading-6 text-charcoal-800">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-brand-100 bg-white/70 p-5">
          <p className="text-sm leading-6 text-charcoal-500">No profile yet. Complete intake first so SEnuke AI can reuse the business context across modules.</p>
        </div>
      )}
    </Card>
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

  const tasks = project.executionPlans?.[0]?.tasks ?? [];
  const preferredOutputs = Array.isArray(project.preferredOutputs) ? project.preferredOutputs.filter((item): item is string => typeof item === "string") : [];
  const projectUrl = project.website?.rootUrl ?? project.websiteUrl ?? project.businessName ?? "No website connected yet";
  const displayName = project.businessName ?? project.name;
  const internalProjectName = project.name !== displayName ? project.name : null;
  const intakeCount = project.intakeAnswers?.length ?? project._count?.intakeAnswers ?? 0;
  const opportunityCount = project.opportunities?.length ?? project._count?.opportunities ?? 0;
  const strategyCount = project.strategyPlans?.length ?? project._count?.strategyPlans ?? 0;
  const latestStrategy = project.strategyPlans?.[0] as StrategyView | undefined;
  const strategyReviewTasks = tasks.filter((task) => task.moduleName === "strategy_approval");
  const strategyApproved = latestStrategy?.status === "approved" || project.currentStep === "execution" || strategyReviewTasks.some((task) => ["completed", "skipped"].includes(task.status));
  const activeTasks = tasks.filter((task) => !["completed", "skipped"].includes(task.status) && !(strategyApproved && task.moduleName === "strategy_approval"));
  const completedTasks = tasks.filter((task) => ["completed", "skipped"].includes(task.status) || (strategyApproved && task.moduleName === "strategy_approval"));
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
    { key: "opportunity", label: "Opportunity", to: `/opportunities?projectId=${project.id}` },
    { key: "strategy", label: "Strategy", to: "/strategy" },
    { key: "execution", label: "Execution", to: "#execution-tasks" },
  ];
  const intakeComplete = intakeCount > 0 || Boolean(project.businessProfile) || project.currentStep !== "intake";
  const opportunityComplete = opportunityCount > 0;
  const strategyGenerated = strategyCount > 0 || Boolean(latestStrategy);
  const derivedCurrentStep = !intakeComplete
    ? "intake"
    : !opportunityComplete
      ? "opportunity"
      : !strategyGenerated || !strategyApproved
        ? "strategy"
        : "execution";
  const currentStepIndex = Math.max(0, progressSteps.findIndex((step) => step.key === derivedCurrentStep));
  const stageState = (key: string, index: number) => {
    if (key === "intake") return intakeComplete ? "Completed" : "Current stage";
    if (key === "opportunity") return opportunityComplete ? "Completed" : derivedCurrentStep === "opportunity" ? "Current stage" : "Coming next";
    if (key === "strategy") {
      if (strategyApproved) return "Approved";
      if (strategyGenerated) return "Draft";
      return derivedCurrentStep === "strategy" ? "Current stage" : "Coming next";
    }
    if (key === "execution") return derivedCurrentStep === "execution" ? (activeTasks.length ? "Current stage" : "Ready") : "Coming next";
    return index <= currentStepIndex ? "Completed" : "Coming next";
  };
  const strategyTask = activeTasks.find((task) => task.moduleName === "strategy");
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 bg-charcoal-50/70 px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">{displayName}</h1>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-charcoal-500">
                {internalProjectName && <span>Project: {internalProjectName}</span>}
                {!project.website && <span className="break-words">{projectUrl}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {project.website && (
                  <Link
                    to={`/website-projects/${project.website.id}`}
                    className="inline-flex min-h-9 flex-col justify-center rounded-lg border border-charcoal-200 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-charcoal-50"
                  >
                    <span className="text-[11px] font-semibold uppercase leading-4 tracking-wide text-charcoal-500">Connected website project</span>
                    <span className="max-w-[260px] truncate font-semibold leading-5 text-brand-700">{project.website.rootUrl}</span>
                  </Link>
                )}
                <StatusPill status={project.currentStep} />
                <StatusPill status={project.status} />
                <Link to={`/guided-projects/${project.id}/intake`} className="inline-flex items-center justify-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">Edit profile</Link>
                <Link to="/projects" className="inline-flex items-center justify-center rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-sm font-semibold text-charcoal-700 hover:bg-charcoal-50">Back to projects</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <BusinessProfileCard project={project} preferredOutputs={preferredOutputs} />

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
                    : step.key === "opportunity"
                      ? opportunityCount
                      : step.key === "strategy"
                        ? strategyCount
                        : activeTasks.length;
                  const helper = step.key === "intake"
                    ? "answers saved"
                    : step.key === "opportunity"
                      ? "generated ideas"
                      : step.key === "strategy"
                        ? "plans created"
                        : "open tasks";
                  return <ProgressStageTile key={step.key} label={step.label} state={state} badge={badge} count={count} helper={helper} to={step.to} />;
                })}
              </div>
            </Card>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <FocusCard
                title="Opportunity"
                status={opportunityComplete ? "Ready to view" : intakeComplete ? "Pending" : "Waiting"}
                tone={opportunityComplete ? "green" : intakeComplete ? "amber" : "slate"}
                detail={opportunityComplete ? `${opportunityCount} scored opportunit${opportunityCount === 1 ? "y" : "ies"} generated from the intake profile.` : intakeComplete ? "Generate scored opportunities from the completed intake before strategy work." : "Complete intake before opportunity generation."}
              >
                <Link to={`/opportunities?projectId=${project.id}`} className="inline-flex w-full items-center justify-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50">
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
                      ? "Generate the AI strategy from the selected opportunity and project profile."
                      : "Generate opportunities before strategy creation."}
              >
                <Link to="/strategy" className="inline-flex w-full items-center justify-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50">
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
                  <Link to={activeTasks[0].relatedUrl} className="inline-flex w-full items-center justify-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50">
                    {activeTasks[0].actionButtonLabel ?? "Open Task"}
                  </Link>
                ) : strategyApproved && !tasks.length ? (
                  <Button onClick={() => void createExecutionPlan()} disabled={busyAction === "execution-plan"} variant="ghost" className="w-full bg-white">
                    {busyAction === "execution-plan" ? "Creating..." : "Create Execution Plan"}
                  </Button>
                ) : (
                  <Link to={strategyApproved ? "#execution-tasks" : "/strategy"} className="inline-flex w-full items-center justify-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50">
                    {strategyApproved ? "View Execution" : "Review Strategy"}
                  </Link>
                )}
              </FocusCard>
            </div>
          </div>
        </div>
      </Card>

      {project.currentStep === "intake" && (
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

      <div className="grid gap-6">
        <Card id="execution-tasks" className="scroll-mt-24 overflow-hidden">
          <div className="border-b border-charcoal-100 bg-charcoal-50/70 px-5 py-4">
            <SectionTitle title="Execution tasks" helper="Work through these in order. Generated actions and manual review steps stay together here." />
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
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              {activeTasks.map((task) => (
                <div key={task.id} className={`flex min-h-[220px] flex-col justify-between rounded-lg border p-4 shadow-sm ${taskTone(task)}`}>
                  <div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-charcoal-900">{task.title}</span>
                          <StatusPill status={task.status} />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-charcoal-600">{task.description}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-charcoal-500">
                          <span className="rounded-full bg-white px-2 py-1 font-medium">Priority: {task.priority}</span>
                          <span className="rounded-full bg-white px-2 py-1 font-medium">Automation: {labelize(task.automationLevel)}</span>
                          {task.requiresApproval && <span className="rounded-full bg-white px-2 py-1">Approval required</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    {(task.moduleName === "opportunity" || task.moduleName === "strategy" || task.moduleName === "strategy_approval") ? (
                      <Button onClick={() => void runTask(task)} disabled={busyAction === task.id} variant="ghost" className="w-full bg-white">
                        {busyAction === task.id ? "Generating..." : task.actionButtonLabel ?? "Run"}
                      </Button>
                    ) : task.relatedUrl ? (
                      <Link to={task.relatedUrl} className="inline-flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-700 shadow-sm hover:text-brand-800">
                        {task.actionButtonLabel ?? "Open"}
                      </Link>
                    ) : (
                      <span className="inline-flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-charcoal-400 shadow-sm">No action</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

    </div>
  );
}
