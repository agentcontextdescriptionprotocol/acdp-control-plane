/**
 * Cross-issuer JWT validator.
 *
 * Replaces the `TokenIssuer.verifyJwt` single-issuer assumption with
 * dispatch on the JWT's `iss` claim:
 *
 *   - `iss == self_authority`        → verify with local jwtSecret
 *   - `iss in trusted_issuers`       → verify with that issuer's
 *                                       trust material (HS256 secret
 *                                       in V1; RS256/EdDSA JWKS later)
 *   - otherwise                       → reject
 *
 * Also enforces the federation hygiene properties the deferred plan
 * calls out:
 *   - `nbf` (not-before) when present — clock-skew defense across
 *     issuers.
 *   - `scp` (space-separated scope string) when the trusted issuer
 *     declares required scopes.
 *   - `aud` (audience) when the trusted issuer declares it.
 *
 * Logs every trusted-issuer acceptance at INFO with structured fields
 * so operators can audit federation traffic separately from local
 * issuance.
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import jwt, { type Algorithm } from 'jsonwebtoken';
import { AppConfigService } from '../config/app-config.service';
import { JwksClient } from './jwks-client';
import { SigningMaterialService } from './signing-material.service';
import { AcdpBearerClaims } from './token-issuer.service';
import { TrustedIssuer, TrustedIssuerRegistry } from './trusted-issuers';

/** JWT claim shape with the federation extensions. */
export interface FederatedClaims extends AcdpBearerClaims {
  /** Not-before, unix seconds. Optional. */
  nbf?: number;
  /** Audience — single string OR array. Optional. */
  aud?: string | string[];
  /** Space-separated scope string (e.g. `"publish read:restricted"`). */
  scp?: string;
}

@Injectable()
export class CrossIssuerValidator {
  private readonly logger = new Logger(CrossIssuerValidator.name);
  /** Lazily built per-issuer JWKS client (EdDSA peers only). */
  private readonly jwksClients: Map<string, JwksClient> = new Map();

  constructor(
    private readonly config: AppConfigService,
    private readonly trusted: TrustedIssuerRegistry,
    private readonly signing: SigningMaterialService,
  ) {}

  /**
   * Verify a JWT, dispatching on `iss`. Throws
   * UnauthorizedException on any failure mode (same hygiene as
   * `TokenIssuer.verifyJwt` — no shape-level discrimination of
   * failure reasons surfaces to the caller).
   */
  async verify(token: string): Promise<FederatedClaims> {
    // Decode unverified to peek the iss; we then verify against the
    // matched issuer's material. The double-decode is unavoidable
    // because `jwt.verify`'s issuer option compares against a single
    // value and doesn't itself dispatch.
    const peek = decodePeek(token);
    if (!peek) {
      throw new UnauthorizedException('JWT decode failed');
    }
    const { iss } = peek;
    if (!iss) {
      throw new UnauthorizedException('JWT missing iss claim');
    }

    if (iss === this.config.jwtAuthority) {
      return this.verifyLocal(token);
    }
    const trusted = this.trusted.get(iss);
    if (!trusted) {
      throw new UnauthorizedException(`JWT iss='${iss}' is not trusted`);
    }
    return this.verifyTrusted(token, trusted);
  }

  /**
   * For an EdDSA peer, fetch the JWKS and select the right key. We
   * prefer matching by `kid` (RFC 7515 §4.1.4 — the standard hint
   * for verifiers). When the token doesn't carry one OR when no key
   * matches, fall back to the first usable key — most peers have one
   * active signing key at a time, so this is the common case.
   */
  private async resolveJwksKey(
    trusted: TrustedIssuer,
    token: string,
  ): Promise<string> {
    if (!trusted.jwksUrl) {
      throw new Error(`trusted issuer '${trusted.iss}' is EdDSA but jwks_url is missing`);
    }
    let client = this.jwksClients.get(trusted.iss);
    if (!client) {
      client = new JwksClient(trusted.jwksUrl);
      this.jwksClients.set(trusted.iss, client);
    }
    const kid = decodeKid(token);
    return client.getSigningKey(kid);
  }

  private verifyLocal(token: string): FederatedClaims {
    try {
      const decoded = jwt.verify(token, this.signing.material.verifyKey, {
        algorithms: [this.signing.material.algorithm as Algorithm],
        issuer: this.config.jwtAuthority,
        // Local tokens don't carry nbf today, but if a future mint adds
        // it the jsonwebtoken library will respect it automatically.
      });
      return decoded as unknown as FederatedClaims;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new UnauthorizedException(`local JWT verification failed: ${msg}`);
    }
  }

  private async verifyTrusted(
    token: string,
    trusted: TrustedIssuer,
  ): Promise<FederatedClaims> {
    let decoded: FederatedClaims;
    try {
      if (trusted.alg === 'HS256') {
        decoded = jwt.verify(token, trusted.secret ?? '', {
          algorithms: ['HS256'],
          issuer: trusted.iss,
        }) as unknown as FederatedClaims;
      } else {
        // EdDSA via JWKS: fetch the right key by `kid` from the token
        // header, then verify with EdDSA.
        const verifyKey = await this.resolveJwksKey(trusted, token);
        decoded = jwt.verify(token, verifyKey, {
          algorithms: ['EdDSA' as Algorithm],
          issuer: trusted.iss,
        }) as unknown as FederatedClaims;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new UnauthorizedException(`trusted JWT verification failed: ${msg}`);
    }
    if (trusted.audience) {
      if (!matchesAudience(decoded.aud, trusted.audience)) {
        throw new UnauthorizedException(
          `trusted JWT iss='${trusted.iss}' audience mismatch: required '${trusted.audience}'`,
        );
      }
    }
    if (trusted.requiredScope) {
      const have = parseScope(decoded.scp);
      const need = parseScope(trusted.requiredScope);
      const missing = need.filter((s) => !have.includes(s));
      if (missing.length > 0) {
        throw new UnauthorizedException(
          `trusted JWT iss='${trusted.iss}' missing required scope(s): ${missing.join(' ')}`,
        );
      }
    }
    this.logger.log(
      'trusted-issuer JWT accepted',
      JSON.stringify({
        event: 'acdp.jwt.trusted_issuer_accept',
        iss: decoded.iss,
        sub: decoded.sub,
        jti: decoded.jti,
        audience_required: trusted.audience ?? null,
        scope_required: trusted.requiredScope ?? null,
      }),
    );
    return decoded;
  }
}

function decodePeek(token: string): { iss?: string } | null {
  try {
    const d = jwt.decode(token);
    if (!d || typeof d !== 'object') return null;
    return { iss: (d as { iss?: unknown }).iss as string | undefined };
  } catch {
    return null;
  }
}

function decodeKid(token: string): string | null {
  try {
    const d = jwt.decode(token, { complete: true });
    if (!d) return null;
    const kid = (d.header as { kid?: unknown }).kid;
    return typeof kid === 'string' ? kid : null;
  } catch {
    return null;
  }
}

function matchesAudience(aud: FederatedClaims['aud'], required: string): boolean {
  if (typeof aud === 'string') return aud === required;
  if (Array.isArray(aud)) return aud.includes(required);
  return false;
}

function parseScope(scp: string | undefined): string[] {
  if (!scp) return [];
  return scp.split(/\s+/).filter(Boolean);
}
