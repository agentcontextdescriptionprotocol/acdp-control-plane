import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { Agent, agents } from '../db/schema';

@Injectable()
export class AgentRepository {
  constructor(private readonly database: DatabaseService) {}

  async upsert(agentDid: string, registryAuthority?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.database.db
      .insert(agents)
      .values({
        agentDid,
        firstSeen: now,
        lastSeen: now,
        registryAuthority: registryAuthority || null,
        contextCount: 1,
      })
      .onConflictDoUpdate({
        target: agents.agentDid,
        set: {
          lastSeen: now,
          contextCount: sql`${agents.contextCount} + 1`,
          ...(registryAuthority
            ? { registryAuthority: registryAuthority }
            : {}),
        },
      });
  }

  async findByDid(agentDid: string): Promise<Agent | null> {
    const rows = await this.database.db
      .select()
      .from(agents)
      .where(eq(agents.agentDid, agentDid))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(limit = 200): Promise<Agent[]> {
    return this.database.db
      .select()
      .from(agents)
      .orderBy(desc(agents.lastSeen))
      .limit(limit);
  }
}
