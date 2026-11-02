import { FeatureKey, ProviderCategory } from '../types';

export interface FeatureCost {
  featureKey: FeatureKey;
  displayName: string;
  providerCategory: ProviderCategory;
  defaultCreditCost: number;
  cacheable: boolean;
  cacheTtlMinutes?: number;
  queueByDefault?: boolean;
  requiresProject?: boolean;
}

// Replace with database-backed configuration in production.
export const FEATURE_COSTS: Record<string, FeatureCost> = {
  ai_rewrite_quick: { featureKey: 'ai_rewrite_quick', displayName: 'Quick AI Rewrite', providerCategory: 'ai', defaultCreditCost: 1, cacheable: false },
  ai_strategy_full: { featureKey: 'ai_strategy_full', displayName: 'Full AI Strategy', providerCategory: 'ai', defaultCreditCost: 20, cacheable: true, cacheTtlMinutes: 43200, queueByDefault: true, requiresProject: true },
  site_crawl_small: { featureKey: 'site_crawl_small', displayName: 'Site Crawl up to 100 Pages', providerCategory: 'crawl', defaultCreditCost: 25, cacheable: true, cacheTtlMinutes: 10080, queueByDefault: true, requiresProject: true },
  keyword_research_batch: { featureKey: 'keyword_research_batch', displayName: 'Keyword Research Batch', providerCategory: 'keyword', defaultCreditCost: 10, cacheable: true, cacheTtlMinutes: 10080, requiresProject: true },
  backlink_snapshot: { featureKey: 'backlink_snapshot', displayName: 'Backlink Snapshot', providerCategory: 'backlink', defaultCreditCost: 30, cacheable: true, cacheTtlMinutes: 20160, queueByDefault: true, requiresProject: true },
  ai_citation_scan: { featureKey: 'ai_citation_scan', displayName: 'AI Citation Scan', providerCategory: 'citation', defaultCreditCost: 10, cacheable: true, cacheTtlMinutes: 10080, queueByDefault: true, requiresProject: true },
  growth_report: { featureKey: 'growth_report', displayName: 'Growth Report', providerCategory: 'report', defaultCreditCost: 15, cacheable: true, cacheTtlMinutes: 43200, queueByDefault: true, requiresProject: true },
  agency_white_label_report: { featureKey: 'agency_white_label_report', displayName: 'Agency White-Label Report', providerCategory: 'report', defaultCreditCost: 40, cacheable: true, cacheTtlMinutes: 43200, queueByDefault: true, requiresProject: true },
};

export function getFeatureCost(featureKey: FeatureKey): FeatureCost {
  const feature = FEATURE_COSTS[featureKey];
  if (!feature) throw new Error(`Unknown feature cost: ${featureKey}`);
  return feature;
}
