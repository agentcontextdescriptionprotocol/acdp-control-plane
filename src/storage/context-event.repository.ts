import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, lt, SQL } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { contextEvents, ContextEvent, NewContextEvent } from '../db/schema';

export interface ContextEventFilter {
  runId?: string;
  eventType?: string;
  agentId?: string;
  registryAuthority?: string;
  ctxId?: string;
  lineageId?: string;
  afterTs?: string;
  beforeTs?: string;
  limit?: number;
}

export interface ListByRunFilter {
  runId: string;
  eventType?: string;
  limit?: number;
}

@Injectable()
export class ContextEventRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(input: NewContextEvent): Promise<ContextEvent> {
    const rows = await this.database.db
      .insert(contextEvents)
      .values(input)
      .returning();
    return rows[0];
  }

  async listByRun(runId: string): Promise<ContextEvent[]> {
    return this.database.db
      .select()
      .from(contextEvents)
      .where(eq(contextEvents.runId, runId))
      .orderBy(asc(contextEvents.eventTs));
  }

  async listByRunFiltered(
    filter: ListByRunFilter,
  ): Promise<{ data: ContextEvent[]; total: number }> {
    const conditions: SQL[] = [eq(contextEvents.runId, filter.runId)];
    if (filter.eventType) conditions.push(eq(contextEvents.eventType, filter.eventType));
    const limit = filter.limit ?? 200;

    const data = await this.database.db
      .select()
      .from(contextEvents)
      .where(and(...conditions))
      .orderBy(asc(contextEvents.eventTs))
      .limit(limit);

    return { data, total: data.length };
  }

  async listFiltered(
    filter: ContextEventFilter,
  ): Promise<{ data: ContextEvent[]; total: number }> {
    const conditions: SQL[] = [];
    if (filter.runId) conditions.push(eq(contextEvents.runId, filter.runId));
    if (filter.eventType) conditions.push(eq(contextEvents.eventType, filter.eventType));
    if (filter.agentId) conditions.push(eq(contextEvents.agentId, filter.agentId));
    if (filter.registryAuthority)
      conditions.push(eq(contextEvents.registryAuthority, filter.registryAuthority));
    if (filter.ctxId) conditions.push(eq(contextEvents.ctxId, filter.ctxId));
    if (filter.lineageId) conditions.push(eq(contextEvents.lineageId, filter.lineageId));
    if (filter.afterTs) conditions.push(gt(contextEvents.eventTs, filter.afterTs));
    if (filter.beforeTs) conditions.push(lt(contextEvents.eventTs, filter.beforeTs));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = filter.limit ?? 500;

    const [data, totalResult] = await Promise.all([
      this.database.db
        .select()
        .from(contextEvents)
        .where(where)
        .orderBy(desc(contextEvents.eventTs))
        .limit(limit),
      this.database.db.select({ value: count() }).from(contextEvents).where(where),
    ]);

    return { data, total: Number(totalResult[0]?.value ?? 0) };
  }

  async countByAgent(agentId: string): Promise<number> {
    const result = await this.database.db
      .select({ value: count() })
      .from(contextEvents)
      .where(eq(contextEvents.agentId, agentId));
    return Number(result[0]?.value ?? 0);
  }
}
