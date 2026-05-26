import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { WebhookDelivery, webhookDeliveries } from '../db/schema';
import { DEFAULT_TENANT_ID } from '../tenant/tenant-context';

export interface CreateDeliveryInput {
  webhookId: string;
  event: string;
  runId: string;
  payload: Record<string, unknown>;
  tenantId?: string;
}

@Injectable()
export class WebhookDeliveryRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateDeliveryInput): Promise<WebhookDelivery> {
    const id = randomUUID();
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const now = new Date().toISOString();
    await this.database.db.insert(webhookDeliveries).values({
      id,
      tenantId,
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
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.tenantId, tenantId)))
      .limit(1);
    return rows[0];
  }

  async markDelivered(
    id: string,
    responseStatus: number,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.database.db
      .update(webhookDeliveries)
      .set({
        status: 'delivered',
        responseStatus,
        lastAttemptAt: now,
        deliveredAt: now,
      })
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.tenantId, tenantId)));
  }

  async markFailed(
    id: string,
    attempt: number,
    errorMessage: string,
    responseStatus?: number,
    tenantId: string = DEFAULT_TENANT_ID,
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
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.tenantId, tenantId)));
  }

  async listPending(tenantId: string = DEFAULT_TENANT_ID): Promise<WebhookDelivery[]> {
    return this.database.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, 'pending'), eq(webhookDeliveries.tenantId, tenantId)));
  }

  async listByWebhookId(
    webhookId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<WebhookDelivery[]> {
    return this.database.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.tenantId, tenantId)));
  }
}
