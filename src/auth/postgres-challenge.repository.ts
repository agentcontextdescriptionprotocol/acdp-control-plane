/**
 * Postgres-backed challenge store.
 *
 * Atomicity model:
 *   - `take()` uses `DELETE ... RETURNING` so two concurrent
 *     `POST /auth/token` calls cannot both receive the row.
 *   - The `WHERE expires_at > now` predicate filters expired entries
 *     in the same statement so a slow caller can't slip in after TTL.
 *
 * Sweep model: `evictExpired()` is called by the RevocationSweeper
 * (named generically — it also evicts old challenges) on an interval;
 * the row count returned is logged.
 */
import { Injectable } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { authChallenges } from '../db/schema';
import {
  ChallengeRecord,
  ChallengeRepository,
} from './challenge-repository';

@Injectable()
export class PostgresChallengeRepository implements ChallengeRepository {
  constructor(private readonly db: DatabaseService) {}

  async put(record: ChallengeRecord): Promise<void> {
    await this.db.db.insert(authChallenges).values({
      nonce: record.nonce,
      agentDid: record.agentDid,
      registryAuthority: record.registryAuthority,
      signingInput: record.signingInput,
      expiresAt: record.expiresAt,
    });
  }

  async take(nonce: string): Promise<ChallengeRecord | null> {
    // DELETE..RETURNING is atomic: only one concurrent caller's row
    // returns. The expires_at check filters TTL-expired rows in the
    // same statement so we don't leak expired challenges through.
    const result = await this.db.db.execute(
      sql`DELETE FROM auth_challenges
          WHERE nonce = ${nonce}
            AND expires_at > extract(epoch from now())
          RETURNING nonce, agent_did, registry_authority, signing_input, expires_at`,
    );
    const row = result.rows[0] as
      | {
          nonce: string;
          agent_did: string;
          registry_authority: string;
          signing_input: string;
          expires_at: string | number;
        }
      | undefined;
    if (!row) return null;
    return {
      nonce: row.nonce,
      agentDid: row.agent_did,
      registryAuthority: row.registry_authority,
      signingInput: row.signing_input,
      expiresAt: Number(row.expires_at),
    };
  }

  async evictExpired(): Promise<number> {
    const result = await this.db.db
      .delete(authChallenges)
      .where(lt(authChallenges.expiresAt, nowSeconds()))
      .returning({ nonce: authChallenges.nonce });
    return result.length;
  }

  async size(): Promise<number> {
    const result = await this.db.db.execute(
      sql`SELECT count(*)::int AS n FROM auth_challenges
          WHERE expires_at > extract(epoch from now())`,
    );
    return (result.rows[0] as { n: number })?.n ?? 0;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
