import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AgentsController } from './agents/agents.controller';
import { CapabilityController } from './agents/capability.controller';
import { CapabilityRepository } from './agents/capability.repository';
import { CapabilityService } from './agents/capability.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { PinnedKeysService } from './auth/pinned-keys.service';
import { ThrottleByUserGuard } from './auth/throttle-by-user.guard';
import { AppConfigService } from './config/app-config.service';
import { ConfigModule } from './config/config.module';
import { ContextsController } from './contexts/contexts.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { DatabaseModule } from './db/database.module';
import { EventsController } from './events/events.controller';
import { MemoryStreamHubStrategy } from './events/memory-stream-hub.strategy';
import { RedisStreamHubStrategy } from './events/redis-stream-hub.strategy';
import { STREAM_HUB_STRATEGY } from './events/stream-hub.interface';
import { StreamHubService } from './events/stream-hub.service';
import { HealthController } from './health/health.controller';
import { IngestController } from './ingest/ingest.controller';
import { IngestService } from './ingest/ingest.service';
import { MetricsController } from './metrics/metrics.controller';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { RequestLoggerMiddleware } from './middleware/request-logger.middleware';
import { EventProcessorService } from './processor/event-processor.service';
import { RegistriesController } from './registries/registries.controller';
import { RunsController } from './runs/runs.controller';
import { RunsService } from './runs/runs.service';
import { AgentRepository } from './storage/agent.repository';
import { ContextEventRepository } from './storage/context-event.repository';
import { LineageEdgeRepository } from './storage/lineage-edge.repository';
import { RegistryRepository } from './storage/registry.repository';
import { RunRepository } from './storage/run.repository';
import { InstrumentationService } from './telemetry/instrumentation.service';
import { WebhookController } from './webhooks/webhook.controller';
import { WebhookDeliveryRepository } from './webhooks/webhook-delivery.repository';
import { WebhookRepository } from './webhooks/webhook.repository';
import { WebhookService } from './webhooks/webhook.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        { ttl: config.throttleTtlMs, limit: config.throttleLimit },
      ],
    }),
  ],
  controllers: [
    IngestController,
    RunsController,
    EventsController,
    ContextsController,
    AgentsController,
    CapabilityController,
    RegistriesController,
    DashboardController,
    WebhookController,
    HealthController,
    MetricsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottleByUserGuard },

    {
      provide: STREAM_HUB_STRATEGY,
      useFactory: (config: AppConfigService) => {
        if (config.streamHubStrategy === 'redis' && config.redisUrl) {
          return new RedisStreamHubStrategy(config.redisUrl);
        }
        return new MemoryStreamHubStrategy();
      },
      inject: [AppConfigService],
    },
    StreamHubService,

    // Pinned-key directory is @Global() so both AuthModule (TokenIssuer)
    // and AgentsModule (CapabilityService) can inject the same instance.
    // Registering it here unconditionally means capability declarations
    // work even when TOKEN_ISSUANCE_ENABLED is off (the agent still
    // needs to prove they own the DID before declaring caps for it).
    PinnedKeysService,

    // Repositories
    ContextEventRepository,
    RunRepository,
    LineageEdgeRepository,
    AgentRepository,
    CapabilityRepository,
    CapabilityService,
    RegistryRepository,
    WebhookRepository,
    WebhookDeliveryRepository,

    // Services
    InstrumentationService,
    EventProcessorService,
    IngestService,
    RunsService,
    DashboardService,
    WebhookService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware, RequestLoggerMiddleware).forRoutes('*');
  }
}
