import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PinoLogger } from './common/pino-logger';
import { AppConfigService } from './config/app-config.service';
import { runMigrations } from './db/migrate';
import { GlobalExceptionFilter } from './errors/exception.filter';
import { startTelemetry, stopTelemetry } from './telemetry/telemetry';

async function bootstrap() {
  const config = new AppConfigService();

  // Run database migrations before NestJS bootstraps
  await runMigrations(config.databaseUrl);

  await startTelemetry({
    enabled: config.otelEnabled,
    serviceName: config.otelServiceName,
    otlpEndpoint: config.otelExporterOtlpEndpoint || undefined,
  });

  const pinoLogger = new PinoLogger(config.logLevel, config.isDevelopment);
  const app = await NestFactory.create(AppModule, {
    cors: false,
    logger: pinoLogger,
    rawBody: true,
  });

  app.use(helmet());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors({ origin: config.corsOrigin, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  if (config.isDevelopment) {
    const swagger = new DocumentBuilder()
      .setTitle('ACDP Control Plane')
      .setDescription(
        'Control plane for the Agent Context Description Protocol — ingests registry events, ' +
          'correlates runs, broadcasts SSE.',
      )
      .setVersion(config.clientVersion)
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, document);
  }

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  const shutdown = async () => {
    await app.close();
    await stopTelemetry();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error(
    `bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined,
  );
  process.exit(1);
});
