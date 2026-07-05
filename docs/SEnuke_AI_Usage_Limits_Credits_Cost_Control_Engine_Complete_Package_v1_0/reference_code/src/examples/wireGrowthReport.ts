import crypto from 'crypto';
import { preflightCostGuard } from '../services/preflightCostGuard';
import { enqueueCostControlledJob } from '../services/batchJobQueue';

export async function requestGrowthReport(workspaceId: string, userId: string, projectId: string) {
  const preflight = await preflightCostGuard({
    workspaceId,
    userId,
    projectId,
    featureKey: 'growth_report',
    actionParameters: { reportType: 'monthly_growth_summary' },
    idempotencyKey: crypto.randomUUID(),
    requestedMode: 'queued',
    userConfirmedCreditUse: true,
  });

  if (!preflight.allowed) return preflight;

  await enqueueCostControlledJob({
    jobId: crypto.randomUUID(),
    workspaceId,
    projectId,
    featureKey: 'growth_report',
    usageEventId: preflight.usageEventId!,
    approvalToken: preflight.approvalToken!,
    priority: 'normal',
    scheduledFor: new Date(),
  });

  return preflight;
}
