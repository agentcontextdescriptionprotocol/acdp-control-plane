/**
 * Challenge orchestration — generates nonces and the canonical signing
 * input, then delegates persistence to a `ChallengeRepository` (memory
 * or Postgres, picked at boot by `AuthModule`).
 *
 * Public API kept stable: `TokenIssuer` calls `issue(...)` and
 * `consume(...)` exactly as before, but the storage layer is now
 * pluggable so a multi-instance control plane can share state.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CHALLENGE_REPOSITORY,
  ChallengeRecord,
  ChallengeRepository,
} from './challenge-repository';

// Re-export for backwards compatibility with existing imports.
export type { ChallengeRecord } from './challenge-repository';

@Injectable()
export class ChallengeStore {
  private readonly logger = new Logger(ChallengeStore.name);

  constructor(
    @Inject(CHALLENGE_REPOSITORY)
    private readonly repo: ChallengeRepository,
  ) {}

  /** Mint a fresh challenge for an agent and persist it. */
  async issue(
    agentDid: string,
    registryAuthority: string,
    ttlSeconds: number,
  ): Promise<ChallengeRecord> {
    const nonce = randomBytes(16).toString('base64url');
    const expiresAt = nowSeconds() + ttlSeconds;
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
    await this.repo.put(record);
    return record;
  }

  /**
   * Consume a challenge — returns the record and removes it.
   *
   * Returns `null` when the nonce is unknown, expired, or already
   * consumed. The atomicity of the underlying `take()` is what defends
   * against replay across concurrent /auth/token calls in a
   * multi-instance deployment.
   */
  async consume(nonce: string): Promise<ChallengeRecord | null> {
    return this.repo.take(nonce);
  }

  /** Visible for diagnostics / tests. */
  async size(): Promise<number> {
    return this.repo.size();
  }

  /** Visible for the sweeper service. */
  async evictExpired(): Promise<number> {
    return this.repo.evictExpired();
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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
