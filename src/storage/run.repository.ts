import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, sql, SQL } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { Run, runs } from '../db/schema';

export interface ListRunsOptions {
  status?: string;
  scenarioId?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class RunRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Upsert a run record from an incoming event. New runs are created in
   * 'running' state; existing runs get their contexts_count and registries
   * updated.
   */
  async upsertFromEvent(
    runId: string,
    scenarioId: string,
    registryAuthority: string,
  ): Promise<void> {
    const existing = await this.database.db
      .select()
      .from(runs)
      .where(eq(runs.runId, runId))
      .limit(1);

    if (existing.length === 0) {
      await this.database.db.insert(runs).values({
        runId,
        scenarioId,
        status: 'running',
        contextsCount: 1,
        registries: registryAuthority ? [registryAuthority] : [],
      });
      return;
    }

    const current = existing[0];
    const updatedRegistries =
      !registryAuthority || current.registries.includes(registryAuthority)
        ? current.registries
        : [...current.registries, registryAuthority];

    await this.database.db
      .update(runs)
      .set({
        contextsCount: sql`${runs.contextsCount} + 1`,
        registries: updatedRegistries,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(runs.runId, runId));
  }

  async markComplete(
    runId: string,
    status: string,
    result?: Record<string, unknown>,
  ): Promise<Run> {
    const now = new Date().toISOString();
    await this.database.db
      .update(runs)
      .set({
        status,
        completedAt: now,
        result: result ?? null,
        updatedAt: now,
      })
      .where(eq(runs.runId, runId));
    return this.findByIdOrThrow(runId);
  }

  async findById(runId: string): Promise<Run | null> {
    const rows = await this.database.db
      .select()
      .from(runs)
      .where(eq(runs.runId, runId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdOrThrow(runId: string): Promise<Run> {
    const row = await this.findById(runId);
    if (!row) throw new NotFoundException(`run ${runId} not found`);
    return row;
  }

  async list(opts: ListRunsOptions): Promise<{ data: Run[]; total: number }> {
    const conditions: SQL[] = [];
    if (opts.status) conditions.push(eq(runs.status, opts.status));
    if (opts.scenarioId) conditions.push(eq(runs.scenarioId, opts.scenarioId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, totalResult] = await Promise.all([
      this.database.db
        .select()
        .from(runs)
        .where(where)
        .orderBy(desc(runs.startedAt))
        .limit(opts.limit)
        .offset(opts.offset),
      this.database.db.select({ value: count() }).from(runs).where(where),
    ]);

    return { data, total: Number(totalResult[0]?.value ?? 0) };
  }
}
