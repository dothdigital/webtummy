-- SEnuke AI Search Atlas Competitive Gap Launch Add-On v1.0
-- PostgreSQL reference schema. Adapt naming to existing conventions.

CREATE TABLE IF NOT EXISTS seo_fix_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  source_analysis_id UUID,
  affected_url TEXT NOT NULL,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('technical','on_page','content','internal_link','indexability','conversion','schema','performance')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('safe','review_needed','developer_needed','avoid')),
  automation_level TEXT NOT NULL CHECK (automation_level IN ('manual','one_click','integration_required','automated_after_approval')),
  recommended_fix TEXT NOT NULL,
  ai_output_id UUID,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft','needs_review','approved','rejected','executed')),
  credit_cost_estimate INTEGER NOT NULL DEFAULT 0,
  execution_task_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wordpress_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  site_url TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('oauth','application_password','plugin_token','manual_export')),
  connection_status TEXT NOT NULL DEFAULT 'not_connected' CHECK (connection_status IN ('not_connected','pending','connected','failed','revoked')),
  permission_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_publish_mode TEXT NOT NULL DEFAULT 'draft' CHECK (default_publish_mode IN ('draft','pending_review','publish_after_approval')),
  secret_ref TEXT,
  last_connection_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wordpress_publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  integration_id UUID REFERENCES wordpress_integrations(id),
  ai_output_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','page','metadata','block_update')),
  publish_mode TEXT NOT NULL CHECK (publish_mode IN ('draft','pending_review','publish')),
  external_post_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','preflight_failed','running','complete','failed','cancelled')),
  rollback_note TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS local_seo_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  business_name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  primary_phone TEXT,
  address_or_service_area TEXT NOT NULL,
  cities_served JSONB NOT NULL DEFAULT '[]'::jsonb,
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  gbp_status TEXT DEFAULT 'unknown',
  review_goal INTEGER,
  citation_status TEXT DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_visibility_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  query_text TEXT NOT NULL,
  target_brand TEXT NOT NULL,
  target_url TEXT,
  competitors JSONB NOT NULL DEFAULT '[]'::jsonb,
  scan_frequency TEXT NOT NULL DEFAULT 'manual' CHECK (scan_frequency IN ('manual','monthly','weekly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES ai_visibility_queries(id),
  scan_provider TEXT NOT NULL,
  visibility_status TEXT NOT NULL CHECK (visibility_status IN ('visible','not_visible','competitor_visible','citation_gap')),
  cited_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  competitors_visible JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authority_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  opportunity_type TEXT NOT NULL,
  opportunity_url TEXT,
  target_page_url TEXT,
  description TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_label TEXT NOT NULL CHECK (risk_label IN ('safe','review_needed','avoid')),
  estimated_value TEXT NOT NULL CHECK (estimated_value IN ('low','medium','high')),
  outreach_required BOOLEAN NOT NULL DEFAULT false,
  outreach_draft_ai_output_id UUID,
  execution_task_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS white_label_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  agency_name TEXT,
  agency_logo_file_id UUID,
  prepared_by_name TEXT,
  contact_email TEXT,
  footer_disclaimer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  report_type TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'needs_review',
  export_format TEXT NOT NULL CHECK (export_format IN ('pdf','docx','both')),
  output_file_id UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
