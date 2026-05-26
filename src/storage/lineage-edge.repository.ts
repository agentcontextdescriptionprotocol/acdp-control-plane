import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { LineageEdge, lineageEdges } from '../db/schema';
import { DEFAULT_TENANT_ID } from '../tenant/tenant-context';

export interface LineageEdgeInput {
  fromCtxId: string;
  toCtxId: string;
  runId?: string;
  tenantId?: string;
}

@Injectable()
export class LineageEdgeRepository {
  constructor(private readonly database: DatabaseService) {}

  async upsert(input: LineageEdgeInput): Promise<void> {
    await this.database.db
      .insert(lineageEdges)
      .values({
        fromCtxId: input.fromCtxId,
        toCtxId: input.toCtxId,
        runId: input.runId,
        tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
      })
      .onConflictDoNothing();
  }

  async listByRun(
    runId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<LineageEdge[]> {
    return this.database.db
      .select()
      .from(lineageEdges)
      .where(and(eq(lineageEdges.runId, runId), eq(lineageEdges.tenantId, tenantId)));
  }

  async listIncoming(
    ctxId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<LineageEdge[]> {
    return this.database.db
      .select()
      .from(lineageEdges)
      .where(and(eq(lineageEdges.toCtxId, ctxId), eq(lineageEdges.tenantId, tenantId)));
  }

  async listOutgoing(
    ctxId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<LineageEdge[]> {
    return this.database.db
      .select()
      .from(lineageEdges)
      .where(and(eq(lineageEdges.fromCtxId, ctxId), eq(lineageEdges.tenantId, tenantId)));
  }
}
