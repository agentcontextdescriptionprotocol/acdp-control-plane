-- 0003 — persistent auth stores (challenges + revoked tokens)
--
-- Replaces the in-memory ChallengeStore for multi-instance deployments
-- and adds the V2 revocation list consulted by TokenIssuer.verifyJwt.

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce              varchar(64)  PRIMARY KEY,
  agent_did          text         NOT NULL,
  registry_authority varchar(255) NOT NULL,
  signing_input      text         NOT NULL,
  expires_at         bigint       NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_challenges_expires_idx
  ON auth_challenges (expires_at);
CREATE INDEX IF NOT EXISTS auth_challenges_agent_idx
  ON auth_challenges (agent_did);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        varchar(64) PRIMARY KEY,
  sub        text         NOT NULL,
  iss        text         NOT NULL,
  exp        bigint       NOT NULL,
  revoked_at timestamptz  NOT NULL DEFAULT now(),
  revoked_by text         NOT NULL,
  reason     varchar(64)
);

CREATE INDEX IF NOT EXISTS revoked_tokens_exp_idx
  ON revoked_tokens (exp);
CREATE INDEX IF NOT EXISTS revoked_tokens_sub_idx
  ON revoked_tokens (sub);
