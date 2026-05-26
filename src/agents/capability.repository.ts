/**
 * Storage for agent capability declarations.
 *
 * `declare()` is idempotent — re-declaring the same `(agent_did,
 * capability_uri)` pair is a no-op (returns the prior row's
 * `declared_at`). Discovery queries are O(1) by capability_uri thanks
 * to the secondary index on `agent_capabilities.capability_uri`.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { agentCapabilities, AgentCapability, NewAgentCapability } from '../db/schema';

export interface CapabilityRow {
  agentDid: string;
  capabilityUri: string;
  declaredAt: string;
  signedBy: string;
}

@Injectable()
export class CapabilityRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Insert-or-no-op. Returns the stored `(agentDid, capabilityUri,
   * declaredAt)` triple — the caller surfaces `declaredAt` so the
   * agent can observe the server-pinned timestamp.
   */
  async declare(row: NewAgentCapability): Promise<CapabilityRow> {
    const inserted = await this.db.db
      .insert(agentCapabilities)
      .values(row)
      .onConflictDoNothing({
        target: [agentCapabilities.agentDid, agentCapabilities.capabilityUri],
      })
      .returning();
    if (inserted.length > 0) return rowToTriple(inserted[0]!);

    // Already exists — return the existing row's metadata.
    const existing = await this.db.db
      .select()
      .from(agentCapabilities)
      .where(
        and(
          eq(agentCapabilities.agentDid, row.agentDid),
          eq(agentCapabilities.capabilityUri, row.capabilityUri),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      // ON CONFLICT + RETURNING-empty + SELECT-empty implies the row
      // was deleted between the two statements — return what the
      // caller gave us as the best-effort answer.
      return {
        agentDid: row.agentDid,
        capabilityUri: row.capabilityUri,
        declaredAt: new Date().toISOString(),
        signedBy: row.signedBy,
      };
    }
    return rowToTriple(existing[0]!);
  }

  async findByAgent(agentDid: string): Promise<CapabilityRow[]> {
    const rows = await this.db.db
      .select()
      .from(agentCapabilities)
      .where(eq(agentCapabilities.agentDid, agentDid));
    return rows.map(rowToTriple);
  }

  async findByCapability(capabilityUri: string): Promise<CapabilityRow[]> {
    const rows = await this.db.db
      .select()
      .from(agentCapabilities)
      .where(eq(agentCapabilities.capabilityUri, capabilityUri));
    return rows.map(rowToTriple);
  }
}

function rowToTriple(r: AgentCapability): CapabilityRow {
  return {
    agentDid: r.agentDid,
    capabilityUri: r.capabilityUri,
    declaredAt: r.declaredAt,
    signedBy: r.signedBy,
  };
}
