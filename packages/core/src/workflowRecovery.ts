export type WorkflowRecoveryAction = "retry" | "reconnect" | "provide_information" | "contact_support";
export type WorkflowCapacityOutcome = "not_used" | "refunded" | "used" | "refund_pending" | "unknown";

export function workflowRecoveryPayload(input: {
  whatFailed: string;
  workSaved: boolean;
  capacityOutcome: WorkflowCapacityOutcome;
  nextStep: string;
  action: WorkflowRecoveryAction;
  actionUrl?: string | null;
  errorCode?: string | null;
}) {
  return {
    whatFailed: input.whatFailed,
    workSaved: input.workSaved,
    capacityOutcome: input.capacityOutcome,
    nextStep: input.nextStep,
    action: input.action,
    actionUrl: input.actionUrl ?? null,
    errorCode: input.errorCode ?? null,
  } as const;
}
