import type { ProjectWorkflowController } from "../types.js";

export function siteAnalysisPrimaryMode(workflow: Pick<ProjectWorkflowController, "websiteDeliveryStage" | "state" | "nextBestAction"> | null, hasReport: boolean) {
  if (workflow?.websiteDeliveryStage === "live_checks" || (workflow?.state === "measurement" && workflow.nextBestAction.action.url.startsWith("/site-analysis"))) return "live_review";
  if (workflow?.websiteDeliveryStage) return "workflow";
  return hasReport ? "gap" : "scan";
}
