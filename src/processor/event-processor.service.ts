import { Injectable, Logger } from '@nestjs/common';
import { AcdpStreamEvent, AcdpWebhookEvent } from '../contracts/acdp';
import { StreamHubService } from '../events/stream-hub.service';
import { AgentRepository } from '../storage/agent.repository';
import { ContextEventRepository } from '../storage/context-event.repository';
import { LineageEdgeRepository } from '../storage/lineage-edge.repository';
import { RegistryRepository } from '../storage/registry.repository';
import { RunRepository } from '../storage/run.repository';
import { InstrumentationService } from '../telemetry/instrumentation.service';
import { WebhookService } from '../webhooks/webhook.service';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    private readonly contextEventRepo: ContextEventRepository,
    private readonly runRepo: RunRepository,
    private readonly lineageRepo: LineageEdgeRepository,
    private readonly agentRepo: AgentRepository,
    private readonly registryRepo: RegistryRepository,
    private readonly streamHub: StreamHubService,
    private readonly instrumentation: InstrumentationService,
    private readonly webhookService: WebhookService,
  ) {}

  async process(payload: AcdpWebhookEvent, runIdOverride?: string): Promise<void> {
    const eventType = String(payload.type ?? 'unknown');
    const ctxId = payload.ctx_id;
    const lineageId = payload.lineage_id;
    const agentId = String(payload.agent_id ?? '');
    const contextType = payload.context_type;
    const visibility = payload.visibility;
    const version = payload.version;
    const derivedFrom = payload.derived_from ?? [];
    const registryAuthority = String(payload.registry_authority ?? '');
    const scenarioId = this.extractScenarioId(payload);
    const eventTs = String(payload.created_at ?? new Date().toISOString());
    const runId = runIdOverride ?? payload.run_id;

    // 1. Persist raw event
    await this.contextEventRepo.create({
      eventType,
      eventTs,
      runId: runId ?? null,
      ctxId: ctxId ?? null,
      lineageId: lineageId ?? null,
      agentId,
      contextType: contextType ?? null,
      visibility: visibility ?? null,
      version: version ?? null,
      derivedFrom,
      registryAuthority,
      scenarioId: scenarioId ?? null,
      rawPayload: payload as unknown as Record<string, unknown>,
    });

    this.instrumentation.eventsIngestedTotal.inc({ event_type: eventType });

    // 2. Run correlation — upsert run record
    if (runId) {
      await this.runRepo.upsertFromEvent(
        runId,
        scenarioId ?? 'unknown',
        registryAuthority,
      );
    }

    // 3. Lineage edges — one per derived_from entry on context_published
    if (eventType === 'context_published' && ctxId && derivedFrom.length > 0) {
      for (const fromCtxId of derivedFrom) {
        await this.lineageRepo.upsert({ fromCtxId, toCtxId: ctxId, runId });
      }
    }

    // 4. Agent registry
    if (agentId) {
      await this.agentRepo.upsert(agentId, registryAuthority);
    }

    // 5. Registry registry
    if (registryAuthority) {
      await this.registryRepo.upsert(registryAuthority);
    }

    // 6. Pub/sub — emit to SSE subscribers (per run + global)
    const streamEvent: AcdpStreamEvent = {
      type: eventType,
      ts: eventTs,
      runId,
      ctxId,
      agentId,
      contextType,
      registryAuthority,
      derivedFrom,
    };
    if (runId) this.streamHub.publishToRun(runId, streamEvent);
    this.streamHub.publishGlobal(streamEvent);

    // 7. Outbound webhooks — fire-and-forget
    void this.webhookService.fireEvent({
      event: eventType,
      runId: runId ?? '',
      timestamp: eventTs,
      data: streamEvent as unknown as Record<string, unknown>,
    });
  }

  private extractScenarioId(payload: AcdpWebhookEvent): string | undefined {
    const meta = payload.metadata as Record<string, unknown> | undefined;
    return (meta?.['scenario_id'] ?? payload.scenario_id) as string | undefined;
  }
}
