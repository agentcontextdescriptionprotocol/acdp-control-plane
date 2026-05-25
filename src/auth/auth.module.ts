import { DynamicModule, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { ChallengeStore } from './challenge-store.service';
import { ConfigModule } from '../config/config.module';
import { IssuanceLedgerService } from './issuance-ledger.service';
import { PinnedKeysService } from './pinned-keys.service';
import { TokenIssuer } from './token-issuer.service';

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
    const providers = [
      AuthGuard,
      ...(issuanceEnabled
        ? [ChallengeStore, PinnedKeysService, TokenIssuer, IssuanceLedgerService]
        : []),
    ];
    return {
      module: AuthModule,
      imports: [ConfigModule],
      controllers: issuanceEnabled ? [AuthController] : [],
      providers,
      exports: [AuthGuard, ...(issuanceEnabled ? [TokenIssuer] : [])],
    };
  }
}

function readBool(raw: string | undefined): boolean {
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}
