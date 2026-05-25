/**
 * Auth endpoints — Phase-5: the control plane as IdP.
 *
 *   POST /auth/challenge   request a one-shot signing input
 *   POST /auth/token       exchange a signed challenge for a JWT
 *
 * Both are marked `@Public()` — the AuthGuard skips them so an agent
 * doesn't need a bearer token to ask for a bearer token. The endpoints
 * are mounted only when `TOKEN_ISSUANCE_ENABLED=true` (see auth.module).
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  ChallengeRequestDto,
  ChallengeResponseDto,
  TokenRequestDto,
  TokenResponseDto,
} from './dto/auth.dto';
import { Public } from './public.decorator';
import { TokenIssuer } from './token-issuer.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly issuer: TokenIssuer) {}

  @Public()
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  challenge(@Body() body: ChallengeRequestDto): ChallengeResponseDto {
    const rec = this.issuer.issueChallenge(body.agent_id);
    return {
      nonce: rec.nonce,
      registry_authority: rec.registryAuthority,
      expires_at: rec.expiresAt,
      signing_input: rec.signingInput,
    };
  }

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  token(@Body() body: TokenRequestDto, @Req() req: Request): TokenResponseDto {
    const out = this.issuer.issueToken(
      {
        agentDid: body.agent_id,
        keyId: body.key_id,
        nonce: body.nonce,
        expiresAt: body.expires_at,
        algorithm: body.algorithm,
        signature: body.signature,
      },
      { signerIp: extractIp(req) },
    );
    return {
      token: out.token,
      token_type: out.tokenType,
      expires_at: out.expiresAt,
    };
  }
}

/**
 * Best-effort caller IP for audit. Prefers `X-Forwarded-For` (first
 * hop) when present — Express's `req.ip` only reflects the proxy
 * unless `app.set('trust proxy', ...)` is configured upstream.
 */
function extractIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]!.trim();
  if (Array.isArray(xff) && xff[0]) return xff[0];
  return req.ip;
}
