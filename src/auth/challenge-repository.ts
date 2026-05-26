/**
 * Storage abstraction for challenge nonces.
 *
 * The control plane mints a nonce on `POST /auth/challenge` and consumes
 * it atomically on `POST /auth/token`. Two implementations are wired
 * up by `AuthModule` based on the `AUTH_PERSISTENCE` env var:
 *
 *   - `memory`   — process-local Map; correct for a single-process
 *                  deployment (default).
 *   - `postgres` — Drizzle-backed `auth_challenges` table; required
 *                  for multi-instance deployments so two instances
 *                  can't both consume the same nonce.
 *
 * The Postgres implementation uses `DELETE ... RETURNING` for `take()`
 * so the consume operation is atomic at the database level — no
 * application-level locking required.
 */

export interface ChallengeRecord {
  nonce: string;
  agentDid: string;
  registryAuthority: string;
  signingInput: string;
  /** Unix seconds. */
  expiresAt: number;
}

export interface ChallengeRepository {
  /** Persist a freshly-issued challenge. */
  put(record: ChallengeRecord): Promise<void>;

  /**
   * Consume a nonce atomically. Returns the record if present and not
   * yet expired (caller still re-checks `expiresAt` against the request
   * `expires_at` for cross-tamper detection), or null otherwise.
   *
   * Must be safe under concurrent invocation for the same nonce — only
   * one caller should observe a non-null return.
   */
  take(nonce: string): Promise<ChallengeRecord | null>;

  /** Best-effort sweep of expired records. */
  evictExpired(): Promise<number>;

  /** Live entry count (for diagnostics; may approximate). */
  size(): Promise<number>;
}

/** Symbol token for NestJS DI. */
export const CHALLENGE_REPOSITORY = Symbol('CHALLENGE_REPOSITORY');
