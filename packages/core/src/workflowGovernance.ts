export const PROJECT_WORKFLOW_STATUS = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  NEEDS_ATTENTION: "needs_attention",
  WAITING_FOR_APPROVAL: "waiting_for_approval",
  COMPLETE: "complete",
  NOT_APPLICABLE: "not_applicable",
  NEEDS_REFRESH: "needs_refresh",
  BLOCKED: "blocked",
} as const;

export type ProjectWorkflowStatus = typeof PROJECT_WORKFLOW_STATUS[keyof typeof PROJECT_WORKFLOW_STATUS];

export const PROJECT_WORKFLOW_LIFECYCLE = [
  { key: "project_created", number: 1, label: "Project Created", prerequisite: null },
  { key: "intake", number: 2, label: "Intake", prerequisite: "project_created" },
  { key: "business_brain_approval", number: 3, label: "Business Brain Review and Approval", prerequisite: "intake" },
  { key: "readiness_check", number: 4, label: "Readiness Check", prerequisite: "business_brain_approval" },
  { key: "opportunity_discovery", number: 5, label: "Opportunity Discovery", prerequisite: "readiness_check" },
  { key: "required_intelligence", number: 6, label: "Required Intelligence", prerequisite: "opportunity_discovery" },
  { key: "findings_review", number: 7, label: "Findings Review", prerequisite: "required_intelligence" },
  { key: "growth_strategy", number: 8, label: "Growth Strategy", prerequisite: "findings_review" },
  { key: "growth_strategy_approval", number: 9, label: "Growth Strategy Approval", prerequisite: "growth_strategy" },
  { key: "growth_blueprint", number: 10, label: "Growth Blueprint", prerequisite: "growth_strategy_approval" },
  { key: "required_channel_plans", number: 11, label: "Required Channel Plans", prerequisite: "growth_blueprint" },
  { key: "execution_plan_approval", number: 12, label: "Execution Plan Review and Approval", prerequisite: "required_channel_plans" },
  { key: "approved_execution", number: 13, label: "Approved Execution", prerequisite: "execution_plan_approval" },
  { key: "output_approval", number: 14, label: "Output Review and Approval", prerequisite: "approved_execution" },
  { key: "external_completion", number: 15, label: "Publishing or External Completion", prerequisite: "output_approval" },
  { key: "tracking_verification", number: 16, label: "Tracking and Measurement Verification", prerequisite: "external_completion" },
  { key: "reporting_learning", number: 17, label: "Reporting and Learning", prerequisite: "tracking_verification" },
  { key: "growth_loop_activation", number: 18, label: "Continuous Growth Loop Activation", prerequisite: "reporting_learning" },
  { key: "next_best_action", number: 19, label: "Next Best Action", prerequisite: "growth_loop_activation" },
] as const;

export type ProjectWorkflowStageKey = typeof PROJECT_WORKFLOW_LIFECYCLE[number]["key"];

export const REQUIRED_STRATEGY_CHANNELS = [
  "seo",
  "aeo_geo",
  "website",
  "content",
  "funnel_conversion",
  "email",
  "ecommerce",
  "local_visibility",
  "authority_building",
  "paid_media",
] as const;

export type RequiredStrategyChannel = typeof REQUIRED_STRATEGY_CHANNELS[number];

export type WorkflowNextAction = {
  label: string;
  url: string;
  type: "navigate" | "review" | "approve" | "generate" | "implement";
};

export type WorkflowBlockedPayload = {
  error: "The action is not ready.";
  code: "WORKFLOW_PREREQUISITE_REQUIRED";
  missingRequirement: string;
  nextAction: WorkflowNextAction;
};

export function workflowBlockedPayload(missingRequirement: string, nextAction: WorkflowNextAction): WorkflowBlockedPayload {
  return {
    error: "The action is not ready.",
    code: "WORKFLOW_PREREQUISITE_REQUIRED",
    missingRequirement,
    nextAction,
  };
}

export function workflowStageNumber(key: ProjectWorkflowStageKey) {
  return PROJECT_WORKFLOW_LIFECYCLE.find((stage) => stage.key === key)?.number ?? 0;
}
