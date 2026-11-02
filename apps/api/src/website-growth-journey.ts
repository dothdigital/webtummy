import { isWebsitePlanTask } from "./website-plan-task.js";

type GrowthTask = {
  id: string; title: string; moduleName: string; sourceType: string; status: string;
  actionButtonLabel?: string | null; dedupeKey?: string; approvedAt?: Date | null;
  approvalSnapshotJson?: unknown; blockedReason?: string | null;
  dependencies?: Array<{ requiredTask: { title: string; status: string } }>;
};
const finished = new Set(["completed", "published", "verified", "skipped", "cancelled", "canceled"]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function websiteGrowthJourney(projectId: string, tasks: GrowthTask[], websiteLive: boolean) {
  const executionUrl = `/guided-projects/${encodeURIComponent(projectId)}?tab=execution`;
  const returnTo = `/projects/${encodeURIComponent(projectId)}/website/performance#next-best-action`;
  const plans = tasks.filter(task => isWebsitePlanTask(task) && record(task.approvalSnapshotJson).contentPlan && !["skipped", "cancelled", "canceled"].includes(task.status));
  const approved = (task: GrowthTask) => Boolean(task.approvedAt) && ["approved", "completed", "ready_to_publish", "published", "verified"].includes(task.status);
  const plan = plans.find(approved) ?? plans[0];
  const planUrl = `/seo-page-map?${new URLSearchParams({ projectId, ...(plan ? { taskId: plan.id } : {}), returnTo })}`;
  const mapTask = (task: GrowthTask) => /keyword[- ]to[- ]page map/i.test(task.title);
  const gapTask = (task: GrowthTask) => task.moduleName === "gap_analysis" && /execution plan/i.test(task.title);
  const candidates = tasks.filter(task => !finished.has(task.status) && !plans.some(plan => plan.id === task.id)
    && (mapTask(task) || gapTask(task) || ["content", "ai_content", "publishing", "ai_citations", "local_seo", "social", "lead_magnet", "growth", "reports"].includes(task.moduleName))
    && !["crawl_issue", "gap_recommendation", "keyword_ideas", "keyword_research_run", "seo_fix_queue_item"].includes(task.sourceType));
  const activities = candidates.map(task => {
    const unmet = (task.dependencies ?? []).filter(dep => !["completed", "approved", "published", "verified", "skipped"].includes(dep.requiredTask.status));
    const blockedReason = task.blockedReason || (unmet.length ? `Complete first: ${unmet.map(dep => dep.requiredTask.title).join(", ")}` : null);
    const stage = blockedReason || ["blocked", "pending"].includes(task.status) ? "planned"
      : ["queued", "running", "in_progress", "generating", "preparing", "publishing", "verifying"].includes(task.status) ? "working"
      : ["needs_review", "submitted_for_approval", "pending_approval", "waiting_for_approval", "changes_requested"].includes(task.status) ? "review"
      : ["approved", "ready_to_publish"].includes(task.status) ? "publish" : "ready";
    const url = mapTask(task) ? planUrl : gapTask(task) ? `/gap-analysis?projectId=${encodeURIComponent(projectId)}`
      : `${executionUrl}&actionTask=${encodeURIComponent(task.id)}#execution-tasks`;
    const nextStep = blockedReason || (mapTask(task) ? "Review the published pages against the saved keyword owners and approved content plan. Keep completed pages; identify only remaining improvements."
      : gapTask(task) ? "Choose an unfinished improvement from the consolidated SEO and gap actions."
      : stage === "working" ? "Preparation or execution is in progress. Open the activity to see its saved progress and any worker errors."
      : stage === "review" ? "Review the prepared work and approve the exact version, or request changes."
      : stage === "publish" ? "Continue with the approved version, then verify the result at its destination."
      : stage === "planned" ? "This activity is planned. Open its prerequisites before starting preparation."
      : "Open the activity to check readiness and begin its preparation workflow.");
    return { id: task.id, title: task.title, moduleName: task.moduleName, status: task.status, stage, blockedReason, url, nextStep,
      actionLabel: mapTask(task) ? "Review existing page map" : gapTask(task) ? "Open SEO & Gap Execution Plan" : stage === "working" ? "View progress" : stage === "review" ? "Review prepared work" : stage === "publish" ? "Continue to publishing" : "Open activity" };
  }).sort((a, b) => {
    const rank = (item: typeof a) => item.stage === "review" ? 0 : item.stage === "working" ? 1 : item.stage === "publish" ? 2 : item.stage === "planned" ? 20 : /keyword[- ]to[- ]page map/i.test(item.title) ? 3 : item.moduleName === "gap_analysis" ? 4 : 5;
    return rank(a) - rank(b);
  });
  return {
    websiteLive,
    plan: plan ? { id: plan.id, title: plan.title, approved: approved(plan), url: planUrl } : null,
    executionUrl, planUrl,
    nextActivity: activities.find(item => item.stage !== "planned") ?? null,
    activities,
    reviewTaskId: plan && approved(plan) ? activities.find(item => item.stage === "ready" && /keyword[- ]to[- ]page map/i.test(item.title))?.id ?? null : null,
    counts: Object.fromEntries(["ready", "working", "review", "publish", "planned"].map(stage => [stage, activities.filter(item => item.stage === stage).length])),
  };
}
