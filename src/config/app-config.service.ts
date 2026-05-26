import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

function readBoolean(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function readNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readStringList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class AppConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppConfigService.name);

  readonly nodeEnv = process.env.NODE_ENV ?? 'development';
  readonly isDevelopment = this.nodeEnv === 'development';

  readonly clientVersion: string = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../../package.json').version as string;
    } catch {
      return '0.0.0';
    }
  })();

  readonly port = readNumber('PORT', 3001);
  readonly host = process.env.HOST ?? '0.0.0.0';
  readonly corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  readonly databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@localhost:5432/acdp_control_plane';

  // Auth — comma-separated API keys. Empty = auth disabled (dev only).
  readonly authApiKeys = readStringList('AUTH_API_KEYS');

  // ── Token issuance (Phase-5: V2 Seam IdP foundation) ───────────────────
  //
  // When `tokenIssuanceEnabled` is true the control plane mounts
  // `POST /auth/challenge` + `POST /auth/token` and issues HS256 JWTs
  // signed with `jwtSecret`. The JWT shape matches the registry's
  // BearerClaims so the two issuers stay interoperable.
  //
  // `CONTROL_PLANE_PINNED_KEYS` populates the agent → public-key
  // directory used to verify challenge signatures (loaded by
  // PinnedKeysService at boot).
  readonly tokenIssuanceEnabled = readBoolean('TOKEN_ISSUANCE_ENABLED', false);
  readonly jwtSecret = process.env.JWT_SECRET ?? '';
  readonly jwtAuthority = process.env.JWT_AUTHORITY ?? 'control-plane.local';
  readonly jwtTtlSeconds = readNumber('JWT_TTL_SECONDS', 3600);
  readonly challengeTtlSeconds = readNumber('CHALLENGE_TTL_SECONDS', 300);

  // Auth-store backend selection — drives the #8 persistent stores,
  // the #12 issuance ledger, and any future auth tables. `memory` is
  // correct for single-process dev/test; multi-instance deployments
  // MUST set `postgres` so the challenge nonces and revocation list
  // are shared across replicas. Validated against the allowed set.
  readonly authPersistence: 'memory' | 'postgres' = (() => {
    const raw = (process.env.AUTH_PERSISTENCE ?? 'memory').toLowerCase();
    if (raw === 'memory' || raw === 'postgres') return raw;
    throw new Error(
      `AUTH_PERSISTENCE must be 'memory' or 'postgres' (got '${raw}')`,
    );
  })();
  readonly authSweepIntervalSeconds = readNumber('AUTH_SWEEP_INTERVAL_SECONDS', 300);

  // HMAC secret used to verify incoming registry webhooks. Empty = skip (dev).
  readonly webhookSecret = process.env.WEBHOOK_SECRET ?? '';

  // Playground URL — for run-completion notifications back to the playground.
  readonly playgroundUrl = process.env.PLAYGROUND_URL ?? '';

  // SSE / stream hub
  readonly streamHubStrategy = process.env.STREAM_HUB_STRATEGY ?? 'memory';
  readonly redisUrl = process.env.REDIS_URL ?? '';
  readonly streamSseHeartbeatMs = readNumber('STREAM_SSE_HEARTBEAT_MS', 15000);

  // DB pool
  readonly dbPoolMax = readNumber('DB_POOL_MAX', 20);
  readonly dbPoolIdleTimeout = readNumber('DB_POOL_IDLE_TIMEOUT', 30000);
  readonly dbPoolConnectionTimeout = readNumber('DB_POOL_CONNECTION_TIMEOUT', 5000);

  // Throttler
  readonly throttleTtlMs = readNumber('THROTTLE_TTL_MS', 60000);
  readonly throttleLimit = readNumber('THROTTLE_LIMIT', 200);

  // Data retention
  readonly dataRetentionEnabled = readBoolean('DATA_RETENTION_ENABLED', false);
  readonly dataRetentionTtlDays = readNumber('DATA_RETENTION_TTL_DAYS', 30);
  readonly dataRetentionIntervalHours = readNumber('DATA_RETENTION_INTERVAL_HOURS', 24);

  // OTel / logging
  readonly logLevel = process.env.LOG_LEVEL ?? 'info';
  readonly otelEnabled = readBoolean('OTEL_ENABLED', false);
  readonly otelServiceName = process.env.OTEL_SERVICE_NAME ?? 'acdp-control-plane';
  readonly otelExporterOtlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';

  // OpenAPI / Swagger
  // Defaults to enabled in development; opt-in in production via SWAGGER_ENABLED=true.
  readonly swaggerEnabled = readBoolean('SWAGGER_ENABLED', this.nodeEnv === 'development');
  readonly swaggerPath = process.env.SWAGGER_PATH ?? 'docs';

  onModuleInit(): void {
    this.validate();
  }

  private validate(): void {
    if (this.isDevelopment) return;

    if (this.authApiKeys.length === 0) {
      throw new Error(
        'AUTH_API_KEYS must be set in production. Empty value disables authentication.',
      );
    }

    if (!this.webhookSecret) {
      this.logger.warn(
        'WEBHOOK_SECRET is not set — webhook HMAC verification is disabled. Required in production.',
      );
    }

    if (this.streamHubStrategy === 'memory') {
      this.logger.warn(
        'STREAM_HUB_STRATEGY=memory in production — SSE events will not sync across instances. ' +
          'Set STREAM_HUB_STRATEGY=redis for multi-instance deployments.',
      );
    }

    if (this.otelEnabled && !this.otelExporterOtlpEndpoint) {
      this.logger.warn(
        'OTEL_ENABLED is true but OTEL_EXPORTER_OTLP_ENDPOINT is not set — traces will be discarded',
      );
    }

    if (this.dataRetentionEnabled && this.dataRetentionTtlDays < 1) {
      throw new Error('DATA_RETENTION_TTL_DAYS must be >= 1 when retention is enabled');
    }

    if (this.dbPoolMax < 2) {
      throw new Error('DB_POOL_MAX must be >= 2 to avoid connection pool starvation');
    }

    if (this.tokenIssuanceEnabled) {
      // Minimum 32 bytes for HS256 per RFC 7518 §3.2.
      const secretBytes = Buffer.byteLength(this.jwtSecret, 'utf-8');
      if (secretBytes < 32) {
        throw new Error(
          `JWT_SECRET must be at least 32 bytes when TOKEN_ISSUANCE_ENABLED=true ` +
            `(got ${secretBytes})`,
        );
      }
      if (this.jwtTtlSeconds < 60) {
        throw new Error('JWT_TTL_SECONDS must be >= 60');
      }
      if (this.challengeTtlSeconds < 30) {
        throw new Error('CHALLENGE_TTL_SECONDS must be >= 30');
      }
      if (this.authPersistence === 'memory') {
        this.logger.warn(
          'AUTH_PERSISTENCE=memory in production — challenge nonces and the ' +
            'revocation list are NOT shared across instances. Set ' +
            'AUTH_PERSISTENCE=postgres for multi-instance deployments.',
        );
      }
    }
  }
}
