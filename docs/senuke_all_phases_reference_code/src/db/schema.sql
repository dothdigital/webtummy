-- SEnuke AI - AI Growth Operating System reference schema.
-- This schema favors clarity over vendor-specific optimizations.
-- Developers can convert this to Prisma, Drizzle, Laravel migrations, Django models, etc.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  workspace_type TEXT NOT NULL CHECK (workspace_type IN ('personal','business','agency')),
  plan_code TEXT NOT NULL DEFAULT 'starter',
  subscription_status TEXT NOT NULL DEFAULT 'trial',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_name TEXT NOT NULL,
  project_type TEXT NOT NULL CHECK (project_type IN ('new_business','existing_website','agency_client','ecommerce')),
  status TEXT NOT NULL DEFAULT 'active',
  business_name TEXT,
  website_url TEXT,
  niche TEXT,
  target_location TEXT,
  primary_goal TEXT,
  preferred_publishing_method TEXT,
  current_step TEXT NOT NULL DEFAULT 'intake',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_intake_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answer_value JSONB NOT NULL,
  answer_type TEXT NOT NULL DEFAULT 'text',
  module_context TEXT NOT NULL DEFAULT 'core_intake',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, question_key)
);

CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  business_summary TEXT,
  target_audience TEXT,
  offer_summary TEXT,
  business_model TEXT,
  strengths JSONB DEFAULT '[]'::jsonb,
  constraints JSONB DEFAULT '[]'::jsonb,
  budget_level TEXT,
  skill_level TEXT,
  tone_preference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_snapshot_json JSONB NOT NULL,
  output_json JSONB,
  output_text TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  token_usage JSONB,
  cost_estimate NUMERIC(12,6),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_plan_id UUID NOT NULL REFERENCES execution_plans(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  task_title TEXT NOT NULL,
  task_description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'not_started',
  automation_level TEXT NOT NULL DEFAULT 'recommend',
  ai_can_execute BOOLEAN NOT NULL DEFAULT false,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  requires_integration BOOLEAN NOT NULL DEFAULT false,
  manual_required BOOLEAN NOT NULL DEFAULT false,
  integration_type TEXT,
  related_asset_id UUID,
  related_page_id UUID,
  action_button_label TEXT,
  manual_instructions TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  due_stage TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  opportunity_name TEXT NOT NULL,
  target_audience TEXT,
  problem_solved TEXT,
  recommended_offer TEXT,
  business_model TEXT,
  opportunity_score INT,
  seo_score INT,
  competition_score INT,
  monetization_score INT,
  execution_score INT,
  user_fit_score INT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id),
  strategy_summary TEXT,
  positioning_statement TEXT,
  audience_profile TEXT,
  offer_recommendation TEXT,
  business_model TEXT,
  seo_strategy TEXT,
  ai_citation_strategy TEXT,
  content_strategy TEXT,
  authority_strategy TEXT,
  social_strategy TEXT,
  publishing_strategy TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS keyword_research_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual','automated','import')),
  seed_keywords JSONB DEFAULT '[]'::jsonb,
  provider_name TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  research_run_id UUID REFERENCES keyword_research_runs(id),
  keyword TEXT NOT NULL,
  normalized_keyword TEXT NOT NULL,
  search_volume INT,
  difficulty NUMERIC(5,2),
  cpc NUMERIC(10,2),
  search_intent TEXT,
  funnel_stage TEXT,
  business_value INT,
  priority INT,
  recommended_page_slug TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_analysis_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  analysis_type TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'queued',
  score_overall INT,
  score_seo INT,
  score_content INT,
  score_ai_citation INT,
  score_technical INT,
  score_authority INT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id UUID REFERENCES keywords(id),
  keyword TEXT NOT NULL,
  url TEXT,
  rank_position INT,
  search_engine TEXT NOT NULL DEFAULT 'google',
  location TEXT,
  device TEXT DEFAULT 'desktop',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backlink_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_run_id UUID REFERENCES site_analysis_runs(id),
  referring_domains INT,
  backlinks_total INT,
  dofollow_links INT,
  nofollow_links INT,
  top_anchor_text JSONB DEFAULT '[]'::jsonb,
  top_linked_pages JSONB DEFAULT '[]'::jsonb,
  provider_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_citation_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_url TEXT,
  query TEXT NOT NULL,
  citation_readiness_score INT,
  entity_clarity_score INT,
  answer_quality_score INT,
  source_structure_score INT,
  recommendations JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_architectures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  strategy_plan_id UUID REFERENCES strategy_plans(id),
  site_type TEXT NOT NULL,
  sitemap_json JSONB DEFAULT '[]'::jsonb,
  navigation_json JSONB DEFAULT '[]'::jsonb,
  homepage_structure_json JSONB DEFAULT '[]'::jsonb,
  conversion_flow_json JSONB DEFAULT '[]'::jsonb,
  internal_linking_plan_json JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_architecture_id UUID REFERENCES site_architectures(id),
  page_type TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  seo_title TEXT,
  meta_description TEXT,
  h1 TEXT,
  content_json JSONB DEFAULT '{}'::jsonb,
  html_content TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_text TEXT,
  content_json JSONB DEFAULT '{}'::jsonb,
  file_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS domain_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain_name TEXT NOT NULL,
  tld TEXT NOT NULL,
  score INT,
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  estimated_price NUMERIC(10,2),
  registrar_provider TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS domain_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain_name TEXT NOT NULL,
  registrar_provider TEXT NOT NULL,
  registration_status TEXT NOT NULL DEFAULT 'pending_approval',
  registration_order_id TEXT,
  expires_at TIMESTAMPTZ,
  dns_status TEXT NOT NULL DEFAULT 'not_configured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publishing_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_name TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'not_connected',
  config_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  publishing_target_id UUID REFERENCES publishing_targets(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  output_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_name TEXT,
  auth_status TEXT NOT NULL DEFAULT 'not_connected',
  encrypted_credentials TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  post_text TEXT NOT NULL,
  post_json JSONB DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  external_post_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_mentions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_id TEXT,
  author_name TEXT,
  mention_text TEXT,
  sentiment TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  suggested_reply TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON execution_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_keywords_project ON keywords(project_id);
CREATE INDEX IF NOT EXISTS idx_rank_project_keyword ON rank_snapshots(project_id, keyword);
CREATE INDEX IF NOT EXISTS idx_social_posts_project ON social_posts(project_id);
