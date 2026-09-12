import { competitiveFeatures } from '../featureRegistry';

interface RunContext {
  projectId: string;
  userId: string;
  workspaceId: string;
  plan: 'starter' | 'pro' | 'agency' | 'enterprise';
  readiness: Record<string, boolean>;
  creditsRemaining: number;
}

export function canRunFeature(featureKey: string, ctx: RunContext) {
  const feature = competitiveFeatures.find(f => f.key === featureKey);
  if (!feature) return { ok: false, reason: 'Unknown feature.' };

  const planOrder = ['starter', 'pro', 'agency', 'enterprise'];
  if (planOrder.indexOf(ctx.plan) < planOrder.indexOf(feature.minPlan)) {
    return { ok: false, reason: `This feature requires ${feature.minPlan} plan or higher.` };
  }

  const missing = feature.requiresReadiness.filter(key => !ctx.readiness[key]);
  if (missing.length) {
    return { ok: false, reason: 'Missing required data.', missing };
  }

  if (ctx.creditsRemaining < feature.creditCost) {
    return { ok: false, reason: 'Not enough credits.', creditCost: feature.creditCost };
  }

  return { ok: true, feature, creditCost: feature.creditCost };
}

export async function runCompetitiveIntelligence(featureKey: string, ctx: RunContext, input: unknown) {
  const allowed = canRunFeature(featureKey, ctx);
  if (!allowed.ok) return allowed;

  // Pseudocode: reserve credits, enqueue job, log run.
  // await credits.reserve(ctx.workspaceId, allowed.creditCost)
  // const run = await intelligenceRuns.create({ featureKey, input, status: 'queued' })
  // await queue.add('competitive-intelligence', { runId: run.id, featureKey, input })

  return {
    ok: true,
    status: 'queued',
    message: 'Competitive intelligence run queued.',
    creditCost: allowed.creditCost
  };
}
