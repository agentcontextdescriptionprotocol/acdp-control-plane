import {
  Controller,
  Get,
  MessageEvent,
  Query,
  Sse,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { AppConfigService } from '../config/app-config.service';
import { ListEventsQueryDto } from '../dto/list-events-query.dto';
import { ContextEventRepository } from '../storage/context-event.repository';
import { StreamHubService } from './stream-hub.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly contextEventRepo: ContextEventRepository,
    private readonly streamHub: StreamHubService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Cross-run event history with filters.' })
  async listEvents(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: ListEventsQueryDto,
  ) {
    return this.contextEventRepo.listFiltered({
      runId: query.runId,
      eventType: query.eventType,
      agentId: query.agentId,
      registryAuthority: query.registryAuthority,
      afterTs: query.afterTs,
      beforeTs: query.beforeTs,
      limit: query.limit ?? 500,
    });
  }

  @Sse('stream')
  @ApiOperation({
    summary: 'Global SSE feed — all events from all registries, live.',
  })
  streamGlobal(): Observable<MessageEvent> {
    const heartbeatMs = this.config.streamSseHeartbeatMs;

    return new Observable<MessageEvent>((subscriber) => {
      const sub = this.streamHub.streamGlobal().subscribe({
        next: (event) =>
          subscriber.next({ type: event.type, data: event } as MessageEvent),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

      const heartbeat = setInterval(() => {
        subscriber.next({
          type: 'heartbeat',
          data: { ts: new Date().toISOString() },
        } as MessageEvent);
      }, heartbeatMs);
      if (typeof heartbeat === 'object' && 'unref' in heartbeat) heartbeat.unref();

      return () => {
        clearInterval(heartbeat);
        sub.unsubscribe();
      };
    });
  }
}
