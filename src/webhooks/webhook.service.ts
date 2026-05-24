import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { InstrumentationService } from '../telemetry/instrumentation.service';
import { WebhookDeliveryRepository } from './webhook-delivery.repository';
import { WebhookRepository } from './webhook.repository';

export interface WebhookPayload {
  event: string;
  runId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly deliveryRepository: WebhookDeliveryRepository,
    private readonly instrumentation: InstrumentationService,
  ) {}

  async register(input: { url: string; events: string[]; secret: string }) {
    return this.webhookRepository.create(input);
  }

  async list() {
    return this.webhookRepository.list();
  }

  async update(
    id: string,
    fields: { url?: string; events?: string[]; secret?: string; active?: boolean },
  ) {
    return this.webhookRepository.update(id, fields);
  }

  async remove(id: string) {
    return this.webhookRepository.delete(id);
  }

  /**
   * Fire an event to all matching webhooks. Callers fire-and-forget
   * (`void webhookService.fireEvent(...)`). Errors are swallowed and logged
   * so they don't surface as unhandled rejections.
   */
  async fireEvent(payload: WebhookPayload): Promise<void> {
    try {
      const active = await this.webhookRepository.listActive();
      const matching = active.filter(
        (wh) => wh.events.length === 0 || wh.events.includes(payload.event),
      );

      for (const webhook of matching) {
        const delivery = await this.deliveryRepository.create({
          webhookId: webhook.id,
          event: payload.event,
          runId: payload.runId,
          payload: payload as unknown as Record<string, unknown>,
        });
        void this.deliverWithTracking(
          delivery.id,
          webhook.url,
          webhook.secret,
          payload,
        );
      }
    } catch (err) {
      this.logger.warn(
        `fireEvent(${payload.event}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async retryPending(): Promise<number> {
    const pending = await this.deliveryRepository.listPending();
    let retried = 0;
    for (const delivery of pending) {
      const webhook = await this.webhookRepository.findById(delivery.webhookId);
      if (!webhook) continue;
      void this.deliverWithTracking(
        delivery.id,
        webhook.url,
        webhook.secret,
        delivery.payload as unknown as WebhookPayload,
        delivery.attempts,
      );
      retried++;
    }
    return retried;
  }

  private async deliverWithTracking(
    deliveryId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
    startAttempt = 0,
  ): Promise<void> {
    const maxAttempts = 3;
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    for (let attempt = startAttempt + 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ACDP-Signature': `sha256=${signature}`,
            'X-ACDP-Event': payload.event,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          throw new Error(`webhook returned ${response.status}`);
        }

        await this.deliveryRepository.markDelivered(deliveryId, response.status);
        this.instrumentation.webhookDeliveriesTotal.inc({ status: 'delivered' });
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `webhook delivery to ${url} failed (attempt ${attempt}/${maxAttempts}): ${errorMessage}`,
        );
        await this.deliveryRepository.markFailed(deliveryId, attempt, errorMessage);
        if (attempt >= maxAttempts) {
          this.instrumentation.webhookDeliveriesTotal.inc({ status: 'failed' });
        }
        if (attempt < maxAttempts) {
          const backoffMs = 1000 * 2 ** (attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
  }
}
