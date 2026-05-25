/**
 * Storage abstraction for revoked-token records.
 *
 * A JWT whose `jti` lives in this store is treated as invalid by
 * `TokenIssuer.verifyJwt` (and any downstream guards that consult the
 * repository) even if its `exp` hasn't passed. Once `exp` passes,
 * ordinary JWT verification rejects the token anyway, so the entry
 * becomes safe to evict — the `RevocationSweeper` runs that cleanup.
 *
 * Two implementations are wired up by `AuthModule` based on the
 * `AUTH_PERSISTENCE` env var, mirroring the challenge store choice.
 */

export type RevocationReason =
  | 'user_logout'
  | 'admin_revoke'
  | 'key_rotation'
  | 'security_incident'
  | 'unspecified';

export interface RevocationRecord {
  jti: string;
  sub: string;
  iss: string;
  /** Unix seconds. */
  exp: number;
  revokedBy: string;
  reason: RevocationReason;
  revokedAt?: Date;
}

export interface RevocationRepository {
  /**
   * Mark a token as revoked. Returns true if the token was newly
   * revoked, false if it was already in the store (idempotent).
   */
  revoke(record: RevocationRecord): Promise<boolean>;

  /** Return true if the `jti` is currently revoked. */
  isRevoked(jti: string): Promise<boolean>;

  /** Look up a revocation record (for introspection / audit). */
  get(jti: string): Promise<RevocationRecord | null>;

  /** Best-effort sweep of records whose `exp` has passed. */
  evictExpired(): Promise<number>;

  /** Live entry count (for diagnostics). */
  size(): Promise<number>;
}

export const REVOCATION_REPOSITORY = Symbol('REVOCATION_REPOSITORY');
