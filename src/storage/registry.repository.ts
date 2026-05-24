import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { Registry, registries } from '../db/schema';

@Injectable()
export class RegistryRepository {
  constructor(private readonly database: DatabaseService) {}

  async upsert(authority: string, baseUrl?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.database.db
      .insert(registries)
      .values({
        authority,
        baseUrl: baseUrl ?? null,
        firstSeen: now,
        lastSeen: now,
        eventCount: 1,
      })
      .onConflictDoUpdate({
        target: registries.authority,
        set: {
          lastSeen: now,
          eventCount: sql`${registries.eventCount} + 1`,
          ...(baseUrl ? { baseUrl } : {}),
        },
      });
  }

  async findByAuthority(authority: string): Promise<Registry | null> {
    const rows = await this.database.db
      .select()
      .from(registries)
      .where(eq(registries.authority, authority))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(): Promise<Registry[]> {
    return this.database.db
      .select()
      .from(registries)
      .orderBy(desc(registries.lastSeen));
  }
}
