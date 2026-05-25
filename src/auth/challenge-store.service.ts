/**
 * In-memory challenge store with TTL eviction.
 *
 * Stores `(nonce → { agentDid, signingInput, expiresAt })` for the
 * window between `POST /auth/challenge` and `POST /auth/token`. A
 * second use of the same nonce is rejected (replay defense), and
 * entries older than their TTL are evicted lazily on each access.
 *
 * V1 single-process. A multi-instance deployment should swap this for
 * a Redis/Postgres-backed implementation behind the same interface.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export interface ChallengeRecord {
  nonce: string;
  agentDid: string;
  registryAuthority: string;
  signingInput: string;
  /** Unix seconds. */
  expiresAt: number;
}

@Injectable()
export class ChallengeStore {
  private readonly logger = new Logger(ChallengeStore.name);
  private readonly store = new Map<string, ChallengeRecord>();

  /** Mint a fresh challenge for an agent. */
  issue(
    agentDid: string,
    registryAuthority: string,
    ttlSeconds: number,
  ): ChallengeRecord {
    this.evictExpired();
    const nonce = randomBytes(16).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signingInput = signingInputFor(
      nonce,
      agentDid,
      registryAuthority,
      expiresAt,
    );
    const record: ChallengeRecord = {
      nonce,
      agentDid,
      registryAuthority,
      signingInput,
      expiresAt,
    };
    this.store.set(nonce, record);
    return record;
  }

  /**
   * Consume a challenge — returns the record and removes it.
   *
   * Returns `null` when the nonce is unknown, expired, or already
   * consumed. The single-use property is what defends against replay.
   */
  consume(nonce: string): ChallengeRecord | null {
    const rec = this.store.get(nonce);
    if (!rec) return null;
    this.store.delete(nonce);
    if (rec.expiresAt < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return rec;
  }

  size(): number {
    this.evictExpired();
    return this.store.size;
  }

  private evictExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [nonce, rec] of this.store) {
      if (rec.expiresAt < now) this.store.delete(nonce);
    }
  }
}

/**
 * Canonical signing input shared with the registry.
 *
 * Mirrors `AuthChallenge::signing_input` in
 * `acdp-registry-types/src/auth.rs`. Keep the prefix and field order
 * in sync between the two implementations.
 */
export function signingInputFor(
  nonce: string,
  agentDid: string,
  authority: string,
  expiresAt: number,
): string {
  return `acdp-registry-auth:v1:${nonce}:${agentDid}:${authority}:${expiresAt}`;
}
