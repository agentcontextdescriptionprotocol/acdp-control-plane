/**
 * GET /.well-known/jwks.json — publish the public key(s) federated
 * peers should use to verify tokens issued by this control plane.
 *
 * Returns:
 *   - EdDSA: `{ keys: [<OKP/Ed25519 JWK>] }` — single active key for V1.
 *   - HS256: `{ keys: [] }` — symmetric secrets are never published.
 *     Operators that want federation MUST switch to EdDSA.
 *
 * Marked @Public() so peers can fetch unauthenticated. The endpoint
 * carries only public material — there's nothing to gate behind auth.
 *
 * Cache headers (Cache-Control: public, max-age=300) match the
 * JwksClient's success TTL so consumers can cache locally and avoid
 * hammering the CP on every verify.
 */
import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './public.decorator';
import { SigningMaterialService } from './signing-material.service';

interface JwksResponse {
  keys: Array<Record<string, string>>;
}

@ApiTags('auth')
@Controller('.well-known/jwks.json')
export class JwksController {
  constructor(private readonly signing: SigningMaterialService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Content-Type', 'application/jwk-set+json')
  @ApiOperation({ summary: 'Publish JWKS for federated verification' })
  jwks(): JwksResponse {
    const jwk = this.signing.material.publicJwk;
    if (!jwk) {
      // HS256: no public material to publish. Return an empty key set
      // (still 200) — peers will treat that as "this issuer isn't
      // asymmetric-signing yet" and refuse to dispatch to a JWKS-based
      // trust entry.
      return { keys: [] };
    }
    return {
      keys: [jwk as unknown as Record<string, string>],
    };
  }
}
