import { DynamicModule, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { ChallengeStore } from './challenge-store.service';
import { ConfigModule } from '../config/config.module';
import { CrossIssuerValidator } from './cross-issuer-validator.service';
import { PinnedKeysService } from './pinned-keys.service';
import { TokenIssuer } from './token-issuer.service';
import {
  parseTrustedIssuers,
  TrustedIssuerRegistry,
} from './trusted-issuers';

/**
 * Auth module — bearer-token guard (always on) + optional Phase-5 IdP.
 *
 * The IdP pieces (challenge store, pinned-key directory, JWT issuer,
 * controller) are only registered when `TOKEN_ISSUANCE_ENABLED=true`
 * at boot. Validation in AppConfigService refuses to start in
 * production with an undersized JWT secret.
 */
@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {
  static forRoot(): DynamicModule {
    const issuanceEnabled = readBool(process.env.TOKEN_ISSUANCE_ENABLED);
    // The trusted-issuer registry is built once at module init from
    // TRUSTED_ISSUERS. Registry is always present (empty when no
    // peers configured) so CrossIssuerValidator's dispatch can fall
    // through cleanly to the "iss matches self" path.
    const trustedRegistryProvider = {
      provide: TrustedIssuerRegistry,
      useFactory: (config: AppConfigService) =>
        new TrustedIssuerRegistry(parseTrustedIssuers(config.trustedIssuersRaw)),
      inject: [AppConfigService],
    };

    const providers = [
      AuthGuard,
      ...(issuanceEnabled
        ? [
            ChallengeStore,
            PinnedKeysService,
            TokenIssuer,
            trustedRegistryProvider,
            CrossIssuerValidator,
          ]
        : []),
    ];
    return {
      module: AuthModule,
      imports: [ConfigModule],
      controllers: issuanceEnabled ? [AuthController] : [],
      providers,
      exports: [
        AuthGuard,
        ...(issuanceEnabled
          ? [TokenIssuer, CrossIssuerValidator, TrustedIssuerRegistry]
          : []),
      ],
    };
  }
}

function readBool(raw: string | undefined): boolean {
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}
