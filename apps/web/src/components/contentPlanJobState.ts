export type ContentPlanJobSnapshot = {
  status: string;
  error?: string | null;
  errorCode?: string | null;
};

export type ContentPlanJobAction = "poll" | "fetch_result" | "show_failure" | "show_unexpected_status";

export function contentPlanJobAction(job: ContentPlanJobSnapshot): ContentPlanJobAction {
  if (job.status === "failed") return "show_failure";
  if (job.status === "completed") return "fetch_result";
  if (["queued", "running"].includes(job.status)) return "poll";
  return "show_unexpected_status";
}

export function contentPlanJobFailureMessage(job: ContentPlanJobSnapshot) {
  const message = job.error || "Website Plan generation could not be completed.";
  if (!job.errorCode || message.includes(job.errorCode)) return message;
  return `${message} Error code: ${job.errorCode}`;
}
