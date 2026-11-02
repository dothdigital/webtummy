export interface QueuedJob {
  jobId: string;
  workspaceId: string;
  projectId?: string;
  featureKey: string;
  usageEventId: string;
  approvalToken: string;
  priority: 'low' | 'normal' | 'high';
  scheduledFor: Date;
  status: 'queued' | 'running' | 'completed' | 'failed';
}

const jobs: QueuedJob[] = [];

export async function enqueueCostControlledJob(job: Omit<QueuedJob, 'status'>): Promise<QueuedJob> {
  const queued: QueuedJob = { ...job, status: 'queued' };
  jobs.push(queued);
  return queued;
}

export async function getQueuedJobs(): Promise<QueuedJob[]> {
  return jobs;
}

// Production should use BullMQ, Cloud Tasks, Sidekiq, Celery, or similar.
// Workers must verify approvalToken before running any expensive provider call.
