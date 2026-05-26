-- 0003 — token-issuance audit ledger.
--
-- Append-only. Every challenge → token attempt records one row:
--   - `decision='mint'`         when a JWT was issued.
--   - `decision='reject_*'`     when validation rejected the request
--                               (one row per discriminator; see
--                               IssuanceDecision in code).
--
-- `prev_hash` / `entry_hash` form a SHA-256 hash chain in `id` order.
-- A post-hoc surgical edit to a row breaks the chain at audit time.

CREATE TABLE IF NOT EXISTS issuance_ledger (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  jti             varchar(64),
  sub             text,
  iss             text,
  iat             bigint,
  exp             bigint,
  signer_ip       varchar(64),
  decision        varchar(32)  NOT NULL,
  decision_detail text,
  prev_hash       varchar(64),
  entry_hash      varchar(64),
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issuance_ledger_sub_idx       ON issuance_ledger (sub);
CREATE INDEX IF NOT EXISTS issuance_ledger_jti_idx       ON issuance_ledger (jti);
CREATE INDEX IF NOT EXISTS issuance_ledger_decision_idx  ON issuance_ledger (decision);
CREATE INDEX IF NOT EXISTS issuance_ledger_created_idx   ON issuance_ledger (created_at);
