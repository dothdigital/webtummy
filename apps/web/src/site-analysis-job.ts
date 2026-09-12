// Compatibility bridge for dev servers that still have the former module in
// their HMR graph. New processes should use the generic background-jobs API.
import { BACKGROUND_JOBS_EVENT, dismissBackgroundJob, readBackgroundJobs, registerBackgroundJob } from "./background-jobs.js";

export const SITE_ANALYSIS_JOB_EVENT = BACKGROUND_JOBS_EVENT;
export const SITE_ANALYSIS_JOB_KEY = "senuke-ai:site-analysis-job";

export type SiteAnalysisJob = {
  crawlId: string;
  projectId: string;
  projectName: string;
  status: string;
  pagesCrawled?: number;
  error?: string | null;
  startedAt: string;
};

export function readSiteAnalysisJob(): SiteAnalysisJob | null {
  const job = readBackgroundJobs().find((item) => item.type === "site-analysis");
  if (!job) return null;
  const projectId = new URL(job.resultUrl, window.location.origin).searchParams.get("projectId") ?? "";
  return { crawlId: job.id, projectId, projectName: job.subject, status: job.status, pagesCrawled: job.resultMetric, error: job.error, startedAt: job.startedAt };
}

export function storeSiteAnalysisJob(job: SiteAnalysisJob | null) {
  if (!job) {
    for (const existing of readBackgroundJobs().filter((item) => item.type === "site-analysis")) dismissBackgroundJob(existing.id);
    return;
  }
  registerBackgroundJob({ id: job.crawlId, type: "site-analysis", title: "Site analysis", subject: job.projectName, status: job.status, statusUrl: `/api/crawls/${job.crawlId}/status`, resultUrl: `/site-analysis?projectId=${encodeURIComponent(job.projectId)}`, startedAt: job.startedAt, progressMessage: `You can continue working. We’re analyzing ${job.projectName} in the background.`, completedMessage: `${job.projectName} is ready to review`, failedMessage: `${job.projectName} could not be analyzed. Review the error and try again.`, resultMetricKey: "pagesCrawled", resultMetricLabel: "pages analyzed", resultMetric: job.pagesCrawled, error: job.error });
}
