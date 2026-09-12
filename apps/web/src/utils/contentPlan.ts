import type { GuidedExecutionTask } from "../types.js";

export function isContentPlanTask(task: GuidedExecutionTask) {
  // Before current SEO evidence is incorporated into an approved Strategy,
  // this record is a workflow gate rather than an editable content plan.
  if (task.status === "pending" && /(?:run seo\s*&?\s*gap analysis|update strategy|approve (?:updated )?strategy)/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return false;
  // Local SEO and publishing tasks may refer to the approved plan, but they are
  // downstream actions and must not reopen the planning workflow.
  if (["local_seo", "publishing"].includes(task.moduleName)) return false;
  const value = `${task.title} ${task.actionButtonLabel ?? ""}`.trim();
  return /website\s+launch\s+(?:page\s+map\s*(?:&|and)\s*content\s+plan|plan)/i.test(value)
    || /seo\s+page\s+map\s*(?:&|and)\s*(?:seo\s+)?content\s+plan/i.test(value)
    || /(?:create|review|view)\s+(?:seo\s+)?content\s+plan/i.test(value)
    || /(?:create|review|view)\s+(?:seo\s+)?page\s+map/i.test(value)
    || /map\s+(?:seo|local)\s+keyword\s+opportunities/i.test(value);
}

export function contentPlanTitle(task: GuidedExecutionTask) {
  return isContentPlanTask(task) ? /website\s+launch/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`) ? "Website Launch Page Map & Content Plan" : "SEO Page Map & Content Plan" : task.title;
}

export function contentPlanDescription(task: GuidedExecutionTask) {
  return isContentPlanTask(task)
    ? "Group approved keywords by intent, assign one owner page, prepare URLs and SEO briefs, then review FAQs, proof, Local SEO, internal links, and publishing requirements in one workflow."
    : task.description;
}

export function contentPlanActionLabel(task: GuidedExecutionTask) {
  if (!isContentPlanTask(task)) return task.actionButtonLabel ?? "Open Task";
  const launchPlan = /website\s+launch/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`);
  if (["submitted_for_approval", "pending_approval", "waiting_for_approval", "needs_approval"].includes(task.status)) return "Review Approval";
  if (["completed", "approved", "ready_to_publish"].includes(task.status)) return launchPlan ? "View Approved Website Launch Plan" : "View Approved SEO Plan";
  if (task.status === "in_progress") return launchPlan ? "Website Plan in process" : "SEO Plan in process";
  if (task.status === "failed") return launchPlan ? "Website Plan failed — Retry" : "SEO Plan failed — Retry";
  if (["needs_review", "changes_requested"].includes(task.status)) return launchPlan ? "Review Website Launch Plan" : "Review SEO Plan";
  return launchPlan ? "Create Website Launch Plan" : "Create SEO Plan";
}

export function preferredContentPlanTask(left: GuidedExecutionTask, right: GuidedExecutionTask) {
  const score = (task: GuidedExecutionTask) => {
    const hasDetailedPlan = Boolean(task.approvalSnapshotJson?.contentPlan);
    const active = !["cancelled", "canceled", "skipped"].includes(task.status);
    const progressed = ["in_progress", "needs_review", "submitted_for_approval", "pending_approval", "approved", "completed"].includes(task.status);
    return Number(hasDetailedPlan) * 100 + Number(active) * 10 + Number(progressed) * 5 + new Date(task.createdAt).getTime() / 1e15;
  };
  return score(right) > score(left) ? right : left;
}
