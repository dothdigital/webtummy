import { FeatureKey } from '../types';

export interface PlanLimit {
  enabled: boolean;
  monthlyLimit?: number;
  dailyLimit?: number;
  creditCostOverride?: number;
  minimumPlanToUpgrade?: 'Starter' | 'Pro' | 'Agency' | 'Enterprise';
}

export interface WorkspacePlanContext {
  workspaceId: string;
  planName: 'Starter' | 'Pro' | 'Agency' | 'Enterprise';
  monthlyBaseCredits: number;
  cycleEndsAt: Date;
}

// Replace with database plan_feature_limits table in production.
const LIMITS: Record<string, Record<string, PlanLimit>> = {
  Starter: {
    ai_strategy_full: { enabled: true, monthlyLimit: 1 },
    site_crawl_small: { enabled: true, monthlyLimit: 1 },
    keyword_research_batch: { enabled: true, monthlyLimit: 5 },
    backlink_snapshot: { enabled: true, monthlyLimit: 1 },
    ai_citation_scan: { enabled: true, monthlyLimit: 3 },
    growth_report: { enabled: true, monthlyLimit: 1 },
    agency_white_label_report: { enabled: false, minimumPlanToUpgrade: 'Agency' },
  },
  Pro: {
    ai_strategy_full: { enabled: true, monthlyLimit: 8 },
    site_crawl_small: { enabled: true, monthlyLimit: 4 },
    keyword_research_batch: { enabled: true, monthlyLimit: 50 },
    backlink_snapshot: { enabled: true, monthlyLimit: 4 },
    ai_citation_scan: { enabled: true, monthlyLimit: 10 },
    growth_report: { enabled: true, monthlyLimit: 10 },
    agency_white_label_report: { enabled: false, minimumPlanToUpgrade: 'Agency' },
  },
  Agency: {
    ai_strategy_full: { enabled: true, monthlyLimit: 50 },
    site_crawl_small: { enabled: true, monthlyLimit: 25 },
    keyword_research_batch: { enabled: true, monthlyLimit: 250 },
    backlink_snapshot: { enabled: true, monthlyLimit: 25 },
    ai_citation_scan: { enabled: true, monthlyLimit: 75 },
    growth_report: { enabled: true, monthlyLimit: 50 },
    agency_white_label_report: { enabled: true, monthlyLimit: 25 },
  },
};

export async function getWorkspacePlan(workspaceId: string): Promise<WorkspacePlanContext> {
  // TODO: read from subscriptions/billing tables.
  return { workspaceId, planName: 'Pro', monthlyBaseCredits: 300, cycleEndsAt: new Date(Date.now() + 7 * 86400000) };
}

export async function getPlanLimit(planName: WorkspacePlanContext['planName'], featureKey: FeatureKey): Promise<PlanLimit> {
  return LIMITS[planName]?.[featureKey] ?? { enabled: false, minimumPlanToUpgrade: 'Pro' };
}

export async function getMonthlyFeatureUsage(workspaceId: string, featureKey: FeatureKey): Promise<number> {
  // TODO: SELECT count(*) or sum(quantity) from usage_events for current billing cycle.
  return 0;
}
