-- SEnuke AI Competitive SEO and Growth Intelligence Add-On v1.0
-- PostgreSQL reference schema

CREATE TABLE competitive_intelligence_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  feature_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER DEFAULT 0,
  actual_cost_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE keyword_revenue_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  keyword TEXT NOT NULL,
  search_volume INTEGER,
  difficulty NUMERIC,
  buyer_intent_score NUMERIC,
  offer_fit_score NUMERIC,
  authority_gap_score NUMERIC,
  ai_citation_potential_score NUMERIC,
  revenue_opportunity_score NUMERIC NOT NULL,
  recommendation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE page_growth_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  page_id UUID,
  url TEXT,
  proof_gap_score NUMERIC,
  monetization_fit_score NUMERIC,
  refresh_priority_score NUMERIC,
  internal_link_opportunity_score NUMERIC,
  ai_citation_potential_score NUMERIC,
  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE authority_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  risk_score NUMERIC DEFAULT 0,
  priority_score NUMERIC DEFAULT 0,
  execution_task_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_citation_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  query TEXT NOT NULL,
  competitor_url TEXT,
  cited_page_url TEXT,
  gap_summary TEXT,
  recommended_fixes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE community_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  insight_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  suggested_action TEXT,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE intent_drift_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  keyword TEXT NOT NULL,
  serp_snapshot JSONB NOT NULL,
  result_format_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  intent_class TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moat_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  topical_coverage_score NUMERIC,
  authority_asset_score NUMERIC,
  brand_entity_score NUMERIC,
  ai_citation_score NUMERIC,
  conversion_asset_score NUMERIC,
  community_signal_score NUMERIC,
  total_moat_score NUMERIC NOT NULL,
  recommended_next_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
