import crypto from 'crypto';
import { PreflightDecision, PreflightRequest } from '../types';
import { getFeatureCost } from './featureCostCatalog';
import { getWorkspacePlan, getPlanLimit, getMonthlyFeatureUsage } from './planLimits';
import { getCreditBalance, reserveCredits } from './creditLedger';
import { findFreshCache } from './cacheService';
import { estimateActionCost } from './costEstimator';
import { createUsageEvent, markReserved } from './usageMetering';

function signApprovalToken(usageEventId: string): string {
  // Production: sign a short-lived JWT or HMAC token scoped to usageEventId + featureKey.
  return Buffer.from(`${usageEventId}.${crypto.randomBytes(16).toString('hex')}`).toString('base64url');
}

export async function preflightCostGuard(req: PreflightRequest): Promise<PreflightDecision> {
  const feature = getFeatureCost(req.featureKey);
  const plan = await getWorkspacePlan(req.workspaceId);
  const planLimit = await getPlanLimit(plan.planName, req.featureKey);

  if (!planLimit.enabled) {
    return {
      allowed: false,
      decision: 'require_upgrade',
      message: `${feature.displayName} is not included in your current plan.`,
      estimatedCredits: 0,
      upgradePlanSuggestion: planLimit.minimumPlanToUpgrade ?? 'Pro',
    };
  }

  const monthlyUsage = await getMonthlyFeatureUsage(req.workspaceId, req.featureKey);
  if (planLimit.monthlyLimit !== undefined && monthlyUsage >= planLimit.monthlyLimit) {
    return {
      allowed: false,
      decision: 'block_limit',
      message: `You have reached your monthly limit for ${feature.displayName}.`,
      estimatedCredits: 0,
      creditPackSuggestion: 'Buy extra credits or upgrade your plan.',
    };
  }

  const cacheHit = await findFreshCache(req, feature);
  if (cacheHit && req.requestedMode !== 'full') {
    const usage = await createUsageEvent({ req, decision: 'use_cache', estimatedCredits: 0, estimatedProviderCostCents: 0, cacheHit: true });
    return {
      allowed: true,
      decision: 'use_cache',
      message: `A recent ${feature.displayName} result is available. Reuse it for 0 credits or run a fresh scan.`,
      estimatedCredits: 0,
      usageEventId: usage.id,
      cacheRecordId: cacheHit.cacheKey,
    };
  }

  const estimate = estimateActionCost(feature, req.actionParameters);
  const balance = await getCreditBalance(req.workspaceId);
  if (balance.availableCredits < estimate.estimatedCredits) {
    return {
      allowed: false,
      decision: 'block_limit',
      message: `This action needs ${estimate.estimatedCredits} credits, but you only have ${balance.availableCredits}.`,
      estimatedCredits: estimate.estimatedCredits,
      remainingCreditsAfterAction: balance.availableCredits,
      creditPackSuggestion: 'Buy a credit pack or wait until your next reset.',
    };
  }

  if (!req.userConfirmedCreditUse && estimate.estimatedCredits >= 10) {
    return {
      allowed: false,
      decision: 'require_confirm',
      message: `This action will use ${estimate.estimatedCredits} credits.`,
      estimatedCredits: estimate.estimatedCredits,
      remainingCreditsAfterAction: balance.availableCredits - estimate.estimatedCredits,
    };
  }

  const usage = await createUsageEvent({
    req,
    decision: estimate.recommendedMode === 'queued' ? 'queue' : 'allow',
    estimatedCredits: estimate.estimatedCredits,
    estimatedProviderCostCents: estimate.estimatedProviderCostCents,
    cacheHit: false,
  });

  await reserveCredits({ workspaceId: req.workspaceId, amount: estimate.estimatedCredits, usageEventId: usage.id, idempotencyKey: req.idempotencyKey });
  await markReserved(usage.id, estimate.estimatedCredits);

  return {
    allowed: true,
    decision: estimate.recommendedMode === 'queued' ? 'queue' : 'allow',
    message: estimate.recommendedMode === 'queued' ? 'This job will run in the background to control processing cost.' : 'Action approved.',
    estimatedCredits: estimate.estimatedCredits,
    remainingCreditsAfterAction: balance.availableCredits - estimate.estimatedCredits,
    approvalToken: signApprovalToken(usage.id),
    usageEventId: usage.id,
  };
}
