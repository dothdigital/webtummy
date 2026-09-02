export const BACKGROUND_JOBS_KEY = "senuke-ai:background-jobs";
export const BACKGROUND_JOBS_EVENT = "senuke-ai:background-jobs-changed";
export const BACKGROUND_JOBS_SCOPE_KEY = "senuke-ai:background-jobs-scope";

export function bindBackgroundJobsScope(scope: string) {
  const normalized = scope.trim();
  if (!normalized) return;
  const previous = window.localStorage.getItem(BACKGROUND_JOBS_SCOPE_KEY);
  if (previous !== normalized) {
    window.localStorage.removeItem(BACKGROUND_JOBS_KEY);
    window.localStorage.removeItem("senuke-ai:site-analysis-job");
    window.dispatchEvent(new CustomEvent(BACKGROUND_JOBS_EVENT, { detail: [] }));
  }
  window.localStorage.setItem(BACKGROUND_JOBS_SCOPE_KEY, normalized);
}

export type BackgroundJob = {
  id: string;
  projectId?: string | null;
  type: string;
  title: string;
  subject: string;
  status: string;
  statusUrl: string;
  resultUrl: string;
  startedAt: string;
  progressMessage: string;
  completedMessage: string;
  failedMessage: string;
  resultMetricKey?: string;
  resultMetricLabel?: string;
  resultMetric?: number;
  resultMetricTotal?: number;
  error?: string | null;
};

export function readBackgroundJobs(): BackgroundJob[] {
  try {
    const value = window.localStorage.getItem(BACKGROUND_JOBS_KEY);
    const parsed = value ? JSON.parse(value) : [];
    if (Array.isArray(parsed) && parsed.length) return parsed as BackgroundJob[];
    const legacyValue = window.localStorage.getItem("senuke-ai:site-analysis-job");
    if (!legacyValue) return [];
    const legacy = JSON.parse(legacyValue) as { crawlId: string; projectId: string; projectName: string; status: string; pagesCrawled?: number; error?: string | null; startedAt: string };
    const migrated: BackgroundJob = { id: legacy.crawlId, type: "site-analysis", title: "Site analysis", subject: legacy.projectName, status: legacy.status, statusUrl: `/api/crawls/${legacy.crawlId}/status`, resultUrl: `/site-analysis?projectId=${encodeURIComponent(legacy.projectId)}`, startedAt: legacy.startedAt, progressMessage: `You can continue working. We’re analyzing ${legacy.projectName} in the background.`, completedMessage: `${legacy.projectName} is ready to review`, failedMessage: `${legacy.projectName} could not be analyzed. Review the error and try again.`, resultMetricKey: "pagesCrawled", resultMetricLabel: "pages analyzed", resultMetric: legacy.pagesCrawled, error: legacy.error };
    window.localStorage.setItem(BACKGROUND_JOBS_KEY, JSON.stringify([migrated]));
    window.localStorage.removeItem("senuke-ai:site-analysis-job");
    return [migrated];
  } catch {
    return [];
  }
}

function write(jobs: BackgroundJob[]) {
  window.localStorage.setItem(BACKGROUND_JOBS_KEY, JSON.stringify(jobs));
  window.dispatchEvent(new CustomEvent(BACKGROUND_JOBS_EVENT, { detail: jobs }));
}

export function registerBackgroundJob(job: BackgroundJob) {
  const jobs = readBackgroundJobs();
  write([job, ...jobs.filter((item) => item.id !== job.id)]);
}

export function updateBackgroundJob(id: string, patch: Partial<BackgroundJob>) {
  write(readBackgroundJobs().map((job) => job.id === id ? { ...job, ...patch } : job));
}

export function dismissBackgroundJob(id: string) {
  write(readBackgroundJobs().filter((job) => job.id !== id));
}

export function dismissBackgroundJobs(ids: string[]) {
  const dismissed = new Set(ids);
  write(readBackgroundJobs().filter((job) => !dismissed.has(job.id)));
}

export function normalizeBackgroundJobResponse(result: unknown) {
  const envelope = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const value = (envelope.run ?? envelope.crawlJob ?? envelope.job ?? envelope) as Record<string, unknown>;
  return value && typeof value === "object" ? value : {};
}

export function isBackgroundJobFinished(status: string) {
  return ["completed", "failed", "cancelled"].includes(status);
}
