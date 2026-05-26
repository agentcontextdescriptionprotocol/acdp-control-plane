/**
 * SigningMaterialService — single source of truth for the operative
 * JWT signing material (algorithm + key + kid) used by TokenIssuer,
 * CrossIssuerValidator (for self-issued tokens), and the JWKS endpoint.
 *
 * Built once at boot from AppConfigService. Throws at construction
 * if config is invalid (caught by Nest's bootstrap, surfaces as a
 * clear fatal log) — better than silently signing with garbage.
 */
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { buildSigningMaterial, type SigningMaterial } from './jwt-signing';

@Injectable()
export class SigningMaterialService {
  readonly material: SigningMaterial;

  constructor(config: AppConfigService) {
    this.material = buildSigningMaterial({
      algorithm: config.jwtSigningAlg,
      hsSecret: config.jwtSecret,
      privateKeyPem: config.jwtPrivateKeyPem,
      kid: config.jwtKid || undefined,
    });
  }
}
