import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { AcdpWebhookEvent } from '../contracts/acdp';
import { DomainPackRegistry } from '../domain-packs/domain-pack';
import { EventProcessorService } from '../processor/event-processor.service';
import { DEFAULT_TENANT_ID } from '../tenant/tenant-context';
import { verifyWebhookSignature } from './hmac';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly processor: EventProcessorService,
    private readonly domainPacks: DomainPackRegistry,
  ) {}

  async handle(
    body: Buffer,
    signatureHeader: string,
    headerRunId?: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<void> {
    if (!verifyWebhookSignature(body, signatureHeader ?? '', this.config.webhookSecret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let payload: AcdpWebhookEvent;
    try {
      payload = JSON.parse(body.toString('utf8')) as AcdpWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid JSON payload');
    }

    if (typeof payload !== 'object' || payload === null) {
      throw new BadRequestException('Payload must be an object');
    }
    if (!payload.type) {
      throw new BadRequestException('Missing required field: type');
    }
    if (!payload.agent_id) {
      throw new BadRequestException('Missing required field: agent_id');
    }
    // Domain-pack context-type gate (plan §1). Only active when at least
    // one pack is registered — keeps deployments without DOMAIN_PACKS set
    // behaving exactly as before. The union of every pack's
    // `contextTypes[].contextType` is the allowlist.
    const packs = this.domainPacks.list();
    if (packs.length > 0 && payload.context_type !== undefined && payload.context_type !== null) {
      const allowed = new Set<string>();
      for (const p of packs) {
        for (const ct of p.contextTypes) allowed.add(ct.contextType);
      }
      const requested = String(payload.context_type);
      if (!allowed.has(requested)) {
        throw new BadRequestException(
          `context_type '${requested}' not declared by any active domain pack ` +
            `(${packs.map((p) => p.id).join(', ')})`,
        );
      }
    }
    // registry_authority is required, but the ACDP registry's WebhookEvent
    // doesn't include it explicitly — fall back to extracting it from
    // ctx_id (format: `acdp://<authority>/<id>`) so the event still flows.
    if (!payload.registry_authority) {
      const extracted = extractAuthorityFromCtxId(payload.ctx_id);
      if (!extracted) {
        throw new BadRequestException(
          'Missing required field: registry_authority (and ctx_id has no authority)',
        );
      }
      payload.registry_authority = extracted;
    }

    const runId = headerRunId ?? payload.run_id;
    await this.processor.process(payload, runId, tenantId);
  }
}

/**
 * Pull the authority out of an ACDP context URI. Returns undefined if the
 * input isn't shaped like `acdp://<authority>/<id>`.
 */
export function extractAuthorityFromCtxId(ctxId: unknown): string | undefined {
  if (typeof ctxId !== 'string' || !ctxId.startsWith('acdp://')) return undefined;
  const [authority] = ctxId.slice('acdp://'.length).split('/');
  return authority || undefined;
}
