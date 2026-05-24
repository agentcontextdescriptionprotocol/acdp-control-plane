import {
  Body,
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { AppConfigService } from '../config/app-config.service';
import { LineageDag } from '../contracts/acdp';
import { ListEventsQueryDto } from '../dto/list-events-query.dto';
import { ListRunsQueryDto } from '../dto/list-runs-query.dto';
import { RunCompleteDto } from '../dto/run-complete.dto';
import { StreamHubService } from '../events/stream-hub.service';
import { ContextEventRepository } from '../storage/context-event.repository';
import { LineageEdgeRepository } from '../storage/lineage-edge.repository';
import { RunsService } from './runs.service';

@ApiTags('runs')
@Controller('runs')
export class RunsController {
  constructor(
    private readonly runsService: RunsService,
    private readonly contextEventRepo: ContextEventRepository,
    private readonly lineageRepo: LineageEdgeRepository,
    private readonly streamHub: StreamHubService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List runs with optional filtering and pagination.' })
  async listRuns(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: ListRunsQueryDto,
  ) {
    return this.runsService.list({
      status: query.status,
      scenarioId: query.scenarioId,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Fetch a single run.' })
  async getRun(@Param('runId') runId: string) {
    return this.runsService.getOrThrow(runId);
  }

  @Get(':runId/lineage')
  @ApiOperation({
    summary: 'DAG of contexts produced in this run (nodes + directed edges).',
  })
  async getLineage(@Param('runId') runId: string): Promise<LineageDag> {
    const [events, edges] = await Promise.all([
      this.contextEventRepo.listByRun(runId),
      this.lineageRepo.listByRun(runId),
    ]);
    const nodes = events
      .filter((e) => e.eventType === 'context_published')
      .map((e, i) => ({
        ctxId: e.ctxId,
        agentId: e.agentId,
        contextType: e.contextType,
        visibility: e.visibility,
        registryAuthority: e.registryAuthority,
        step: i + 1,
      }));
    return {
      runId,
      nodes,
      edges: edges.map((e) => ({ from: e.fromCtxId, to: e.toCtxId })),
    };
  }

  @Get(':runId/events')
  @ApiOperation({ summary: 'List context events for a run.' })
  async getRunEvents(
    @Param('runId') runId: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: ListEventsQueryDto,
  ) {
    return this.contextEventRepo.listByRunFiltered({
      runId,
      eventType: query.eventType,
      limit: query.limit ?? 200,
    });
  }

  @Sse(':runId/events/stream')
  @ApiOperation({ summary: 'Live SSE stream of events for a run.' })
  streamRunEvents(@Param('runId') runId: string): Observable<MessageEvent> {
    const heartbeatMs = this.config.streamSseHeartbeatMs;

    return new Observable<MessageEvent>((subscriber) => {
      const sub = this.streamHub.streamRun(runId).subscribe({
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

  @Post(':runId/complete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Playground notifies that the run is complete.' })
  async markComplete(
    @Param('runId') runId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: RunCompleteDto,
  ): Promise<void> {
    await this.runsService.markComplete(runId, body.status, body.result);
  }
}
