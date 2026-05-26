-- 0007 — multi-tenancy completion across the remaining tables.
--
-- 0006 added tenant_id to context_events / runs / agents. This migration
-- finishes the job for the rest of the production tables. Same pattern:
-- ADD COLUMN IF NOT EXISTS with default 'default' so existing rows are
-- backfilled atomically and single-tenant deployments stay unchanged.

ALTER TABLE lineage_edges
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS le_tenant_idx ON lineage_edges (tenant_id);

ALTER TABLE registries
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';

ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';

ALTER TABLE agent_capabilities
  ADD COLUMN IF NOT EXISTS tenant_id varchar(255) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS agent_capabilities_tenant_idx
  ON agent_capabilities (tenant_id);

-- Note: auth_challenges / revoked_tokens / issuance_ledger intentionally
-- omitted. Those are auth-issuer state (per-CP, not per-tenant) — a
-- token's tenant is encoded in its claims, not in the issuer's bookkeeping.
