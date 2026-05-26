import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { Webhook, webhooks } from '../db/schema';
import { DEFAULT_TENANT_ID } from '../tenant/tenant-context';

export interface CreateWebhookInput {
  url: string;
  events: string[];
  secret: string;
  tenantId?: string;
}

export interface UpdateWebhookFields {
  url?: string;
  events?: string[];
  secret?: string;
  active?: boolean;
}

@Injectable()
export class WebhookRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateWebhookInput): Promise<Webhook | null> {
    const id = randomUUID();
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const now = new Date().toISOString();
    await this.database.db.insert(webhooks).values({
      id,
      tenantId,
      url: input.url,
      events: input.events,
      secret: input.secret,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return this.findById(id, tenantId);
  }

  async findById(
    id: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<Webhook | null> {
    const rows = await this.database.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listActive(tenantId: string = DEFAULT_TENANT_ID): Promise<Webhook[]> {
    return this.database.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.active, true), eq(webhooks.tenantId, tenantId)));
  }

  async list(tenantId: string = DEFAULT_TENANT_ID): Promise<Webhook[]> {
    return this.database.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.tenantId, tenantId));
  }

  async update(
    id: string,
    fields: UpdateWebhookFields,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<Webhook | null> {
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (fields.url !== undefined) updates.url = fields.url;
    if (fields.events !== undefined) updates.events = fields.events;
    if (fields.secret !== undefined) updates.secret = fields.secret;
    if (fields.active !== undefined) updates.active = fields.active;

    await this.database.db
      .update(webhooks)
      .set(updates)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)));
    return this.findById(id, tenantId);
  }

  async delete(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    await this.database.db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantId)));
  }
}
