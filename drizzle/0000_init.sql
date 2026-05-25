CREATE TABLE IF NOT EXISTS context_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(64) NOT NULL,
  event_ts timestamptz NOT NULL,
  run_id varchar(255),
  ctx_id text,
  lineage_id text,
  agent_id text NOT NULL,
  context_type varchar(128),
  visibility varchar(32),
  version integer,
  derived_from jsonb NOT NULL DEFAULT '[]'::jsonb,
  registry_authority varchar(255) NOT NULL,
  scenario_id varchar(128),
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  run_id varchar(255) PRIMARY KEY,
  scenario_id varchar(128) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  inputs jsonb,
  result jsonb,
  contexts_count integer NOT NULL DEFAULT 0,
  registries jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lineage_edges (
  from_ctx_id text NOT NULL,
  to_ctx_id text NOT NULL,
  run_id varchar(255),
  PRIMARY KEY (from_ctx_id, to_ctx_id)
);

CREATE TABLE IF NOT EXISTS agents (
  agent_did text PRIMARY KEY,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  registry_authority varchar(255),
  context_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  secret varchar(255) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event varchar(128) NOT NULL,
  run_id varchar(255) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  response_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
