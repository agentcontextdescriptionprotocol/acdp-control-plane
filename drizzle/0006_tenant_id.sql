-- 0006 — multi-tenancy foundation (#6).
--
-- Adds a `tenant_id` column to every core table with default 'default',
-- so existing single-tenant deployments keep working unchanged. New
-- writes inherit the request's tenant via repository updates landing
-- in this same PR (or follow-ups for the repositories not yet touched).
--
-- Indexes added on tenant_id for efficient WHERE tenant_id=... lookups.

ALTER TABLE context_events
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS ce_tenant_idx ON context_events (tenant_id);

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS runs_tenant_idx ON runs (tenant_id);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';

-- Other tables (lineage_edges, registries, webhooks, webhook_deliveries,
-- and the auth tables landing on other branches) get tenant_id in
-- follow-up PRs. This migration intentionally limits blast radius to the
-- three tables actively gated by the repositories updated in this PR,
-- so the migration can't fail mid-way and leave the schema half-tagged.
