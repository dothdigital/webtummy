export type FeatureVisibility = 'hidden_intelligence' | 'visible_module' | 'advanced_agency';
export type Plan = 'starter' | 'pro' | 'agency' | 'enterprise';

export interface CompetitiveFeatureConfig {
  key: string;
  label: string;
  visibility: FeatureVisibility;
  minPlan: Plan;
  creditCost: number;
  requiresApproval: boolean;
  requiresReadiness: string[];
}

export const competitiveFeatures: CompetitiveFeatureConfig[] = [
  {
    key: 'revenue_keyword_score',
    label: 'Revenue-Focused Keyword Scoring',
    visibility: 'hidden_intelligence',
    minPlan: 'starter',
    creditCost: 2,
    requiresApproval: false,
    requiresReadiness: ['project', 'strategy_or_goal']
  },
  {
    key: 'improve_page_stack',
    label: 'Improve This Page Intelligence Stack',
    visibility: 'hidden_intelligence',
    minPlan: 'starter',
    creditCost: 5,
    requiresApproval: true,
    requiresReadiness: ['project', 'page_or_url', 'site_crawl']
  },
  {
    key: 'authority_asset_builder',
    label: 'Authority Asset Builder v1',
    visibility: 'advanced_agency',
    minPlan: 'pro',
    creditCost: 10,
    requiresApproval: true,
    requiresReadiness: ['project', 'strategy', 'keyword_data']
  },
  {
    key: 'ai_citation_gap',
    label: 'AI Citation Competitor Gap v1',
    visibility: 'advanced_agency',
    minPlan: 'pro',
    creditCost: 15,
    requiresApproval: true,
    requiresReadiness: ['project', 'competitors', 'target_ai_queries']
  },
  {
    key: 'community_intelligence',
    label: 'Community Intelligence v1',
    visibility: 'advanced_agency',
    minPlan: 'pro',
    creditCost: 8,
    requiresApproval: true,
    requiresReadiness: ['project', 'niche', 'allowed_sources']
  },
  {
    key: 'moat_tracker',
    label: 'Competitive Moat Tracker v1',
    visibility: 'visible_module',
    minPlan: 'pro',
    creditCost: 3,
    requiresApproval: false,
    requiresReadiness: ['project']
  }
];
