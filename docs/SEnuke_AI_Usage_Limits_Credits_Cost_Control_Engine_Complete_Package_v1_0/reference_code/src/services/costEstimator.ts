import { FeatureCost } from './featureCostCatalog';

export interface CostEstimate {
  estimatedCredits: number;
  estimatedProviderCostCents: number;
  recommendedMode: 'instant' | 'queued' | 'cached' | 'sample';
}

export function estimateActionCost(feature: FeatureCost, params: Record<string, unknown>): CostEstimate {
  let credits = feature.defaultCreditCost;

  // Examples of parameter-based scaling. Replace with real formulas per provider.
  if (feature.featureKey === 'site_crawl_small') {
    const pageLimit = Number(params.pageLimit ?? 100);
    credits = pageLimit <= 100 ? 25 : Math.ceil(pageLimit / 100) * 25;
  }

  if (feature.featureKey === 'ai_citation_scan') {
    const queryCount = Number(params.queryCount ?? 1);
    credits = Math.max(10, queryCount * 2);
  }

  const providerCostCents = Math.ceil(credits * 12); // Placeholder internal estimate.
  return {
    estimatedCredits: credits,
    estimatedProviderCostCents: providerCostCents,
    recommendedMode: feature.queueByDefault ? 'queued' : 'instant',
  };
}
