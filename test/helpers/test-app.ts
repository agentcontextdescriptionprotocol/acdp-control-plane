import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as promClient from 'prom-client';
import { AppModule } from '../../src/app.module';
import { runMigrations } from '../../src/db/migrate';
import { DatabaseService } from '../../src/db/database.service';
import { GlobalExceptionFilter } from '../../src/errors/exception.filter';
import { TestClient } from './test-client';
import { truncateAll, TEST_DB_URL } from './test-db';

export interface TestAppContext {
  app: INestApplication;
  url: string;
  client: TestClient;
  module: TestingModule;
  cleanup: () => Promise<void>;
}

export interface TestAppOptions {
  /** When set, HMAC verification is enabled with this secret (matches WEBHOOK_SECRET). */
  webhookSecret?: string;
  /** API key for AUTH. Defaults to 'test-key'. */
  apiKey?: string;
}

/**
 * Boot a real NestJS application for integration testing.
 *
 * Migrations run before the app is created. The app listens on a random
 * port; tests reach it via `ctx.client` (typed HTTP) or `ctx.url`.
 */
export async function createTestApp(opts: TestAppOptions = {}): Promise<TestAppContext> {
  const apiKey = opts.apiKey ?? 'test-key';
  const webhookSecret = opts.webhookSecret ?? '';

  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.NODE_ENV = 'development';
  process.env.AUTH_API_KEYS = apiKey;
  process.env.WEBHOOK_SECRET = webhookSecret;
  process.env.OTEL_ENABLED = 'false';
  process.env.LOG_LEVEL = 'warn';
  process.env.PLAYGROUND_URL = '';
  process.env.STREAM_SSE_HEARTBEAT_MS = '60000';

  // Clear Prometheus registry — prevents duplicate-metric errors across suites.
  promClient.register.clear();

  await runMigrations(TEST_DB_URL);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors({ origin: '*', credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  await app.listen(0);
  const url = await app.getUrl();
  const client = new TestClient(url, apiKey);

  const cleanup = async () => {
    const db = moduleRef.get(DatabaseService);
    await truncateAll(db.pool);
  };

  return { app, url, client, module: moduleRef, cleanup };
}
