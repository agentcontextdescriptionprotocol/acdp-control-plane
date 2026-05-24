import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { WebhookDelivery, webhookDeliveries } from '../db/schema';

export interface CreateDeliveryInput {
  webhookId: string;
  event: string;
  runId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class WebhookDeliveryRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateDeliveryInput): Promise<WebhookDelivery> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.database.db.insert(webhookDeliveries).values({
      id,
      webhookId: input.webhookId,
      event: input.event,
      runId: input.runId,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      createdAt: now,
    });
    const rows = await this.database.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id))
      .limit(1);
    return rows[0];
  }

  async markDelivered(id: string, responseStatus: number): Promise<void> {
    const now = new Date().toISOString();
    await this.database.db
      .update(webhookDeliveries)
      .set({
        status: 'delivered',
        responseStatus,
        lastAttemptAt: now,
        deliveredAt: now,
      })
      .where(eq(webhookDeliveries.id, id));
  }

  async markFailed(
    id: string,
    attempt: number,
    errorMessage: string,
    responseStatus?: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.database.db
      .update(webhookDeliveries)
      .set({
        status: attempt >= 3 ? 'failed' : 'pending',
        attempts: attempt,
        lastAttemptAt: now,
        errorMessage,
        responseStatus,
      })
      .where(eq(webhookDeliveries.id, id));
  }

  async listPending(): Promise<WebhookDelivery[]> {
    return this.database.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, 'pending'));
  }

  async listByWebhookId(webhookId: string): Promise<WebhookDelivery[]> {
    return this.database.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId));
  }
}
