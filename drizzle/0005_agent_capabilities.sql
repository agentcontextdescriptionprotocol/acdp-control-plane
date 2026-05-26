-- 0005 — agent capability declarations (#4).
--
-- Each row is a self-declared `(agent_did, capability_uri)` pairing
-- backed by an Ed25519 signature over the canonical assertion:
--
--   acdp-cap:v1:<agent_did>:<capability_uri>:<declared_at_iso>
--
-- The signature gates the write so a third party can't grant
-- themselves capabilities they don't control.

CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_did       text         NOT NULL,
  capability_uri  text         NOT NULL,
  declared_at     timestamptz  NOT NULL DEFAULT now(),
  signed_by       text         NOT NULL,
  signature       text         NOT NULL,
  PRIMARY KEY (agent_did, capability_uri)
);

CREATE INDEX IF NOT EXISTS agent_capabilities_capability_idx
  ON agent_capabilities (capability_uri);
