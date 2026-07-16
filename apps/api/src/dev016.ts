export type NextBestActionTask = {
  id: string;
  moduleName: string;
  sourceType?: string | null;
  title: string;
  description: string;
  expectedOutcome?: string | null;
  impact?: string | null;
  priority: string;
  status: string;
  requiresApproval?: boolean;
  relatedUrl?: string | null;
  actionButtonLabel?: string | null;
  dueAt?: Date | string | null;
  manualInstructions?: string | null;
  dependencies?: { requiredTask: { id: string; title: string; status: string } }[];
};

export type NextBestActionContext = {
  projectId?: string;
  primaryGoal?: string | null;
  targetMarkets?: string[];
  keywordGapCount?: number;
  competitorCount?: number;
  technicalIssueCount?: number;
  contentDecayCount?: number;
  canExecute: boolean;
  canApprove: boolean;
};

export type NextBestActionDecision = {
  taskId: string;
  title: string;
  reason: string;
  expectedOutcome: string;
  priority: "critical" | "high" | "medium" | "low";
  score: number;
  confidence: number;
  signals: { key: string; label: string; contribution: number; evidence: string }[];
  actionUrl: string | null;
  actionLabel: string;
  actionable: boolean;
  requiresApproval: boolean;
};

const complete = new Set(["completed", "skipped", "approved", "published"]);
const terminal = new Set([...complete, "cancelled", "canceled"]);
const priorityScore: Record<string, number> = { critical: 44, high: 34, medium: 22, low: 12 };

function bounded(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function signal(key: string, label: string, contribution: number, evidence: string) { return { key, label, contribution, evidence }; }

export function rankNextBestAction(tasks: NextBestActionTask[], context: NextBestActionContext): NextBestActionDecision | null {
  const candidates = tasks.filter((task) => {
    if (terminal.has(task.status) || ["blocked", "queued"].includes(task.status)) return false;
    if (task.requiresApproval && context.canExecute && !context.canApprove) return false;
    return (task.dependencies ?? []).every((dependency) => complete.has(dependency.requiredTask.status));
  });

  const ranked = candidates.map((task) => {
    const text = `${task.moduleName} ${task.sourceType ?? ""} ${task.title} ${task.description} ${task.expectedOutcome ?? ""} ${task.impact ?? ""} ${task.manualInstructions ?? ""}`.toLowerCase();
    const signals = [signal("priority", "Business impact", priorityScore[task.priority] ?? 18, `${task.priority} task priority`)];
    if (task.status === "in_progress") signals.push(signal("active_work", "Work already in progress", 18, "Finishing active work reduces context switching and unlocks dependants"));
    if (["submitted_for_approval", "awaiting_confirmation", "waiting_for_approval", "pending_approval"].includes(task.status) && context.canApprove) signals.push(signal("approval", "Approval waiting", 16, "A decision is waiting and may unblock execution"));
    const goalWords = (context.primaryGoal ?? "").toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    if (goalWords.some((word) => text.includes(word)) || /lead|sale|conversion|revenue/.test(text)) signals.push(signal("business_impact", "Business impact", 12, `Supports ${context.primaryGoal || "the primary business goal"}`));
    if ((context.keywordGapCount ?? 0) > 0 && /intent|keyword|mapping|cannibali|content gap|topical/.test(text)) signals.push(signal("intent_gaps", "Search intent gaps", 13, `${context.keywordGapCount} saved keyword or topical gaps`));
    if ((context.competitorCount ?? 0) > 0 && /competitor|gap|position|authority|serp/.test(text)) signals.push(signal("competitors", "Competitor advantage", 10, `${context.competitorCount} saved competitors provide comparison evidence`));
    if (/ai citation|ai overview|answer-first|serp feature|schema|entity/.test(text)) signals.push(signal("ai_visibility", "AI visibility opportunity", 12, "The task targets enhanced search or AI answer visibility"));
    if ((context.technicalIssueCount ?? 0) > 0 && /crawl|technical|404|broken|index|canonical|redirect|sitemap|robots|internal link/.test(text)) signals.push(signal("technical", "Technical issues", 15, `${context.technicalIssueCount} open technical findings`));
    if ((context.contentDecayCount ?? 0) > 0 && /fresh|decay|outdated|stale|refresh|old content/.test(text)) signals.push(signal("decay", "Content decay", 12, `${context.contentDecayCount} freshness signals`));
    if ((context.targetMarkets?.length ?? 0) > 0 && /local|location|market|google business|citation|nap/.test(text)) signals.push(signal("local", "Local SEO opportunity", 11, `Targets ${context.targetMarkets!.slice(0, 3).join(", ")}`));
    const impact = text.match(/impact\s+(\d{1,3})(?:\/100|%)/)?.[1];
    if (impact) signals.push(signal("measured_impact", "Measured strategy impact", Math.round(Number(impact) / 10), `${impact}/100 estimated impact`));
    if (task.dueAt) {
      const days = (new Date(task.dueAt).getTime() - Date.now()) / 86_400_000;
      if (days <= 3) signals.push(signal("due_date", "Due-date urgency", days < 0 ? 14 : 9, days < 0 ? "Task is overdue" : "Task is due within three days"));
    }
    const score = bounded(signals.reduce((total, item) => total + item.contribution, 0));
    return { task, score, signals };
  }).sort((a, b) => b.score - a.score || (priorityScore[b.task.priority] ?? 0) - (priorityScore[a.task.priority] ?? 0) || a.task.title.localeCompare(b.task.title));

  const winner = ranked[0];
  if (!winner) return null;
  const { task, score, signals } = winner;
  const requiresApproval = Boolean(task.requiresApproval);
  const actionable = context.canExecute && (!requiresApproval || context.canApprove);
  const strongest = signals.filter((item) => item.key !== "priority").sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const reason = strongest.length
    ? `This is the highest-scoring dependency-ready task because of ${strongest.map((item) => item.label.toLowerCase()).join(", ")}.`
    : "This is the highest-priority dependency-ready task in the active Execution Plan.";
  return {
    taskId: task.id, title: task.title, reason,
    expectedOutcome: task.expectedOutcome || task.impact || task.description,
    priority: (["critical", "high", "medium", "low"].includes(task.priority) ? task.priority : "medium") as NextBestActionDecision["priority"],
    score, confidence: bounded(62 + Math.min(28, signals.length * 5)), signals,
    actionUrl: task.relatedUrl && context.projectId && task.relatedUrl.startsWith("/") && !/[?&](?:projectId|project)=/.test(task.relatedUrl)
      ? `${task.relatedUrl}${task.relatedUrl.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(context.projectId)}`
      : task.relatedUrl ?? null,
    actionLabel: actionable ? (task.actionButtonLabel || (requiresApproval ? "Review & Approve" : "Open Task")) : "View Task",
    actionable, requiresApproval,
  };
}
