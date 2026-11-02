export type FeatureKey =
  | 'ai_strategy_full'
  | 'ai_rewrite_quick'
  | 'ai_page_generate'
  | 'site_crawl_small'
  | 'keyword_research_batch'
  | 'rank_tracking_keyword_weekly'
  | 'backlink_snapshot'
  | 'ai_citation_scan'
  | 'growth_diagnosis'
  | 'growth_report'
  | 'agency_white_label_report'
  | string;

export type ProviderCategory = 'ai' | 'serp' | 'keyword' | 'crawl' | 'backlink' | 'citation' | 'social' | 'report' | 'storage';

export interface PreflightRequest {
  workspaceId: string;
  userId: string;
  projectId?: string;
  featureKey: FeatureKey;
  actionParameters: Record<string, unknown>;
  idempotencyKey: string;
  requestedMode?: 'instant' | 'queued' | 'cached' | 'sample' | 'full';
  userConfirmedCreditUse?: boolean;
}

export interface PreflightDecision {
  allowed: boolean;
  decision: 'allow' | 'block_limit' | 'block_plan' | 'block_budget' | 'use_cache' | 'queue' | 'require_confirm' | 'require_upgrade';
  message: string;
  estimatedCredits: number;
  remainingCreditsAfterAction?: number;
  approvalToken?: string;
  usageEventId?: string;
  cacheRecordId?: string;
  upgradePlanSuggestion?: string;
  creditPackSuggestion?: string;
}

export interface UsageCommitRequest {
  usageEventId: string;
  approvalToken: string;
  status: 'completed' | 'failed' | 'cached';
  actualCredits?: number;
  actualProviderCostCents?: number;
  providerEvents?: ProviderCostEvent[];
}

export interface ProviderCostEvent {
  provider: string;
  modelOrEndpoint?: string;
  units: number;
  unitType?: string;
  estimatedCostCents?: number;
  actualCostCents?: number;
  metadata?: Record<string, unknown>;
}
