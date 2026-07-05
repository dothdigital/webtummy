-- SEnuke AI Usage, Limits, Credits, and Cost Control Engine
-- PostgreSQL reference schema. Adjust types/names to match the existing codebase.

CREATE TABLE plans (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  monthly_base_credits INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_cost_catalog (
  feature_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider_category TEXT NOT NULL,
  default_credit_cost INTEGER NOT NULL DEFAULT 0,
  cacheable BOOLEAN NOT NULL DEFAULT FALSE,
  cache_ttl_minutes INTEGER,
  queue_by_default BOOLEAN NOT NULL DEFAULT FALSE,
  requires_project BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_feature_limits (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plans(id),
  feature_key TEXT NOT NULL REFERENCES feature_cost_catalog(feature_key),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  monthly_limit INTEGER,
  daily_limit INTEGER,
  included_quantity INTEGER,
  credit_cost_override INTEGER,
  allow_credit_pack_usage BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_plan_to_upgrade TEXT,
  UNIQUE(plan_id, feature_key)
);

CREATE TABLE credit_accounts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES plans(id),
  cycle_start TIMESTAMPTZ NOT NULL,
  cycle_end TIMESTAMPTZ NOT NULL,
  base_credits INTEGER NOT NULL DEFAULT 0,
  bonus_credits INTEGER NOT NULL DEFAULT 0,
  used_credits INTEGER NOT NULL DEFAULT 0,
  reserved_credits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, cycle_start, cycle_end)
);

CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY,
  credit_account_id UUID NOT NULL REFERENCES credit_accounts(id),
  workspace_id UUID NOT NULL,
  user_id UUID,
  project_id UUID,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('grant','debit','reserve','release','refund','purchase','adjustment','expire')),
  amount INTEGER NOT NULL,
  feature_key TEXT,
  usage_event_id UUID,
  job_id UUID,
  idempotency_key TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  user_id UUID NOT NULL,
  project_id UUID,
  feature_key TEXT NOT NULL,
  action_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preflight','reserved','running','completed','failed','refunded','blocked','queued','cached')),
  decision TEXT,
  credits_estimated INTEGER NOT NULL DEFAULT 0,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  credits_actual INTEGER NOT NULL DEFAULT 0,
  provider_cost_estimated_cents INTEGER NOT NULL DEFAULT 0,
  provider_cost_actual_cents INTEGER NOT NULL DEFAULT 0,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  approval_token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, idempotency_key)
);

CREATE TABLE provider_cost_events (
  id UUID PRIMARY KEY,
  usage_event_id UUID NOT NULL REFERENCES usage_events(id),
  provider TEXT NOT NULL,
  model_or_endpoint TEXT,
  units NUMERIC NOT NULL DEFAULT 0,
  unit_type TEXT,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  actual_cost_cents INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cache_records (
  cache_key TEXT PRIMARY KEY,
  feature_key TEXT NOT NULL,
  workspace_id UUID,
  project_id UUID,
  storage_ref TEXT NOT NULL,
  credit_policy TEXT NOT NULL DEFAULT 'free_reuse',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE budget_caps (
  id UUID PRIMARY KEY,
  workspace_id UUID,
  daily_cap_cents INTEGER,
  monthly_cap_cents INTEGER,
  warning_threshold_percent INTEGER NOT NULL DEFAULT 80,
  hard_stop_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_routing_rules (
  id UUID PRIMARY KEY,
  task_type TEXT NOT NULL,
  plan_id UUID REFERENCES plans(id),
  model_tier TEXT NOT NULL CHECK (model_tier IN ('cheap','mid','premium')),
  max_input_tokens INTEGER,
  max_output_tokens INTEGER,
  allow_premium BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(task_type, plan_id)
);
