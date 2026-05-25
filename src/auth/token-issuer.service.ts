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
 *
 * Every decision point in `issueToken` writes one row to the
 * `IssuanceLedgerService` so compliance auditors have a complete
 * record of who requested what, when, from where, and why we
 * accepted or rejected.
 *
 * Splitting the orchestration out of the controller keeps validation
 * decisions testable without spinning up the HTTP layer.
 */
import {
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
import { IssuanceLedgerService } from './issuance-ledger.service';
import { PinnedKeysService } from './pinned-keys.service';
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

/**
 * Caller context for issueToken — currently just the actor IP for
 * audit. Other fields (user-agent, request id) can be added without
 * breaking callers because the type is structural.
 */
export interface IssueTokenContext {
  signerIp?: string;
}

@Injectable()
export class TokenIssuer {
  private readonly logger = new Logger(TokenIssuer.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly challenges: ChallengeStore,
    private readonly pinned: PinnedKeysService,
    @Optional() private readonly ledger: IssuanceLedgerService | null = null,
  ) {}

  // ── Step 1 — challenge ────────────────────────────────────────────────

  issueChallenge(agentDid: string): ChallengeRecord {
    return this.challenges.issue(
      agentDid,
      this.config.jwtAuthority,
      this.config.challengeTtlSeconds,
    );
  }

  // ── Step 2 — token ────────────────────────────────────────────────────

  issueToken(
    req: {
      agentDid: string;
      keyId: string;
      nonce: string;
      expiresAt: number;
      algorithm: string;
      signature: string;
    },
    ctx: IssueTokenContext = {},
  ): IssuedToken {
    if (req.algorithm !== 'ed25519') {
      this.ledger?.record({
        sub: req.agentDid,
        iss: this.config.jwtAuthority,
        signerIp: ctx.signerIp,
        decision: 'reject_alg',
        decisionDetail: `algorithm=${req.algorithm}`,
      });
      throw new BadRequestException(
        `Unsupported signature algorithm: '${req.algorithm}'`,
      );
    }

    // Consume the challenge — this also enforces single-use replay
    // defense and TTL expiry.
    const record = this.challenges.consume(req.nonce);
    if (!record) {
      this.ledger?.record({
        sub: req.agentDid,
        iss: this.config.jwtAuthority,
        signerIp: ctx.signerIp,
        decision: 'reject_nonce',
        decisionDetail: 'unknown, expired, or already-used',
      });
      throw new UnauthorizedException(
        'Unknown, expired, or already-used nonce',
      );
    }

    // Cross-check the claimed agent_did matches the one that requested
    // the challenge. If a caller could swap agent_id between
    // challenge and token, they could impersonate any pinned identity.
    if (record.agentDid !== req.agentDid) {
      this.ledger?.record({
        sub: req.agentDid,
        iss: this.config.jwtAuthority,
        signerIp: ctx.signerIp,
        decision: 'reject_agent_mismatch',
        decisionDetail: `challenge=${record.agentDid} got=${req.agentDid}`,
      });
      throw new UnauthorizedException(
        `agent_id does not match challenge owner: ` +
          `challenge=${record.agentDid} got=${req.agentDid}`,
      );
    }
    if (record.expiresAt !== req.expiresAt) {
      this.ledger?.record({
        sub: req.agentDid,
        iss: this.config.jwtAuthority,
        signerIp: ctx.signerIp,
        decision: 'reject_expires_mismatch',
        decisionDetail: `challenge=${record.expiresAt} got=${req.expiresAt}`,
      });
      throw new UnauthorizedException(
        `expires_at does not match challenge: ` +
          `challenge=${record.expiresAt} got=${req.expiresAt}`,
      );
    }

    // Resolve the public key. V1 uses the static pinned directory;
    // V2 will plug in did:web / DID-resolver here.
    const pinned = this.pinned.get(req.agentDid);
    if (!pinned) {
      this.ledger?.record({
        sub: req.agentDid,
        iss: this.config.jwtAuthority,
        signerIp: ctx.signerIp,
        decision: 'reject_unpinned',
      });
      throw new UnauthorizedException(
        `agent_did '${req.agentDid}' has no pinned public key on this control plane`,
      );
    }

    // Verify the signature over the canonical signing input.
    const ok = verifyEd25519(pinned.publicKey, record.signingInput, req.signature);
    if (!ok) {
      this.ledger?.record({
        sub: req.agentDid,
        iss: this.config.jwtAuthority,
        signerIp: ctx.signerIp,
        decision: 'reject_signature',
      });
      throw new UnauthorizedException('Signature verification failed');
    }

    // Mint the JWT.
    const issued = this.mintJwt(req.agentDid, req.keyId);
    const decoded = jwt.decode(issued.token) as AcdpBearerClaims;
    this.ledger?.record({
      jti: decoded.jti,
      sub: decoded.sub,
      iss: decoded.iss,
      iat: decoded.iat,
      exp: decoded.exp,
      signerIp: ctx.signerIp,
      decision: 'mint',
      decisionDetail: `key_id=${req.keyId}`,
    });
    return issued;
  }

  // ── verify (for downstream guards / federation experiments) ──────────

  verifyJwt(token: string): AcdpBearerClaims {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: this.config.jwtAuthority,
      });
      return decoded as AcdpBearerClaims;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new UnauthorizedException(`JWT verification failed: ${msg}`);
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
