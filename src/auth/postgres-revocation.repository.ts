import { Injectable } from '@nestjs/common';
import { eq, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { revokedTokens } from '../db/schema';
import {
  RevocationRecord,
  RevocationRepository,
} from './revocation-repository';

@Injectable()
export class PostgresRevocationRepository implements RevocationRepository {
  constructor(private readonly db: DatabaseService) {}

  async revoke(record: RevocationRecord): Promise<boolean> {
    // ON CONFLICT DO NOTHING so duplicate revocations are idempotent
    // and we don't leak the existence of a token via 409s. The
    // affected-row count tells us whether this was a new revocation.
    const result = await this.db.db.execute(
      sql`INSERT INTO revoked_tokens (jti, sub, iss, exp, revoked_by, reason)
          VALUES (${record.jti}, ${record.sub}, ${record.iss}, ${record.exp},
                  ${record.revokedBy}, ${record.reason})
          ON CONFLICT (jti) DO NOTHING
          RETURNING jti`,
    );
    return result.rows.length > 0;
  }

  async isRevoked(jti: string): Promise<boolean> {
    const result = await this.db.db.execute(
      sql`SELECT 1 FROM revoked_tokens
          WHERE jti = ${jti} AND exp > extract(epoch from now())
          LIMIT 1`,
    );
    return result.rows.length > 0;
  }

  async get(jti: string): Promise<RevocationRecord | null> {
    const rows = await this.db.db
      .select()
      .from(revokedTokens)
      .where(eq(revokedTokens.jti, jti))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      jti: row.jti,
      sub: row.sub,
      iss: row.iss,
      exp: Number(row.exp),
      revokedBy: row.revokedBy,
      reason: (row.reason ?? 'unspecified') as RevocationRecord['reason'],
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
    };
  }

  async evictExpired(): Promise<number> {
    const result = await this.db.db
      .delete(revokedTokens)
      .where(lt(revokedTokens.exp, nowSeconds()))
      .returning({ jti: revokedTokens.jti });
    return result.length;
  }

  async size(): Promise<number> {
    const result = await this.db.db.execute(
      sql`SELECT count(*)::int AS n FROM revoked_tokens
          WHERE exp > extract(epoch from now())`,
    );
    return (result.rows[0] as { n: number })?.n ?? 0;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
