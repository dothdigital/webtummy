import crypto from 'crypto';
import { PreflightRequest, UsageCommitRequest } from '../types';

interface UsageEventRecord {
  id: string;
  request: PreflightRequest;
  status: string;
  estimatedCredits: number;
  reservedCredits: number;
  actualCredits: number;
  estimatedProviderCostCents: number;
  actualProviderCostCents: number;
  cacheHit: boolean;
  decision: string;
}

const usageEvents = new Map<string, UsageEventRecord>();

export async function createUsageEvent(params: {
  req: PreflightRequest;
  decision: string;
  estimatedCredits: number;
  estimatedProviderCostCents: number;
  cacheHit: boolean;
}): Promise<UsageEventRecord> {
  const id = crypto.randomUUID();
  const record: UsageEventRecord = {
    id,
    request: params.req,
    status: 'preflight',
    estimatedCredits: params.estimatedCredits,
    reservedCredits: 0,
    actualCredits: 0,
    estimatedProviderCostCents: params.estimatedProviderCostCents,
    actualProviderCostCents: 0,
    cacheHit: params.cacheHit,
    decision: params.decision,
  };
  usageEvents.set(id, record);
  return record;
}

export async function markReserved(usageEventId: string, credits: number): Promise<void> {
  const event = usageEvents.get(usageEventId);
  if (!event) throw new Error('Usage event not found');
  event.status = 'reserved';
  event.reservedCredits = credits;
}

export async function commitUsage(req: UsageCommitRequest): Promise<void> {
  const event = usageEvents.get(req.usageEventId);
  if (!event) throw new Error('Usage event not found');
  event.status = req.status;
  event.actualCredits = req.actualCredits ?? event.reservedCredits;
  event.actualProviderCostCents = req.actualProviderCostCents ?? 0;
  // TODO: persist providerEvents and reconcile provider costs.
}

export async function getUsageEvent(usageEventId: string): Promise<UsageEventRecord | undefined> {
  return usageEvents.get(usageEventId);
}
