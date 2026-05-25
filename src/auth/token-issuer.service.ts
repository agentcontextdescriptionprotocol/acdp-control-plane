/**
 * Token issuer — the IdP role for the control plane (V2 Seam foundation).
 *
 * Orchestrates:
 *   1. issueChallenge() — mint a one-shot nonce + canonical signing input
 *   2. issueToken()     — verify the agent's Ed25519 signature over the
 *                         signing input, then mint an HS256 JWT whose
 *                         claim shape matches the registry's BearerClaims
 *                         (so consumers can validate either issuer's
 *                         tokens with the same code path in V2).
 *   3. verifyJwt()      — verify signature + consult the revocation
 *                         repository so admin-revoked tokens are
 *                         rejected even before they naturally expire.
 *
 * Splitting the orchestration out of the controller keeps validation
 * decisions testable without spinning up the HTTP layer.
 */
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';

import { AppConfigService } from '../config/app-config.service';
import { ChallengeStore, ChallengeRecord } from './challenge-store.service';
import { PinnedKeysService } from './pinned-keys.service';
import {
  REVOCATION_REPOSITORY,
  RevocationRepository,
} from './revocation-repository';
import { verifyEd25519 } from './ed25519';

export interface IssuedToken {
  token: string;
  tokenType: string;
  expiresAt: number;
}

export interface AcdpBearerClaims {
  iss: string;
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  acdp: { registry: string; key_id: string };
}

@Injectable()
export class TokenIssuer {
  private readonly logger = new Logger(TokenIssuer.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly challenges: ChallengeStore,
    private readonly pinned: PinnedKeysService,
    @Optional()
    @Inject(REVOCATION_REPOSITORY)
    private readonly revocations: RevocationRepository | null = null,
  ) {}

  // ── Step 1 — challenge ────────────────────────────────────────────────

  async issueChallenge(agentDid: string): Promise<ChallengeRecord> {
    return this.challenges.issue(
      agentDid,
      this.config.jwtAuthority,
      this.config.challengeTtlSeconds,
    );
  }

  // ── Step 2 — token ────────────────────────────────────────────────────

  async issueToken(req: {
    agentDid: string;
    keyId: string;
    nonce: string;
    expiresAt: number;
    algorithm: string;
    signature: string;
  }): Promise<IssuedToken> {
    if (req.algorithm !== 'ed25519') {
      throw new BadRequestException(
        `Unsupported signature algorithm: '${req.algorithm}'`,
      );
    }

    // Consume the challenge — this also enforces single-use replay
    // defense and TTL expiry (atomic via DELETE..RETURNING when on
    // Postgres, so two concurrent /auth/token calls can't both win).
    const record = await this.challenges.consume(req.nonce);
    if (!record) {
      throw new UnauthorizedException(
        'Unknown, expired, or already-used nonce',
      );
    }

    // Cross-check the claimed agent_did matches the one that requested
    // the challenge. If a caller could swap agent_id between
    // challenge and token, they could impersonate any pinned identity.
    if (record.agentDid !== req.agentDid) {
      throw new UnauthorizedException(
        `agent_id does not match challenge owner: ` +
          `challenge=${record.agentDid} got=${req.agentDid}`,
      );
    }
    if (record.expiresAt !== req.expiresAt) {
      throw new UnauthorizedException(
        `expires_at does not match challenge: ` +
          `challenge=${record.expiresAt} got=${req.expiresAt}`,
      );
    }

    // Resolve the public key. V1 uses the static pinned directory;
    // V2 will plug in did:web / DID-resolver here.
    const pinned = this.pinned.get(req.agentDid);
    if (!pinned) {
      throw new UnauthorizedException(
        `agent_did '${req.agentDid}' has no pinned public key on this control plane`,
      );
    }

    // Verify the signature over the canonical signing input.
    const ok = verifyEd25519(pinned.publicKey, record.signingInput, req.signature);
    if (!ok) {
      throw new UnauthorizedException('Signature verification failed');
    }

    // Mint the JWT.
    return this.mintJwt(req.agentDid, req.keyId);
  }

  // ── verify (for downstream guards / federation experiments) ──────────

  async verifyJwt(token: string): Promise<AcdpBearerClaims> {
    let decoded: AcdpBearerClaims;
    try {
      decoded = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: this.config.jwtAuthority,
      }) as AcdpBearerClaims;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new UnauthorizedException(`JWT verification failed: ${msg}`);
    }

    // Revocation check — short-circuits even when the JWT's own `exp`
    // hasn't passed. Optional dep: in the tiny config that disables
    // the revocation repository, we skip the check (and accept the
    // V1 behavior of "tokens are valid until they expire").
    if (this.revocations) {
      const revoked = await this.revocations.isRevoked(decoded.jti);
      if (revoked) {
        throw new UnauthorizedException(`token jti=${decoded.jti} has been revoked`);
      }
    }

    return decoded;
  }

  /**
   * Decode a JWT without verifying — used by the revoke endpoint to
   * extract `jti`/`sub`/`exp` so we can persist the revocation even
   * if the token has already expired (operators may want the audit
   * trail). Callers MUST verify separately before trusting claims.
   */
  decodeJwt(token: string): AcdpBearerClaims | null {
    try {
      const decoded = jwt.decode(token);
      if (decoded && typeof decoded === 'object') {
        return decoded as AcdpBearerClaims;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── internals ────────────────────────────────────────────────────────

  private mintJwt(agentDid: string, keyId: string): IssuedToken {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.config.jwtTtlSeconds;
    const claims: AcdpBearerClaims = {
      iss: this.config.jwtAuthority,
      sub: agentDid,
      jti: randomBytes(12).toString('base64url'),
      iat: now,
      exp,
      acdp: {
        registry: this.config.jwtAuthority,
        key_id: keyId,
      },
    };
    const opts: SignOptions = { algorithm: 'HS256', noTimestamp: true };
    const token = jwt.sign(claims, this.config.jwtSecret, opts);
    return { token, tokenType: 'Bearer', expiresAt: exp };
  }
}
