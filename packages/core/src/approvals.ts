export const approvalTypes = ["content", "publishing", "website_change", "strategy", "ai_execution", "client", "integration", "high_risk"] as const;
export type ApprovalType = (typeof approvalTypes)[number];
export const automationLevels = ["manual", "assisted", "trusted"] as const;
export type AutomationLevel = (typeof automationLevels)[number];

export type ApprovalCandidate = {
  title?: string | null; description?: string | null; moduleName?: string | null; sourceType?: string | null;
  approvalRisk?: string | null; safetyCategory?: string | null; requiresIntegration?: boolean | null;
  clientApprovalRequired?: boolean | null; affectedCount?: number | null;
};

export function classifyApproval(candidate: ApprovalCandidate): { type: ApprovalType; risk: "low" | "medium" | "high" | "critical"; highRisk: boolean } {
  const text = `${candidate.title ?? ""} ${candidate.description ?? ""} ${candidate.moduleName ?? ""} ${candidate.sourceType ?? ""} ${candidate.safetyCategory ?? ""}`.toLowerCase();
  const explicitRisk = ["low", "medium", "high", "critical"].includes(String(candidate.approvalRisk)) ? candidate.approvalRisk as "low" | "medium" | "high" | "critical" : "medium";
  const destructive = /delete|remove integration|disconnect|bulk redirect|robots\.txt|sitemap|navigation|structural|archive client|delete project/.test(text);
  const bulk = (candidate.affectedCount ?? 0) > 10 || /bulk|\b\d{2,}\s+(pages|products|urls)/.test(text);
  const risk = destructive ? "critical" : bulk && explicitRisk === "low" ? "high" : explicitRisk;
  if (destructive || risk === "critical") return { type: "high_risk", risk, highRisk: true };
  if (candidate.clientApprovalRequired) return { type: "client", risk, highRisk: false };
  if (candidate.requiresIntegration || /wordpress|shopify|google|stripe|integration|connect|disconnect/.test(text)) return { type: "integration", risk, highRisk: false };
  if (/publish|go live|deploy|schedule post/.test(text)) return { type: "publishing", risk, highRisk: false };
  if (/strategy|keyword direction|pillar|link.building|local seo focus/.test(text)) return { type: "strategy", risk, highRisk: false };
  if (/navigation|redirect|internal link|schema|robots|sitemap|create page|update page/.test(text)) return { type: "website_change", risk, highRisk: false };
  if (bulk || /multiple actions|optimi[sz]e \d+|execution plan/.test(text)) return { type: "ai_execution", risk, highRisk: risk === "high" };
  return { type: "content", risk, highRisk: risk === "high" };
}

export function approvalRequired(level: AutomationLevel, candidate: ApprovalCandidate) {
  const classification = classifyApproval(candidate);
  if (classification.highRisk || ["publishing", "strategy", "client", "integration"].includes(classification.type)) return true;
  if (level === "manual") return true;
  if (level === "assisted") return classification.risk !== "low" || classification.type !== "content";
  return classification.risk === "high" || classification.risk === "critical";
}

export function automationLevelDescription(level: AutomationLevel) {
  if (level === "manual") return "Every action requiring approval pauses for review.";
  if (level === "assisted") return "Low-risk drafts may continue automatically; higher-risk actions pause.";
  return "Most actions continue automatically, but publishing, integrations, strategy and high-risk changes still pause.";
}

export type ApprovalDecision = "approved" | "rejected" | "changes_requested";

export function normalizedApprovalDecision(value: string): ApprovalDecision {
  if (value === "approved" || value === "rejected") return value;
  return "changes_requested";
}

export function approvalDecisionState(decision: ApprovalDecision, needsClientApproval: boolean) {
  if (decision === "approved" && needsClientApproval) return { status: "submitted_for_approval", storedDecision: "team_approved" };
  if (decision === "approved") return { status: "ready_to_publish", storedDecision: "approved" };
  if (decision === "rejected") return { status: "rejected", storedDecision: "rejected" };
  return { status: "changes_requested", storedDecision: "changes_requested" };
}

export function approvalEscalationStage(submittedAt: Date, now = new Date()) {
  const hours = (now.getTime() - submittedAt.getTime()) / (60 * 60 * 1000);
  if (hours >= 48) return "owner" as const;
  if (hours >= 24) return "manager" as const;
  return null;
}
