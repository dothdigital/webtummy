export type WebsiteGenerationJobState = {
  status: string;
  inputJson: unknown;
  resultJson: unknown;
};

export type WebsitePageSummaryState = {
  id: string;
  version: number;
  status: string;
  approvalReadiness?: unknown;
  seoQuality?: unknown;
  contentSummary?: unknown;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

const stringArray = (value: unknown) => Array.isArray(value)
  ? value.map(String).filter(Boolean)
  : [];

const activeStatuses = new Set(["queued", "processing", "running", "in_progress", "pending", "retrying"]);
const websiteGenerationModes = new Set(["content_generation", "image_generation", "website_generation"]);

export const websiteGenerationJobIsActive = (job: WebsiteGenerationJobState) => {
  const input = record(job.inputJson);
  return activeStatuses.has(job.status.toLowerCase())
    && websiteGenerationModes.has(String(input.mode || "website_generation"));
};

export const websiteGenerationJobCoversPage = (job: WebsiteGenerationJobState, pageId: string) => {
  if (!websiteGenerationJobIsActive(job)) return false;
  const input = record(job.inputJson);
  const result = record(job.resultJson);
  if (stringArray(result.completedPageIds).includes(pageId)) return false;
  const requestedPageIds = stringArray(input.pageIds);
  return requestedPageIds.length === 0 || requestedPageIds.includes(pageId);
};

export const websitePageContentIsProcessing = (
  jobs: WebsiteGenerationJobState[],
  pageId: string,
  contentReadyForReview = false,
) => !contentReadyForReview && jobs.some((job) => websiteGenerationJobCoversPage(job, pageId));

export const websiteContentActionsAreLocked = (jobs: WebsiteGenerationJobState[]) => jobs.some(websiteGenerationJobIsActive);

export const reconcileWebsitePageDetail = <T extends WebsitePageSummaryState>(summary: T | null, detail: T | null): T | null => {
  if (!summary) return null;
  if (!detail || detail.id !== summary.id || detail.version !== summary.version) return summary;
  return {
    ...detail,
    status: summary.status,
    approvalReadiness: summary.approvalReadiness,
    seoQuality: summary.seoQuality,
    contentSummary: summary.contentSummary,
  };
};

export const qualityWaiverDestination = (blockingCount: number | null | undefined) => blockingCount === 0
  ? "review" as const
  : "optimization" as const;
