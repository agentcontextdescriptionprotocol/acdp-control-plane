import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { LineageEdge, lineageEdges } from '../db/schema';

export interface LineageEdgeInput {
  fromCtxId: string;
  toCtxId: string;
  runId?: string;
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
      })
      .onConflictDoNothing();
  }

  async listByRun(runId: string): Promise<LineageEdge[]> {
    return this.database.db
      .select()
      .from(lineageEdges)
      .where(eq(lineageEdges.runId, runId));
  }

  async listIncoming(ctxId: string): Promise<LineageEdge[]> {
    return this.database.db
      .select()
      .from(lineageEdges)
      .where(eq(lineageEdges.toCtxId, ctxId));
  }

  async listOutgoing(ctxId: string): Promise<LineageEdge[]> {
    return this.database.db
      .select()
      .from(lineageEdges)
      .where(eq(lineageEdges.fromCtxId, ctxId));
  }
}
